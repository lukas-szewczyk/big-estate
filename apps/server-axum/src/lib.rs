pub mod app;
pub mod auth;
pub mod bootstrap;
pub mod config;
pub mod error;
pub mod models;
pub mod users;

pub use app::{build_app, create_state, AppState};
pub use config::Config;
pub use error::ApiError;

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");
