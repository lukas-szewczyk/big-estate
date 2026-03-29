use std::io;

use server_axum::{bootstrap, build_app, create_state, seed_reference_data, Config, MIGRATOR};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Clone, Copy, Debug)]
enum Command {
    Serve,
    Migrate,
    BootstrapAdmin,
    SeedReferenceData,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    dotenvy::dotenv().ok();
    init_tracing();

    let command = parse_command()?;
    let config = Config::from_env().map_err(io::Error::other)?;
    let state = create_state(config.clone())
        .await
        .map_err(io::Error::other)?;

    match command {
        Command::Serve => {
            MIGRATOR.run(&state.db).await?;
            bootstrap::ensure_bootstrap_admin(&state.db, &config)
                .await
                .map_err(io::Error::other)?;

            let address = config.socket_addr().map_err(io::Error::other)?;
            let app = build_app(state).map_err(io::Error::other)?;
            let listener = tokio::net::TcpListener::bind(address).await?;

            tracing::info!(address = %address, "server-axum listening");
            axum::serve(listener, app).await?;
        }
        Command::Migrate => {
            MIGRATOR.run(&state.db).await?;
            tracing::info!("database migrations completed");
        }
        Command::BootstrapAdmin => {
            MIGRATOR.run(&state.db).await?;
            bootstrap::ensure_bootstrap_admin(&state.db, &config)
                .await
                .map_err(io::Error::other)?;
            tracing::info!("bootstrap admin command completed");
        }
        Command::SeedReferenceData => {
            MIGRATOR.run(&state.db).await?;
            seed_reference_data(&state.db)
                .await
                .map_err(io::Error::other)?;
            tracing::info!("reference data seeding completed");
        }
    }

    Ok(())
}

fn parse_command() -> Result<Command, io::Error> {
    match std::env::args().nth(1).as_deref() {
        None | Some("serve") => Ok(Command::Serve),
        Some("migrate") => Ok(Command::Migrate),
        Some("bootstrap-admin") => Ok(Command::BootstrapAdmin),
        Some("seed-reference-data") => Ok(Command::SeedReferenceData),
        Some(other) => Err(io::Error::other(format!(
            "unknown command {other}; expected serve, migrate, bootstrap-admin, or seed-reference-data"
        ))),
    }
}

fn init_tracing() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
}
