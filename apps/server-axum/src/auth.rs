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
    accounts::{create_user, find_user_by_email},
    config::normalize_email,
    error::ApiError,
    models::{BusinessRole, PlatformRole, PublicUser},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    email: String,
    password: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    email: String,
    password: String,
}

#[derive(Clone, Debug)]
pub struct AuthenticatedUser {
    pub id: i64,
    pub email: String,
    pub role: PlatformRole,
    pub business_role: BusinessRole,
    pub agency_id: Option<i64>,
    pub is_verified: bool,
}

impl AuthenticatedUser {
    pub fn public(&self) -> PublicUser {
        PublicUser {
            id: self.id,
            email: self.email.clone(),
            role: self.role,
            business_role: self.business_role,
            agency_id: self.agency_id,
            is_verified: self.is_verified,
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

    let cookie = create_session_cookie(&state, user.id).await?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    append_cookie(&mut response, &cookie)?;
    Ok(response)
}

pub async fn register_handler(
    State(state): State<AppState>,
    Json(payload): Json<RegisterRequest>,
) -> Result<Response, ApiError> {
    let user = create_user(
        &state.db,
        &payload.email,
        &payload.password,
        PlatformRole::User,
        BusinessRole::Buyer,
    )
    .await?;
    let cookie = create_session_cookie(&state, user.id).await?;
    let mut response = (StatusCode::CREATED, Json(user.public())).into_response();
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

pub async fn lookup_authenticated_user(
    pool: &PgPool,
    session_token: &str,
) -> Result<AuthenticatedUser, ApiError> {
    let token_hash = hash_session_token(session_token);
    let row = sqlx::query(
        r#"
        SELECT users.id, users.email, users.role, users.business_role, users.agency_id, users.is_verified
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
    let business_role: String =
        sqlx::Row::try_get(&row, "business_role").map_err(ApiError::from)?;

    Ok(AuthenticatedUser {
        id: sqlx::Row::try_get(&row, "id").map_err(ApiError::from)?,
        email: sqlx::Row::try_get(&row, "email").map_err(ApiError::from)?,
        role: PlatformRole::try_from(role)
            .map_err(|_| ApiError::internal("invalid_role", "Stored user role is invalid"))?,
        business_role: BusinessRole::try_from(business_role).map_err(|_| {
            ApiError::internal("invalid_business_role", "Stored business role is invalid")
        })?,
        agency_id: sqlx::Row::try_get(&row, "agency_id").map_err(ApiError::from)?,
        is_verified: sqlx::Row::try_get(&row, "is_verified").map_err(ApiError::from)?,
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

fn verify_password(password: &str, password_hash: &str) -> Result<(), ApiError> {
    let parsed_hash = PasswordHash::new(password_hash).map_err(|_| invalid_credentials())?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|_| invalid_credentials())
}

async fn create_session_cookie(
    state: &AppState,
    user_id: i64,
) -> Result<Cookie<'static>, ApiError> {
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
    .bind(user_id)
    .bind(&session_token_hash)
    .bind(expires_at)
    .execute(&state.db)
    .await?;

    Ok(build_session_cookie(state, &session_token))
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

fn generate_session_token() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    Base64UrlUnpadded::encode_string(&bytes)
}

fn hash_session_token(session_token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(session_token.as_bytes());
    hex::encode(hasher.finalize())
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
