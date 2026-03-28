use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use ezorm_dialects::{framework_schema, SqlDialect};
use sqlx::{
    mysql::{MySqlPoolOptions, MySqlRow},
    postgres::{PgPoolOptions, PgRow},
    sqlite::{SqlitePoolOptions, SqliteRow},
    MySqlPool, PgPool, Row, SqlitePool,
};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SnapshotRecord {
    pub stream_id: String,
    pub version: u64,
    pub schema_version: u32,
    pub state: serde_json::Value,
}

#[derive(Debug, Error)]
pub enum SnapshotStoreError {
    #[error("unsupported database url `{0}`")]
    UnsupportedDatabaseUrl(String),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Serde(#[from] serde_json::Error),
}

#[derive(Debug, Default, Clone)]
pub struct InMemorySnapshotStore {
    inner: Arc<Mutex<HashMap<String, SnapshotRecord>>>,
}

#[derive(Debug, Clone)]
pub struct SqlSnapshotStore {
    pool: SnapshotPool,
    dialect: SqlDialect,
}

#[derive(Debug, Clone)]
enum SnapshotPool {
    Sqlite(SqlitePool),
    Postgres(PgPool),
    Mysql(MySqlPool),
}

impl InMemorySnapshotStore {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn save(&self, snapshot: SnapshotRecord) {
        let mut inner = self.inner.lock().expect("snapshot store lock poisoned");
        let current = inner.get(&snapshot.stream_id);
        if current.map_or(true, |record| snapshot.version >= record.version) {
            inner.insert(snapshot.stream_id.clone(), snapshot);
        }
    }

    pub fn load(&self, stream_id: &str) -> Option<SnapshotRecord> {
        self.inner
            .lock()
            .expect("snapshot store lock poisoned")
            .get(stream_id)
            .cloned()
    }
}

impl SqlSnapshotStore {
    pub async fn connect(database_url: &str) -> Result<Self, SnapshotStoreError> {
        let dialect = dialect_from_url(database_url)?;
        let pool = match dialect {
            SqlDialect::Sqlite => SnapshotPool::Sqlite(
                SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect(database_url)
                    .await?,
            ),
            SqlDialect::Postgres => SnapshotPool::Postgres(
                PgPoolOptions::new()
                    .max_connections(5)
                    .connect(database_url)
                    .await?,
            ),
            SqlDialect::Mysql => SnapshotPool::Mysql(
                MySqlPoolOptions::new()
                    .max_connections(5)
                    .connect(database_url)
                    .await?,
            ),
        };

        Ok(Self { pool, dialect })
    }

    pub async fn bootstrap(&self) -> Result<(), SnapshotStoreError> {
        match &self.pool {
            SnapshotPool::Sqlite(pool) => {
                for statement in framework_schema(self.dialect) {
                    sqlx::query(statement.as_str()).execute(pool).await?;
                }
                Ok(())
            }
            SnapshotPool::Postgres(pool) => {
                for statement in framework_schema(self.dialect) {
                    sqlx::query(statement.as_str()).execute(pool).await?;
                }
                Ok(())
            }
            SnapshotPool::Mysql(pool) => {
                for statement in framework_schema(self.dialect) {
                    sqlx::query(statement.as_str()).execute(pool).await?;
                }
                Ok(())
            }
        }
    }

    pub async fn save(&self, snapshot: &SnapshotRecord) -> Result<(), SnapshotStoreError> {
        let state = serde_json::to_string(&snapshot.state)?;

        match &self.pool {
            SnapshotPool::Sqlite(pool) => {
                sqlx::query(
                    "INSERT INTO snapshots (stream_id, version, schema_version, state) VALUES (?, ?, ?, ?) ON CONFLICT(stream_id) DO UPDATE SET version = excluded.version, schema_version = excluded.schema_version, state = excluded.state WHERE excluded.version >= snapshots.version",
                )
                .bind(&snapshot.stream_id)
                .bind(snapshot.version as i64)
                .bind(snapshot.schema_version as i64)
                .bind(state)
                .execute(pool)
                .await?;
            }
            SnapshotPool::Postgres(pool) => {
                sqlx::query(
                    "INSERT INTO snapshots (stream_id, version, schema_version, state) VALUES ($1, $2, $3, $4) ON CONFLICT(stream_id) DO UPDATE SET version = EXCLUDED.version, schema_version = EXCLUDED.schema_version, state = EXCLUDED.state WHERE EXCLUDED.version >= snapshots.version",
                )
                .bind(&snapshot.stream_id)
                .bind(snapshot.version as i64)
                .bind(snapshot.schema_version as i32)
                .bind(state)
                .execute(pool)
                .await?;
            }
            SnapshotPool::Mysql(pool) => {
                let current = self.load(&snapshot.stream_id).await?;
                if current
                    .as_ref()
                    .map_or(true, |record| snapshot.version >= record.version)
                {
                    sqlx::query(
                        "INSERT INTO snapshots (stream_id, version, schema_version, state) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE version = VALUES(version), schema_version = VALUES(schema_version), state = VALUES(state)",
                    )
                    .bind(&snapshot.stream_id)
                    .bind(snapshot.version as i64)
                    .bind(snapshot.schema_version as i32)
                    .bind(state)
                    .execute(pool)
                    .await?;
                }
            }
        }

        Ok(())
    }

    pub async fn load(
        &self,
        stream_id: &str,
    ) -> Result<Option<SnapshotRecord>, SnapshotStoreError> {
        match &self.pool {
            SnapshotPool::Sqlite(pool) => {
                let row = sqlx::query(
                    "SELECT stream_id, version, schema_version, state FROM snapshots WHERE stream_id = ?",
                )
                .bind(stream_id)
                .fetch_optional(pool)
                .await?;
                row.map(row_to_snapshot_sqlite).transpose()
            }
            SnapshotPool::Postgres(pool) => {
                let row = sqlx::query(
                    "SELECT stream_id, version, schema_version, state FROM snapshots WHERE stream_id = $1",
                )
                .bind(stream_id)
                .fetch_optional(pool)
                .await?;
                row.map(row_to_snapshot_postgres).transpose()
            }
            SnapshotPool::Mysql(pool) => {
                let row = sqlx::query(
                    "SELECT stream_id, version, schema_version, state FROM snapshots WHERE stream_id = ?",
                )
                .bind(stream_id)
                .fetch_optional(pool)
                .await?;
                row.map(row_to_snapshot_mysql).transpose()
            }
        }
    }
}

fn row_to_snapshot_sqlite(row: SqliteRow) -> Result<SnapshotRecord, SnapshotStoreError> {
    let state: String = row.try_get("state")?;
    Ok(SnapshotRecord {
        stream_id: row.try_get("stream_id")?,
        version: row.try_get::<i64, _>("version")? as u64,
        schema_version: row.try_get::<i64, _>("schema_version")? as u32,
        state: serde_json::from_str(&state)?,
    })
}

fn row_to_snapshot_postgres(row: PgRow) -> Result<SnapshotRecord, SnapshotStoreError> {
    let state: String = row.try_get("state")?;
    Ok(SnapshotRecord {
        stream_id: row.try_get("stream_id")?,
        version: row.try_get::<i64, _>("version")? as u64,
        schema_version: row.try_get::<i32, _>("schema_version")? as u32,
        state: serde_json::from_str(&state)?,
    })
}

fn row_to_snapshot_mysql(row: MySqlRow) -> Result<SnapshotRecord, SnapshotStoreError> {
    let state: String = row.try_get("state")?;
    Ok(SnapshotRecord {
        stream_id: row.try_get("stream_id")?,
        version: row.try_get::<i64, _>("version")? as u64,
        schema_version: row.try_get::<i32, _>("schema_version")? as u32,
        state: serde_json::from_str(&state)?,
    })
}

fn dialect_from_url(database_url: &str) -> Result<SqlDialect, SnapshotStoreError> {
    if database_url.starts_with("sqlite:") || database_url.starts_with("file:") {
        Ok(SqlDialect::Sqlite)
    } else if database_url.starts_with("postgres://") || database_url.starts_with("postgresql://") {
        Ok(SqlDialect::Postgres)
    } else if database_url.starts_with("mysql://") {
        Ok(SqlDialect::Mysql)
    } else {
        Err(SnapshotStoreError::UnsupportedDatabaseUrl(
            database_url.to_owned(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_latest_snapshot_per_stream() {
        let store = InMemorySnapshotStore::new();
        store.save(SnapshotRecord {
            stream_id: "account-1".into(),
            version: 3,
            schema_version: 1,
            state: json!({ "balance": 30 }),
        });
        store.save(SnapshotRecord {
            stream_id: "account-1".into(),
            version: 2,
            schema_version: 1,
            state: json!({ "balance": 20 }),
        });

        assert_eq!(store.load("account-1").unwrap().version, 3);
    }

    #[tokio::test]
    async fn persists_latest_snapshot_in_sqlite() {
        let store = SqlSnapshotStore::connect("sqlite::memory:").await.unwrap();
        store.bootstrap().await.unwrap();

        store
            .save(&SnapshotRecord {
                stream_id: "account-1".into(),
                version: 1,
                schema_version: 1,
                state: json!({ "balance": 10 }),
            })
            .await
            .unwrap();
        store
            .save(&SnapshotRecord {
                stream_id: "account-1".into(),
                version: 2,
                schema_version: 1,
                state: json!({ "balance": 20 }),
            })
            .await
            .unwrap();

        let snapshot = store.load("account-1").await.unwrap().unwrap();
        assert_eq!(snapshot.version, 2);
        assert_eq!(snapshot.state, json!({ "balance": 20 }));
    }
}
