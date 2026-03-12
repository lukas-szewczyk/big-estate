use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use async_trait::async_trait;
use axum::{
    extract::{FromRef, FromRequestParts, State},
    http::{header, request::Parts, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use axum_extra::extract::cookie::{Cookie, SameSite};
use base64ct::{Base64UrlUnpadded, Encoding};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use time::Duration;

use crate::{
    config::normalize_email,
    error::ApiError,
    models::{PublicUser, UserRole},
    users::find_user_by_email,
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    email: String,
    password: String,
}

#[derive(Clone, Debug)]
pub struct AuthenticatedUser {
    pub id: i64,
    pub email: String,
    pub role: UserRole,
    pub token_hash: String,
}

impl AuthenticatedUser {
    pub fn public(&self) -> PublicUser {
        PublicUser {
            id: self.id,
            email: self.email.clone(),
            role: self.role,
        }
    }
}

pub async fn login_handler(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Response, ApiError> {
    let email = normalize_email(payload.email);
    let user = find_user_by_email(&state.db, &email)
        .await?
        .ok_or_else(invalid_credentials)?;

    verify_password(&payload.password, &user.password_hash)?;

    let session_token = generate_session_token();
    let session_token_hash = hash_session_token(&session_token);
    let expires_at =
        time::OffsetDateTime::now_utc() + Duration::days(state.config.session_ttl_days);

    sqlx::query(
        r#"
        INSERT INTO sessions (user_id, token_hash, expires_at)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(user.id)
    .bind(&session_token_hash)
    .bind(expires_at)
    .execute(&state.db)
    .await?;

    let cookie = build_session_cookie(&state, &session_token);
    let mut response = StatusCode::NO_CONTENT.into_response();
    append_cookie(&mut response, &cookie)?;
    Ok(response)
}

pub async fn logout_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    if let Some(token) = read_session_token(&headers, &state.config.auth_cookie_name) {
        let token_hash = hash_session_token(&token);
        sqlx::query(
            r#"
            UPDATE sessions
            SET revoked_at = now()
            WHERE token_hash = $1 AND revoked_at IS NULL
            "#,
        )
        .bind(token_hash)
        .execute(&state.db)
        .await?;
    }

    let mut response = StatusCode::NO_CONTENT.into_response();
    append_cookie(&mut response, &removal_cookie(&state))?;
    Ok(response)
}

pub async fn me_handler(auth_user: AuthenticatedUser) -> Result<Json<PublicUser>, ApiError> {
    Ok(Json(auth_user.public()))
}

#[async_trait]
impl<S> FromRequestParts<S> for AuthenticatedUser
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let state = AppState::from_ref(state);
        let headers = parts.headers.clone();
        let token = read_session_token(&headers, &state.config.auth_cookie_name)
            .ok_or_else(unauthorized)?;
        lookup_authenticated_user(&state.db, &token).await
    }
}

pub fn hash_password(password: &str) -> Result<String, ApiError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| {
            ApiError::internal(
                "password_hash_failed",
                "Password hashing failed unexpectedly",
            )
        })
}

fn verify_password(password: &str, password_hash: &str) -> Result<(), ApiError> {
    let parsed_hash = PasswordHash::new(password_hash).map_err(|_| invalid_credentials())?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|_| invalid_credentials())
}

pub async fn lookup_authenticated_user(
    pool: &PgPool,
    session_token: &str,
) -> Result<AuthenticatedUser, ApiError> {
    let token_hash = hash_session_token(session_token);
    let row = sqlx::query(
        r#"
        SELECT users.id, users.email, users.role
        FROM sessions
        INNER JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = $1
          AND sessions.revoked_at IS NULL
          AND sessions.expires_at > now()
        "#,
    )
    .bind(&token_hash)
    .fetch_optional(pool)
    .await?;

    let row = row.ok_or_else(unauthorized)?;
    let role: String = sqlx::Row::try_get(&row, "role").map_err(ApiError::from)?;

    Ok(AuthenticatedUser {
        id: sqlx::Row::try_get(&row, "id").map_err(ApiError::from)?,
        email: sqlx::Row::try_get(&row, "email").map_err(ApiError::from)?,
        role: UserRole::try_from(role)
            .map_err(|_| ApiError::internal("invalid_role", "Stored user role is invalid"))?,
        token_hash,
    })
}

pub fn build_session_cookie(state: &AppState, session_token: &str) -> Cookie<'static> {
    let mut cookie = Cookie::build((
        state.config.auth_cookie_name.clone(),
        session_token.to_string(),
    ))
    .http_only(true)
    .path("/")
    .same_site(SameSite::Lax)
    .secure(state.config.auth_cookie_secure)
    .max_age(Duration::days(state.config.session_ttl_days))
    .build();

    if let Some(domain) = &state.config.auth_cookie_domain {
        cookie.set_domain(domain.clone());
    }

    cookie
}

fn removal_cookie(state: &AppState) -> Cookie<'static> {
    let mut cookie = Cookie::build((state.config.auth_cookie_name.clone(), String::new()))
        .http_only(true)
        .path("/")
        .same_site(SameSite::Lax)
        .secure(state.config.auth_cookie_secure)
        .build();

    if let Some(domain) = &state.config.auth_cookie_domain {
        cookie.set_domain(domain.clone());
    }

    cookie.make_removal();
    cookie
}

fn append_cookie(response: &mut Response, cookie: &Cookie<'_>) -> Result<(), ApiError> {
    let header_value = HeaderValue::from_str(&cookie.to_string()).map_err(|_| {
        ApiError::internal(
            "invalid_cookie",
            "Failed to serialize the authentication cookie",
        )
    })?;
    response
        .headers_mut()
        .append(header::SET_COOKIE, header_value);
    Ok(())
}

fn read_session_token(headers: &HeaderMap, cookie_name: &str) -> Option<String> {
    let raw_cookie = headers.get(header::COOKIE)?.to_str().ok()?;
    raw_cookie.split(';').find_map(|entry| {
        let (name, value) = entry.trim().split_once('=')?;
        (name == cookie_name).then(|| value.to_string())
    })
}

fn hash_session_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    hex::encode(digest)
}

fn generate_session_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    Base64UrlUnpadded::encode_string(&bytes)
}

fn invalid_credentials() -> ApiError {
    ApiError::unauthorized("invalid_credentials", "Email or password is incorrect")
}

fn unauthorized() -> ApiError {
    ApiError::unauthorized(
        "unauthorized",
        "Authentication is required to access this resource",
    )
}
