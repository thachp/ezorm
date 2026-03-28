use serde::{Deserialize, Serialize};
use sqlmodel_ts_event_store::{
    EventReader, EventRecord, EventStoreError, InMemoryEventStore, NewEvent, SqlEventStore,
};
use sqlmodel_ts_snapshots::{InMemorySnapshotStore, SnapshotRecord, SnapshotStoreError, SqlSnapshotStore};

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
}

#[derive(Debug, Clone)]
pub struct RelationalSqlModelEngine {
    event_store: SqlEventStore,
    snapshots: SqlSnapshotStore,
}

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error(transparent)]
    EventStore(#[from] EventStoreError),
    #[error(transparent)]
    SnapshotStore(#[from] SnapshotStoreError),
}

impl SqlModelEngine {
    #[must_use]
    pub fn new(event_store: InMemoryEventStore, snapshots: InMemorySnapshotStore) -> Self {
        Self {
            event_store,
            snapshots,
        }
    }

    pub fn load_stream(&self, stream_id: &str) -> LoadedStream {
        let snapshot = self.snapshots.load(stream_id);
        let events = self.event_store.load_stream(stream_id);
        let current_version = events.last().map_or(snapshot.as_ref().map_or(0, |item| item.version), |event| event.version);
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
                version: appended.last().map_or(snapshot_record.version, |event| event.version),
                ..snapshot_record
            });
        }
        Ok(appended)
    }
}

impl RelationalSqlModelEngine {
    pub async fn connect(database_url: &str) -> Result<Self, EngineError> {
        Ok(Self {
            event_store: SqlEventStore::connect(database_url).await?,
            snapshots: SqlSnapshotStore::connect(database_url).await?,
        })
    }

    pub async fn bootstrap(&self) -> Result<(), EngineError> {
        self.event_store.bootstrap().await?;
        self.snapshots.bootstrap().await?;
        Ok(())
    }

    pub async fn load_stream(&self, stream_id: &str) -> Result<LoadedStream, EngineError> {
        let snapshot = self.snapshots.load(stream_id).await?;
        let events = self.event_store.load_stream(stream_id).await?;
        let current_version = events
            .last()
            .map_or(snapshot.as_ref().map_or(0, |item| item.version), |event| event.version);
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn loads_events_after_snapshot_only() {
        let event_store = InMemoryEventStore::new();
        let snapshots = InMemorySnapshotStore::new();
        let engine = SqlModelEngine::new(event_store.clone(), snapshots.clone());

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
}
