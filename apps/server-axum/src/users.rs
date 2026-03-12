use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgQueryResult, PgPool, Row};

use crate::{
    auth::AuthenticatedUser,
    config::normalize_email,
    error::ApiError,
    models::{PublicUser, UserRecord, UserRole},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub email: String,
    pub password: String,
    pub role: UserRole,
}

#[derive(Debug, Deserialize)]
pub struct ListUsersQuery {
    pub email: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ListUsersResponse {
    pub items: Vec<PublicUser>,
}

pub async fn create_user_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Json(payload): Json<CreateUserRequest>,
) -> Result<(axum::http::StatusCode, Json<PublicUser>), ApiError> {
    require_admin(&auth_user)?;
    let user = create_user(&state.db, &payload.email, &payload.password, payload.role).await?;
    Ok((axum::http::StatusCode::CREATED, Json(user.public())))
}

pub async fn list_users_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Query(query): Query<ListUsersQuery>,
) -> Result<Json<ListUsersResponse>, ApiError> {
    require_admin(&auth_user)?;
    let users = list_users(&state.db, query.email).await?;
    Ok(Json(ListUsersResponse {
        items: users.into_iter().map(|user| user.public()).collect(),
    }))
}

pub async fn get_user_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Path(user_id): Path<i64>,
) -> Result<Json<PublicUser>, ApiError> {
    require_admin(&auth_user)?;
    let user = find_user_by_id(&state.db, user_id)
        .await?
        .ok_or_else(|| ApiError::not_found("user_not_found", "User was not found"))?;
    Ok(Json(user.public()))
}

pub async fn delete_user_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Path(user_id): Path<i64>,
) -> Result<axum::http::StatusCode, ApiError> {
    require_admin(&auth_user)?;
    if auth_user.id == user_id {
        return Err(ApiError::conflict(
            "self_delete_forbidden",
            "You cannot delete the currently authenticated user",
        ));
    }

    let deleted = delete_user(&state.db, user_id).await?;
    if !deleted {
        return Err(ApiError::not_found("user_not_found", "User was not found"));
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub fn require_admin(user: &AuthenticatedUser) -> Result<(), ApiError> {
    if user.role != UserRole::Admin {
        return Err(ApiError::forbidden(
            "forbidden",
            "You do not have permission to access this resource",
        ));
    }
    Ok(())
}

pub async fn create_user(
    pool: &PgPool,
    email: &str,
    password: &str,
    role: UserRole,
) -> Result<UserRecord, ApiError> {
    let normalized_email = validate_email(email)?;
    validate_password(password)?;
    let password_hash = crate::auth::hash_password(password)?;

    let result = sqlx::query(
        r#"
        INSERT INTO users (email, password_hash, role)
        VALUES ($1, $2, $3)
        RETURNING id, email, password_hash, role
        "#,
    )
    .bind(&normalized_email)
    .bind(&password_hash)
    .bind(role.as_str())
    .fetch_one(pool)
    .await;

    match result {
        Ok(row) => map_user_row(row),
        Err(sqlx::Error::Database(database_error))
            if database_error.code().as_deref() == Some("23505") =>
        {
            Err(ApiError::conflict(
                "duplicate_email",
                "A user with this email already exists",
            ))
        }
        Err(error) => Err(error.into()),
    }
}

pub async fn find_user_by_email(
    pool: &PgPool,
    email: &str,
) -> Result<Option<UserRecord>, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT id, email, password_hash, role
        FROM users
        WHERE email = $1
        "#,
    )
    .bind(normalize_email(email.to_string()))
    .fetch_optional(pool)
    .await?;

    row.map(map_user_row).transpose()
}

pub async fn find_user_by_id(pool: &PgPool, user_id: i64) -> Result<Option<UserRecord>, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT id, email, password_hash, role
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    row.map(map_user_row).transpose()
}

pub async fn list_users(
    pool: &PgPool,
    email_filter: Option<String>,
) -> Result<Vec<UserRecord>, ApiError> {
    let rows = if let Some(email) = email_filter {
        let normalized_email = validate_email(&email)?;
        sqlx::query(
            r#"
            SELECT id, email, password_hash, role
            FROM users
            WHERE email = $1
            ORDER BY id ASC
            "#,
        )
        .bind(normalized_email)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query(
            r#"
            SELECT id, email, password_hash, role
            FROM users
            ORDER BY id ASC
            "#,
        )
        .fetch_all(pool)
        .await?
    };

    rows.into_iter().map(map_user_row).collect()
}

pub async fn delete_user(pool: &PgPool, user_id: i64) -> Result<bool, ApiError> {
    let result: PgQueryResult = sqlx::query(
        r#"
        DELETE FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() == 1)
}

fn map_user_row(row: sqlx::postgres::PgRow) -> Result<UserRecord, ApiError> {
    let role: String = row.try_get("role").map_err(ApiError::from)?;
    Ok(UserRecord {
        id: row.try_get("id").map_err(ApiError::from)?,
        email: row.try_get("email").map_err(ApiError::from)?,
        password_hash: row.try_get("password_hash").map_err(ApiError::from)?,
        role: UserRole::try_from(role)
            .map_err(|_| ApiError::internal("invalid_role", "Stored user role is invalid"))?,
    })
}

fn validate_email(email: &str) -> Result<String, ApiError> {
    let normalized_email = normalize_email(email.to_string());
    if normalized_email.is_empty() || !normalized_email.contains('@') {
        return Err(ApiError::bad_request(
            "invalid_email",
            "Email must be a valid e-mail address",
        ));
    }
    Ok(normalized_email)
}

fn validate_password(password: &str) -> Result<(), ApiError> {
    if password.trim().is_empty() {
        return Err(ApiError::bad_request(
            "invalid_password",
            "Password must not be empty",
        ));
    }
    Ok(())
}
