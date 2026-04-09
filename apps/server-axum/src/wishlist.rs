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
    listings::load_listing,
    models::{PaginatedResponse, PaginationQuery},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct ListWishlistsQuery {
    pub page: Option<u64>,
    pub per_page: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateWishlistRequest {
    pub name: String,
    pub color: Option<String>,
    pub is_shared: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateWishlistRequest {
    pub name: Option<String>,
    pub color: Option<String>,
    pub is_shared: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct AddWishlistItemRequest {
    pub listing_id: i64,
    pub user_notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ImportGuestWishlistRequest {
    pub name: String,
    pub color: Option<String>,
    pub listing_ids: Vec<i64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct WishlistListingSummary {
    pub id: i64,
    pub slug: String,
    pub title: String,
    pub price: f64,
    pub transaction_type: String,
    pub status: String,
    pub city: String,
    pub street: String,
    pub rooms: i32,
    pub thumbnail_url: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct WishlistItemResponse {
    pub id: i64,
    pub listing_id: i64,
    pub added_at: String,
    pub user_notes: String,
    pub listing: WishlistListingSummary,
}

#[derive(Debug, Serialize, Clone)]
pub struct WishlistResponse {
    pub id: i64,
    pub user_id: i64,
    pub name: String,
    pub color: String,
    pub is_shared: bool,
    pub created_at: String,
    pub items: Vec<WishlistItemResponse>,
}

pub async fn list_wishlists_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Query(query): Query<ListWishlistsQuery>,
) -> Result<Json<PaginatedResponse<WishlistResponse>>, ApiError> {
    let pagination = PaginationQuery {
        page: query.page,
        per_page: query.per_page,
    }
    .normalize();

    let total_row = sqlx::query("SELECT COUNT(*) AS total FROM wishlists WHERE user_id = $1")
        .bind(auth_user.id)
        .fetch_one(&state.db)
        .await?;
    let total: i64 = total_row.try_get("total").map_err(ApiError::from)?;

    let rows = sqlx::query(
        r#"
        SELECT id
        FROM wishlists
        WHERE user_id = $1
        ORDER BY id ASC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(auth_user.id)
    .bind(pagination.limit)
    .bind(pagination.offset)
    .fetch_all(&state.db)
    .await?;

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let wishlist_id: i64 = row.try_get("id").map_err(ApiError::from)?;
        items.push(
            load_wishlist(&state.db, wishlist_id)
                .await?
                .ok_or_else(|| {
                    ApiError::internal("wishlist_load_failed", "Wishlist disappeared mid-request")
                })?,
        );
    }

    Ok(Json(PaginatedResponse::new(
        items,
        pagination,
        total as u64,
    )))
}

pub async fn create_wishlist_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Json(payload): Json<CreateWishlistRequest>,
) -> Result<(StatusCode, Json<WishlistResponse>), ApiError> {
    let name = validate_standard_wishlist_name(&payload.name)?;
    let color = validate_wishlist_color(payload.color.as_deref())?;
    let row = sqlx::query(
        r#"
        INSERT INTO wishlists (user_id, name, color, is_shared)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        "#,
    )
    .bind(auth_user.id)
    .bind(name)
    .bind(color)
    .bind(payload.is_shared.unwrap_or(false))
    .fetch_one(&state.db)
    .await?;
    let wishlist_id: i64 = row.try_get("id").map_err(ApiError::from)?;

    let wishlist = load_wishlist(&state.db, wishlist_id)
        .await?
        .ok_or_else(|| ApiError::internal("wishlist_not_found", "Wishlist creation failed"))?;

    Ok((StatusCode::CREATED, Json(wishlist)))
}

pub async fn get_wishlist_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Path(wishlist_id): Path<i64>,
) -> Result<Json<WishlistResponse>, ApiError> {
    let wishlist = load_wishlist(&state.db, wishlist_id)
        .await?
        .ok_or_else(|| ApiError::not_found("wishlist_not_found", "Wishlist was not found"))?;
    ensure_wishlist_access(&auth_user, &wishlist)?;
    Ok(Json(wishlist))
}

pub async fn update_wishlist_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Path(wishlist_id): Path<i64>,
    Json(payload): Json<UpdateWishlistRequest>,
) -> Result<Json<WishlistResponse>, ApiError> {
    let current = load_wishlist(&state.db, wishlist_id)
        .await?
        .ok_or_else(|| ApiError::not_found("wishlist_not_found", "Wishlist was not found"))?;
    ensure_wishlist_access(&auth_user, &current)?;

    let next_name = match payload.name.as_deref() {
        Some(name) => validate_standard_wishlist_name(name)?,
        None => current.name.clone(),
    };
    let next_color = match payload.color.as_deref() {
        Some(color) => validate_wishlist_color(Some(color))?,
        None => current.color.clone(),
    };

    sqlx::query(
        r#"
        UPDATE wishlists
        SET name = $1,
            color = $2,
            is_shared = $3
        WHERE id = $4
        "#,
    )
    .bind(next_name)
    .bind(next_color)
    .bind(payload.is_shared.unwrap_or(current.is_shared))
    .bind(wishlist_id)
    .execute(&state.db)
    .await?;

    let wishlist = load_wishlist(&state.db, wishlist_id)
        .await?
        .ok_or_else(|| ApiError::internal("wishlist_not_found", "Wishlist update failed"))?;
    Ok(Json(wishlist))
}

pub async fn import_guest_wishlist_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Json(payload): Json<ImportGuestWishlistRequest>,
) -> Result<(StatusCode, Json<WishlistResponse>), ApiError> {
    let name = validate_guest_import_name(&payload.name)?;
    let color = validate_wishlist_color(payload.color.as_deref())?;
    let listing_ids = dedupe_listing_ids(payload.listing_ids);
    if listing_ids.is_empty() {
        return Err(ApiError::bad_request(
            "listing_ids_required",
            "Guest wishlist import must contain at least one listing",
        ));
    }

    ensure_listings_exist(&state.db, &listing_ids).await?;

    let mut tx = state.db.begin().await?;
    let row = sqlx::query(
        r#"
        INSERT INTO wishlists (user_id, name, color, is_shared)
        VALUES ($1, $2, $3, FALSE)
        RETURNING id
        "#,
    )
    .bind(auth_user.id)
    .bind(name)
    .bind(color)
    .fetch_one(&mut *tx)
    .await?;
    let wishlist_id: i64 = row.try_get("id").map_err(ApiError::from)?;

    for listing_id in listing_ids {
        sqlx::query(
            r#"
            INSERT INTO wishlist_items (wishlist_id, listing_id, user_notes)
            VALUES ($1, $2, '')
            ON CONFLICT (wishlist_id, listing_id) DO NOTHING
            "#,
        )
        .bind(wishlist_id)
        .bind(listing_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    let wishlist = load_wishlist(&state.db, wishlist_id)
        .await?
        .ok_or_else(|| ApiError::internal("wishlist_not_found", "Wishlist import failed"))?;

    Ok((StatusCode::CREATED, Json(wishlist)))
}

pub async fn delete_wishlist_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Path(wishlist_id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let wishlist = load_wishlist(&state.db, wishlist_id)
        .await?
        .ok_or_else(|| ApiError::not_found("wishlist_not_found", "Wishlist was not found"))?;
    ensure_wishlist_access(&auth_user, &wishlist)?;

    sqlx::query("DELETE FROM wishlists WHERE id = $1")
        .bind(wishlist_id)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn add_wishlist_item_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Path(wishlist_id): Path<i64>,
    Json(payload): Json<AddWishlistItemRequest>,
) -> Result<(StatusCode, Json<WishlistItemResponse>), ApiError> {
    let wishlist = load_wishlist(&state.db, wishlist_id)
        .await?
        .ok_or_else(|| ApiError::not_found("wishlist_not_found", "Wishlist was not found"))?;
    ensure_wishlist_access(&auth_user, &wishlist)?;

    if load_listing(&state.db, payload.listing_id).await?.is_none() {
        return Err(ApiError::not_found(
            "listing_not_found",
            "Listing was not found",
        ));
    }

    let result = sqlx::query(
        r#"
        INSERT INTO wishlist_items (wishlist_id, listing_id, user_notes)
        VALUES ($1, $2, $3)
        RETURNING id, listing_id, added_at::text AS added_at, user_notes
        "#,
    )
    .bind(wishlist_id)
    .bind(payload.listing_id)
    .bind(payload.user_notes.unwrap_or_default())
    .fetch_one(&state.db)
    .await;

    let row = match result {
        Ok(row) => row,
        Err(sqlx::Error::Database(database_error))
            if database_error.code().as_deref() == Some("23505") =>
        {
            return Err(ApiError::conflict(
                "wishlist_item_exists",
                "Listing already exists in this wishlist",
            ));
        }
        Err(error) => return Err(error.into()),
    };
    let wishlist_item_id: i64 = row.try_get("id").map_err(ApiError::from)?;

    let wishlist_item = load_wishlist_item(&state.db, wishlist_item_id)
        .await?
        .ok_or_else(|| {
            ApiError::internal(
                "wishlist_item_not_found",
                "Wishlist item creation failed unexpectedly",
            )
        })?;

    Ok((StatusCode::CREATED, Json(wishlist_item)))
}

pub async fn delete_wishlist_item_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Path((wishlist_id, item_id)): Path<(i64, i64)>,
) -> Result<StatusCode, ApiError> {
    let wishlist = load_wishlist(&state.db, wishlist_id)
        .await?
        .ok_or_else(|| ApiError::not_found("wishlist_not_found", "Wishlist was not found"))?;
    ensure_wishlist_access(&auth_user, &wishlist)?;

    sqlx::query("DELETE FROM wishlist_items WHERE id = $1 AND wishlist_id = $2")
        .bind(item_id)
        .bind(wishlist_id)
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

async fn load_wishlist(
    pool: &PgPool,
    wishlist_id: i64,
) -> Result<Option<WishlistResponse>, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT id, user_id, name, color, is_shared, created_at::text AS created_at
        FROM wishlists
        WHERE id = $1
        "#,
    )
    .bind(wishlist_id)
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };

    let item_rows = sqlx::query(
        r#"
        SELECT id
        FROM wishlist_items
        WHERE wishlist_id = $1
        ORDER BY added_at DESC, id DESC
        "#,
    )
    .bind(wishlist_id)
    .fetch_all(pool)
    .await?;

    let mut items = Vec::with_capacity(item_rows.len());
    for item_row in item_rows {
        let item_id: i64 = item_row.try_get("id").map_err(ApiError::from)?;
        if let Some(item) = load_wishlist_item(pool, item_id).await? {
            items.push(item);
        }
    }

    Ok(Some(WishlistResponse {
        id: row.try_get("id").map_err(ApiError::from)?,
        user_id: row.try_get("user_id").map_err(ApiError::from)?,
        name: row.try_get("name").map_err(ApiError::from)?,
        color: row.try_get("color").map_err(ApiError::from)?,
        is_shared: row.try_get("is_shared").map_err(ApiError::from)?,
        created_at: row.try_get("created_at").map_err(ApiError::from)?,
        items,
    }))
}

async fn load_wishlist_item(
    pool: &PgPool,
    wishlist_item_id: i64,
) -> Result<Option<WishlistItemResponse>, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT
            wi.id,
            wi.listing_id,
            wi.added_at::text AS added_at,
            wi.user_notes,
            l.slug,
            l.price::text AS price,
            l.transaction_type,
            l.status,
            p.rooms,
            c.name AS category_name,
            city.name AS city_name,
            loc.street,
            COALESCE(primary_media.url, '/listing-placeholder.svg') AS thumbnail_url
        FROM wishlist_items wi
        INNER JOIN listings l ON l.id = wi.listing_id
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
        ) primary_media ON TRUE
        WHERE wi.id = $1
        "#,
    )
    .bind(wishlist_item_id)
    .fetch_optional(pool)
    .await?;

    row.map(map_wishlist_item_row).transpose()
}

fn ensure_wishlist_access(
    auth_user: &AuthenticatedUser,
    wishlist: &WishlistResponse,
) -> Result<(), ApiError> {
    if is_platform_admin(auth_user) || auth_user.id == wishlist.user_id {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "forbidden",
            "You do not have permission to access this wishlist",
        ))
    }
}

async fn ensure_listings_exist(pool: &PgPool, listing_ids: &[i64]) -> Result<(), ApiError> {
    for listing_id in listing_ids {
        if load_listing(pool, *listing_id).await?.is_none() {
            return Err(ApiError::not_found(
                "listing_not_found",
                format!("Listing {listing_id} was not found"),
            ));
        }
    }

    Ok(())
}

fn dedupe_listing_ids(listing_ids: Vec<i64>) -> Vec<i64> {
    let mut deduped = Vec::new();

    for listing_id in listing_ids {
        if listing_id > 0 && !deduped.contains(&listing_id) {
            deduped.push(listing_id);
        }
    }

    deduped
}

fn map_wishlist_item_row(row: sqlx::postgres::PgRow) -> Result<WishlistItemResponse, ApiError> {
    Ok(WishlistItemResponse {
        id: row.try_get("id").map_err(ApiError::from)?,
        listing_id: row.try_get("listing_id").map_err(ApiError::from)?,
        added_at: row.try_get("added_at").map_err(ApiError::from)?,
        user_notes: row.try_get("user_notes").map_err(ApiError::from)?,
        listing: WishlistListingSummary {
            id: row.try_get("listing_id").map_err(ApiError::from)?,
            slug: row.try_get("slug").map_err(ApiError::from)?,
            title: format!(
                "{} in {}",
                row.try_get::<String, _>("category_name")
                    .map_err(ApiError::from)?,
                row.try_get::<String, _>("city_name")
                    .map_err(ApiError::from)?
            ),
            price: crate::models::parse_db_f64(
                row.try_get("price").map_err(ApiError::from)?,
                "price",
            )?,
            transaction_type: row.try_get("transaction_type").map_err(ApiError::from)?,
            status: row.try_get("status").map_err(ApiError::from)?,
            city: row.try_get("city_name").map_err(ApiError::from)?,
            street: row.try_get("street").map_err(ApiError::from)?,
            rooms: row.try_get("rooms").map_err(ApiError::from)?,
            thumbnail_url: row.try_get("thumbnail_url").map_err(ApiError::from)?,
        },
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

fn validate_standard_wishlist_name(value: &str) -> Result<String, ApiError> {
    let name = required_text(value, "name")?;
    if name.eq_ignore_ascii_case("niezalogowany") {
        return Err(ApiError::bad_request(
            "reserved_wishlist_name",
            "Name 'niezalogowany' is reserved for imported guest wishlists",
        ));
    }

    Ok(name)
}

fn validate_guest_import_name(value: &str) -> Result<String, ApiError> {
    let name = required_text(value, "name")?;
    if !name.eq_ignore_ascii_case("niezalogowany") {
        return Err(ApiError::bad_request(
            "invalid_guest_wishlist_name",
            "Guest wishlist import must use the reserved name 'niezalogowany'",
        ));
    }

    Ok("niezalogowany".to_string())
}

fn validate_wishlist_color(value: Option<&str>) -> Result<String, ApiError> {
    let color = value.unwrap_or("sand").trim().to_ascii_lowercase();
    if matches!(
        color.as_str(),
        "sand" | "amber" | "rose" | "plum" | "sky" | "teal" | "sage" | "slate"
    ) {
        Ok(color)
    } else {
        Err(ApiError::bad_request(
            "invalid_wishlist_color",
            "Wishlist color must be one of: sand, amber, rose, plum, sky, teal, sage, slate",
        ))
    }
}
