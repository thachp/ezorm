use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use sqlmodel_ts_event_store::{EventReader, EventRecord};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectionCheckpoint {
    pub projector: String,
    pub last_sequence: u64,
}

#[derive(Debug, Default, Clone)]
pub struct InMemoryCheckpointStore {
    inner: Arc<Mutex<HashMap<String, ProjectionCheckpoint>>>,
}

impl InMemoryCheckpointStore {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn load(&self, projector: &str) -> Option<ProjectionCheckpoint> {
        self.inner
            .lock()
            .expect("checkpoint lock poisoned")
            .get(projector)
            .cloned()
    }

    pub fn save(&self, checkpoint: ProjectionCheckpoint) {
        self.inner
            .lock()
            .expect("checkpoint lock poisoned")
            .insert(checkpoint.projector.clone(), checkpoint);
    }
}

pub trait Projector {
    fn name(&self) -> &str;
    fn handle(&self, event: &EventRecord);
}

pub fn replay_projection<R: EventReader, P: Projector>(
    reader: &R,
    checkpoint_store: &InMemoryCheckpointStore,
    projector: &P,
) -> ProjectionCheckpoint {
    let last_sequence = checkpoint_store
        .load(projector.name())
        .map_or(0, |checkpoint| checkpoint.last_sequence);
    let events = reader.load_all_after(last_sequence);
    let mut latest = last_sequence;

    for event in events {
        latest = event.sequence;
        projector.handle(&event);
    }

    let checkpoint = ProjectionCheckpoint {
        projector: projector.name().to_owned(),
        last_sequence: latest,
    };
    checkpoint_store.save(checkpoint.clone());
    checkpoint
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sqlmodel_ts_event_store::{InMemoryEventStore, NewEvent};
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
    fn replays_new_events_and_updates_checkpoint() {
        let store = InMemoryEventStore::new();
        store.append(
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
        let checkpoint = replay_projection(&store, &checkpoints, &projector);

        assert_eq!(count.load(Ordering::SeqCst), 1);
        assert_eq!(checkpoint.last_sequence, 1);
    }
}

