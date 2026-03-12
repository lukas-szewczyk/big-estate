use std::{env, net::SocketAddr};

#[derive(Clone, Debug)]
pub struct Config {
    pub app_host: String,
    pub app_port: u16,
    pub database_url: String,
    pub frontend_origin: String,
    pub auth_cookie_name: String,
    pub auth_cookie_domain: Option<String>,
    pub auth_cookie_secure: bool,
    pub session_ttl_days: i64,
    pub bootstrap_admin_email: Option<String>,
    pub bootstrap_admin_password: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let app_host = env::var("APP_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
        let app_port = env::var("APP_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(3000);
        let database_url = required_var("DATABASE_URL")?;
        let frontend_origin =
            env::var("FRONTEND_ORIGIN").unwrap_or_else(|_| "http://localhost:4321".to_string());
        let auth_cookie_domain = env::var("AUTH_COOKIE_DOMAIN")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let auth_cookie_secure = env_bool("AUTH_COOKIE_SECURE", false);
        let bootstrap_admin_email = env::var("BOOTSTRAP_ADMIN_EMAIL")
            .ok()
            .map(normalize_email)
            .filter(|value| !value.is_empty());
        let bootstrap_admin_password = env::var("BOOTSTRAP_ADMIN_PASSWORD")
            .ok()
            .filter(|value| !value.trim().is_empty());

        if bootstrap_admin_email.is_some() ^ bootstrap_admin_password.is_some() {
            return Err(
                "BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be set together"
                    .to_string(),
            );
        }

        Ok(Self {
            app_host,
            app_port,
            database_url,
            frontend_origin,
            auth_cookie_name: "auth_session".to_string(),
            auth_cookie_domain,
            auth_cookie_secure,
            session_ttl_days: 30,
            bootstrap_admin_email,
            bootstrap_admin_password,
        })
    }

    pub fn socket_addr(&self) -> Result<SocketAddr, String> {
        format!("{}:{}", self.app_host, self.app_port)
            .parse::<SocketAddr>()
            .map_err(|error| format!("invalid APP_HOST/APP_PORT combination: {error}"))
    }
}

fn required_var(name: &str) -> Result<String, String> {
    env::var(name).map_err(|_| format!("missing required environment variable {name}"))
}

fn env_bool(name: &str, default: bool) -> bool {
    env::var(name)
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(default)
}

pub fn normalize_email(value: String) -> String {
    value.trim().to_ascii_lowercase()
}
