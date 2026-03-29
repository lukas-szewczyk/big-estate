use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{types::Json as SqlxJson, PgPool, Row};

use crate::{
    accounts::{find_user_by_id, is_platform_admin, require_business_roles},
    auth::AuthenticatedUser,
    error::ApiError,
    models::{parse_optional_db_f64, BusinessRole, PaginatedResponse, PaginationQuery},
    AppState,
};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct LocationPayload {
    pub city_id: i64,
    pub district_id: Option<i64>,
    pub street: String,
    pub postal_code: String,
    pub building_number: String,
    pub apartment_number: Option<String>,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PropertyOwnerPayload {
    pub user_id: i64,
    pub ownership_share: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePropertyRequest {
    pub location: LocationPayload,
    pub category_id: i64,
    pub area_sqm: f64,
    pub plot_area_sqm: Option<f64>,
    pub rooms: i32,
    pub floor: i32,
    pub year_built: i32,
    pub heating_type: String,
    pub extra_attributes: Option<Value>,
    #[serde(default)]
    pub amenity_ids: Vec<i64>,
    #[serde(default)]
    pub owners: Vec<PropertyOwnerPayload>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePropertyRequest {
    pub location: Option<LocationPayload>,
    pub category_id: Option<i64>,
    pub area_sqm: Option<f64>,
    pub plot_area_sqm: Option<f64>,
    pub rooms: Option<i32>,
    pub floor: Option<i32>,
    pub year_built: Option<i32>,
    pub heating_type: Option<String>,
    pub extra_attributes: Option<Value>,
    pub amenity_ids: Option<Vec<i64>>,
    pub owners: Option<Vec<PropertyOwnerPayload>>,
}

#[derive(Debug, Deserialize)]
pub struct ListPropertiesQuery {
    pub category_id: Option<i64>,
    pub city_id: Option<i64>,
    pub owner_user_id: Option<i64>,
    pub page: Option<u64>,
    pub per_page: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PropertyLocationResponse {
    pub id: i64,
    pub city_id: i64,
    pub city_name: String,
    pub district_id: Option<i64>,
    pub district_name: Option<String>,
    pub street: String,
    pub postal_code: String,
    pub building_number: String,
    pub apartment_number: Option<String>,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Debug, Serialize, Clone)]
pub struct PropertyOwnerResponse {
    pub user_id: i64,
    pub ownership_share: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PropertyResponse {
    pub id: i64,
    pub location: PropertyLocationResponse,
    pub category_id: i64,
    pub category_name: String,
    pub area_sqm: f64,
    pub plot_area_sqm: Option<f64>,
    pub rooms: i32,
    pub floor: i32,
    pub year_built: i32,
    pub heating_type: String,
    pub extra_attributes: Value,
    pub amenity_ids: Vec<i64>,
    pub owners: Vec<PropertyOwnerResponse>,
    pub created_at: String,
    pub updated_at: String,
}

pub async fn list_properties_handler(
    State(state): State<AppState>,
    _auth_user: AuthenticatedUser,
    Query(query): Query<ListPropertiesQuery>,
) -> Result<Json<PaginatedResponse<PropertyResponse>>, ApiError> {
    let pagination = PaginationQuery {
        page: query.page,
        per_page: query.per_page,
    }
    .normalize();

    let total_row = sqlx::query(
        r#"
        SELECT COUNT(*) AS total
        FROM properties p
        INNER JOIN locations l ON l.id = p.location_id
        WHERE ($1::bigint IS NULL OR p.category_id = $1)
          AND ($2::bigint IS NULL OR l.city_id = $2)
          AND (
                $3::bigint IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM property_owners po
                    WHERE po.property_id = p.id AND po.user_id = $3
                )
          )
        "#,
    )
    .bind(query.category_id)
    .bind(query.city_id)
    .bind(query.owner_user_id)
    .fetch_one(&state.db)
    .await?;
    let total: i64 = total_row.try_get("total").map_err(ApiError::from)?;

    let rows = sqlx::query(
        r#"
        SELECT p.id
        FROM properties p
        INNER JOIN locations l ON l.id = p.location_id
        WHERE ($1::bigint IS NULL OR p.category_id = $1)
          AND ($2::bigint IS NULL OR l.city_id = $2)
          AND (
                $3::bigint IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM property_owners po
                    WHERE po.property_id = p.id AND po.user_id = $3
                )
          )
        ORDER BY p.id ASC
        LIMIT $4 OFFSET $5
        "#,
    )
    .bind(query.category_id)
    .bind(query.city_id)
    .bind(query.owner_user_id)
    .bind(pagination.limit)
    .bind(pagination.offset)
    .fetch_all(&state.db)
    .await?;

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let property_id: i64 = row.try_get("id").map_err(ApiError::from)?;
        items.push(
            load_property(&state.db, property_id)
                .await?
                .ok_or_else(|| {
                    ApiError::internal("property_load_failed", "Property disappeared mid-request")
                })?,
        );
    }

    Ok(Json(PaginatedResponse::new(
        items,
        pagination,
        total as u64,
    )))
}

pub async fn create_property_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Json(payload): Json<CreatePropertyRequest>,
) -> Result<(StatusCode, Json<PropertyResponse>), ApiError> {
    require_business_roles(
        &auth_user,
        &[
            BusinessRole::Agent,
            BusinessRole::Owner,
            BusinessRole::Developer,
        ],
    )?;
    validate_property_owners(&state.db, &auth_user, &payload.owners).await?;

    let mut tx = state.db.begin().await?;

    let location_id = insert_location(&mut tx, &payload.location).await?;
    let property_row = sqlx::query(
        r#"
        INSERT INTO properties (
            location_id,
            category_id,
            area_sqm,
            plot_area_sqm,
            rooms,
            floor,
            year_built,
            heating_type,
            extra_attributes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
        "#,
    )
    .bind(location_id)
    .bind(payload.category_id)
    .bind(payload.area_sqm)
    .bind(payload.plot_area_sqm)
    .bind(payload.rooms)
    .bind(payload.floor)
    .bind(payload.year_built)
    .bind(required_text(&payload.heating_type, "heating_type")?)
    .bind(SqlxJson(
        payload
            .extra_attributes
            .unwrap_or_else(|| Value::Object(Default::default())),
    ))
    .fetch_one(&mut *tx)
    .await?;
    let property_id: i64 = property_row.try_get("id").map_err(ApiError::from)?;

    replace_property_owners(&mut tx, property_id, &payload.owners).await?;
    replace_property_amenities(&mut tx, property_id, &payload.amenity_ids).await?;

    tx.commit().await?;

    let property = load_property(&state.db, property_id)
        .await?
        .ok_or_else(|| ApiError::internal("property_not_found", "Property creation failed"))?;

    Ok((StatusCode::CREATED, Json(property)))
}

pub async fn get_property_handler(
    State(state): State<AppState>,
    _auth_user: AuthenticatedUser,
    Path(property_id): Path<i64>,
) -> Result<Json<PropertyResponse>, ApiError> {
    let property = load_property(&state.db, property_id)
        .await?
        .ok_or_else(|| ApiError::not_found("property_not_found", "Property was not found"))?;
    Ok(Json(property))
}

pub async fn update_property_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Path(property_id): Path<i64>,
    Json(payload): Json<UpdatePropertyRequest>,
) -> Result<Json<PropertyResponse>, ApiError> {
    let current = load_property(&state.db, property_id)
        .await?
        .ok_or_else(|| ApiError::not_found("property_not_found", "Property was not found"))?;
    ensure_property_access(&auth_user, &current)?;

    if let Some(ref owners) = payload.owners {
        validate_property_owners(&state.db, &auth_user, owners).await?;
    }

    let mut tx = state.db.begin().await?;

    if let Some(location) = payload.location.as_ref() {
        sqlx::query(
            r#"
            UPDATE locations
            SET city_id = $1,
                district_id = $2,
                street = $3,
                postal_code = $4,
                building_number = $5,
                apartment_number = $6,
                coordinates = ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography
            WHERE id = $9
            "#,
        )
        .bind(location.city_id)
        .bind(location.district_id)
        .bind(required_text(&location.street, "street")?)
        .bind(required_text(&location.postal_code, "postal_code")?)
        .bind(required_text(&location.building_number, "building_number")?)
        .bind(optional_text(location.apartment_number.clone()))
        .bind(location.longitude)
        .bind(location.latitude)
        .bind(current.location.id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        r#"
        UPDATE properties
        SET category_id = $1,
            area_sqm = $2,
            plot_area_sqm = $3,
            rooms = $4,
            floor = $5,
            year_built = $6,
            heating_type = $7,
            extra_attributes = $8,
            updated_at = now()
        WHERE id = $9
        "#,
    )
    .bind(payload.category_id.unwrap_or(current.category_id))
    .bind(payload.area_sqm.unwrap_or(current.area_sqm))
    .bind(payload.plot_area_sqm.or(current.plot_area_sqm))
    .bind(payload.rooms.unwrap_or(current.rooms))
    .bind(payload.floor.unwrap_or(current.floor))
    .bind(payload.year_built.unwrap_or(current.year_built))
    .bind(
        payload
            .heating_type
            .as_deref()
            .map(|value| required_text(value, "heating_type"))
            .transpose()?
            .unwrap_or(current.heating_type),
    )
    .bind(SqlxJson(
        payload.extra_attributes.unwrap_or(current.extra_attributes),
    ))
    .bind(property_id)
    .execute(&mut *tx)
    .await?;

    if let Some(amenity_ids) = payload.amenity_ids.as_ref() {
        replace_property_amenities(&mut tx, property_id, amenity_ids).await?;
    }

    if let Some(owners) = payload.owners.as_ref() {
        replace_property_owners(&mut tx, property_id, owners).await?;
    }

    tx.commit().await?;

    let property = load_property(&state.db, property_id)
        .await?
        .ok_or_else(|| ApiError::internal("property_not_found", "Property update failed"))?;
    Ok(Json(property))
}

pub async fn load_property(
    pool: &PgPool,
    property_id: i64,
) -> Result<Option<PropertyResponse>, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT p.id,
               p.category_id,
               c.name AS category_name,
               p.area_sqm,
               p.plot_area_sqm,
               p.rooms,
               p.floor,
               p.year_built,
               p.heating_type,
               p.extra_attributes,
               p.created_at::text AS created_at,
               p.updated_at::text AS updated_at,
               l.id AS location_id,
               l.city_id,
               city.name AS city_name,
               l.district_id,
               district.name AS district_name,
               l.street,
               l.postal_code,
               l.building_number,
               l.apartment_number,
               ST_Y(l.coordinates::geometry) AS latitude,
               ST_X(l.coordinates::geometry) AS longitude
        FROM properties p
        INNER JOIN categories c ON c.id = p.category_id
        INNER JOIN locations l ON l.id = p.location_id
        INNER JOIN cities city ON city.id = l.city_id
        LEFT JOIN districts district ON district.id = l.district_id
        WHERE p.id = $1
        "#,
    )
    .bind(property_id)
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };

    let owners_rows = sqlx::query(
        r#"
        SELECT user_id, ownership_share::text AS ownership_share
        FROM property_owners
        WHERE property_id = $1
        ORDER BY user_id ASC
        "#,
    )
    .bind(property_id)
    .fetch_all(pool)
    .await?;

    let amenity_rows = sqlx::query(
        r#"
        SELECT amenity_id
        FROM property_amenities
        WHERE property_id = $1
        ORDER BY amenity_id ASC
        "#,
    )
    .bind(property_id)
    .fetch_all(pool)
    .await?;

    let extra_attributes: SqlxJson<Value> =
        row.try_get("extra_attributes").map_err(ApiError::from)?;

    let owners = owners_rows
        .into_iter()
        .map(|owner_row| {
            Ok(PropertyOwnerResponse {
                user_id: owner_row.try_get("user_id").map_err(ApiError::from)?,
                ownership_share: parse_optional_db_f64(
                    owner_row
                        .try_get("ownership_share")
                        .map_err(ApiError::from)?,
                    "ownership_share",
                )?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    let amenity_ids = amenity_rows
        .into_iter()
        .map(|amenity_row| amenity_row.try_get("amenity_id").map_err(ApiError::from))
        .collect::<Result<Vec<i64>, ApiError>>()?;

    Ok(Some(PropertyResponse {
        id: row.try_get("id").map_err(ApiError::from)?,
        location: PropertyLocationResponse {
            id: row.try_get("location_id").map_err(ApiError::from)?,
            city_id: row.try_get("city_id").map_err(ApiError::from)?,
            city_name: row.try_get("city_name").map_err(ApiError::from)?,
            district_id: row.try_get("district_id").map_err(ApiError::from)?,
            district_name: row.try_get("district_name").map_err(ApiError::from)?,
            street: row.try_get("street").map_err(ApiError::from)?,
            postal_code: row.try_get("postal_code").map_err(ApiError::from)?,
            building_number: row.try_get("building_number").map_err(ApiError::from)?,
            apartment_number: row.try_get("apartment_number").map_err(ApiError::from)?,
            latitude: row.try_get("latitude").map_err(ApiError::from)?,
            longitude: row.try_get("longitude").map_err(ApiError::from)?,
        },
        category_id: row.try_get("category_id").map_err(ApiError::from)?,
        category_name: row.try_get("category_name").map_err(ApiError::from)?,
        area_sqm: row.try_get("area_sqm").map_err(ApiError::from)?,
        plot_area_sqm: row.try_get("plot_area_sqm").map_err(ApiError::from)?,
        rooms: row.try_get("rooms").map_err(ApiError::from)?,
        floor: row.try_get("floor").map_err(ApiError::from)?,
        year_built: row.try_get("year_built").map_err(ApiError::from)?,
        heating_type: row.try_get("heating_type").map_err(ApiError::from)?,
        extra_attributes: extra_attributes.0,
        amenity_ids,
        owners,
        created_at: row.try_get("created_at").map_err(ApiError::from)?,
        updated_at: row.try_get("updated_at").map_err(ApiError::from)?,
    }))
}

fn ensure_property_access(
    user: &AuthenticatedUser,
    property: &PropertyResponse,
) -> Result<(), ApiError> {
    if is_platform_admin(user) {
        return Ok(());
    }

    match user.business_role {
        BusinessRole::Buyer => Err(ApiError::forbidden(
            "forbidden",
            "Buyers cannot manage properties",
        )),
        BusinessRole::Agent => {
            if user.agency_id.is_some() {
                Ok(())
            } else {
                Err(ApiError::forbidden(
                    "agency_required",
                    "An agent must belong to an agency to manage properties",
                ))
            }
        }
        BusinessRole::Owner | BusinessRole::Developer => {
            if property.owners.iter().any(|owner| owner.user_id == user.id) {
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

async fn validate_property_owners(
    pool: &PgPool,
    auth_user: &AuthenticatedUser,
    owners: &[PropertyOwnerPayload],
) -> Result<(), ApiError> {
    if owners.is_empty() {
        return Err(ApiError::bad_request(
            "owners_required",
            "At least one property owner is required",
        ));
    }

    if matches!(
        auth_user.business_role,
        BusinessRole::Owner | BusinessRole::Developer
    ) && !owners.iter().any(|owner| owner.user_id == auth_user.id)
        && !is_platform_admin(auth_user)
    {
        return Err(ApiError::forbidden(
            "ownership_required",
            "You must be listed as an owner of the property",
        ));
    }

    if auth_user.business_role == BusinessRole::Agent
        && auth_user.agency_id.is_none()
        && !is_platform_admin(auth_user)
    {
        return Err(ApiError::forbidden(
            "agency_required",
            "An agent must belong to an agency to manage properties",
        ));
    }

    for owner in owners {
        if find_user_by_id(pool, owner.user_id).await?.is_none() {
            return Err(ApiError::bad_request(
                "owner_not_found",
                format!("Owner {} was not found", owner.user_id),
            ));
        }
    }

    Ok(())
}

async fn insert_location(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    payload: &LocationPayload,
) -> Result<i64, ApiError> {
    let row = sqlx::query(
        r#"
        INSERT INTO locations (
            city_id,
            district_id,
            street,
            postal_code,
            building_number,
            apartment_number,
            coordinates
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography
        )
        RETURNING id
        "#,
    )
    .bind(payload.city_id)
    .bind(payload.district_id)
    .bind(required_text(&payload.street, "street")?)
    .bind(required_text(&payload.postal_code, "postal_code")?)
    .bind(required_text(&payload.building_number, "building_number")?)
    .bind(optional_text(payload.apartment_number.clone()))
    .bind(payload.longitude)
    .bind(payload.latitude)
    .fetch_one(&mut **tx)
    .await?;

    row.try_get("id").map_err(ApiError::from)
}

async fn replace_property_owners(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    property_id: i64,
    owners: &[PropertyOwnerPayload],
) -> Result<(), ApiError> {
    sqlx::query("DELETE FROM property_owners WHERE property_id = $1")
        .bind(property_id)
        .execute(&mut **tx)
        .await?;

    for owner in owners {
        sqlx::query(
            r#"
            INSERT INTO property_owners (property_id, user_id, ownership_share)
            VALUES ($1, $2, $3::numeric)
            "#,
        )
        .bind(property_id)
        .bind(owner.user_id)
        .bind(owner.ownership_share.map(|value| format!("{value:.2}")))
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

async fn replace_property_amenities(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    property_id: i64,
    amenity_ids: &[i64],
) -> Result<(), ApiError> {
    sqlx::query("DELETE FROM property_amenities WHERE property_id = $1")
        .bind(property_id)
        .execute(&mut **tx)
        .await?;

    for amenity_id in amenity_ids {
        sqlx::query(
            r#"
            INSERT INTO property_amenities (property_id, amenity_id)
            VALUES ($1, $2)
            "#,
        )
        .bind(property_id)
        .bind(*amenity_id)
        .execute(&mut **tx)
        .await?;
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

fn optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}
