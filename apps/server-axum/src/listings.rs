use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};

use crate::{
    accounts::is_platform_admin,
    auth::AuthenticatedUser,
    error::ApiError,
    models::{
        parse_db_f64, slugify, BusinessRole, ListingStatus, MediaType, PaginatedResponse,
        PaginationQuery, TransactionType,
    },
    properties::{load_property, PropertyResponse},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct CreateListingRequest {
    pub property_id: i64,
    pub seller_user_id: Option<i64>,
    pub transaction_type: TransactionType,
    pub price: f64,
    pub status: Option<ListingStatus>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateListingRequest {
    pub price: Option<f64>,
    pub status: Option<ListingStatus>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddMediaRequest {
    pub media_type: MediaType,
    pub url: String,
    pub is_main: Option<bool>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct AddOpenHouseRequest {
    pub start_time: String,
    pub end_time: String,
    pub requires_registration: Option<bool>,
    pub instructions: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListListingsQuery {
    pub city_id: Option<i64>,
    pub category_id: Option<i64>,
    pub min_price: Option<f64>,
    pub max_price: Option<f64>,
    pub rooms: Option<i32>,
    pub transaction_type: Option<String>,
    pub status: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub radius_meters: Option<f64>,
    pub page: Option<u64>,
    pub per_page: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct ListListingsGeoJsonQuery {
    pub bbox: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct BoundingBox {
    min_lng: f64,
    min_lat: f64,
    max_lng: f64,
    max_lat: f64,
}

#[derive(Debug, Serialize, Clone)]
pub struct MediaResponse {
    pub id: i64,
    pub property_id: i64,
    pub listing_id: Option<i64>,
    pub media_type: MediaType,
    pub url: String,
    pub is_main: bool,
    pub sort_order: i32,
}

#[derive(Debug, Serialize, Clone)]
pub struct OpenHouseResponse {
    pub id: i64,
    pub listing_id: i64,
    pub start_time: String,
    pub end_time: String,
    pub requires_registration: bool,
    pub instructions: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ListingResponse {
    pub id: i64,
    pub property_id: i64,
    pub seller_user_id: i64,
    pub transaction_type: TransactionType,
    pub price: f64,
    pub slug: String,
    pub status: ListingStatus,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: String,
    pub property: PropertyResponse,
    pub media: Vec<MediaResponse>,
    pub open_houses: Vec<OpenHouseResponse>,
}

#[derive(Debug, Serialize)]
pub struct ListingGeoJsonFeatureCollection {
    #[serde(rename = "type")]
    pub type_name: &'static str,
    pub features: Vec<ListingGeoJsonFeature>,
}

#[derive(Debug, Serialize)]
pub struct ListingGeoJsonFeature {
    #[serde(rename = "type")]
    pub type_name: &'static str,
    pub geometry: ListingGeoJsonGeometry,
    pub properties: ListingGeoJsonProperties,
}

#[derive(Debug, Serialize)]
pub struct ListingGeoJsonGeometry {
    #[serde(rename = "type")]
    pub type_name: &'static str,
    pub coordinates: [f64; 2],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListingGeoJsonProperties {
    pub id: i64,
    pub slug: String,
    pub title: String,
    pub price: f64,
    pub rooms: i32,
    pub transaction_type: String,
    pub thumbnail_url: String,
    pub city: String,
    pub street: String,
}

pub async fn list_listings_handler(
    State(state): State<AppState>,
    Query(query): Query<ListListingsQuery>,
) -> Result<Json<PaginatedResponse<ListingResponse>>, ApiError> {
    let pagination = PaginationQuery {
        page: query.page,
        per_page: query.per_page,
    }
    .normalize();
    let transaction_type = parse_optional_transaction_type(query.transaction_type.as_deref())?;
    let status = parse_optional_listing_status(query.status.as_deref())?;

    let total_row = sqlx::query(
        r#"
        SELECT COUNT(*) AS total
        FROM listings l
        INNER JOIN properties p ON p.id = l.property_id
        INNER JOIN locations loc ON loc.id = p.location_id
        WHERE ($1::bigint IS NULL OR loc.city_id = $1)
          AND ($2::bigint IS NULL OR p.category_id = $2)
          AND ($3::numeric IS NULL OR l.price >= $3::numeric)
          AND ($4::numeric IS NULL OR l.price <= $4::numeric)
          AND ($5::int IS NULL OR p.rooms = $5)
          AND ($6::text IS NULL OR l.transaction_type = $6)
          AND l.status = COALESCE($7::text, 'active')
          AND (
                $8::double precision IS NULL
                OR $9::double precision IS NULL
                OR $10::double precision IS NULL
                OR ST_DWithin(
                    loc.coordinates,
                    ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography,
                    $10
                )
          )
        "#,
    )
    .bind(query.city_id)
    .bind(query.category_id)
    .bind(query.min_price.map(|value| format!("{value:.2}")))
    .bind(query.max_price.map(|value| format!("{value:.2}")))
    .bind(query.rooms)
    .bind(transaction_type.map(|value| value.as_str()))
    .bind(status.map(|value| value.as_str()))
    .bind(query.lat)
    .bind(query.lng)
    .bind(query.radius_meters)
    .fetch_one(&state.db)
    .await?;
    let total: i64 = total_row.try_get("total").map_err(ApiError::from)?;

    let rows = sqlx::query(
        r#"
        SELECT l.id
        FROM listings l
        INNER JOIN properties p ON p.id = l.property_id
        INNER JOIN locations loc ON loc.id = p.location_id
        WHERE ($1::bigint IS NULL OR loc.city_id = $1)
          AND ($2::bigint IS NULL OR p.category_id = $2)
          AND ($3::numeric IS NULL OR l.price >= $3::numeric)
          AND ($4::numeric IS NULL OR l.price <= $4::numeric)
          AND ($5::int IS NULL OR p.rooms = $5)
          AND ($6::text IS NULL OR l.transaction_type = $6)
          AND l.status = COALESCE($7::text, 'active')
          AND (
                $8::double precision IS NULL
                OR $9::double precision IS NULL
                OR $10::double precision IS NULL
                OR ST_DWithin(
                    loc.coordinates,
                    ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography,
                    $10
                )
          )
        ORDER BY l.updated_at DESC, l.id DESC
        LIMIT $11 OFFSET $12
        "#,
    )
    .bind(query.city_id)
    .bind(query.category_id)
    .bind(query.min_price.map(|value| format!("{value:.2}")))
    .bind(query.max_price.map(|value| format!("{value:.2}")))
    .bind(query.rooms)
    .bind(transaction_type.map(|value| value.as_str()))
    .bind(status.map(|value| value.as_str()))
    .bind(query.lat)
    .bind(query.lng)
    .bind(query.radius_meters)
    .bind(pagination.limit)
    .bind(pagination.offset)
    .fetch_all(&state.db)
    .await?;

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let listing_id: i64 = row.try_get("id").map_err(ApiError::from)?;
        items.push(load_listing(&state.db, listing_id).await?.ok_or_else(|| {
            ApiError::internal("listing_load_failed", "Listing disappeared mid-request")
        })?);
    }

    Ok(Json(PaginatedResponse::new(
        items,
        pagination,
        total as u64,
    )))
}

pub async fn list_listings_geojson_handler(
    State(state): State<AppState>,
    Query(query): Query<ListListingsGeoJsonQuery>,
) -> Result<Json<ListingGeoJsonFeatureCollection>, ApiError> {
    let bbox = parse_bbox(query.bbox.as_deref())?;

    let rows = sqlx::query(
        r#"
        SELECT l.id,
               l.slug,
               l.transaction_type,
               l.price::text AS price,
               p.rooms,
               c.name AS category_name,
               city.name AS city_name,
               loc.street,
               ST_Y(loc.coordinates::geometry) AS latitude,
               ST_X(loc.coordinates::geometry) AS longitude,
               primary_media.url AS thumbnail_url
        FROM listings l
        INNER JOIN properties p ON p.id = l.property_id
        INNER JOIN categories c ON c.id = p.category_id
        INNER JOIN locations loc ON loc.id = p.location_id
        INNER JOIN cities city ON city.id = loc.city_id
        LEFT JOIN LATERAL (
            SELECT url
            FROM media
            WHERE listing_id = l.id AND media_type = 'photo'
            ORDER BY is_main DESC, sort_order ASC, id ASC
            LIMIT 1
        ) AS primary_media ON TRUE
        WHERE l.status = 'active'
          AND ST_Intersects(
                loc.coordinates::geometry,
                ST_MakeEnvelope($1, $2, $3, $4, 4326)
          )
        ORDER BY l.updated_at DESC, l.id DESC
        "#,
    )
    .bind(bbox.min_lng)
    .bind(bbox.min_lat)
    .bind(bbox.max_lng)
    .bind(bbox.max_lat)
    .fetch_all(&state.db)
    .await?;

    let features = rows
        .into_iter()
        .map(|row| {
            let transaction_type: String =
                row.try_get("transaction_type").map_err(ApiError::from)?;
            let transaction_type = TransactionType::try_from(transaction_type).map_err(|_| {
                ApiError::internal(
                    "invalid_transaction_type",
                    "Stored transaction type is invalid",
                )
            })?;
            let category_name: String = row.try_get("category_name").map_err(ApiError::from)?;
            let city_name: String = row.try_get("city_name").map_err(ApiError::from)?;
            let street: String = row.try_get("street").map_err(ApiError::from)?;
            let latitude: f64 = row.try_get("latitude").map_err(ApiError::from)?;
            let longitude: f64 = row.try_get("longitude").map_err(ApiError::from)?;

            Ok(ListingGeoJsonFeature {
                type_name: "Feature",
                geometry: ListingGeoJsonGeometry {
                    type_name: "Point",
                    coordinates: [longitude, latitude],
                },
                properties: ListingGeoJsonProperties {
                    id: row.try_get("id").map_err(ApiError::from)?,
                    slug: row.try_get("slug").map_err(ApiError::from)?,
                    title: build_geojson_listing_title(&category_name, &city_name),
                    price: parse_db_f64(row.try_get("price").map_err(ApiError::from)?, "price")?,
                    rooms: row.try_get("rooms").map_err(ApiError::from)?,
                    transaction_type: transaction_type.as_str().to_string(),
                    thumbnail_url: row
                        .try_get::<Option<String>, _>("thumbnail_url")
                        .map_err(ApiError::from)?
                        .unwrap_or_else(|| "/listing-placeholder.svg".to_string()),
                    city: city_name,
                    street,
                },
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(ListingGeoJsonFeatureCollection {
        type_name: "FeatureCollection",
        features,
    }))
}

pub async fn create_listing_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Json(payload): Json<CreateListingRequest>,
) -> Result<(StatusCode, Json<ListingResponse>), ApiError> {
    validate_listing_author(
        &state.db,
        &auth_user,
        payload.property_id,
        payload.seller_user_id,
    )
    .await?;
    let property = load_property(&state.db, payload.property_id)
        .await?
        .ok_or_else(|| ApiError::not_found("property_not_found", "Property was not found"))?;
    let seller_user_id = resolve_seller_user_id(&auth_user, payload.seller_user_id)?;
    let initial_slug = format!(
        "listing-{}-{}",
        payload.property_id,
        time::OffsetDateTime::now_utc().unix_timestamp_nanos()
    );

    let mut tx = state.db.begin().await?;

    let listing_row = sqlx::query(
        r#"
        INSERT INTO listings (
            property_id,
            seller_user_id,
            transaction_type,
            price,
            slug,
            status,
            expires_at
        )
        VALUES (
            $1,
            $2,
            $3,
            $4::numeric,
            $5,
            $6,
            COALESCE($7::timestamptz, now() + interval '30 days')
        )
        RETURNING id
        "#,
    )
    .bind(payload.property_id)
    .bind(seller_user_id)
    .bind(payload.transaction_type.as_str())
    .bind(format!("{:.2}", payload.price))
    .bind(initial_slug)
    .bind(payload.status.unwrap_or(ListingStatus::Active).as_str())
    .bind(payload.expires_at.clone())
    .fetch_one(&mut *tx)
    .await?;
    let listing_id: i64 = listing_row.try_get("id").map_err(ApiError::from)?;

    let slug = generate_listing_slug(&property, payload.transaction_type, listing_id);
    sqlx::query("UPDATE listings SET slug = $1 WHERE id = $2")
        .bind(&slug)
        .bind(listing_id)
        .execute(&mut *tx)
        .await?;

    insert_property_history(
        &mut tx,
        payload.property_id,
        "Listed",
        Some(payload.price),
        Some(payload.price / property.area_sqm),
        "Listing created",
    )
    .await?;

    tx.commit().await?;

    let listing = load_listing(&state.db, listing_id)
        .await?
        .ok_or_else(|| ApiError::internal("listing_not_found", "Listing creation failed"))?;

    Ok((StatusCode::CREATED, Json(listing)))
}

pub async fn get_listing_handler(
    State(state): State<AppState>,
    Path(listing_id): Path<i64>,
) -> Result<Json<ListingResponse>, ApiError> {
    let listing = load_listing(&state.db, listing_id)
        .await?
        .ok_or_else(|| ApiError::not_found("listing_not_found", "Listing was not found"))?;
    Ok(Json(listing))
}

pub async fn update_listing_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Path(listing_id): Path<i64>,
    Json(payload): Json<UpdateListingRequest>,
) -> Result<Json<ListingResponse>, ApiError> {
    let current = load_listing(&state.db, listing_id)
        .await?
        .ok_or_else(|| ApiError::not_found("listing_not_found", "Listing was not found"))?;
    validate_listing_author(
        &state.db,
        &auth_user,
        current.property_id,
        Some(current.seller_user_id),
    )
    .await?;

    let next_price = payload.price.unwrap_or(current.price);
    let next_status = payload.status.unwrap_or(current.status);
    let expires_at = payload
        .expires_at
        .clone()
        .unwrap_or(current.expires_at.clone());

    let mut tx = state.db.begin().await?;

    sqlx::query(
        r#"
        UPDATE listings
        SET price = $1::numeric,
            status = $2,
            expires_at = $3::timestamptz,
            updated_at = now()
        WHERE id = $4
        "#,
    )
    .bind(format!("{next_price:.2}"))
    .bind(next_status.as_str())
    .bind(expires_at)
    .bind(listing_id)
    .execute(&mut *tx)
    .await?;

    if (next_price - current.price).abs() > f64::EPSILON {
        insert_property_history(
            &mut tx,
            current.property_id,
            "PriceChange",
            Some(next_price),
            Some(next_price / current.property.area_sqm),
            "Listing price updated",
        )
        .await?;
    }

    if current.status != ListingStatus::Sold && next_status == ListingStatus::Sold {
        insert_property_history(
            &mut tx,
            current.property_id,
            "Sold",
            Some(next_price),
            Some(next_price / current.property.area_sqm),
            "Listing marked as sold",
        )
        .await?;
    }

    tx.commit().await?;

    let listing = load_listing(&state.db, listing_id)
        .await?
        .ok_or_else(|| ApiError::internal("listing_not_found", "Listing update failed"))?;
    Ok(Json(listing))
}

pub async fn add_media_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Path(listing_id): Path<i64>,
    Json(payload): Json<AddMediaRequest>,
) -> Result<(StatusCode, Json<MediaResponse>), ApiError> {
    let listing = load_listing(&state.db, listing_id)
        .await?
        .ok_or_else(|| ApiError::not_found("listing_not_found", "Listing was not found"))?;
    validate_listing_author(
        &state.db,
        &auth_user,
        listing.property_id,
        Some(listing.seller_user_id),
    )
    .await?;

    let mut tx = state.db.begin().await?;
    if payload.is_main.unwrap_or(false) {
        sqlx::query("UPDATE media SET is_main = FALSE WHERE listing_id = $1")
            .bind(listing_id)
            .execute(&mut *tx)
            .await?;
    }

    let row = sqlx::query(
        r#"
        INSERT INTO media (property_id, listing_id, media_type, url, is_main, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, property_id, listing_id, media_type, url, is_main, sort_order
        "#,
    )
    .bind(listing.property_id)
    .bind(listing_id)
    .bind(payload.media_type.as_str())
    .bind(required_text(&payload.url, "url")?)
    .bind(payload.is_main.unwrap_or(false))
    .bind(payload.sort_order.unwrap_or(0))
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok((StatusCode::CREATED, Json(map_media_row(row)?)))
}

pub async fn add_open_house_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Path(listing_id): Path<i64>,
    Json(payload): Json<AddOpenHouseRequest>,
) -> Result<(StatusCode, Json<OpenHouseResponse>), ApiError> {
    let listing = load_listing(&state.db, listing_id)
        .await?
        .ok_or_else(|| ApiError::not_found("listing_not_found", "Listing was not found"))?;
    validate_listing_author(
        &state.db,
        &auth_user,
        listing.property_id,
        Some(listing.seller_user_id),
    )
    .await?;

    let row = sqlx::query(
        r#"
        INSERT INTO open_houses (listing_id, start_time, end_time, requires_registration, instructions)
        VALUES ($1, $2::timestamptz, $3::timestamptz, $4, $5)
        RETURNING id, listing_id, start_time::text AS start_time, end_time::text AS end_time,
                  requires_registration, instructions
        "#,
    )
    .bind(listing_id)
    .bind(required_text(&payload.start_time, "start_time")?)
    .bind(required_text(&payload.end_time, "end_time")?)
    .bind(payload.requires_registration.unwrap_or(false))
    .bind(payload.instructions.unwrap_or_default())
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(map_open_house_row(row)?)))
}

pub async fn load_listing(
    pool: &PgPool,
    listing_id: i64,
) -> Result<Option<ListingResponse>, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT id, property_id, seller_user_id, transaction_type, price::text AS price, slug, status,
               created_at::text AS created_at,
               updated_at::text AS updated_at,
               expires_at::text AS expires_at
        FROM listings
        WHERE id = $1
        "#,
    )
    .bind(listing_id)
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };

    let property_id: i64 = row.try_get("property_id").map_err(ApiError::from)?;
    let property = load_property(pool, property_id).await?.ok_or_else(|| {
        ApiError::internal("property_not_found", "Listing property was not found")
    })?;

    let media_rows = sqlx::query(
        r#"
        SELECT id, property_id, listing_id, media_type, url, is_main, sort_order
        FROM media
        WHERE listing_id = $1
        ORDER BY is_main DESC, sort_order ASC, id ASC
        "#,
    )
    .bind(listing_id)
    .fetch_all(pool)
    .await?;

    let open_house_rows = sqlx::query(
        r#"
        SELECT id, listing_id, start_time::text AS start_time, end_time::text AS end_time,
               requires_registration, instructions
        FROM open_houses
        WHERE listing_id = $1
        ORDER BY start_time ASC
        "#,
    )
    .bind(listing_id)
    .fetch_all(pool)
    .await?;

    let transaction_type: String = row.try_get("transaction_type").map_err(ApiError::from)?;
    let status: String = row.try_get("status").map_err(ApiError::from)?;

    Ok(Some(ListingResponse {
        id: row.try_get("id").map_err(ApiError::from)?,
        property_id,
        seller_user_id: row.try_get("seller_user_id").map_err(ApiError::from)?,
        transaction_type: TransactionType::try_from(transaction_type).map_err(|_| {
            ApiError::internal(
                "invalid_transaction_type",
                "Stored transaction type is invalid",
            )
        })?,
        price: parse_db_f64(row.try_get("price").map_err(ApiError::from)?, "price")?,
        slug: row.try_get("slug").map_err(ApiError::from)?,
        status: ListingStatus::try_from(status).map_err(|_| {
            ApiError::internal("invalid_listing_status", "Stored listing status is invalid")
        })?,
        created_at: row.try_get("created_at").map_err(ApiError::from)?,
        updated_at: row.try_get("updated_at").map_err(ApiError::from)?,
        expires_at: row.try_get("expires_at").map_err(ApiError::from)?,
        property,
        media: media_rows
            .into_iter()
            .map(map_media_row)
            .collect::<Result<Vec<_>, _>>()?,
        open_houses: open_house_rows
            .into_iter()
            .map(map_open_house_row)
            .collect::<Result<Vec<_>, _>>()?,
    }))
}

async fn validate_listing_author(
    pool: &PgPool,
    auth_user: &AuthenticatedUser,
    property_id: i64,
    seller_user_id: Option<i64>,
) -> Result<(), ApiError> {
    if is_platform_admin(auth_user) {
        return Ok(());
    }

    match auth_user.business_role {
        BusinessRole::Buyer => Err(ApiError::forbidden(
            "forbidden",
            "Buyers cannot manage listings",
        )),
        BusinessRole::Agent => {
            if auth_user.agency_id.is_none() {
                return Err(ApiError::forbidden(
                    "agency_required",
                    "An agent must belong to an agency to manage listings",
                ));
            }
            if seller_user_id.is_some() && seller_user_id != Some(auth_user.id) {
                return Err(ApiError::forbidden(
                    "forbidden",
                    "Agents can only publish listings as themselves",
                ));
            }
            Ok(())
        }
        BusinessRole::Owner | BusinessRole::Developer => {
            if seller_user_id.is_some() && seller_user_id != Some(auth_user.id) {
                return Err(ApiError::forbidden(
                    "forbidden",
                    "You can only publish listings as yourself",
                ));
            }

            let row = sqlx::query(
                r#"
                SELECT EXISTS (
                    SELECT 1
                    FROM property_owners
                    WHERE property_id = $1 AND user_id = $2
                ) AS owns_property
                "#,
            )
            .bind(property_id)
            .bind(auth_user.id)
            .fetch_one(pool)
            .await?;
            let owns_property: bool = row.try_get("owns_property").map_err(ApiError::from)?;
            if owns_property {
                Ok(())
            } else {
                Err(ApiError::forbidden(
                    "forbidden",
                    "You do not own this property",
                ))
            }
        }
    }
}

fn resolve_seller_user_id(
    auth_user: &AuthenticatedUser,
    seller_user_id: Option<i64>,
) -> Result<i64, ApiError> {
    if is_platform_admin(auth_user) {
        return Ok(seller_user_id.unwrap_or(auth_user.id));
    }

    if let Some(explicit_seller_user_id) = seller_user_id {
        if explicit_seller_user_id != auth_user.id {
            return Err(ApiError::forbidden(
                "forbidden",
                "You can only create listings as yourself",
            ));
        }
        Ok(explicit_seller_user_id)
    } else {
        Ok(auth_user.id)
    }
}

async fn insert_property_history(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    property_id: i64,
    event_type: &str,
    amount: Option<f64>,
    price_per_sqm: Option<f64>,
    description: &str,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO property_histories (property_id, event_type, event_date, amount, price_per_sqm, description)
        VALUES ($1, $2, CURRENT_DATE, $3::numeric, $4::numeric, $5)
        "#,
    )
    .bind(property_id)
    .bind(event_type)
    .bind(amount.map(|value| format!("{value:.2}")))
    .bind(price_per_sqm.map(|value| format!("{value:.2}")))
    .bind(description)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

fn generate_listing_slug(
    property: &PropertyResponse,
    transaction_type: TransactionType,
    listing_id: i64,
) -> String {
    let base = format!(
        "{} {} {} {}",
        property.category_name,
        property.location.city_name,
        transaction_type.as_str(),
        listing_id
    );
    slugify(&base)
}

fn parse_optional_transaction_type(
    value: Option<&str>,
) -> Result<Option<TransactionType>, ApiError> {
    value
        .map(|raw| TransactionType::try_from(raw.trim().to_ascii_lowercase()))
        .transpose()
        .map_err(|_| {
            ApiError::bad_request(
                "invalid_transaction_type",
                "transaction_type must be one of: sale, rent",
            )
        })
}

fn parse_optional_listing_status(value: Option<&str>) -> Result<Option<ListingStatus>, ApiError> {
    value
        .map(|raw| ListingStatus::try_from(raw.trim().to_ascii_lowercase()))
        .transpose()
        .map_err(|_| {
            ApiError::bad_request(
                "invalid_listing_status",
                "status must be one of: active, draft, sold, expired",
            )
        })
}

fn parse_bbox(raw: Option<&str>) -> Result<BoundingBox, ApiError> {
    let raw = raw.ok_or_else(|| {
        ApiError::bad_request(
            "invalid_bbox",
            "bbox must contain four numbers: minLng,minLat,maxLng,maxLat",
        )
    })?;

    let values = raw
        .split(',')
        .map(|value| {
            value.trim().parse::<f64>().map_err(|_| {
                ApiError::bad_request(
                    "invalid_bbox",
                    "bbox must contain four numbers: minLng,minLat,maxLng,maxLat",
                )
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    if values.len() != 4 {
        return Err(ApiError::bad_request(
            "invalid_bbox",
            "bbox must contain four numbers: minLng,minLat,maxLng,maxLat",
        ));
    }

    let bbox = BoundingBox {
        min_lng: values[0],
        min_lat: values[1],
        max_lng: values[2],
        max_lat: values[3],
    };

    ensure_bbox_range("minLng", bbox.min_lng, -180.0, 180.0)?;
    ensure_bbox_range("maxLng", bbox.max_lng, -180.0, 180.0)?;
    ensure_bbox_range("minLat", bbox.min_lat, -90.0, 90.0)?;
    ensure_bbox_range("maxLat", bbox.max_lat, -90.0, 90.0)?;

    if bbox.min_lng >= bbox.max_lng || bbox.min_lat >= bbox.max_lat {
        return Err(ApiError::bad_request(
            "invalid_bbox",
            "bbox must satisfy minLng < maxLng and minLat < maxLat",
        ));
    }

    Ok(bbox)
}

fn ensure_bbox_range(field_name: &str, value: f64, min: f64, max: f64) -> Result<(), ApiError> {
    if value.is_finite() && value >= min && value <= max {
        return Ok(());
    }

    Err(ApiError::bad_request(
        "invalid_bbox",
        format!("{field_name} must be between {min} and {max}"),
    ))
}

fn build_geojson_listing_title(category_name: &str, city_name: &str) -> String {
    let mut characters = category_name.chars();
    let Some(first) = characters.next() else {
        return format!("Listing in {city_name}");
    };

    format!(
        "{}{} in {}",
        first.to_uppercase(),
        characters.as_str(),
        city_name
    )
}

fn map_media_row(row: sqlx::postgres::PgRow) -> Result<MediaResponse, ApiError> {
    let media_type: String = row.try_get("media_type").map_err(ApiError::from)?;
    Ok(MediaResponse {
        id: row.try_get("id").map_err(ApiError::from)?,
        property_id: row.try_get("property_id").map_err(ApiError::from)?,
        listing_id: row.try_get("listing_id").map_err(ApiError::from)?,
        media_type: MediaType::try_from(media_type).map_err(|_| {
            ApiError::internal("invalid_media_type", "Stored media type is invalid")
        })?,
        url: row.try_get("url").map_err(ApiError::from)?,
        is_main: row.try_get("is_main").map_err(ApiError::from)?,
        sort_order: row.try_get("sort_order").map_err(ApiError::from)?,
    })
}

fn map_open_house_row(row: sqlx::postgres::PgRow) -> Result<OpenHouseResponse, ApiError> {
    Ok(OpenHouseResponse {
        id: row.try_get("id").map_err(ApiError::from)?,
        listing_id: row.try_get("listing_id").map_err(ApiError::from)?,
        start_time: row.try_get("start_time").map_err(ApiError::from)?,
        end_time: row.try_get("end_time").map_err(ApiError::from)?,
        requires_registration: row
            .try_get("requires_registration")
            .map_err(ApiError::from)?,
        instructions: row.try_get("instructions").map_err(ApiError::from)?,
    })
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

#[cfg(test)]
mod tests {
    use super::{parse_bbox, BoundingBox};

    #[test]
    fn parse_bbox_accepts_valid_envelope() {
        let bbox = parse_bbox(Some("18.9,52.1,21.2,53.4")).unwrap();

        assert_eq!(
            bbox,
            BoundingBox {
                min_lng: 18.9,
                min_lat: 52.1,
                max_lng: 21.2,
                max_lat: 53.4,
            }
        );
    }

    #[test]
    fn parse_bbox_rejects_invalid_coordinate_ranges() {
        assert!(parse_bbox(Some("181,52.1,21.2,53.4")).is_err());
        assert!(parse_bbox(Some("18.9,-91,21.2,53.4")).is_err());
        assert!(parse_bbox(Some("18.9,52.1,18.9,53.4")).is_err());
    }
}
