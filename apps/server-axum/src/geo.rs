use axum::{
    extract::{Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    error::ApiError,
    models::{PaginatedResponse, PaginationQuery},
    AppState,
};

#[derive(Debug, Serialize)]
pub struct DictionaryItem {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct AmenityResponse {
    pub id: i64,
    pub name: String,
    pub icon_name: String,
}

#[derive(Debug, Deserialize)]
pub struct CityQuery {
    pub voivodeship_id: i64,
    pub page: Option<u64>,
    pub per_page: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct DistrictQuery {
    pub city_id: i64,
    pub page: Option<u64>,
    pub per_page: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct BasicListQuery {
    pub page: Option<u64>,
    pub per_page: Option<u64>,
}

pub async fn list_voivodeships_handler(
    State(state): State<AppState>,
    Query(query): Query<BasicListQuery>,
) -> Result<Json<PaginatedResponse<DictionaryItem>>, ApiError> {
    list_dictionary(
        &state,
        "SELECT COUNT(*) AS total FROM voivodeships",
        r#"
        SELECT id, name
        FROM voivodeships
        ORDER BY name ASC
        LIMIT $1 OFFSET $2
        "#,
        PaginationQuery {
            page: query.page,
            per_page: query.per_page,
        },
        Vec::<String>::new(),
    )
    .await
}

pub async fn list_cities_handler(
    State(state): State<AppState>,
    Query(query): Query<CityQuery>,
) -> Result<Json<PaginatedResponse<DictionaryItem>>, ApiError> {
    let pagination = PaginationQuery {
        page: query.page,
        per_page: query.per_page,
    }
    .normalize();

    let total_row = sqlx::query(
        r#"
        SELECT COUNT(*) AS total
        FROM cities
        WHERE voivodeship_id = $1
        "#,
    )
    .bind(query.voivodeship_id)
    .fetch_one(&state.db)
    .await?;
    let total: i64 = total_row.try_get("total").map_err(ApiError::from)?;

    let rows = sqlx::query(
        r#"
        SELECT id, name
        FROM cities
        WHERE voivodeship_id = $1
        ORDER BY name ASC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(query.voivodeship_id)
    .bind(pagination.limit)
    .bind(pagination.offset)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(PaginatedResponse::new(
        rows.into_iter()
            .map(map_dictionary_row)
            .collect::<Result<Vec<_>, _>>()?,
        pagination,
        total as u64,
    )))
}

pub async fn list_districts_handler(
    State(state): State<AppState>,
    Query(query): Query<DistrictQuery>,
) -> Result<Json<PaginatedResponse<DictionaryItem>>, ApiError> {
    let pagination = PaginationQuery {
        page: query.page,
        per_page: query.per_page,
    }
    .normalize();

    let total_row = sqlx::query(
        r#"
        SELECT COUNT(*) AS total
        FROM districts
        WHERE city_id = $1
        "#,
    )
    .bind(query.city_id)
    .fetch_one(&state.db)
    .await?;
    let total: i64 = total_row.try_get("total").map_err(ApiError::from)?;

    let rows = sqlx::query(
        r#"
        SELECT id, name
        FROM districts
        WHERE city_id = $1
        ORDER BY name ASC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(query.city_id)
    .bind(pagination.limit)
    .bind(pagination.offset)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(PaginatedResponse::new(
        rows.into_iter()
            .map(map_dictionary_row)
            .collect::<Result<Vec<_>, _>>()?,
        pagination,
        total as u64,
    )))
}

pub async fn list_categories_handler(
    State(state): State<AppState>,
    Query(query): Query<BasicListQuery>,
) -> Result<Json<PaginatedResponse<DictionaryItem>>, ApiError> {
    list_dictionary(
        &state,
        "SELECT COUNT(*) AS total FROM categories",
        r#"
        SELECT id, name
        FROM categories
        ORDER BY name ASC
        LIMIT $1 OFFSET $2
        "#,
        PaginationQuery {
            page: query.page,
            per_page: query.per_page,
        },
        Vec::<String>::new(),
    )
    .await
}

pub async fn list_amenities_handler(
    State(state): State<AppState>,
    Query(query): Query<BasicListQuery>,
) -> Result<Json<PaginatedResponse<AmenityResponse>>, ApiError> {
    let pagination = PaginationQuery {
        page: query.page,
        per_page: query.per_page,
    }
    .normalize();

    let total_row = sqlx::query("SELECT COUNT(*) AS total FROM amenities")
        .fetch_one(&state.db)
        .await?;
    let total: i64 = total_row.try_get("total").map_err(ApiError::from)?;

    let rows = sqlx::query(
        r#"
        SELECT id, name, icon_name
        FROM amenities
        ORDER BY name ASC
        LIMIT $1 OFFSET $2
        "#,
    )
    .bind(pagination.limit)
    .bind(pagination.offset)
    .fetch_all(&state.db)
    .await?;

    let items = rows
        .into_iter()
        .map(|row| {
            Ok(AmenityResponse {
                id: row.try_get("id").map_err(ApiError::from)?,
                name: row.try_get("name").map_err(ApiError::from)?,
                icon_name: row.try_get("icon_name").map_err(ApiError::from)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(PaginatedResponse::new(
        items,
        pagination,
        total as u64,
    )))
}

async fn list_dictionary(
    state: &AppState,
    total_sql: &str,
    rows_sql: &str,
    query: PaginationQuery,
    _bindings: Vec<String>,
) -> Result<Json<PaginatedResponse<DictionaryItem>>, ApiError> {
    let pagination = query.normalize();
    let total_row = sqlx::query(total_sql).fetch_one(&state.db).await?;
    let total: i64 = total_row.try_get("total").map_err(ApiError::from)?;
    let rows = sqlx::query(rows_sql)
        .bind(pagination.limit)
        .bind(pagination.offset)
        .fetch_all(&state.db)
        .await?;

    Ok(Json(PaginatedResponse::new(
        rows.into_iter()
            .map(map_dictionary_row)
            .collect::<Result<Vec<_>, _>>()?,
        pagination,
        total as u64,
    )))
}

fn map_dictionary_row(row: sqlx::postgres::PgRow) -> Result<DictionaryItem, ApiError> {
    Ok(DictionaryItem {
        id: row.try_get("id").map_err(ApiError::from)?,
        name: row.try_get("name").map_err(ApiError::from)?,
    })
}
