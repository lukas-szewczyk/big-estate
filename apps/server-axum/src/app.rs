use axum::{
    http::{header, HeaderValue, Method, StatusCode},
    routing::{delete, get, post},
    Json, Router,
};
use serde::Serialize;
use sqlx::{postgres::PgPoolOptions, PgPool};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::{
    accounts, auth, config::Config, engagement, error::ApiError, geo, listings, properties,
};

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
        .max_connections(10)
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
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ]);

    let api_v1 = Router::new()
        .route(
            "/profile",
            get(accounts::get_profile_handler).patch(accounts::update_profile_handler),
        )
        .route(
            "/agencies",
            get(accounts::list_agencies_handler).post(accounts::create_agency_handler),
        )
        .route(
            "/agencies/:id",
            get(accounts::get_agency_handler).patch(accounts::update_agency_handler),
        )
        .route(
            "/dictionaries/voivodeships",
            get(geo::list_voivodeships_handler),
        )
        .route("/cities", get(geo::list_cities_handler))
        .route("/districts", get(geo::list_districts_handler))
        .route("/categories", get(geo::list_categories_handler))
        .route("/amenities", get(geo::list_amenities_handler))
        .route(
            "/properties",
            get(properties::list_properties_handler).post(properties::create_property_handler),
        )
        .route(
            "/properties/:id",
            get(properties::get_property_handler).patch(properties::update_property_handler),
        )
        .route(
            "/listings",
            get(listings::list_listings_handler).post(listings::create_listing_handler),
        )
        .route(
            "/listings/geojson",
            get(listings::list_listings_geojson_handler),
        )
        .route(
            "/listings/:id",
            get(listings::get_listing_handler).patch(listings::update_listing_handler),
        )
        .route("/listings/:id/media", post(listings::add_media_handler))
        .route(
            "/listings/:id/open-houses",
            post(listings::add_open_house_handler),
        )
        .route(
            "/wishlists",
            get(engagement::list_wishlists_handler).post(engagement::create_wishlist_handler),
        )
        .route(
            "/wishlists/:id",
            get(engagement::get_wishlist_handler)
                .patch(engagement::update_wishlist_handler)
                .delete(engagement::delete_wishlist_handler),
        )
        .route(
            "/wishlists/:id/items",
            post(engagement::add_wishlist_item_handler),
        )
        .route(
            "/wishlists/:id/items/:item_id",
            delete(engagement::delete_wishlist_item_handler),
        )
        .route(
            "/conversations",
            get(engagement::list_conversations_handler)
                .post(engagement::create_conversation_handler),
        )
        .route(
            "/conversations/:id/messages",
            get(engagement::list_messages_handler).post(engagement::create_message_handler),
        );

    Ok(Router::new()
        .route("/", get(root_handler))
        .route("/health", get(health_handler))
        .route("/auth/login", post(auth::login_handler))
        .route("/auth/register", post(auth::register_handler))
        .route("/auth/logout", post(auth::logout_handler))
        .route("/auth/me", get(auth::me_handler))
        .nest("/api/v1", api_v1)
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state))
}

async fn root_handler() -> Json<RootResponse> {
    Json(RootResponse {
        message: "server-axum real estate API",
    })
}

async fn health_handler() -> StatusCode {
    StatusCode::OK
}
