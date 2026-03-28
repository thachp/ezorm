use std::{env, error::Error, io};

use ezorm_orm_runtime::RelationalPoolOptions;
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let database_url = env::var("DATABASE_URL").map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "DATABASE_URL is required to start the ezorm_proxy service",
        )
    })?;
    let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port = match env::var("PORT") {
        Ok(value) => value
            .parse::<u16>()
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))?,
        Err(env::VarError::NotPresent) => 3000,
        Err(error) => {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, error.to_string()).into())
        }
    };
    let pool_options = RelationalPoolOptions {
        min_connections: parse_env_u32("EZORM_POOL_MIN_CONNECTIONS")?,
        max_connections: parse_env_u32("EZORM_POOL_MAX_CONNECTIONS")?,
        acquire_timeout_ms: parse_env_u64("EZORM_POOL_ACQUIRE_TIMEOUT_MS")?,
        idle_timeout_ms: parse_env_u64("EZORM_POOL_IDLE_TIMEOUT_MS")?,
    };

    let app = ezorm_proxy::create_proxy_app(&database_url, Some(pool_options)).await?;
    let listener = TcpListener::bind(format!("{host}:{port}")).await?;

    axum::serve(listener, app).await?;
    Ok(())
}

fn parse_env_u32(name: &str) -> Result<Option<u32>, io::Error> {
    match env::var(name) {
        Ok(value) => value
            .parse::<u32>()
            .map(Some)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string())),
        Err(env::VarError::NotPresent) => Ok(None),
        Err(error) => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            error.to_string(),
        )),
    }
}

fn parse_env_u64(name: &str) -> Result<Option<u64>, io::Error> {
    match env::var(name) {
        Ok(value) => value
            .parse::<u64>()
            .map(Some)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string())),
        Err(env::VarError::NotPresent) => Ok(None),
        Err(error) => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            error.to_string(),
        )),
    }
}
