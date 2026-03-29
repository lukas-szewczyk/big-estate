use sqlx::PgPool;

use crate::{
    accounts::{create_user, find_user_by_email},
    config::Config,
    error::ApiError,
    models::{BusinessRole, PlatformRole},
};

pub async fn ensure_bootstrap_admin(pool: &PgPool, config: &Config) -> Result<(), ApiError> {
    let Some(email) = config.bootstrap_admin_email.as_deref() else {
        return Ok(());
    };
    let Some(password) = config.bootstrap_admin_password.as_deref() else {
        return Err(ApiError::internal(
            "bootstrap_admin_config_invalid",
            "Bootstrap admin password is missing",
        ));
    };

    if find_user_by_email(pool, email).await?.is_some() {
        tracing::info!(email = %email, "bootstrap admin already exists");
        return Ok(());
    }

    let user = create_user(
        pool,
        email,
        password,
        PlatformRole::Admin,
        BusinessRole::Buyer,
    )
    .await?;
    tracing::info!(email = %user.email, "bootstrap admin created");
    Ok(())
}
