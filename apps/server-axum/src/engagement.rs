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
    models::{BusinessRole, PaginatedResponse, PaginationQuery},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct ListConversationsQuery {
    pub page: Option<u64>,
    pub per_page: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateConversationRequest {
    pub listing_id: Option<i64>,
    pub participant_user_id: i64,
    pub initial_message: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateMessageRequest {
    pub content: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct MessageResponse {
    pub id: i64,
    pub conversation_id: i64,
    pub sender_id: i64,
    pub content: String,
    pub sent_at: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ConversationResponse {
    pub id: i64,
    pub listing_id: Option<i64>,
    pub participant_one_id: i64,
    pub participant_two_id: i64,
    pub created_at: String,
    pub updated_at: String,
    pub last_message: Option<MessageResponse>,
}

pub async fn list_conversations_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Query(query): Query<ListConversationsQuery>,
) -> Result<Json<PaginatedResponse<ConversationResponse>>, ApiError> {
    let pagination = PaginationQuery {
        page: query.page,
        per_page: query.per_page,
    }
    .normalize();

    let total_row = sqlx::query(
        r#"
        SELECT COUNT(*) AS total
        FROM conversations
        WHERE participant_one_id = $1 OR participant_two_id = $1
        "#,
    )
    .bind(auth_user.id)
    .fetch_one(&state.db)
    .await?;
    let total: i64 = total_row.try_get("total").map_err(ApiError::from)?;

    let rows = sqlx::query(
        r#"
        SELECT id
        FROM conversations
        WHERE participant_one_id = $1 OR participant_two_id = $1
        ORDER BY updated_at DESC, id DESC
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
        let conversation_id: i64 = row.try_get("id").map_err(ApiError::from)?;
        items.push(
            load_conversation(&state.db, conversation_id)
                .await?
                .ok_or_else(|| {
                    ApiError::internal(
                        "conversation_load_failed",
                        "Conversation disappeared mid-request",
                    )
                })?,
        );
    }

    Ok(Json(PaginatedResponse::new(
        items,
        pagination,
        total as u64,
    )))
}

pub async fn create_conversation_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Json(payload): Json<CreateConversationRequest>,
) -> Result<(StatusCode, Json<ConversationResponse>), ApiError> {
    require_buyer_or_admin(&auth_user)?;
    if payload.participant_user_id == auth_user.id {
        return Err(ApiError::bad_request(
            "invalid_participant",
            "Conversation participant must be another user",
        ));
    }

    if let Some(listing_id) = payload.listing_id {
        let listing = load_listing(&state.db, listing_id)
            .await?
            .ok_or_else(|| ApiError::not_found("listing_not_found", "Listing was not found"))?;
        if listing.seller_user_id != payload.participant_user_id {
            return Err(ApiError::bad_request(
                "participant_mismatch",
                "Listing participant must match the listing seller",
            ));
        }
    }

    let participant_one_id = auth_user.id.min(payload.participant_user_id);
    let participant_two_id = auth_user.id.max(payload.participant_user_id);

    let mut tx = state.db.begin().await?;
    let conversation_row = sqlx::query(
        r#"
        INSERT INTO conversations (listing_id, participant_one_id, participant_two_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (
            COALESCE(listing_id, 0),
            LEAST(participant_one_id, participant_two_id),
            GREATEST(participant_one_id, participant_two_id)
        )
        DO UPDATE SET updated_at = now()
        RETURNING id
        "#,
    )
    .bind(payload.listing_id)
    .bind(participant_one_id)
    .bind(participant_two_id)
    .fetch_one(&mut *tx)
    .await?;
    let conversation_id: i64 = conversation_row.try_get("id").map_err(ApiError::from)?;

    insert_message(
        &mut tx,
        conversation_id,
        auth_user.id,
        &payload.initial_message,
    )
    .await?;

    if let Some(listing_id) = payload.listing_id {
        let seller_row = sqlx::query(
            r#"
            SELECT agency_id
            FROM users
            WHERE id = $1
            "#,
        )
        .bind(payload.participant_user_id)
        .fetch_one(&mut *tx)
        .await?;
        let agency_id: Option<i64> = seller_row.try_get("agency_id").map_err(ApiError::from)?;

        sqlx::query(
            r#"
            INSERT INTO leads (
                buyer_user_id,
                listing_id,
                agency_id,
                seller_user_id,
                source,
                match_score,
                status
            )
            SELECT $1, $2, $3, $4, 'message', 0, 'new'
            WHERE NOT EXISTS (
                SELECT 1
                FROM leads
                WHERE buyer_user_id = $1
                  AND listing_id = $2
                  AND seller_user_id = $4
                  AND source = 'message'
            )
            "#,
        )
        .bind(auth_user.id)
        .bind(listing_id)
        .bind(agency_id)
        .bind(payload.participant_user_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    let conversation = load_conversation(&state.db, conversation_id)
        .await?
        .ok_or_else(|| {
            ApiError::internal("conversation_not_found", "Conversation creation failed")
        })?;
    Ok((StatusCode::CREATED, Json(conversation)))
}

pub async fn list_messages_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Path(conversation_id): Path<i64>,
) -> Result<Json<Vec<MessageResponse>>, ApiError> {
    ensure_conversation_participant(&state.db, &auth_user, conversation_id).await?;
    Ok(Json(load_messages(&state.db, conversation_id).await?))
}

pub async fn create_message_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
    Path(conversation_id): Path<i64>,
    Json(payload): Json<CreateMessageRequest>,
) -> Result<(StatusCode, Json<MessageResponse>), ApiError> {
    ensure_conversation_participant(&state.db, &auth_user, conversation_id).await?;
    let mut tx = state.db.begin().await?;
    let message = insert_message(&mut tx, conversation_id, auth_user.id, &payload.content).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(message)))
}

async fn load_conversation(
    pool: &PgPool,
    conversation_id: i64,
) -> Result<Option<ConversationResponse>, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT id, listing_id, participant_one_id, participant_two_id,
               created_at::text AS created_at,
               updated_at::text AS updated_at
        FROM conversations
        WHERE id = $1
        "#,
    )
    .bind(conversation_id)
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };

    let last_message = sqlx::query(
        r#"
        SELECT id, conversation_id, sender_id, content, sent_at::text AS sent_at
        FROM messages
        WHERE conversation_id = $1
        ORDER BY sent_at DESC, id DESC
        LIMIT 1
        "#,
    )
    .bind(conversation_id)
    .fetch_optional(pool)
    .await?
    .map(map_message_row)
    .transpose()?;

    Ok(Some(ConversationResponse {
        id: row.try_get("id").map_err(ApiError::from)?,
        listing_id: row.try_get("listing_id").map_err(ApiError::from)?,
        participant_one_id: row.try_get("participant_one_id").map_err(ApiError::from)?,
        participant_two_id: row.try_get("participant_two_id").map_err(ApiError::from)?,
        created_at: row.try_get("created_at").map_err(ApiError::from)?,
        updated_at: row.try_get("updated_at").map_err(ApiError::from)?,
        last_message,
    }))
}

async fn load_messages(
    pool: &PgPool,
    conversation_id: i64,
) -> Result<Vec<MessageResponse>, ApiError> {
    sqlx::query(
        r#"
        SELECT id, conversation_id, sender_id, content, sent_at::text AS sent_at
        FROM messages
        WHERE conversation_id = $1
        ORDER BY sent_at ASC, id ASC
        "#,
    )
    .bind(conversation_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(map_message_row)
    .collect()
}

async fn insert_message(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    conversation_id: i64,
    sender_id: i64,
    content: &str,
) -> Result<MessageResponse, ApiError> {
    let row = sqlx::query(
        r#"
        INSERT INTO messages (conversation_id, sender_id, content)
        VALUES ($1, $2, $3)
        RETURNING id, conversation_id, sender_id, content, sent_at::text AS sent_at
        "#,
    )
    .bind(conversation_id)
    .bind(sender_id)
    .bind(required_text(content, "content")?)
    .fetch_one(&mut **tx)
    .await?;

    sqlx::query("UPDATE conversations SET updated_at = now() WHERE id = $1")
        .bind(conversation_id)
        .execute(&mut **tx)
        .await?;

    map_message_row(row)
}

async fn ensure_conversation_participant(
    pool: &PgPool,
    auth_user: &AuthenticatedUser,
    conversation_id: i64,
) -> Result<(), ApiError> {
    if is_platform_admin(auth_user) {
        return Ok(());
    }

    let row = sqlx::query(
        r#"
        SELECT participant_one_id, participant_two_id
        FROM conversations
        WHERE id = $1
        "#,
    )
    .bind(conversation_id)
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        return Err(ApiError::not_found(
            "conversation_not_found",
            "Conversation was not found",
        ));
    };

    let participant_one_id: i64 = row.try_get("participant_one_id").map_err(ApiError::from)?;
    let participant_two_id: i64 = row.try_get("participant_two_id").map_err(ApiError::from)?;
    if auth_user.id == participant_one_id || auth_user.id == participant_two_id {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "forbidden",
            "You are not a participant in this conversation",
        ))
    }
}

fn require_buyer_or_admin(auth_user: &AuthenticatedUser) -> Result<(), ApiError> {
    if is_platform_admin(auth_user) || auth_user.business_role == BusinessRole::Buyer {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "forbidden",
            "This action is only available to buyers",
        ))
    }
}

fn map_message_row(row: sqlx::postgres::PgRow) -> Result<MessageResponse, ApiError> {
    Ok(MessageResponse {
        id: row.try_get("id").map_err(ApiError::from)?,
        conversation_id: row.try_get("conversation_id").map_err(ApiError::from)?,
        sender_id: row.try_get("sender_id").map_err(ApiError::from)?,
        content: row.try_get("content").map_err(ApiError::from)?,
        sent_at: row.try_get("sent_at").map_err(ApiError::from)?,
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
