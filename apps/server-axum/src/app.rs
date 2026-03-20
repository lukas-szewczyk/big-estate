use axum::{
    http::{header, HeaderValue, Method, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use sqlx::{postgres::PgPoolOptions, PgPool};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::{auth, config::Config, error::ApiError, users};

#[derive(Clone, Debug)]
pub struct AppState {
    pub db: PgPool,
    pub config: Config,
}

#[derive(Debug, Serialize)]
struct RootResponse {
    message: &'static str,
}

pub async fn create_state(config: Config) -> Result<AppState, ApiError> {
    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await
        .map_err(ApiError::from)?;

    Ok(AppState { db, config })
}

pub fn build_app(state: AppState) -> Result<Router, ApiError> {
    let allow_origin = HeaderValue::from_str(&state.config.frontend_origin).map_err(|_| {
        ApiError::internal(
            "invalid_frontend_origin",
            "FRONTEND_ORIGIN must be a valid header value",
        )
    })?;

    let cors = CorsLayer::new()
        .allow_origin(allow_origin)
        .allow_credentials(true)
        .allow_headers([header::CONTENT_TYPE])
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS]);

    Ok(Router::new()
        .route("/", get(root_handler))
        .route("/health", get(health_handler))
        .route("/auth/login", post(auth::login_handler))
        .route("/auth/register", post(auth::register_handler))
        .route("/auth/logout", post(auth::logout_handler))
        .route("/auth/me", get(auth::me_handler))
        .route(
            "/users",
            post(users::create_user_handler).get(users::list_users_handler),
        )
        .route(
            "/users/:id",
            get(users::get_user_handler).delete(users::delete_user_handler),
        )
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state))
}

async fn root_handler() -> Json<RootResponse> {
    Json(RootResponse {
        message: "server-axum auth API",
    })
}

async fn health_handler() -> StatusCode {
    StatusCode::OK
}
