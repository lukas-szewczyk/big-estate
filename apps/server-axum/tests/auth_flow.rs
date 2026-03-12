use http_body_util::BodyExt;
use serial_test::serial;
use server_axum::{build_app, create_state, models::UserRole, users, Config, MIGRATOR};
use sqlx::PgPool;
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
    sqlx::query("TRUNCATE sessions, users RESTART IDENTITY CASCADE")
        .execute(&pool)
        .await
        .unwrap();
    pool
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

async fn login_cookie(email: &str, password: &str) -> String {
    let state = create_state(test_config()).await.unwrap();
    let app = build_app(state).unwrap();
    let response = app
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

async fn authenticated_cookie(pool: &PgPool, role: UserRole) -> String {
    let email = format!("{}@example.com", role.as_str());
    let password = "secret-password";
    let user = users::create_user(pool, &email, password, role)
        .await
        .unwrap();
    login_cookie(&user.email, password).await
}

#[tokio::test]
#[serial]
async fn login_success_sets_cookie_and_me_returns_user() {
    let pool = test_pool().await;
    users::create_user(
        &pool,
        "admin@example.com",
        "secret-password",
        UserRole::Admin,
    )
    .await
    .unwrap();

    let state = create_state(test_config()).await.unwrap();
    let app = build_app(state).unwrap();
    let login_response = app
        .clone()
        .oneshot(
            http::Request::builder()
                .method(http::Method::POST)
                .uri("/auth/login")
                .header(http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    serde_json::json!({"email": "admin@example.com", "password": "secret-password"})
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(login_response.status(), http::StatusCode::NO_CONTENT);
    let cookie = cookie_value(&login_response);

    let me_response = app
        .oneshot(
            http::Request::builder()
                .method(http::Method::GET)
                .uri("/auth/me")
                .header(http::header::COOKIE, cookie)
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(me_response.status(), http::StatusCode::OK);
    let user: serde_json::Value = json_body(me_response).await;
    assert_eq!(user["email"], "admin@example.com");
    assert_eq!(user["role"], "admin");
}

#[tokio::test]
#[serial]
async fn login_failure_returns_unauthorized() {
    let pool = test_pool().await;
    users::create_user(
        &pool,
        "admin@example.com",
        "secret-password",
        UserRole::Admin,
    )
    .await
    .unwrap();

    let state = create_state(test_config()).await.unwrap();
    let app = build_app(state).unwrap();
    let response = app
        .oneshot(
            http::Request::builder()
                .method(http::Method::POST)
                .uri("/auth/login")
                .header(http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    serde_json::json!({"email": "admin@example.com", "password": "wrong"})
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), http::StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[serial]
async fn logout_revokes_session_and_clears_cookie() {
    let pool = test_pool().await;
    let cookie = authenticated_cookie(&pool, UserRole::Admin).await;

    let state = create_state(test_config()).await.unwrap();
    let app = build_app(state).unwrap();
    let logout_response = app
        .clone()
        .oneshot(
            http::Request::builder()
                .method(http::Method::POST)
                .uri("/auth/logout")
                .header(http::header::COOKIE, &cookie)
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(logout_response.status(), http::StatusCode::NO_CONTENT);
    assert!(logout_response
        .headers()
        .get(http::header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("Max-Age=0"));

    let me_response = app
        .oneshot(
            http::Request::builder()
                .method(http::Method::GET)
                .uri("/auth/me")
                .header(http::header::COOKIE, cookie)
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(me_response.status(), http::StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[serial]
async fn admin_can_create_user_and_duplicate_email_conflicts() {
    let pool = test_pool().await;
    let cookie = authenticated_cookie(&pool, UserRole::Admin).await;

    let state = create_state(test_config()).await.unwrap();
    let app = build_app(state).unwrap();

    let create_response = app
        .clone()
        .oneshot(
            http::Request::builder()
                .method(http::Method::POST)
                .uri("/users")
                .header(http::header::COOKIE, &cookie)
                .header(http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    serde_json::json!({"email": "new@example.com", "password": "pw", "role": "user"})
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_response.status(), http::StatusCode::CREATED);

    let duplicate_response = app
        .oneshot(
            http::Request::builder()
                .method(http::Method::POST)
                .uri("/users")
                .header(http::header::COOKIE, cookie)
                .header(http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    serde_json::json!({"email": "new@example.com", "password": "pw", "role": "user"})
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(duplicate_response.status(), http::StatusCode::CONFLICT);
}

#[tokio::test]
#[serial]
async fn non_admin_cannot_access_user_crud() {
    let pool = test_pool().await;
    let cookie = authenticated_cookie(&pool, UserRole::User).await;

    let state = create_state(test_config()).await.unwrap();
    let app = build_app(state).unwrap();

    for request in [
        http::Request::builder()
            .method(http::Method::GET)
            .uri("/users")
            .header(http::header::COOKIE, &cookie)
            .body(axum::body::Body::empty())
            .unwrap(),
        http::Request::builder()
            .method(http::Method::POST)
            .uri("/users")
            .header(http::header::COOKIE, &cookie)
            .header(http::header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(
                serde_json::json!({"email": "new@example.com", "password": "pw", "role": "user"})
                    .to_string(),
            ))
            .unwrap(),
        http::Request::builder()
            .method(http::Method::DELETE)
            .uri("/users/1")
            .header(http::header::COOKIE, &cookie)
            .body(axum::body::Body::empty())
            .unwrap(),
    ] {
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), http::StatusCode::FORBIDDEN);
    }
}

#[tokio::test]
#[serial]
async fn admin_can_list_filter_and_fetch_users() {
    let pool = test_pool().await;
    let cookie = authenticated_cookie(&pool, UserRole::Admin).await;
    let user = users::create_user(&pool, "search@example.com", "pw", UserRole::User)
        .await
        .unwrap();
    users::create_user(&pool, "other@example.com", "pw", UserRole::User)
        .await
        .unwrap();

    let state = create_state(test_config()).await.unwrap();
    let app = build_app(state).unwrap();

    let list_response = app
        .clone()
        .oneshot(
            http::Request::builder()
                .method(http::Method::GET)
                .uri("/users?email=search@example.com")
                .header(http::header::COOKIE, &cookie)
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list_response.status(), http::StatusCode::OK);
    let list_json: serde_json::Value = json_body(list_response).await;
    assert_eq!(list_json["items"].as_array().unwrap().len(), 1);
    assert_eq!(list_json["items"][0]["email"], "search@example.com");

    let get_response = app
        .oneshot(
            http::Request::builder()
                .method(http::Method::GET)
                .uri(format!("/users/{}", user.id))
                .header(http::header::COOKIE, cookie)
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(get_response.status(), http::StatusCode::OK);
}

#[tokio::test]
#[serial]
async fn delete_user_cascades_sessions_and_prevents_self_delete() {
    let pool = test_pool().await;
    let admin_cookie = authenticated_cookie(&pool, UserRole::Admin).await;
    let target_password = "delete-me-password";
    let target = users::create_user(
        &pool,
        "delete-me@example.com",
        target_password,
        UserRole::User,
    )
    .await
    .unwrap();
    let target_cookie = login_cookie(&target.email, target_password).await;

    let state = create_state(test_config()).await.unwrap();
    let app = build_app(state).unwrap();

    let delete_response = app
        .clone()
        .oneshot(
            http::Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/users/{}", target.id))
                .header(http::header::COOKIE, &admin_cookie)
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(delete_response.status(), http::StatusCode::NO_CONTENT);

    let me_response = app
        .clone()
        .oneshot(
            http::Request::builder()
                .method(http::Method::GET)
                .uri("/auth/me")
                .header(http::header::COOKIE, target_cookie)
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(me_response.status(), http::StatusCode::UNAUTHORIZED);

    let admin_me = app
        .clone()
        .oneshot(
            http::Request::builder()
                .method(http::Method::GET)
                .uri("/auth/me")
                .header(http::header::COOKIE, &admin_cookie)
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let admin_json: serde_json::Value = json_body(admin_me).await;
    let self_delete = app
        .oneshot(
            http::Request::builder()
                .method(http::Method::DELETE)
                .uri(format!("/users/{}", admin_json["id"].as_i64().unwrap()))
                .header(http::header::COOKIE, admin_cookie)
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(self_delete.status(), http::StatusCode::CONFLICT);
}
