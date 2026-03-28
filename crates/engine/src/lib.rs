use serde::{Deserialize, Serialize};
use sqlmodel_event_store::{
    EventReader, EventRecord, EventStoreError, InMemoryEventStore, NewEvent, SqlEventStore,
};
use sqlmodel_projections::{
    replay_projection, reset_projection_checkpoint, CheckpointStore, CheckpointStoreError,
    InMemoryCheckpointStore, ProjectionCheckpoint, ProjectionRunnerError, Projector,
    SqlCheckpointStore,
};
use sqlmodel_snapshots::{
    InMemorySnapshotStore, SnapshotRecord, SnapshotStoreError, SqlSnapshotStore,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoadedStream {
    pub snapshot: Option<SnapshotRecord>,
    pub events: Vec<EventRecord>,
    pub current_version: u64,
}

#[derive(Debug, Clone)]
pub struct SqlModelEngine {
    event_store: InMemoryEventStore,
    snapshots: InMemorySnapshotStore,
    checkpoints: InMemoryCheckpointStore,
}

#[derive(Debug, Clone)]
pub struct RelationalSqlModelEngine {
    event_store: SqlEventStore,
    snapshots: SqlSnapshotStore,
    checkpoints: SqlCheckpointStore,
}

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error(transparent)]
    EventStore(#[from] EventStoreError),
    #[error(transparent)]
    SnapshotStore(#[from] SnapshotStoreError),
    #[error(transparent)]
    CheckpointStore(#[from] CheckpointStoreError),
    #[error(transparent)]
    ProjectionRunner(#[from] ProjectionRunnerError),
}

impl SqlModelEngine {
    #[must_use]
    pub fn new(
        event_store: InMemoryEventStore,
        snapshots: InMemorySnapshotStore,
        checkpoints: InMemoryCheckpointStore,
    ) -> Self {
        Self {
            event_store,
            snapshots,
            checkpoints,
        }
    }

    pub fn load_stream(&self, stream_id: &str) -> LoadedStream {
        let snapshot = self.snapshots.load(stream_id);
        let events = self.event_store.load_stream(stream_id);
        let current_version = events
            .last()
            .map_or(snapshot.as_ref().map_or(0, |item| item.version), |event| {
                event.version
            });
        let events = if let Some(snapshot_record) = &snapshot {
            events
                .into_iter()
                .filter(|event| event.version > snapshot_record.version)
                .collect()
        } else {
            events
        };

        LoadedStream {
            snapshot,
            events,
            current_version,
        }
    }

    pub fn append_events(
        &self,
        stream_id: &str,
        expected_version: u64,
        events: Vec<NewEvent>,
        snapshot: Option<SnapshotRecord>,
    ) -> Result<Vec<EventRecord>, EventStoreError> {
        let appended = self
            .event_store
            .append(stream_id, expected_version, events)?;
        if let Some(snapshot_record) = snapshot {
            self.snapshots.save(SnapshotRecord {
                stream_id: stream_id.to_owned(),
                version: appended
                    .last()
                    .map_or(snapshot_record.version, |event| event.version),
                ..snapshot_record
            });
        }
        Ok(appended)
    }

    pub async fn replay_projection<P: Projector + Sync>(
        &self,
        projector: &P,
    ) -> Result<ProjectionCheckpoint, EngineError> {
        replay_projection(&self.event_store, &self.checkpoints, projector)
            .await
            .map_err(EngineError::from)
    }

    pub async fn reset_projection(&self, projector: &str) -> Result<(), EngineError> {
        reset_projection_checkpoint(&self.checkpoints, projector)
            .await
            .map_err(EngineError::from)
    }

    pub async fn load_projection_checkpoint(
        &self,
        projector: &str,
    ) -> Result<Option<ProjectionCheckpoint>, EngineError> {
        self.checkpoints
            .load(projector)
            .await
            .map_err(EngineError::from)
    }
}

impl RelationalSqlModelEngine {
    pub async fn connect(database_url: &str) -> Result<Self, EngineError> {
        Ok(Self {
            event_store: SqlEventStore::connect(database_url).await?,
            snapshots: SqlSnapshotStore::connect(database_url).await?,
            checkpoints: SqlCheckpointStore::connect(database_url).await?,
        })
    }

    pub async fn bootstrap(&self) -> Result<(), EngineError> {
        self.event_store.bootstrap().await?;
        self.snapshots.bootstrap().await?;
        self.checkpoints.bootstrap().await?;
        Ok(())
    }

    pub async fn load_stream(&self, stream_id: &str) -> Result<LoadedStream, EngineError> {
        let snapshot = self.snapshots.load(stream_id).await?;
        let events = self.event_store.load_stream(stream_id).await?;
        let current_version = events
            .last()
            .map_or(snapshot.as_ref().map_or(0, |item| item.version), |event| {
                event.version
            });
        let events = if let Some(snapshot_record) = &snapshot {
            events
                .into_iter()
                .filter(|event| event.version > snapshot_record.version)
                .collect()
        } else {
            events
        };

        Ok(LoadedStream {
            snapshot,
            events,
            current_version,
        })
    }

    pub async fn append_events(
        &self,
        stream_id: &str,
        expected_version: u64,
        events: Vec<NewEvent>,
        snapshot: Option<SnapshotRecord>,
    ) -> Result<Vec<EventRecord>, EngineError> {
        let appended = self
            .event_store
            .append(stream_id, expected_version, events)
            .await?;
        if let Some(snapshot_record) = snapshot {
            self.snapshots
                .save(&SnapshotRecord {
                    stream_id: stream_id.to_owned(),
                    version: appended
                        .last()
                        .map_or(snapshot_record.version, |event| event.version),
                    ..snapshot_record
                })
                .await?;
        }
        Ok(appended)
    }

    pub async fn replay_projection<P: Projector + Sync>(
        &self,
        projector: &P,
    ) -> Result<ProjectionCheckpoint, EngineError> {
        replay_projection(&self.event_store, &self.checkpoints, projector)
            .await
            .map_err(EngineError::from)
    }

    pub async fn reset_projection(&self, projector: &str) -> Result<(), EngineError> {
        reset_projection_checkpoint(&self.checkpoints, projector)
            .await
            .map_err(EngineError::from)
    }

    pub async fn load_projection_checkpoint(
        &self,
        projector: &str,
    ) -> Result<Option<ProjectionCheckpoint>, EngineError> {
        self.checkpoints
            .load(projector)
            .await
            .map_err(EngineError::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
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

    #[test]
    fn loads_events_after_snapshot_only() {
        let event_store = InMemoryEventStore::new();
        let snapshots = InMemorySnapshotStore::new();
        let checkpoints = InMemoryCheckpointStore::new();
        let engine = SqlModelEngine::new(event_store.clone(), snapshots.clone(), checkpoints);

        event_store
            .append(
                "account-1",
                0,
                vec![
                    NewEvent {
                        event_type: "opened".into(),
                        payload: json!({}),
                        schema_version: 1,
                        metadata: None,
                    },
                    NewEvent {
                        event_type: "deposited".into(),
                        payload: json!({ "amount": 10 }),
                        schema_version: 1,
                        metadata: None,
                    },
                ],
            )
            .unwrap();

        snapshots.save(SnapshotRecord {
            stream_id: "account-1".into(),
            version: 1,
            schema_version: 1,
            state: json!({ "balance": 0 }),
        });

        let loaded = engine.load_stream("account-1");
        assert_eq!(loaded.snapshot.unwrap().version, 1);
        assert_eq!(loaded.events.len(), 1);
        assert_eq!(loaded.current_version, 2);
    }

    #[tokio::test]
    async fn relational_engine_bootstraps_and_loads_after_snapshot() {
        let engine = RelationalSqlModelEngine::connect("sqlite::memory:")
            .await
            .unwrap();
        engine.bootstrap().await.unwrap();
        engine
            .append_events(
                "account-2",
                0,
                vec![
                    NewEvent {
                        event_type: "opened".into(),
                        payload: json!({}),
                        schema_version: 1,
                        metadata: None,
                    },
                    NewEvent {
                        event_type: "deposited".into(),
                        payload: json!({ "amount": 5 }),
                        schema_version: 1,
                        metadata: None,
                    },
                ],
                Some(SnapshotRecord {
                    stream_id: "account-2".into(),
                    version: 1,
                    schema_version: 1,
                    state: json!({ "balance": 0 }),
                }),
            )
            .await
            .unwrap();

        let loaded = engine.load_stream("account-2").await.unwrap();
        assert_eq!(loaded.snapshot.unwrap().version, 2);
        assert_eq!(loaded.events.len(), 0);
        assert_eq!(loaded.current_version, 2);
    }

    #[tokio::test]
    async fn in_memory_engine_replays_and_resets_projection_checkpoints() {
        let event_store = InMemoryEventStore::new();
        let snapshots = InMemorySnapshotStore::new();
        let checkpoints = InMemoryCheckpointStore::new();
        let engine = SqlModelEngine::new(event_store.clone(), snapshots, checkpoints);

        event_store
            .append(
                "account-1",
                0,
                vec![NewEvent {
                    event_type: "opened".into(),
                    payload: json!({}),
                    schema_version: 1,
                    metadata: None,
                }],
            )
            .unwrap();

        let count = AtomicU64::new(0);
        let projector = CountingProjector { count: &count };

        engine.replay_projection(&projector).await.unwrap();
        engine.replay_projection(&projector).await.unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 1);
        assert_eq!(
            engine
                .load_projection_checkpoint(projector.name())
                .await
                .unwrap()
                .unwrap()
                .last_sequence,
            1
        );

        engine.reset_projection(projector.name()).await.unwrap();
        engine.replay_projection(&projector).await.unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn relational_engine_replays_and_resets_projection_checkpoints() {
        let engine = RelationalSqlModelEngine::connect("sqlite::memory:")
            .await
            .unwrap();
        engine.bootstrap().await.unwrap();
        engine
            .append_events(
                "account-3",
                0,
                vec![
                    NewEvent {
                        event_type: "opened".into(),
                        payload: json!({}),
                        schema_version: 1,
                        metadata: None,
                    },
                    NewEvent {
                        event_type: "deposited".into(),
                        payload: json!({ "amount": 5 }),
                        schema_version: 1,
                        metadata: None,
                    },
                ],
                None,
            )
            .await
            .unwrap();

        let count = AtomicU64::new(0);
        let projector = CountingProjector { count: &count };

        let checkpoint = engine.replay_projection(&projector).await.unwrap();
        assert_eq!(checkpoint.last_sequence, 2);
        engine.replay_projection(&projector).await.unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 2);

        engine.reset_projection(projector.name()).await.unwrap();
        assert!(engine
            .load_projection_checkpoint(projector.name())
            .await
            .unwrap()
            .is_none());
        engine.replay_projection(&projector).await.unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 4);
    }
}
