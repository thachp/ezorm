use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use sqlmodel_dialects::{framework_schema, SqlDialect};
use sqlx::{
    mysql::{MySqlPoolOptions, MySqlRow},
    postgres::{PgPoolOptions, PgRow},
    sqlite::{SqlitePoolOptions, SqliteRow},
    MySqlPool, PgPool, Row, SqlitePool,
};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NewEvent {
    pub event_type: String,
    pub payload: serde_json::Value,
    pub schema_version: u32,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventRecord {
    pub stream_id: String,
    pub version: u64,
    pub sequence: u64,
    pub event_type: String,
    pub payload: serde_json::Value,
    pub schema_version: u32,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Error)]
pub enum EventStoreError {
    #[error("version conflict for stream `{stream_id}`: expected {expected_version}, actual {actual_version}")]
    VersionConflict {
        stream_id: String,
        expected_version: u64,
        actual_version: u64,
    },
    #[error("unsupported database url `{0}`")]
    UnsupportedDatabaseUrl(String),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Serde(#[from] serde_json::Error),
}

pub trait EventReader {
    fn load_stream(&self, stream_id: &str) -> Vec<EventRecord>;
    fn load_all_after(&self, sequence: u64) -> Vec<EventRecord>;
    fn latest_version(&self, stream_id: &str) -> u64;
}

#[derive(Debug, Clone)]
pub struct SqlEventStore {
    pool: RelationalPool,
    dialect: SqlDialect,
}

#[derive(Debug, Clone)]
enum RelationalPool {
    Sqlite(SqlitePool),
    Postgres(PgPool),
    Mysql(MySqlPool),
}

impl SqlEventStore {
    pub async fn connect(database_url: &str) -> Result<Self, EventStoreError> {
        let dialect = dialect_from_url(database_url)?;
        let pool = match dialect {
            SqlDialect::Sqlite => RelationalPool::Sqlite(
                SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect(database_url)
                    .await?,
            ),
            SqlDialect::Postgres => RelationalPool::Postgres(
                PgPoolOptions::new()
                    .max_connections(5)
                    .connect(database_url)
                    .await?,
            ),
            SqlDialect::Mysql => RelationalPool::Mysql(
                MySqlPoolOptions::new()
                    .max_connections(5)
                    .connect(database_url)
                    .await?,
            ),
        };

        Ok(Self { pool, dialect })
    }

    pub fn dialect(&self) -> SqlDialect {
        self.dialect
    }

    pub async fn bootstrap(&self) -> Result<(), EventStoreError> {
        match &self.pool {
            RelationalPool::Sqlite(pool) => {
                for statement in framework_schema(self.dialect) {
                    sqlx::query(statement.as_str()).execute(pool).await?;
                }
                Ok(())
            }
            RelationalPool::Postgres(pool) => {
                for statement in framework_schema(self.dialect) {
                    sqlx::query(statement.as_str()).execute(pool).await?;
                }
                Ok(())
            }
            RelationalPool::Mysql(pool) => {
                for statement in framework_schema(self.dialect) {
                    sqlx::query(statement.as_str()).execute(pool).await?;
                }
                Ok(())
            }
        }
    }

    pub async fn load_stream(&self, stream_id: &str) -> Result<Vec<EventRecord>, EventStoreError> {
        match &self.pool {
            RelationalPool::Sqlite(pool) => {
                let rows = sqlx::query(
                    "SELECT stream_id, version, sequence, event_type, payload, schema_version, metadata FROM event_store WHERE stream_id = ? ORDER BY version ASC",
                )
                .bind(stream_id)
                .fetch_all(pool)
                .await?;
                rows.into_iter().map(row_to_event_sqlite).collect()
            }
            RelationalPool::Postgres(pool) => {
                let rows = sqlx::query(
                    "SELECT stream_id, version, sequence, event_type, payload, schema_version, metadata FROM event_store WHERE stream_id = $1 ORDER BY version ASC",
                )
                .bind(stream_id)
                .fetch_all(pool)
                .await?;
                rows.into_iter().map(row_to_event_postgres).collect()
            }
            RelationalPool::Mysql(pool) => {
                let rows = sqlx::query(
                    "SELECT stream_id, version, sequence, event_type, payload, schema_version, metadata FROM event_store WHERE stream_id = ? ORDER BY version ASC",
                )
                .bind(stream_id)
                .fetch_all(pool)
                .await?;
                rows.into_iter().map(row_to_event_mysql).collect()
            }
        }
    }

    pub async fn load_all_after(&self, sequence: u64) -> Result<Vec<EventRecord>, EventStoreError> {
        match &self.pool {
            RelationalPool::Sqlite(pool) => {
                let rows = sqlx::query(
                    "SELECT stream_id, version, sequence, event_type, payload, schema_version, metadata FROM event_store WHERE sequence > ? ORDER BY sequence ASC",
                )
                .bind(sequence as i64)
                .fetch_all(pool)
                .await?;
                rows.into_iter().map(row_to_event_sqlite).collect()
            }
            RelationalPool::Postgres(pool) => {
                let rows = sqlx::query(
                    "SELECT stream_id, version, sequence, event_type, payload, schema_version, metadata FROM event_store WHERE sequence > $1 ORDER BY sequence ASC",
                )
                .bind(sequence as i64)
                .fetch_all(pool)
                .await?;
                rows.into_iter().map(row_to_event_postgres).collect()
            }
            RelationalPool::Mysql(pool) => {
                let rows = sqlx::query(
                    "SELECT stream_id, version, sequence, event_type, payload, schema_version, metadata FROM event_store WHERE sequence > ? ORDER BY sequence ASC",
                )
                .bind(sequence as i64)
                .fetch_all(pool)
                .await?;
                rows.into_iter().map(row_to_event_mysql).collect()
            }
        }
    }

    pub async fn latest_version(&self, stream_id: &str) -> Result<u64, EventStoreError> {
        let version = match &self.pool {
            RelationalPool::Sqlite(pool) => {
                sqlx::query_scalar::<_, i64>(
                    "SELECT COALESCE(MAX(version), 0) FROM event_store WHERE stream_id = ?",
                )
                .bind(stream_id)
                .fetch_one(pool)
                .await?
            }
            RelationalPool::Postgres(pool) => {
                sqlx::query_scalar::<_, i64>(
                    "SELECT COALESCE(MAX(version), 0) FROM event_store WHERE stream_id = $1",
                )
                .bind(stream_id)
                .fetch_one(pool)
                .await?
            }
            RelationalPool::Mysql(pool) => {
                sqlx::query_scalar::<_, i64>(
                    "SELECT COALESCE(MAX(version), 0) FROM event_store WHERE stream_id = ?",
                )
                .bind(stream_id)
                .fetch_one(pool)
                .await?
            }
        };

        Ok(version as u64)
    }

    pub async fn append(
        &self,
        stream_id: &str,
        expected_version: u64,
        events: Vec<NewEvent>,
    ) -> Result<Vec<EventRecord>, EventStoreError> {
        match &self.pool {
            RelationalPool::Sqlite(pool) => {
                append_with_sqlite(pool, stream_id, expected_version, &events).await?
            }
            RelationalPool::Postgres(pool) => {
                append_with_postgres(pool, stream_id, expected_version, &events).await?
            }
            RelationalPool::Mysql(pool) => {
                append_with_mysql(pool, stream_id, expected_version, &events).await?
            }
        }
        self.load_stream(stream_id).await
    }
}

#[derive(Debug, Default, Clone)]
pub struct InMemoryEventStore {
    inner: Arc<Mutex<InnerStore>>,
}

#[derive(Debug, Default)]
struct InnerStore {
    streams: HashMap<String, Vec<EventRecord>>,
    sequence: u64,
}

impl InMemoryEventStore {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn append(
        &self,
        stream_id: &str,
        expected_version: u64,
        events: Vec<NewEvent>,
    ) -> Result<Vec<EventRecord>, EventStoreError> {
        let mut inner = self.inner.lock().expect("event store lock poisoned");
        let current_version = inner
            .streams
            .get(stream_id)
            .and_then(|records| records.last())
            .map_or(0, |record| record.version);

        if current_version != expected_version {
            return Err(EventStoreError::VersionConflict {
                stream_id: stream_id.to_owned(),
                expected_version,
                actual_version: current_version,
            });
        }

        let stored_events = events
            .into_iter()
            .enumerate()
            .map(|(offset, event)| {
                inner.sequence += 1;
                EventRecord {
                    stream_id: stream_id.to_owned(),
                    version: expected_version + offset as u64 + 1,
                    sequence: inner.sequence,
                    event_type: event.event_type,
                    payload: event.payload,
                    schema_version: event.schema_version,
                    metadata: event.metadata,
                }
            })
            .collect::<Vec<_>>();

        inner
            .streams
            .entry(stream_id.to_owned())
            .or_default()
            .extend(stored_events.clone());

        Ok(stored_events)
    }
}

impl EventReader for InMemoryEventStore {
    fn load_stream(&self, stream_id: &str) -> Vec<EventRecord> {
        self.inner
            .lock()
            .expect("event store lock poisoned")
            .streams
            .get(stream_id)
            .cloned()
            .unwrap_or_default()
    }

    fn load_all_after(&self, sequence: u64) -> Vec<EventRecord> {
        self.inner
            .lock()
            .expect("event store lock poisoned")
            .streams
            .values()
            .flat_map(|events| events.iter().cloned())
            .filter(|event| event.sequence > sequence)
            .collect()
    }

    fn latest_version(&self, stream_id: &str) -> u64 {
        self.load_stream(stream_id)
            .last()
            .map_or(0, |event| event.version)
    }
}

async fn append_with_sqlite(
    pool: &SqlitePool,
    stream_id: &str,
    expected_version: u64,
    events: &[NewEvent],
) -> Result<(), EventStoreError> {
    let mut tx = pool.begin().await?;
    let current_version = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(version), 0) FROM event_store WHERE stream_id = ?",
    )
    .bind(stream_id)
    .fetch_one(&mut *tx)
    .await? as u64;

    if current_version != expected_version {
        return Err(EventStoreError::VersionConflict {
            stream_id: stream_id.to_owned(),
            expected_version,
            actual_version: current_version,
        });
    }

    for (offset, event) in events.iter().enumerate() {
        sqlx::query(
            "INSERT INTO event_store (stream_id, version, event_type, schema_version, payload, metadata) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(stream_id)
        .bind((expected_version + offset as u64 + 1) as i64)
        .bind(&event.event_type)
        .bind(event.schema_version as i64)
        .bind(serde_json::to_string(&event.payload)?)
        .bind(optional_json_string(event.metadata.as_ref())?)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

async fn append_with_postgres(
    pool: &PgPool,
    stream_id: &str,
    expected_version: u64,
    events: &[NewEvent],
) -> Result<(), EventStoreError> {
    let mut tx = pool.begin().await?;
    let current_version = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(version), 0) FROM event_store WHERE stream_id = $1",
    )
    .bind(stream_id)
    .fetch_one(&mut *tx)
    .await? as u64;

    if current_version != expected_version {
        return Err(EventStoreError::VersionConflict {
            stream_id: stream_id.to_owned(),
            expected_version,
            actual_version: current_version,
        });
    }

    for (offset, event) in events.iter().enumerate() {
        sqlx::query(
            "INSERT INTO event_store (stream_id, version, event_type, schema_version, payload, metadata) VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(stream_id)
        .bind((expected_version + offset as u64 + 1) as i64)
        .bind(&event.event_type)
        .bind(event.schema_version as i32)
        .bind(serde_json::to_string(&event.payload)?)
        .bind(optional_json_string(event.metadata.as_ref())?)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

async fn append_with_mysql(
    pool: &MySqlPool,
    stream_id: &str,
    expected_version: u64,
    events: &[NewEvent],
) -> Result<(), EventStoreError> {
    let mut tx = pool.begin().await?;
    let current_version = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(version), 0) FROM event_store WHERE stream_id = ?",
    )
    .bind(stream_id)
    .fetch_one(&mut *tx)
    .await? as u64;

    if current_version != expected_version {
        return Err(EventStoreError::VersionConflict {
            stream_id: stream_id.to_owned(),
            expected_version,
            actual_version: current_version,
        });
    }

    for (offset, event) in events.iter().enumerate() {
        sqlx::query(
            "INSERT INTO event_store (stream_id, version, event_type, schema_version, payload, metadata) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(stream_id)
        .bind((expected_version + offset as u64 + 1) as i64)
        .bind(&event.event_type)
        .bind(event.schema_version as i32)
        .bind(serde_json::to_string(&event.payload)?)
        .bind(optional_json_string(event.metadata.as_ref())?)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

fn row_to_event_sqlite(row: SqliteRow) -> Result<EventRecord, EventStoreError> {
    let payload: String = row.try_get("payload")?;
    let metadata: Option<String> = row.try_get("metadata")?;
    Ok(EventRecord {
        stream_id: row.try_get("stream_id")?,
        version: row.try_get::<i64, _>("version")? as u64,
        sequence: row.try_get::<i64, _>("sequence")? as u64,
        event_type: row.try_get("event_type")?,
        payload: serde_json::from_str(&payload)?,
        schema_version: row.try_get::<i64, _>("schema_version")? as u32,
        metadata: metadata
            .map(|item| serde_json::from_str(&item))
            .transpose()?,
    })
}

fn row_to_event_postgres(row: PgRow) -> Result<EventRecord, EventStoreError> {
    let payload: String = row.try_get("payload")?;
    let metadata: Option<String> = row.try_get("metadata")?;
    Ok(EventRecord {
        stream_id: row.try_get("stream_id")?,
        version: row.try_get::<i64, _>("version")? as u64,
        sequence: row.try_get::<i64, _>("sequence")? as u64,
        event_type: row.try_get("event_type")?,
        payload: serde_json::from_str(&payload)?,
        schema_version: row.try_get::<i32, _>("schema_version")? as u32,
        metadata: metadata
            .map(|item| serde_json::from_str(&item))
            .transpose()?,
    })
}

fn row_to_event_mysql(row: MySqlRow) -> Result<EventRecord, EventStoreError> {
    let payload: String = row.try_get("payload")?;
    let metadata: Option<String> = row.try_get("metadata")?;
    Ok(EventRecord {
        stream_id: row.try_get("stream_id")?,
        version: row.try_get::<i64, _>("version")? as u64,
        sequence: row.try_get::<i64, _>("sequence")? as u64,
        event_type: row.try_get("event_type")?,
        payload: serde_json::from_str(&payload)?,
        schema_version: row.try_get::<i32, _>("schema_version")? as u32,
        metadata: metadata
            .map(|item| serde_json::from_str(&item))
            .transpose()?,
    })
}

fn optional_json_string(
    value: Option<&serde_json::Value>,
) -> Result<Option<String>, EventStoreError> {
    value
        .map(serde_json::to_string)
        .transpose()
        .map_err(EventStoreError::from)
}

fn dialect_from_url(database_url: &str) -> Result<SqlDialect, EventStoreError> {
    if database_url.starts_with("sqlite:") || database_url.starts_with("file:") {
        Ok(SqlDialect::Sqlite)
    } else if database_url.starts_with("postgres://") || database_url.starts_with("postgresql://") {
        Ok(SqlDialect::Postgres)
    } else if database_url.starts_with("mysql://") {
        Ok(SqlDialect::Mysql)
    } else {
        Err(EventStoreError::UnsupportedDatabaseUrl(
            database_url.to_owned(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn appends_and_loads_streams() {
        let store = InMemoryEventStore::new();
        let appended = store
            .append(
                "account-1",
                0,
                vec![
                    NewEvent {
                        event_type: "account.opened".into(),
                        payload: json!({ "owner": "alice" }),
                        schema_version: 1,
                        metadata: None,
                    },
                    NewEvent {
                        event_type: "account.deposited".into(),
                        payload: json!({ "amount": 25 }),
                        schema_version: 1,
                        metadata: None,
                    },
                ],
            )
            .unwrap();

        assert_eq!(appended[1].version, 2);
        assert_eq!(store.latest_version("account-1"), 2);
        assert_eq!(store.load_stream("account-1").len(), 2);
    }

    #[test]
    fn rejects_stale_expected_versions() {
        let store = InMemoryEventStore::new();
        store
            .append(
                "account-1",
                0,
                vec![NewEvent {
                    event_type: "account.opened".into(),
                    payload: json!({}),
                    schema_version: 1,
                    metadata: None,
                }],
            )
            .unwrap();

        let error = store
            .append(
                "account-1",
                0,
                vec![NewEvent {
                    event_type: "account.deposited".into(),
                    payload: json!({ "amount": 10 }),
                    schema_version: 1,
                    metadata: None,
                }],
            )
            .unwrap_err();

        assert!(matches!(
            error,
            EventStoreError::VersionConflict {
                stream_id,
                expected_version: 0,
                actual_version: 1,
            } if stream_id == "account-1"
        ));
    }

    #[tokio::test]
    async fn bootstraps_and_appends_events_in_sqlite() {
        let store = SqlEventStore::connect("sqlite::memory:").await.unwrap();
        store.bootstrap().await.unwrap();

        let appended = store
            .append(
                "account-2",
                0,
                vec![NewEvent {
                    event_type: "account.opened".into(),
                    payload: json!({ "owner": "bob" }),
                    schema_version: 1,
                    metadata: Some(json!({ "source": "test" })),
                }],
            )
            .await
            .unwrap();

        assert_eq!(appended[0].version, 1);
        assert_eq!(store.latest_version("account-2").await.unwrap(), 1);
        assert_eq!(store.load_all_after(0).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn sqlite_store_rejects_stale_versions() {
        let store = SqlEventStore::connect("sqlite::memory:").await.unwrap();
        store.bootstrap().await.unwrap();
        store
            .append(
                "account-3",
                0,
                vec![NewEvent {
                    event_type: "account.opened".into(),
                    payload: json!({}),
                    schema_version: 1,
                    metadata: None,
                }],
            )
            .await
            .unwrap();

        let error = store
            .append(
                "account-3",
                0,
                vec![NewEvent {
                    event_type: "account.deposited".into(),
                    payload: json!({ "amount": 10 }),
                    schema_version: 1,
                    metadata: None,
                }],
            )
            .await
            .unwrap_err();

        assert!(matches!(
            error,
            EventStoreError::VersionConflict {
                stream_id,
                expected_version: 0,
                actual_version: 1,
            } if stream_id == "account-3"
        ));
    }
}
