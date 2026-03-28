use std::{env, error::Error, io};

use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let database_url = env::var("DATABASE_URL").map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "DATABASE_URL is required to start the sqlmodel_proxy service",
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

    let app = sqlmodel_proxy::create_proxy_app(&database_url).await?;
    let listener = TcpListener::bind(format!("{host}:{port}")).await?;

    axum::serve(listener, app).await?;
    Ok(())
}
