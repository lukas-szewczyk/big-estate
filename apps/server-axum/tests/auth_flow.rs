use http_body_util::BodyExt;
use serial_test::serial;
use server_axum::{
    accounts, build_app, create_state,
    models::{BusinessRole, PlatformRole},
    seed_reference_data, AppState, Config, MIGRATOR,
};
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use tower::ServiceExt;

fn test_config() -> Config {
    Config {
        app_host: "127.0.0.1".to_string(),
        app_port: 3000,
        database_url: std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://god:god@127.0.0.1:5432/god".to_string()),
        frontend_origin: "http://localhost:4321".to_string(),
        auth_cookie_name: "auth_session".to_string(),
        auth_cookie_domain: None,
        auth_cookie_secure: false,
        session_ttl_days: 30,
        bootstrap_admin_email: None,
        bootstrap_admin_password: None,
    }
}

async fn test_pool() -> PgPool {
    let pool = PgPool::connect(&test_config().database_url).await.unwrap();
    MIGRATOR.run(&pool).await.unwrap();
    sqlx::query(
        r#"
        TRUNCATE
            messages,
            conversations,
            phone_reveal_logs,
            leads,
            saved_searches,
            wishlist_items,
            wishlists,
            promotions,
            open_houses,
            media,
            listings,
            property_histories,
            property_amenities,
            property_owners,
            properties,
            neighborhood_data,
            locations,
            districts,
            cities,
            voivodeships,
            amenities,
            categories,
            sessions,
            users,
            agencies,
            subscriptions,
            subscription_plans,
            billing_accounts
        RESTART IDENTITY CASCADE
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    seed_reference_data(&pool).await.unwrap();
    pool
}

async fn test_app() -> axum::Router {
    let state = create_state(test_config()).await.unwrap();
    build_app(state).unwrap()
}

fn cookie_value(response: &axum::response::Response) -> String {
    response
        .headers()
        .get(http::header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string()
}

async fn json_body<T: serde::de::DeserializeOwned>(response: axum::response::Response) -> T {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

async fn register_user(email: &str, password: &str) -> axum::response::Response {
    test_app()
        .await
        .oneshot(
            http::Request::builder()
                .method(http::Method::POST)
                .uri("/auth/register")
                .header(http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    serde_json::json!({ "email": email, "password": password }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn login_cookie(email: &str, password: &str) -> String {
    let response = test_app()
        .await
        .oneshot(
            http::Request::builder()
                .method(http::Method::POST)
                .uri("/auth/login")
                .header(http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    serde_json::json!({ "email": email, "password": password }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), http::StatusCode::NO_CONTENT);
    cookie_value(&response)
}

async fn create_user_with_cookie(
    pool: &PgPool,
    email: &str,
    password: &str,
    role: PlatformRole,
    business_role: BusinessRole,
) -> (i64, String) {
    let user = accounts::create_user(pool, email, password, role, business_role)
        .await
        .unwrap();
    let cookie = login_cookie(email, password).await;
    (user.id, cookie)
}

async fn authed_json(
    method: http::Method,
    uri: &str,
    cookie: &str,
    body: serde_json::Value,
) -> axum::response::Response {
    test_app()
        .await
        .oneshot(
            http::Request::builder()
                .method(method)
                .uri(uri)
                .header(http::header::COOKIE, cookie)
                .header(http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn authed_empty(method: http::Method, uri: &str, cookie: &str) -> axum::response::Response {
    test_app()
        .await
        .oneshot(
            http::Request::builder()
                .method(method)
                .uri(uri)
                .header(http::header::COOKIE, cookie)
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn create_property_for_owner(
    cookie: &str,
    owner_id: i64,
    street: &str,
    city_id: i64,
    district_id: i64,
    latitude: f64,
    longitude: f64,
) -> i64 {
    let response = authed_json(
        http::Method::POST,
        "/api/v1/properties",
        cookie,
        serde_json::json!({
            "location": {
                "city_id": city_id,
                "district_id": district_id,
                "street": street,
                "postal_code": "00-001",
                "building_number": "10",
                "apartment_number": "12",
                "latitude": latitude,
                "longitude": longitude
            },
            "category_id": 1,
            "area_sqm": 72.5,
            "plot_area_sqm": null,
            "rooms": 3,
            "floor": 4,
            "year_built": 2018,
            "heating_type": "district",
            "extra_attributes": { "finish": "turnkey" },
            "amenity_ids": [1, 2],
            "owners": [{ "user_id": owner_id, "ownership_share": 100.0 }]
        }),
    )
    .await;
    assert_eq!(response.status(), http::StatusCode::CREATED);
    let payload: serde_json::Value = json_body(response).await;
    payload["id"].as_i64().unwrap()
}

async fn create_sale_listing(
    cookie: &str,
    property_id: i64,
    price: f64,
    status: Option<&str>,
) -> serde_json::Value {
    let response = authed_json(
        http::Method::POST,
        "/api/v1/listings",
        cookie,
        serde_json::json!({
            "property_id": property_id,
            "transaction_type": "sale",
            "price": price,
            "status": status
        }),
    )
    .await;
    assert_eq!(response.status(), http::StatusCode::CREATED);
    json_body(response).await
}

async fn create_agency(cookie: &str, company_name: &str) -> serde_json::Value {
    let response = authed_json(
        http::Method::POST,
        "/api/v1/agencies",
        cookie,
        serde_json::json!({
            "company_name": company_name,
            "nip": "1234567890",
            "address": "Warszawa, Prosta 10"
        }),
    )
    .await;
    assert_eq!(response.status(), http::StatusCode::CREATED);
    json_body(response).await
}

#[tokio::test]
#[serial]
async fn register_and_me_return_extended_session_user() {
    let pool = test_pool().await;

    let register_response = register_user("buyer@example.com", "secret-password").await;
    assert_eq!(register_response.status(), http::StatusCode::CREATED);
    let cookie = cookie_value(&register_response);
    let user: serde_json::Value = json_body(register_response).await;
    assert_eq!(user["email"], "buyer@example.com");
    assert_eq!(user["role"], "user");
    assert_eq!(user["business_role"], "buyer");

    let stored_user = accounts::find_user_by_email(&pool, "buyer@example.com")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored_user.business_role, BusinessRole::Buyer);

    let me_response = authed_empty(http::Method::GET, "/auth/me", &cookie).await;
    assert_eq!(me_response.status(), http::StatusCode::OK);
    let me_user: serde_json::Value = json_body(me_response).await;
    assert_eq!(me_user["email"], "buyer@example.com");
    assert_eq!(me_user["role"], "user");
    assert_eq!(me_user["business_role"], "buyer");
}

#[tokio::test]
#[serial]
async fn owner_can_create_property_save_draft_listing_add_media_and_publish() {
    let pool = test_pool().await;
    let (owner_id, owner_cookie) = create_user_with_cookie(
        &pool,
        "owner@example.com",
        "secret-password",
        PlatformRole::User,
        BusinessRole::Owner,
    )
    .await;

    let property_id = create_property_for_owner(
        &owner_cookie,
        owner_id,
        "Marszalkowska",
        101,
        1001,
        52.2297,
        21.0122,
    )
    .await;

    let listing_json =
        create_sale_listing(&owner_cookie, property_id, 599000.0, Some("draft")).await;
    let listing_id = listing_json["id"].as_i64().unwrap();
    assert!(listing_json["slug"].as_str().unwrap().contains("apartment"));
    assert_eq!(listing_json["status"], "draft");

    let add_media = authed_json(
        http::Method::POST,
        &format!("/api/v1/listings/{listing_id}/media"),
        &owner_cookie,
        serde_json::json!({
            "media_type": "photo",
            "url": "https://example.com/main.jpg",
            "is_main": true,
            "sort_order": 0
        }),
    )
    .await;
    assert_eq!(add_media.status(), http::StatusCode::CREATED);

    let add_open_house = authed_json(
        http::Method::POST,
        &format!("/api/v1/listings/{listing_id}/open-houses"),
        &owner_cookie,
        serde_json::json!({
            "start_time": "2099-04-01T10:00:00Z",
            "end_time": "2099-04-01T12:00:00Z",
            "requires_registration": true,
            "instructions": "Ring the concierge"
        }),
    )
    .await;
    assert_eq!(add_open_house.status(), http::StatusCode::CREATED);

    let patch_listing = authed_json(
        http::Method::PATCH,
        &format!("/api/v1/listings/{listing_id}"),
        &owner_cookie,
        serde_json::json!({
            "price": 610000.0,
            "status": "active"
        }),
    )
    .await;
    assert_eq!(patch_listing.status(), http::StatusCode::OK);
    let patched_listing: serde_json::Value = json_body(patch_listing).await;
    assert_eq!(patched_listing["media"].as_array().unwrap().len(), 1);
    assert_eq!(patched_listing["open_houses"].as_array().unwrap().len(), 1);
    assert_eq!(patched_listing["price"], 610000.0);
    assert_eq!(patched_listing["status"], "active");

    let history_row =
        sqlx::query("SELECT COUNT(*) AS total FROM property_histories WHERE property_id = $1")
            .bind(property_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let history_total: i64 = history_row.try_get("total").unwrap();
    assert_eq!(history_total, 2);
}

#[tokio::test]
#[serial]
async fn seller_dashboard_surfaces_owner_agent_and_buyer_states() {
    let pool = test_pool().await;
    let (owner_id, owner_cookie) = create_user_with_cookie(
        &pool,
        "dashboard-owner@example.com",
        "secret-password",
        PlatformRole::User,
        BusinessRole::Owner,
    )
    .await;
    let (_agent_id, agent_cookie) = create_user_with_cookie(
        &pool,
        "dashboard-agent@example.com",
        "secret-password",
        PlatformRole::User,
        BusinessRole::Agent,
    )
    .await;
    let (_buyer_id, buyer_cookie) = create_user_with_cookie(
        &pool,
        "dashboard-buyer@example.com",
        "secret-password",
        PlatformRole::User,
        BusinessRole::Buyer,
    )
    .await;

    let create_agency = authed_json(
        http::Method::POST,
        "/api/v1/agencies",
        &agent_cookie,
        serde_json::json!({
            "company_name": "Aurora Estates",
            "nip": "1234567890",
            "address": "Warszawa, Prosta 10"
        }),
    )
    .await;
    assert_eq!(create_agency.status(), http::StatusCode::CREATED);

    let property_id = create_property_for_owner(
        &owner_cookie,
        owner_id,
        "Koszykowa",
        101,
        1001,
        52.2250,
        21.0050,
    )
    .await;
    let listing = create_sale_listing(&owner_cookie, property_id, 920000.0, Some("draft")).await;
    let listing_id = listing["id"].as_i64().unwrap();

    let add_media = authed_json(
        http::Method::POST,
        &format!("/api/v1/listings/{listing_id}/media"),
        &owner_cookie,
        serde_json::json!({
            "media_type": "photo",
            "url": "https://example.com/koszykowa-main.jpg",
            "is_main": true,
            "sort_order": 0
        }),
    )
    .await;
    assert_eq!(add_media.status(), http::StatusCode::CREATED);

    let add_open_house = authed_json(
        http::Method::POST,
        &format!("/api/v1/listings/{listing_id}/open-houses"),
        &owner_cookie,
        serde_json::json!({
            "start_time": "2099-05-01T11:00:00Z",
            "end_time": "2099-05-01T13:00:00Z",
            "requires_registration": false,
            "instructions": "Lobby desk"
        }),
    )
    .await;
    assert_eq!(add_open_house.status(), http::StatusCode::CREATED);

    let create_conversation = authed_json(
        http::Method::POST,
        "/api/v1/conversations",
        &buyer_cookie,
        serde_json::json!({
            "listing_id": listing_id,
            "participant_user_id": owner_id,
            "initial_message": "Czy oferta jest nadal aktualna?"
        }),
    )
    .await;
    assert_eq!(create_conversation.status(), http::StatusCode::CREATED);

    let owner_dashboard = authed_empty(
        http::Method::GET,
        "/api/v1/me/seller-dashboard",
        &owner_cookie,
    )
    .await;
    assert_eq!(owner_dashboard.status(), http::StatusCode::OK);
    let owner_payload: serde_json::Value = json_body(owner_dashboard).await;
    assert_eq!(owner_payload["profile"]["business_role"], "owner");
    assert_eq!(owner_payload["summary"]["draftCount"], 1);
    assert_eq!(owner_payload["summary"]["activeCount"], 0);
    assert_eq!(owner_payload["summary"]["conversationCount"], 1);
    assert_eq!(owner_payload["summary"]["upcomingOpenHouseCount"], 1);
    assert_eq!(owner_payload["recentListings"].as_array().unwrap().len(), 1);
    assert_eq!(
        owner_payload["recentConversations"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        owner_payload["upcomingOpenHouses"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(owner_payload["checklist"][3]["complete"], true);
    assert_eq!(owner_payload["checklist"][4]["complete"], true);
    assert_eq!(owner_payload["checklist"][5]["complete"], false);

    let agent_dashboard = authed_empty(
        http::Method::GET,
        "/api/v1/me/seller-dashboard",
        &agent_cookie,
    )
    .await;
    assert_eq!(agent_dashboard.status(), http::StatusCode::OK);
    let agent_payload: serde_json::Value = json_body(agent_dashboard).await;
    assert_eq!(agent_payload["profile"]["business_role"], "agent");
    assert_eq!(agent_payload["summary"]["draftCount"], 0);
    assert_eq!(agent_payload["checklist"][0]["complete"], true);
    assert_eq!(agent_payload["checklist"][2]["complete"], true);

    let buyer_dashboard = authed_empty(
        http::Method::GET,
        "/api/v1/me/seller-dashboard",
        &buyer_cookie,
    )
    .await;
    assert_eq!(buyer_dashboard.status(), http::StatusCode::OK);
    let buyer_payload: serde_json::Value = json_body(buyer_dashboard).await;
    assert_eq!(buyer_payload["profile"]["business_role"], "buyer");
    assert_eq!(buyer_payload["summary"]["draftCount"], 0);
    assert_eq!(buyer_payload["checklist"][0]["complete"], false);
    assert_eq!(buyer_payload["recentListings"].as_array().unwrap().len(), 0);
}

#[tokio::test]
#[serial]
async fn my_listings_filters_by_status_and_is_private() {
    let pool = test_pool().await;
    let (owner_one_id, owner_one_cookie) = create_user_with_cookie(
        &pool,
        "private-listings-one@example.com",
        "secret-password",
        PlatformRole::User,
        BusinessRole::Owner,
    )
    .await;
    let (owner_two_id, owner_two_cookie) = create_user_with_cookie(
        &pool,
        "private-listings-two@example.com",
        "secret-password",
        PlatformRole::User,
        BusinessRole::Owner,
    )
    .await;

    let owner_one_property = create_property_for_owner(
        &owner_one_cookie,
        owner_one_id,
        "Swietokrzyska",
        101,
        1001,
        52.2340,
        21.0090,
    )
    .await;
    let draft_listing = create_sale_listing(
        &owner_one_cookie,
        owner_one_property,
        510000.0,
        Some("draft"),
    )
    .await;
    let active_listing = create_sale_listing(
        &owner_one_cookie,
        owner_one_property,
        520000.0,
        Some("active"),
    )
    .await;

    let owner_two_property = create_property_for_owner(
        &owner_two_cookie,
        owner_two_id,
        "Dluga",
        102,
        1005,
        50.0647,
        19.9450,
    )
    .await;
    let _other_listing = create_sale_listing(
        &owner_two_cookie,
        owner_two_property,
        880000.0,
        Some("active"),
    )
    .await;

    let draft_response = authed_empty(
        http::Method::GET,
        "/api/v1/me/listings?status=draft",
        &owner_one_cookie,
    )
    .await;
    assert_eq!(draft_response.status(), http::StatusCode::OK);
    let draft_payload: serde_json::Value = json_body(draft_response).await;
    assert_eq!(draft_payload["total"], 1);
    assert_eq!(draft_payload["items"].as_array().unwrap().len(), 1);
    assert_eq!(draft_payload["items"][0]["id"], draft_listing["id"]);

    let all_response =
        authed_empty(http::Method::GET, "/api/v1/me/listings", &owner_one_cookie).await;
    assert_eq!(all_response.status(), http::StatusCode::OK);
    let all_payload: serde_json::Value = json_body(all_response).await;
    assert_eq!(all_payload["total"], 2);
    let ids = all_payload["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_i64().unwrap())
        .collect::<Vec<_>>();
    assert!(ids.contains(&draft_listing["id"].as_i64().unwrap()));
    assert!(ids.contains(&active_listing["id"].as_i64().unwrap()));
}

#[tokio::test]
#[serial]
async fn owner_agent_and_developer_can_manage_colored_wishlists() {
    let pool = test_pool().await;
    let (_, owner_cookie) = create_user_with_cookie(
        &pool,
        "wishlist-owner@example.com",
        "secret-password",
        PlatformRole::User,
        BusinessRole::Owner,
    )
    .await;
    let (_, agent_cookie) = create_user_with_cookie(
        &pool,
        "wishlist-agent@example.com",
        "secret-password",
        PlatformRole::User,
        BusinessRole::Agent,
    )
    .await;
    let (_, developer_cookie) = create_user_with_cookie(
        &pool,
        "wishlist-developer@example.com",
        "secret-password",
        PlatformRole::User,
        BusinessRole::Developer,
    )
    .await;

    let _agency = create_agency(&agent_cookie, "Wishlist Agency").await;

    for (cookie, name, color) in [
        (&owner_cookie, "Owner shortlist", "rose"),
        (&agent_cookie, "Agent shortlist", "teal"),
        (&developer_cookie, "Developer shortlist", "sky"),
    ] {
        let response = authed_json(
            http::Method::POST,
            "/api/v1/wishlists",
            cookie,
            serde_json::json!({
                "name": name,
                "color": color,
                "is_shared": false
            }),
        )
        .await;

        assert_eq!(response.status(), http::StatusCode::CREATED);
        let payload: serde_json::Value = json_body(response).await;
        assert_eq!(payload["name"], name);
        assert_eq!(payload["color"], color);
    }
}

#[tokio::test]
#[serial]
async fn wishlist_rejects_reserved_name_and_imports_guest_items() {
    let pool = test_pool().await;
    let (owner_id, owner_cookie) = create_user_with_cookie(
        &pool,
        "wishlist-import-owner@example.com",
        "secret-password",
        PlatformRole::User,
        BusinessRole::Owner,
    )
    .await;

    let property_id = create_property_for_owner(
        &owner_cookie,
        owner_id,
        "Marszalkowska",
        101,
        1001,
        52.2297,
        21.0122,
    )
    .await;
    let listing_one =
        create_sale_listing(&owner_cookie, property_id, 599000.0, Some("active")).await;
    let listing_two =
        create_sale_listing(&owner_cookie, property_id, 625000.0, Some("draft")).await;

    let create_reserved = authed_json(
        http::Method::POST,
        "/api/v1/wishlists",
        &owner_cookie,
        serde_json::json!({
            "name": "niezalogowany",
            "color": "amber",
            "is_shared": false
        }),
    )
    .await;
    assert_eq!(create_reserved.status(), http::StatusCode::BAD_REQUEST);

    let create_normal = authed_json(
        http::Method::POST,
        "/api/v1/wishlists",
        &owner_cookie,
        serde_json::json!({
            "name": "Moja lista",
            "color": "amber",
            "is_shared": false
        }),
    )
    .await;
    assert_eq!(create_normal.status(), http::StatusCode::CREATED);
    let normal_payload: serde_json::Value = json_body(create_normal).await;
    let wishlist_id = normal_payload["id"].as_i64().unwrap();

    let update_reserved = authed_json(
        http::Method::PATCH,
        &format!("/api/v1/wishlists/{wishlist_id}"),
        &owner_cookie,
        serde_json::json!({
            "name": "niezalogowany"
        }),
    )
    .await;
    assert_eq!(update_reserved.status(), http::StatusCode::BAD_REQUEST);

    let import_guest = authed_json(
        http::Method::POST,
        "/api/v1/wishlists/import-guest",
        &owner_cookie,
        serde_json::json!({
            "name": "niezalogowany",
            "color": "sand",
            "listing_ids": [
                listing_one["id"].as_i64().unwrap(),
                listing_one["id"].as_i64().unwrap(),
                listing_two["id"].as_i64().unwrap()
            ]
        }),
    )
    .await;
    assert_eq!(import_guest.status(), http::StatusCode::CREATED);
    let imported_payload: serde_json::Value = json_body(import_guest).await;
    assert_eq!(imported_payload["name"], "niezalogowany");
    assert_eq!(imported_payload["color"], "sand");
    assert_eq!(imported_payload["items"].as_array().unwrap().len(), 2);
    assert!(imported_payload["items"][0]["listing"]["title"].is_string());
    assert!(imported_payload["items"][0]["listing"]["thumbnail_url"].is_string());
}

#[tokio::test]
#[serial]
async fn public_listing_search_supports_city_and_radius_filters() {
    let pool = test_pool().await;
    let (owner_id, owner_cookie) = create_user_with_cookie(
        &pool,
        "search-owner@example.com",
        "secret-password",
        PlatformRole::User,
        BusinessRole::Owner,
    )
    .await;

    let property_response = authed_json(
        http::Method::POST,
        "/api/v1/properties",
        &owner_cookie,
        serde_json::json!({
            "location": {
                "city_id": 101,
                "district_id": 1002,
                "street": "Nowy Swiat",
                "postal_code": "00-002",
                "building_number": "20",
                "apartment_number": null,
                "latitude": 52.2318,
                "longitude": 21.0190
            },
            "category_id": 1,
            "area_sqm": 55.0,
            "plot_area_sqm": null,
            "rooms": 2,
            "floor": 2,
            "year_built": 2020,
            "heating_type": "district",
            "extra_attributes": { "condition": "new" },
            "amenity_ids": [1],
            "owners": [{ "user_id": owner_id, "ownership_share": 100.0 }]
        }),
    )
    .await;
    let property_json: serde_json::Value = json_body(property_response).await;
    let property_id = property_json["id"].as_i64().unwrap();

    let _listing = authed_json(
        http::Method::POST,
        "/api/v1/listings",
        &owner_cookie,
        serde_json::json!({
            "property_id": property_id,
            "transaction_type": "sale",
            "price": 430000.0
        }),
    )
    .await;

    let response = test_app()
        .await
        .oneshot(
            http::Request::builder()
                .method(http::Method::GET)
                .uri("/api/v1/listings?city_id=101&lat=52.2297&lng=21.0122&radius_meters=1500")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), http::StatusCode::OK);
    let payload: serde_json::Value = json_body(response).await;
    assert_eq!(payload["total"], 1);
    assert_eq!(payload["items"].as_array().unwrap().len(), 1);
}

#[tokio::test]
#[serial]
async fn geojson_listing_search_returns_point_features_for_bbox() {
    let pool = test_pool().await;
    let (owner_id, owner_cookie) = create_user_with_cookie(
        &pool,
        "geojson-owner@example.com",
        "secret-password",
        PlatformRole::User,
        BusinessRole::Owner,
    )
    .await;

    let property_response = authed_json(
        http::Method::POST,
        "/api/v1/properties",
        &owner_cookie,
        serde_json::json!({
            "location": {
                "city_id": 101,
                "district_id": 1002,
                "street": "Pulawska",
                "postal_code": "00-732",
                "building_number": "44",
                "apartment_number": "8",
                "latitude": 52.2104,
                "longitude": 21.0047
            },
            "category_id": 1,
            "area_sqm": 61.2,
            "plot_area_sqm": null,
            "rooms": 3,
            "floor": 5,
            "year_built": 2019,
            "heating_type": "district",
            "extra_attributes": { "parking": true },
            "amenity_ids": [1, 2],
            "owners": [{ "user_id": owner_id, "ownership_share": 100.0 }]
        }),
    )
    .await;
    assert_eq!(property_response.status(), http::StatusCode::CREATED);
    let property_json: serde_json::Value = json_body(property_response).await;
    let property_id = property_json["id"].as_i64().unwrap();

    let listing_response = authed_json(
        http::Method::POST,
        "/api/v1/listings",
        &owner_cookie,
        serde_json::json!({
            "property_id": property_id,
            "transaction_type": "sale",
            "price": 845000.0
        }),
    )
    .await;
    assert_eq!(listing_response.status(), http::StatusCode::CREATED);
    let listing_json: serde_json::Value = json_body(listing_response).await;
    let listing_id = listing_json["id"].as_i64().unwrap();

    let add_media = authed_json(
        http::Method::POST,
        &format!("/api/v1/listings/{listing_id}/media"),
        &owner_cookie,
        serde_json::json!({
            "media_type": "photo",
            "url": "https://example.com/listing-main.jpg",
            "is_main": true,
            "sort_order": 0
        }),
    )
    .await;
    assert_eq!(add_media.status(), http::StatusCode::CREATED);

    let response = test_app()
        .await
        .oneshot(
            http::Request::builder()
                .method(http::Method::GET)
                .uri("/api/v1/listings/geojson?bbox=20.9500,52.1500,21.0500,52.2600")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), http::StatusCode::OK);
    let payload: serde_json::Value = json_body(response).await;
    assert_eq!(payload["type"], "FeatureCollection");
    assert_eq!(payload["features"].as_array().unwrap().len(), 1);

    let feature = &payload["features"][0];
    assert_eq!(feature["type"], "Feature");
    assert_eq!(feature["geometry"]["type"], "Point");
    assert_eq!(feature["geometry"]["coordinates"][0], 21.0047);
    assert_eq!(feature["geometry"]["coordinates"][1], 52.2104);
    assert_eq!(feature["properties"]["id"], listing_id);
    assert_eq!(feature["properties"]["transactionType"], "sale");
    assert_eq!(
        feature["properties"]["thumbnailUrl"],
        "https://example.com/listing-main.jpg"
    );
    assert_eq!(feature["properties"]["title"], "Apartment in Warszawa");
}

#[tokio::test]
#[serial]
async fn geojson_listing_search_rejects_invalid_bbox() {
    let app = build_app(AppState {
        db: PgPoolOptions::new()
            .connect_lazy(&test_config().database_url)
            .unwrap(),
        config: test_config(),
    })
    .unwrap();

    let response = app
        .oneshot(
            http::Request::builder()
                .method(http::Method::GET)
                .uri("/api/v1/listings/geojson?bbox=190,52.1,21.2,53.4")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), http::StatusCode::BAD_REQUEST);
    let payload: serde_json::Value = json_body(response).await;
    assert_eq!(payload["error"]["code"], "invalid_bbox");
}

#[tokio::test]
#[serial]
async fn buyers_can_manage_wishlists_and_create_leads_via_conversations() {
    let pool = test_pool().await;
    let (seller_id, seller_cookie) = create_user_with_cookie(
        &pool,
        "seller@example.com",
        "secret-password",
        PlatformRole::User,
        BusinessRole::Owner,
    )
    .await;
    let (buyer_id, buyer_cookie) = create_user_with_cookie(
        &pool,
        "buyer@example.com",
        "secret-password",
        PlatformRole::User,
        BusinessRole::Buyer,
    )
    .await;

    let property_response = authed_json(
        http::Method::POST,
        "/api/v1/properties",
        &seller_cookie,
        serde_json::json!({
            "location": {
                "city_id": 102,
                "district_id": 1005,
                "street": "Florianska",
                "postal_code": "31-019",
                "building_number": "7",
                "apartment_number": "1",
                "latitude": 50.0647,
                "longitude": 19.9450
            },
            "category_id": 1,
            "area_sqm": 68.0,
            "plot_area_sqm": null,
            "rooms": 3,
            "floor": 1,
            "year_built": 2016,
            "heating_type": "gas",
            "extra_attributes": { "balcony": true },
            "amenity_ids": [2],
            "owners": [{ "user_id": seller_id, "ownership_share": 100.0 }]
        }),
    )
    .await;
    let property_json: serde_json::Value = json_body(property_response).await;
    let property_id = property_json["id"].as_i64().unwrap();

    let listing_response = authed_json(
        http::Method::POST,
        "/api/v1/listings",
        &seller_cookie,
        serde_json::json!({
            "property_id": property_id,
            "transaction_type": "sale",
            "price": 750000.0
        }),
    )
    .await;
    let listing_json: serde_json::Value = json_body(listing_response).await;
    let listing_id = listing_json["id"].as_i64().unwrap();

    let create_wishlist = authed_json(
        http::Method::POST,
        "/api/v1/wishlists",
        &buyer_cookie,
        serde_json::json!({
            "name": "Downtown picks",
            "is_shared": true
        }),
    )
    .await;
    assert_eq!(create_wishlist.status(), http::StatusCode::CREATED);
    let wishlist_json: serde_json::Value = json_body(create_wishlist).await;
    let wishlist_id = wishlist_json["id"].as_i64().unwrap();

    let add_item = authed_json(
        http::Method::POST,
        &format!("/api/v1/wishlists/{wishlist_id}/items"),
        &buyer_cookie,
        serde_json::json!({
            "listing_id": listing_id,
            "user_notes": "Great light and layout"
        }),
    )
    .await;
    assert_eq!(add_item.status(), http::StatusCode::CREATED);

    let create_conversation = authed_json(
        http::Method::POST,
        "/api/v1/conversations",
        &buyer_cookie,
        serde_json::json!({
            "listing_id": listing_id,
            "participant_user_id": seller_id,
            "initial_message": "Is this still available?"
        }),
    )
    .await;
    assert_eq!(create_conversation.status(), http::StatusCode::CREATED);
    let conversation_json: serde_json::Value = json_body(create_conversation).await;
    let conversation_id = conversation_json["id"].as_i64().unwrap();

    let messages_response = authed_empty(
        http::Method::GET,
        &format!("/api/v1/conversations/{conversation_id}/messages"),
        &buyer_cookie,
    )
    .await;
    assert_eq!(messages_response.status(), http::StatusCode::OK);
    let messages: serde_json::Value = json_body(messages_response).await;
    assert_eq!(messages.as_array().unwrap().len(), 1);

    let lead_row = sqlx::query(
        r#"
        SELECT COUNT(*) AS total
        FROM leads
        WHERE buyer_user_id = $1 AND listing_id = $2 AND seller_user_id = $3 AND source = 'message'
        "#,
    )
    .bind(buyer_id)
    .bind(listing_id)
    .bind(seller_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let lead_total: i64 = lead_row.try_get("total").unwrap();
    assert_eq!(lead_total, 1);
}

#[tokio::test]
#[serial]
async fn buyers_cannot_create_properties() {
    let pool = test_pool().await;
    let (buyer_id, buyer_cookie) = create_user_with_cookie(
        &pool,
        "blocked-buyer@example.com",
        "secret-password",
        PlatformRole::User,
        BusinessRole::Buyer,
    )
    .await;

    let response = authed_json(
        http::Method::POST,
        "/api/v1/properties",
        &buyer_cookie,
        serde_json::json!({
            "location": {
                "city_id": 101,
                "district_id": 1001,
                "street": "Testowa",
                "postal_code": "00-003",
                "building_number": "1",
                "apartment_number": null,
                "latitude": 52.2297,
                "longitude": 21.0122
            },
            "category_id": 1,
            "area_sqm": 44.0,
            "plot_area_sqm": null,
            "rooms": 2,
            "floor": 2,
            "year_built": 2019,
            "heating_type": "district",
            "extra_attributes": {},
            "amenity_ids": [],
            "owners": [{ "user_id": buyer_id, "ownership_share": 100.0 }]
        }),
    )
    .await;

    assert_eq!(response.status(), http::StatusCode::FORBIDDEN);
}
