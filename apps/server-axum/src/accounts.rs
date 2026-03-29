use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};

use crate::{
    auth::AuthenticatedUser,
    config::normalize_email,
    error::ApiError,
    models::{BusinessRole, PaginatedResponse, PaginationQuery, PlatformRole, UserRecord},
    AppState,
};

#[derive(Debug, Serialize)]
pub struct ProfileResponse {
    pub id: i64,
    pub email: String,
    pub role: PlatformRole,
    pub business_role: BusinessRole,
    pub phone: Option<String>,
    pub agency_id: Option<i64>,
    pub billing_account_id: Option<i64>,
    pub is_verified: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub phone: Option<String>,
    pub business_role: Option<BusinessRole>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAgencyRequest {
    pub company_name: String,
    pub nip: String,
    pub address: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAgencyRequest {
    pub company_name: Option<String>,
    pub nip: Option<String>,
    pub address: Option<String>,
    pub is_verified: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ListAgenciesQuery {
    pub company_name: Option<String>,
    pub page: Option<u64>,
    pub per_page: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct AgencyResponse {
    pub id: i64,
    pub billing_account_id: i64,
    pub company_name: String,
    pub nip: String,
    pub address: String,
    pub is_verified: bool,
    pub created_at: String,
    pub updated_at: String,
}

pub async fn get_profile_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
) -> Result<Json<ProfileResponse>, ApiError> {
    let user = find_user_by_id(&state.db, auth_user.id)
        .await?
        .ok_or_else(|| ApiError::not_found("user_not_found", "User was not found"))?;
    Ok(Json(ProfileResponse::from(user)))
}

pub async fn update_profile_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Json(payload): Json<UpdateProfileRequest>,
) -> Result<Json<ProfileResponse>, ApiError> {
    let current = find_user_by_id(&state.db, auth_user.id)
        .await?
        .ok_or_else(|| ApiError::not_found("user_not_found", "User was not found"))?;

    let next_phone = payload
        .phone
        .map(|value| normalize_phone(Some(value)))
        .unwrap_or_else(|| current.phone.clone());
    let next_business_role = payload.business_role.unwrap_or(current.business_role);

    let row = sqlx::query(
        r#"
        UPDATE users
        SET phone = $1,
            business_role = $2,
            updated_at = now()
        WHERE id = $3
        RETURNING id, email, password_hash, role, business_role, phone, agency_id, billing_account_id, is_verified
        "#,
    )
    .bind(next_phone)
    .bind(next_business_role.as_str())
    .bind(auth_user.id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(ProfileResponse::from(map_user_row(row)?)))
}

pub async fn list_agencies_handler(
    State(state): State<AppState>,
    Query(query): Query<ListAgenciesQuery>,
) -> Result<Json<PaginatedResponse<AgencyResponse>>, ApiError> {
    let pagination = PaginationQuery {
        page: query.page,
        per_page: query.per_page,
    }
    .normalize();

    let name_filter = query
        .company_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let total_row = sqlx::query(
        r#"
        SELECT COUNT(*) AS total
        FROM agencies
        WHERE ($1::text IS NULL OR company_name ILIKE '%' || $1 || '%')
        "#,
    )
    .bind(name_filter.clone())
    .fetch_one(&state.db)
    .await?;
    let total: i64 = total_row.try_get("total").map_err(ApiError::from)?;

    let rows = sqlx::query(
        r#"
        SELECT id, billing_account_id, company_name, nip, address, is_verified,
               created_at::text AS created_at,
               updated_at::text AS updated_at
        FROM agencies
        WHERE ($1::text IS NULL OR company_name ILIKE '%' || $1 || '%')
        ORDER BY id ASC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(name_filter)
    .bind(pagination.limit)
    .bind(pagination.offset)
    .fetch_all(&state.db)
    .await?;

    let items = rows
        .into_iter()
        .map(map_agency_row)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Json(PaginatedResponse::new(
        items,
        pagination,
        total as u64,
    )))
}

pub async fn create_agency_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Json(payload): Json<CreateAgencyRequest>,
) -> Result<(StatusCode, Json<AgencyResponse>), ApiError> {
    require_business_roles(&auth_user, &[BusinessRole::Agent])?;
    let company_name = required_text(&payload.company_name, "company_name")?;
    let nip = required_text(&payload.nip, "nip")?;
    let address = required_text(&payload.address, "address")?;

    let mut tx = state.db.begin().await?;

    let billing_row = sqlx::query(
        r#"
        INSERT INTO billing_accounts (account_type)
        VALUES ('agency')
        RETURNING id
        "#,
    )
    .fetch_one(&mut *tx)
    .await?;
    let billing_account_id: i64 = billing_row.try_get("id").map_err(ApiError::from)?;

    let agency_row = sqlx::query(
        r#"
        INSERT INTO agencies (billing_account_id, company_name, nip, address)
        VALUES ($1, $2, $3, $4)
        RETURNING id, billing_account_id, company_name, nip, address, is_verified,
                  created_at::text AS created_at,
                  updated_at::text AS updated_at
        "#,
    )
    .bind(billing_account_id)
    .bind(&company_name)
    .bind(&nip)
    .bind(&address)
    .fetch_one(&mut *tx)
    .await?;

    let agency = map_agency_row(agency_row)?;

    if !is_platform_admin(&auth_user) && auth_user.agency_id.is_none() {
        sqlx::query(
            r#"
            UPDATE users
            SET agency_id = $1,
                updated_at = now()
            WHERE id = $2
            "#,
        )
        .bind(agency.id)
        .bind(auth_user.id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    Ok((StatusCode::CREATED, Json(agency)))
}

pub async fn get_agency_handler(
    State(state): State<AppState>,
    Path(agency_id): Path<i64>,
) -> Result<Json<AgencyResponse>, ApiError> {
    let agency = get_agency(&state.db, agency_id)
        .await?
        .ok_or_else(|| ApiError::not_found("agency_not_found", "Agency was not found"))?;
    Ok(Json(agency))
}

pub async fn update_agency_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Path(agency_id): Path<i64>,
    Json(payload): Json<UpdateAgencyRequest>,
) -> Result<Json<AgencyResponse>, ApiError> {
    if !is_platform_admin(&auth_user) && auth_user.agency_id != Some(agency_id) {
        return Err(ApiError::forbidden(
            "forbidden",
            "You do not have permission to manage this agency",
        ));
    }

    let current = get_agency(&state.db, agency_id)
        .await?
        .ok_or_else(|| ApiError::not_found("agency_not_found", "Agency was not found"))?;

    let row = sqlx::query(
        r#"
        UPDATE agencies
        SET company_name = $1,
            nip = $2,
            address = $3,
            is_verified = $4,
            updated_at = now()
        WHERE id = $5
        RETURNING id, billing_account_id, company_name, nip, address, is_verified,
                  created_at::text AS created_at,
                  updated_at::text AS updated_at
        "#,
    )
    .bind(payload.company_name.unwrap_or(current.company_name))
    .bind(payload.nip.unwrap_or(current.nip))
    .bind(payload.address.unwrap_or(current.address))
    .bind(payload.is_verified.unwrap_or(current.is_verified))
    .bind(agency_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(map_agency_row(row)?))
}

pub async fn create_user(
    pool: &PgPool,
    email: &str,
    password: &str,
    role: PlatformRole,
    business_role: BusinessRole,
) -> Result<UserRecord, ApiError> {
    let normalized_email = validate_email(email)?;
    validate_password(password)?;
    let password_hash = crate::auth::hash_password(password)?;

    let result = sqlx::query(
        r#"
        INSERT INTO users (email, password_hash, role, business_role)
        VALUES ($1, $2, $3, $4)
        RETURNING id, email, password_hash, role, business_role, phone, agency_id, billing_account_id, is_verified
        "#,
    )
    .bind(&normalized_email)
    .bind(&password_hash)
    .bind(role.as_str())
    .bind(business_role.as_str())
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
        SELECT id, email, password_hash, role, business_role, phone, agency_id, billing_account_id, is_verified
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
        SELECT id, email, password_hash, role, business_role, phone, agency_id, billing_account_id, is_verified
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    row.map(map_user_row).transpose()
}

pub async fn get_agency(pool: &PgPool, agency_id: i64) -> Result<Option<AgencyResponse>, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT id, billing_account_id, company_name, nip, address, is_verified,
               created_at::text AS created_at,
               updated_at::text AS updated_at
        FROM agencies
        WHERE id = $1
        "#,
    )
    .bind(agency_id)
    .fetch_optional(pool)
    .await?;

    row.map(map_agency_row).transpose()
}

pub fn is_platform_admin(user: &AuthenticatedUser) -> bool {
    user.role == PlatformRole::Admin
}

pub fn require_business_roles(
    user: &AuthenticatedUser,
    allowed_roles: &[BusinessRole],
) -> Result<(), ApiError> {
    if is_platform_admin(user) || allowed_roles.contains(&user.business_role) {
        return Ok(());
    }

    Err(ApiError::forbidden(
        "forbidden",
        "You do not have permission to access this resource",
    ))
}

fn map_user_row(row: sqlx::postgres::PgRow) -> Result<UserRecord, ApiError> {
    let role: String = row.try_get("role").map_err(ApiError::from)?;
    let business_role: String = row.try_get("business_role").map_err(ApiError::from)?;

    Ok(UserRecord {
        id: row.try_get("id").map_err(ApiError::from)?,
        email: row.try_get("email").map_err(ApiError::from)?,
        password_hash: row.try_get("password_hash").map_err(ApiError::from)?,
        role: PlatformRole::try_from(role)
            .map_err(|_| ApiError::internal("invalid_role", "Stored user role is invalid"))?,
        business_role: BusinessRole::try_from(business_role).map_err(|_| {
            ApiError::internal("invalid_business_role", "Stored business role is invalid")
        })?,
        phone: row.try_get("phone").map_err(ApiError::from)?,
        agency_id: row.try_get("agency_id").map_err(ApiError::from)?,
        billing_account_id: row.try_get("billing_account_id").map_err(ApiError::from)?,
        is_verified: row.try_get("is_verified").map_err(ApiError::from)?,
    })
}

fn map_agency_row(row: sqlx::postgres::PgRow) -> Result<AgencyResponse, ApiError> {
    Ok(AgencyResponse {
        id: row.try_get("id").map_err(ApiError::from)?,
        billing_account_id: row.try_get("billing_account_id").map_err(ApiError::from)?,
        company_name: row.try_get("company_name").map_err(ApiError::from)?,
        nip: row.try_get("nip").map_err(ApiError::from)?,
        address: row.try_get("address").map_err(ApiError::from)?,
        is_verified: row.try_get("is_verified").map_err(ApiError::from)?,
        created_at: row.try_get("created_at").map_err(ApiError::from)?,
        updated_at: row.try_get("updated_at").map_err(ApiError::from)?,
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

fn required_text(value: &str, field: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::bad_request(
            format!("invalid_{field}"),
            format!("{field} must not be empty"),
        ));
    }
    Ok(trimmed.to_string())
}

fn normalize_phone(phone: Option<String>) -> Option<String> {
    phone.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

impl From<UserRecord> for ProfileResponse {
    fn from(value: UserRecord) -> Self {
        Self {
            id: value.id,
            email: value.email,
            role: value.role,
            business_role: value.business_role,
            phone: value.phone,
            agency_id: value.agency_id,
            billing_account_id: value.billing_account_id,
            is_verified: value.is_verified,
        }
    }
}
