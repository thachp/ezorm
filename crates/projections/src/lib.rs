use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sqlmodel_dialects::{framework_schema, SqlDialect};
use sqlmodel_event_store::{
    EventReader, EventRecord, EventStoreError, InMemoryEventStore, SqlEventStore,
};
use sqlx::{
    mysql::{MySqlPoolOptions, MySqlRow},
    postgres::{PgPoolOptions, PgRow},
    sqlite::{SqlitePoolOptions, SqliteRow},
    MySqlPool, PgPool, Row, SqlitePool,
};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectionCheckpoint {
    pub projector: String,
    pub last_sequence: u64,
}

#[derive(Debug, Error)]
pub enum CheckpointStoreError {
    #[error("unsupported database url `{0}`")]
    UnsupportedDatabaseUrl(String),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

#[derive(Debug, Error)]
pub enum ProjectionRunnerError {
    #[error(transparent)]
    CheckpointStore(#[from] CheckpointStoreError),
    #[error(transparent)]
    EventStore(#[from] EventStoreError),
}

#[derive(Debug, Default, Clone)]
pub struct InMemoryCheckpointStore {
    inner: Arc<Mutex<HashMap<String, ProjectionCheckpoint>>>,
}

#[derive(Debug, Clone)]
pub struct SqlCheckpointStore {
    pool: CheckpointPool,
    dialect: SqlDialect,
}

#[derive(Debug, Clone)]
enum CheckpointPool {
    Sqlite(SqlitePool),
    Postgres(PgPool),
    Mysql(MySqlPool),
}

#[async_trait]
pub trait CheckpointStore {
    async fn load(
        &self,
        projector: &str,
    ) -> Result<Option<ProjectionCheckpoint>, CheckpointStoreError>;
    async fn save(&self, checkpoint: &ProjectionCheckpoint) -> Result<(), CheckpointStoreError>;
    async fn reset(&self, projector: &str) -> Result<(), CheckpointStoreError>;
}

#[async_trait]
pub trait ProjectionEventReader {
    async fn load_all_after(&self, sequence: u64) -> Result<Vec<EventRecord>, EventStoreError>;
}

impl InMemoryCheckpointStore {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl CheckpointStore for InMemoryCheckpointStore {
    async fn load(
        &self,
        projector: &str,
    ) -> Result<Option<ProjectionCheckpoint>, CheckpointStoreError> {
        Ok(self
            .inner
            .lock()
            .expect("checkpoint lock poisoned")
            .get(projector)
            .cloned())
    }

    async fn save(&self, checkpoint: &ProjectionCheckpoint) -> Result<(), CheckpointStoreError> {
        self.inner
            .lock()
            .expect("checkpoint lock poisoned")
            .insert(checkpoint.projector.clone(), checkpoint.clone());
        Ok(())
    }

    async fn reset(&self, projector: &str) -> Result<(), CheckpointStoreError> {
        self.inner
            .lock()
            .expect("checkpoint lock poisoned")
            .remove(projector);
        Ok(())
    }
}

impl SqlCheckpointStore {
    pub async fn connect(database_url: &str) -> Result<Self, CheckpointStoreError> {
        let dialect = dialect_from_url(database_url)?;
        let pool = match dialect {
            SqlDialect::Sqlite => CheckpointPool::Sqlite(
                SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect(database_url)
                    .await?,
            ),
            SqlDialect::Postgres => CheckpointPool::Postgres(
                PgPoolOptions::new()
                    .max_connections(5)
                    .connect(database_url)
                    .await?,
            ),
            SqlDialect::Mysql => CheckpointPool::Mysql(
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

    pub async fn bootstrap(&self) -> Result<(), CheckpointStoreError> {
        match &self.pool {
            CheckpointPool::Sqlite(pool) => {
                for statement in framework_schema(self.dialect) {
                    sqlx::query(statement.as_str()).execute(pool).await?;
                }
            }
            CheckpointPool::Postgres(pool) => {
                for statement in framework_schema(self.dialect) {
                    sqlx::query(statement.as_str()).execute(pool).await?;
                }
            }
            CheckpointPool::Mysql(pool) => {
                for statement in framework_schema(self.dialect) {
                    sqlx::query(statement.as_str()).execute(pool).await?;
                }
            }
        }

        Ok(())
    }
}

#[async_trait]
impl CheckpointStore for SqlCheckpointStore {
    async fn load(
        &self,
        projector: &str,
    ) -> Result<Option<ProjectionCheckpoint>, CheckpointStoreError> {
        match &self.pool {
            CheckpointPool::Sqlite(pool) => {
                let row = sqlx::query(
                    "SELECT projector, last_sequence FROM projection_checkpoints WHERE projector = ?",
                )
                .bind(projector)
                .fetch_optional(pool)
                .await?;
                row.map(row_to_checkpoint_sqlite).transpose()
            }
            CheckpointPool::Postgres(pool) => {
                let row = sqlx::query(
                    "SELECT projector, last_sequence FROM projection_checkpoints WHERE projector = $1",
                )
                .bind(projector)
                .fetch_optional(pool)
                .await?;
                row.map(row_to_checkpoint_postgres).transpose()
            }
            CheckpointPool::Mysql(pool) => {
                let row = sqlx::query(
                    "SELECT projector, last_sequence FROM projection_checkpoints WHERE projector = ?",
                )
                .bind(projector)
                .fetch_optional(pool)
                .await?;
                row.map(row_to_checkpoint_mysql).transpose()
            }
        }
    }

    async fn save(&self, checkpoint: &ProjectionCheckpoint) -> Result<(), CheckpointStoreError> {
        match &self.pool {
            CheckpointPool::Sqlite(pool) => {
                sqlx::query(
                    "INSERT INTO projection_checkpoints (projector, last_sequence) VALUES (?, ?) ON CONFLICT(projector) DO UPDATE SET last_sequence = excluded.last_sequence",
                )
                .bind(&checkpoint.projector)
                .bind(checkpoint.last_sequence as i64)
                .execute(pool)
                .await?;
            }
            CheckpointPool::Postgres(pool) => {
                sqlx::query(
                    "INSERT INTO projection_checkpoints (projector, last_sequence) VALUES ($1, $2) ON CONFLICT(projector) DO UPDATE SET last_sequence = EXCLUDED.last_sequence",
                )
                .bind(&checkpoint.projector)
                .bind(checkpoint.last_sequence as i64)
                .execute(pool)
                .await?;
            }
            CheckpointPool::Mysql(pool) => {
                sqlx::query(
                    "INSERT INTO projection_checkpoints (projector, last_sequence) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_sequence = VALUES(last_sequence)",
                )
                .bind(&checkpoint.projector)
                .bind(checkpoint.last_sequence as i64)
                .execute(pool)
                .await?;
            }
        }

        Ok(())
    }

    async fn reset(&self, projector: &str) -> Result<(), CheckpointStoreError> {
        match &self.pool {
            CheckpointPool::Sqlite(pool) => {
                sqlx::query("DELETE FROM projection_checkpoints WHERE projector = ?")
                    .bind(projector)
                    .execute(pool)
                    .await?;
            }
            CheckpointPool::Postgres(pool) => {
                sqlx::query("DELETE FROM projection_checkpoints WHERE projector = $1")
                    .bind(projector)
                    .execute(pool)
                    .await?;
            }
            CheckpointPool::Mysql(pool) => {
                sqlx::query("DELETE FROM projection_checkpoints WHERE projector = ?")
                    .bind(projector)
                    .execute(pool)
                    .await?;
            }
        }

        Ok(())
    }
}

pub trait Projector {
    fn name(&self) -> &str;
    fn handle(&self, event: &EventRecord);
}

#[async_trait]
impl ProjectionEventReader for InMemoryEventStore {
    async fn load_all_after(&self, sequence: u64) -> Result<Vec<EventRecord>, EventStoreError> {
        Ok(EventReader::load_all_after(self, sequence))
    }
}

#[async_trait]
impl ProjectionEventReader for SqlEventStore {
    async fn load_all_after(&self, sequence: u64) -> Result<Vec<EventRecord>, EventStoreError> {
        SqlEventStore::load_all_after(self, sequence).await
    }
}

pub async fn replay_projection<
    R: ProjectionEventReader + Sync,
    S: CheckpointStore + Sync,
    P: Projector + Sync,
>(
    reader: &R,
    checkpoint_store: &S,
    projector: &P,
) -> Result<ProjectionCheckpoint, ProjectionRunnerError> {
    let last_sequence = checkpoint_store
        .load(projector.name())
        .await?
        .map_or(0, |checkpoint| checkpoint.last_sequence);
    let events = reader.load_all_after(last_sequence).await?;
    let mut latest = last_sequence;

    for event in events {
        latest = event.sequence;
        projector.handle(&event);
    }

    let checkpoint = ProjectionCheckpoint {
        projector: projector.name().to_owned(),
        last_sequence: latest,
    };
    checkpoint_store.save(&checkpoint).await?;
    Ok(checkpoint)
}

pub async fn reset_projection_checkpoint<S: CheckpointStore + Sync>(
    checkpoint_store: &S,
    projector: &str,
) -> Result<(), CheckpointStoreError> {
    checkpoint_store.reset(projector).await
}

fn row_to_checkpoint_sqlite(row: SqliteRow) -> Result<ProjectionCheckpoint, CheckpointStoreError> {
    Ok(ProjectionCheckpoint {
        projector: row.try_get("projector")?,
        last_sequence: row.try_get::<i64, _>("last_sequence")? as u64,
    })
}

fn row_to_checkpoint_postgres(row: PgRow) -> Result<ProjectionCheckpoint, CheckpointStoreError> {
    Ok(ProjectionCheckpoint {
        projector: row.try_get("projector")?,
        last_sequence: row.try_get::<i64, _>("last_sequence")? as u64,
    })
}

fn row_to_checkpoint_mysql(row: MySqlRow) -> Result<ProjectionCheckpoint, CheckpointStoreError> {
    Ok(ProjectionCheckpoint {
        projector: row.try_get("projector")?,
        last_sequence: row.try_get::<i64, _>("last_sequence")? as u64,
    })
}

fn dialect_from_url(database_url: &str) -> Result<SqlDialect, CheckpointStoreError> {
    if database_url.starts_with("sqlite:") || database_url.starts_with("file:") {
        Ok(SqlDialect::Sqlite)
    } else if database_url.starts_with("postgres://") || database_url.starts_with("postgresql://") {
        Ok(SqlDialect::Postgres)
    } else if database_url.starts_with("mysql://") {
        Ok(SqlDialect::Mysql)
    } else {
        Err(CheckpointStoreError::UnsupportedDatabaseUrl(
            database_url.to_owned(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sqlmodel_event_store::NewEvent;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct CountingProjector<'a> {
        count: &'a AtomicU64,
    }

    impl Projector for CountingProjector<'_> {
        fn name(&self) -> &str {
            "counting"
        }

        fn handle(&self, _event: &EventRecord) {
            self.count.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn replays_new_events_and_updates_checkpoint() {
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

        let count = AtomicU64::new(0);
        let checkpoints = InMemoryCheckpointStore::new();
        let projector = CountingProjector { count: &count };
        let checkpoint = replay_projection(&store, &checkpoints, &projector)
            .await
            .unwrap();

        assert_eq!(count.load(Ordering::SeqCst), 1);
        assert_eq!(checkpoint.last_sequence, 1);
    }

    #[tokio::test]
    async fn replay_resumes_from_persisted_checkpoint() {
        let store = InMemoryEventStore::new();
        store
            .append(
                "account-1",
                0,
                vec![
                    NewEvent {
                        event_type: "account.opened".into(),
                        payload: json!({}),
                        schema_version: 1,
                        metadata: None,
                    },
                    NewEvent {
                        event_type: "account.deposited".into(),
                        payload: json!({ "amount": 10 }),
                        schema_version: 1,
                        metadata: None,
                    },
                ],
            )
            .unwrap();

        let count = AtomicU64::new(0);
        let checkpoints = InMemoryCheckpointStore::new();
        let projector = CountingProjector { count: &count };

        replay_projection(&store, &checkpoints, &projector)
            .await
            .unwrap();
        replay_projection(&store, &checkpoints, &projector)
            .await
            .unwrap();

        assert_eq!(count.load(Ordering::SeqCst), 2);
        assert_eq!(
            checkpoints
                .load("counting")
                .await
                .unwrap()
                .unwrap()
                .last_sequence,
            2
        );
    }

    #[tokio::test]
    async fn replay_from_reset_reprocesses_all_events() {
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

        let count = AtomicU64::new(0);
        let checkpoints = InMemoryCheckpointStore::new();
        let projector = CountingProjector { count: &count };

        replay_projection(&store, &checkpoints, &projector)
            .await
            .unwrap();
        reset_projection_checkpoint(&checkpoints, projector.name())
            .await
            .unwrap();
        replay_projection(&store, &checkpoints, &projector)
            .await
            .unwrap();

        assert_eq!(count.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn persists_checkpoints_in_sqlite() {
        let store = SqlCheckpointStore::connect("sqlite::memory:")
            .await
            .unwrap();
        store.bootstrap().await.unwrap();
        store
            .save(&ProjectionCheckpoint {
                projector: "balances".into(),
                last_sequence: 3,
            })
            .await
            .unwrap();
        store
            .save(&ProjectionCheckpoint {
                projector: "balances".into(),
                last_sequence: 5,
            })
            .await
            .unwrap();

        let loaded = store.load("balances").await.unwrap().unwrap();
        assert_eq!(loaded.last_sequence, 5);

        store.reset("balances").await.unwrap();
        assert!(store.load("balances").await.unwrap().is_none());
    }

    #[test]
    fn rejects_unsupported_checkpoint_urls() {
        let error = dialect_from_url("redis://localhost").unwrap_err();
        assert!(matches!(
            error,
            CheckpointStoreError::UnsupportedDatabaseUrl(url) if url == "redis://localhost"
        ));
    }
}
