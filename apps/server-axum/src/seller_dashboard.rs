use axum::{extract::State, Json};
use serde::Serialize;
use sqlx::{PgPool, Row};

use crate::{
    accounts::{find_user_by_id, get_agency, ProfileResponse},
    auth::AuthenticatedUser,
    error::ApiError,
    listings::{load_listing, ListingResponse},
    models::BusinessRole,
    AppState,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SellerDashboardResponse {
    pub profile: ProfileResponse,
    pub summary: SellerDashboardSummary,
    pub checklist: Vec<SellerChecklistItem>,
    pub recent_listings: Vec<ListingResponse>,
    pub recent_conversations: Vec<SellerConversationSummary>,
    pub upcoming_open_houses: Vec<SellerOpenHouseSummary>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SellerDashboardSummary {
    pub draft_count: i64,
    pub active_count: i64,
    pub sold_count: i64,
    pub expired_count: i64,
    pub conversation_count: i64,
    pub upcoming_open_house_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SellerChecklistItem {
    pub id: &'static str,
    pub label: &'static str,
    pub description: String,
    pub complete: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SellerConversationSummary {
    pub id: i64,
    pub listing_id: Option<i64>,
    pub participant_user_id: i64,
    pub participant_user_email: String,
    pub last_message_preview: String,
    pub last_message_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SellerOpenHouseSummary {
    pub id: i64,
    pub listing_id: i64,
    pub listing_slug: String,
    pub start_time: String,
    pub end_time: String,
    pub requires_registration: bool,
    pub instructions: String,
    pub city: String,
    pub street: String,
}

pub async fn get_seller_dashboard_handler(
    State(state): State<AppState>,
    auth_user: AuthenticatedUser,
) -> Result<Json<SellerDashboardResponse>, ApiError> {
    let user = find_user_by_id(&state.db, auth_user.id)
        .await?
        .ok_or_else(|| ApiError::not_found("user_not_found", "User was not found"))?;
    let profile = ProfileResponse::from(user);

    let summary = load_dashboard_summary(&state.db, &auth_user).await?;
    let has_any_listing =
        summary.draft_count + summary.active_count + summary.sold_count + summary.expired_count > 0;
    let has_main_photo = load_has_main_photo(&state.db, auth_user.id).await?;
    let recent_listings = load_recent_listings(&state.db, auth_user.id).await?;
    let recent_conversations = load_recent_conversations(&state.db, &auth_user).await?;
    let upcoming_open_houses = load_upcoming_open_houses(&state.db, &auth_user).await?;
    let agency = match profile.agency_id {
        Some(agency_id) => get_agency(&state.db, agency_id).await?,
        None => None,
    };
    let checklist = build_checklist(
        &auth_user,
        &profile,
        agency.as_ref(),
        has_any_listing,
        has_main_photo,
        summary.active_count > 0,
    );

    Ok(Json(SellerDashboardResponse {
        profile,
        summary,
        checklist,
        recent_listings,
        recent_conversations,
        upcoming_open_houses,
    }))
}

async fn load_dashboard_summary(
    pool: &PgPool,
    auth_user: &AuthenticatedUser,
) -> Result<SellerDashboardSummary, ApiError> {
    let seller_enabled = has_seller_dashboard_access(auth_user.business_role);
    if !seller_enabled {
        return Ok(SellerDashboardSummary::default());
    }

    let listings_row = sqlx::query(
        r#"
        SELECT
            COUNT(*) FILTER (WHERE status = 'draft') AS draft_count,
            COUNT(*) FILTER (WHERE status = 'active') AS active_count,
            COUNT(*) FILTER (WHERE status = 'sold') AS sold_count,
            COUNT(*) FILTER (WHERE status = 'expired') AS expired_count
        FROM listings
        WHERE seller_user_id = $1
        "#,
    )
    .bind(auth_user.id)
    .fetch_one(pool)
    .await?;

    let conversation_row = sqlx::query(
        r#"
        SELECT COUNT(*) AS total
        FROM conversations c
        INNER JOIN listings l ON l.id = c.listing_id
        WHERE l.seller_user_id = $1
          AND (c.participant_one_id = $1 OR c.participant_two_id = $1)
        "#,
    )
    .bind(auth_user.id)
    .fetch_one(pool)
    .await?;

    let open_house_row = sqlx::query(
        r#"
        SELECT COUNT(*) AS total
        FROM open_houses oh
        INNER JOIN listings l ON l.id = oh.listing_id
        WHERE l.seller_user_id = $1
          AND oh.start_time >= now()
        "#,
    )
    .bind(auth_user.id)
    .fetch_one(pool)
    .await?;

    Ok(SellerDashboardSummary {
        draft_count: listings_row
            .try_get::<i64, _>("draft_count")
            .map_err(ApiError::from)?,
        active_count: listings_row
            .try_get::<i64, _>("active_count")
            .map_err(ApiError::from)?,
        sold_count: listings_row
            .try_get::<i64, _>("sold_count")
            .map_err(ApiError::from)?,
        expired_count: listings_row
            .try_get::<i64, _>("expired_count")
            .map_err(ApiError::from)?,
        conversation_count: conversation_row
            .try_get::<i64, _>("total")
            .map_err(ApiError::from)?,
        upcoming_open_house_count: open_house_row
            .try_get::<i64, _>("total")
            .map_err(ApiError::from)?,
    })
}

async fn load_has_main_photo(pool: &PgPool, seller_user_id: i64) -> Result<bool, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM listings l
            INNER JOIN media m ON m.listing_id = l.id
            WHERE l.seller_user_id = $1
              AND m.media_type = 'photo'
              AND m.is_main = TRUE
        ) AS has_main_photo
        "#,
    )
    .bind(seller_user_id)
    .fetch_one(pool)
    .await?;

    row.try_get("has_main_photo").map_err(ApiError::from)
}

async fn load_recent_listings(
    pool: &PgPool,
    seller_user_id: i64,
) -> Result<Vec<ListingResponse>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT id
        FROM listings
        WHERE seller_user_id = $1
        ORDER BY updated_at DESC, id DESC
        LIMIT 4
        "#,
    )
    .bind(seller_user_id)
    .fetch_all(pool)
    .await?;

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let listing_id: i64 = row.try_get("id").map_err(ApiError::from)?;
        if let Some(listing) = load_listing(pool, listing_id).await? {
            items.push(listing);
        }
    }

    Ok(items)
}

async fn load_recent_conversations(
    pool: &PgPool,
    auth_user: &AuthenticatedUser,
) -> Result<Vec<SellerConversationSummary>, ApiError> {
    if !has_seller_dashboard_access(auth_user.business_role) {
        return Ok(Vec::new());
    }

    let rows = sqlx::query(
        r#"
        SELECT
            c.id,
            c.listing_id,
            CASE
                WHEN c.participant_one_id = $1 THEN c.participant_two_id
                ELSE c.participant_one_id
            END AS participant_user_id,
            peer.email AS participant_user_email,
            c.updated_at::text AS updated_at,
            msg.content AS last_message_preview,
            msg.sent_at::text AS last_message_at
        FROM conversations c
        INNER JOIN listings l ON l.id = c.listing_id
        INNER JOIN users peer ON peer.id = CASE
            WHEN c.participant_one_id = $1 THEN c.participant_two_id
            ELSE c.participant_one_id
        END
        LEFT JOIN LATERAL (
            SELECT content, sent_at
            FROM messages
            WHERE conversation_id = c.id
            ORDER BY sent_at DESC, id DESC
            LIMIT 1
        ) msg ON TRUE
        WHERE l.seller_user_id = $1
          AND (c.participant_one_id = $1 OR c.participant_two_id = $1)
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT 5
        "#,
    )
    .bind(auth_user.id)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            Ok(SellerConversationSummary {
                id: row.try_get("id").map_err(ApiError::from)?,
                listing_id: row.try_get("listing_id").map_err(ApiError::from)?,
                participant_user_id: row.try_get("participant_user_id").map_err(ApiError::from)?,
                participant_user_email: row
                    .try_get("participant_user_email")
                    .map_err(ApiError::from)?,
                last_message_preview: row
                    .try_get::<Option<String>, _>("last_message_preview")
                    .map_err(ApiError::from)?
                    .unwrap_or_else(|| "Brak wiadomości".to_string()),
                last_message_at: row.try_get("last_message_at").map_err(ApiError::from)?,
                updated_at: row.try_get("updated_at").map_err(ApiError::from)?,
            })
        })
        .collect()
}

async fn load_upcoming_open_houses(
    pool: &PgPool,
    auth_user: &AuthenticatedUser,
) -> Result<Vec<SellerOpenHouseSummary>, ApiError> {
    if !has_seller_dashboard_access(auth_user.business_role) {
        return Ok(Vec::new());
    }

    let rows = sqlx::query(
        r#"
        SELECT
            oh.id,
            oh.listing_id,
            l.slug AS listing_slug,
            oh.start_time::text AS start_time,
            oh.end_time::text AS end_time,
            oh.requires_registration,
            oh.instructions,
            city.name AS city,
            loc.street
        FROM open_houses oh
        INNER JOIN listings l ON l.id = oh.listing_id
        INNER JOIN properties p ON p.id = l.property_id
        INNER JOIN locations loc ON loc.id = p.location_id
        INNER JOIN cities city ON city.id = loc.city_id
        WHERE l.seller_user_id = $1
          AND oh.start_time >= now()
        ORDER BY oh.start_time ASC, oh.id ASC
        LIMIT 5
        "#,
    )
    .bind(auth_user.id)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            Ok(SellerOpenHouseSummary {
                id: row.try_get("id").map_err(ApiError::from)?,
                listing_id: row.try_get("listing_id").map_err(ApiError::from)?,
                listing_slug: row.try_get("listing_slug").map_err(ApiError::from)?,
                start_time: row.try_get("start_time").map_err(ApiError::from)?,
                end_time: row.try_get("end_time").map_err(ApiError::from)?,
                requires_registration: row
                    .try_get("requires_registration")
                    .map_err(ApiError::from)?,
                instructions: row.try_get("instructions").map_err(ApiError::from)?,
                city: row.try_get("city").map_err(ApiError::from)?,
                street: row.try_get("street").map_err(ApiError::from)?,
            })
        })
        .collect()
}

fn build_checklist(
    auth_user: &AuthenticatedUser,
    profile: &ProfileResponse,
    agency: Option<&crate::accounts::AgencyResponse>,
    has_any_listing: bool,
    has_main_photo: bool,
    has_published_listing: bool,
) -> Vec<SellerChecklistItem> {
    let seller_role_ready = has_seller_dashboard_access(auth_user.business_role);

    vec![
        SellerChecklistItem {
            id: "seller-role",
            label: "Profil wystawiającego",
            description: if seller_role_ready {
                format!(
                    "Konto działa jako {}.",
                    business_role_label(auth_user.business_role)
                )
            } else {
                "Wybierz rolę właściciela lub agenta, aby wystawiać oferty.".to_string()
            },
            complete: seller_role_ready,
        },
        SellerChecklistItem {
            id: "contact-phone",
            label: "Telefon kontaktowy",
            description: profile.phone.clone().unwrap_or_else(|| {
                "Dodaj numer telefonu, żeby kupujący mogli szybciej się z Tobą skontaktować."
                    .to_string()
            }),
            complete: profile
                .phone
                .as_ref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false),
        },
        SellerChecklistItem {
            id: "agency",
            label: "Agencja",
            description: if auth_user.business_role != BusinessRole::Agent {
                "Agencja nie jest wymagana dla tego typu konta.".to_string()
            } else if let Some(agency) = agency {
                format!("Połączono z agencją {}.", agency.company_name)
            } else {
                "Agent musi mieć przypisaną agencję przed publikacją oferty.".to_string()
            },
            complete: auth_user.business_role != BusinessRole::Agent || profile.agency_id.is_some(),
        },
        SellerChecklistItem {
            id: "draft-listing",
            label: "Szkic oferty",
            description: if has_any_listing {
                "Masz już pierwszą nieruchomość lub szkic gotowy do dalszej edycji.".to_string()
            } else {
                "Utwórz pierwszą nieruchomość i zapisz szkic oferty sprzedaży.".to_string()
            },
            complete: has_any_listing,
        },
        SellerChecklistItem {
            id: "main-photo",
            label: "Główne zdjęcie",
            description: if has_main_photo {
                "Przynajmniej jedna oferta ma ustawione zdjęcie główne.".to_string()
            } else {
                "Dodaj zdjęcie główne, żeby oferta była gotowa do publikacji.".to_string()
            },
            complete: has_main_photo,
        },
        SellerChecklistItem {
            id: "publication",
            label: "Publikacja",
            description: if has_published_listing {
                "Masz już aktywną ofertę widoczną dla kupujących.".to_string()
            } else {
                "Opublikuj pierwszą ofertę, aby rozpocząć pozyskiwanie kontaktów.".to_string()
            },
            complete: has_published_listing,
        },
    ]
}

fn has_seller_dashboard_access(role: BusinessRole) -> bool {
    matches!(
        role,
        BusinessRole::Owner | BusinessRole::Agent | BusinessRole::Developer
    )
}

fn business_role_label(role: BusinessRole) -> &'static str {
    match role {
        BusinessRole::Buyer => "kupujący",
        BusinessRole::Agent => "agent",
        BusinessRole::Developer => "deweloper",
        BusinessRole::Owner => "właściciel",
    }
}
