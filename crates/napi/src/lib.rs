use napi::bindgen_prelude::Result as NapiResult;
use napi::Error;
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use ezorm_event_store::{EventRecord, NewEvent, SqlEventStore};
use ezorm_projections::{CheckpointStore, ProjectionCheckpoint, SqlCheckpointStore};
use tokio::runtime::Runtime;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeBindingManifest {
    pub package_name: String,
    pub binary_name: String,
    pub target_triple: String,
}

impl NodeBindingManifest {
    #[must_use]
    pub fn new(target_triple: impl Into<String>) -> Self {
        Self {
            package_name: "@ezorm/runtime-node".into(),
            binary_name: "ezorm_napi".into(),
            target_triple: target_triple.into(),
        }
    }
}

#[napi(object)]
pub struct NativeEventInput {
    pub event_type: String,
    pub payload_json: String,
    pub schema_version: u32,
    pub metadata_json: Option<String>,
}

#[napi(object)]
pub struct NativeStoredEvent {
    pub stream_id: String,
    pub version: u32,
    pub sequence: u32,
    pub event_type: String,
    pub payload_json: String,
    pub schema_version: u32,
    pub metadata_json: Option<String>,
}

#[napi(object)]
pub struct NativeProjectionCheckpoint {
    pub projector: String,
    pub last_sequence: u32,
}

#[napi]
pub struct NativeEzormRuntime {
    runtime: Runtime,
    store: SqlEventStore,
    checkpoints: SqlCheckpointStore,
}

#[napi]
impl NativeEzormRuntime {
    #[napi]
    pub fn bootstrap(&self) -> NapiResult<()> {
        self.runtime
            .block_on(self.store.bootstrap())
            .map_err(to_napi_error)?;
        self.runtime
            .block_on(self.checkpoints.bootstrap())
            .map_err(to_napi_error)?;
        Ok(())
    }

    #[napi(js_name = "loadCheckpoint")]
    pub fn load_checkpoint(
        &self,
        projector: String,
    ) -> NapiResult<Option<NativeProjectionCheckpoint>> {
        self.runtime
            .block_on(self.checkpoints.load(&projector))
            .map(|checkpoint| checkpoint.map(Into::into))
            .map_err(to_napi_error)
    }

    #[napi]
    pub fn load(&self, stream_id: String) -> NapiResult<Vec<NativeStoredEvent>> {
        self.runtime
            .block_on(self.store.load_stream(&stream_id))
            .map(|events| events.into_iter().map(NativeStoredEvent::from).collect())
            .map_err(to_napi_error)
    }

    #[napi(js_name = "loadAll")]
    pub fn load_all(&self, after_sequence: Option<u32>) -> NapiResult<Vec<NativeStoredEvent>> {
        self.runtime
            .block_on(
                self.store
                    .load_all_after(after_sequence.unwrap_or(0) as u64),
            )
            .map(|events| events.into_iter().map(NativeStoredEvent::from).collect())
            .map_err(to_napi_error)
    }

    #[napi]
    pub fn append(
        &self,
        stream_id: String,
        version: u32,
        events: Vec<NativeEventInput>,
    ) -> NapiResult<Vec<NativeStoredEvent>> {
        let native_events = events
            .into_iter()
            .map(TryInto::try_into)
            .collect::<Result<Vec<_>, _>>()
            .map_err(to_napi_error)?;

        self.runtime
            .block_on(self.store.append(&stream_id, version as u64, native_events))
            .map(|items| items.into_iter().map(NativeStoredEvent::from).collect())
            .map_err(to_napi_error)
    }

    #[napi(js_name = "latestVersion")]
    pub fn latest_version(&self, stream_id: String) -> NapiResult<u32> {
        self.runtime
            .block_on(self.store.latest_version(&stream_id))
            .map(|version| version as u32)
            .map_err(to_napi_error)
    }

    #[napi(js_name = "saveCheckpoint")]
    pub fn save_checkpoint(&self, checkpoint: NativeProjectionCheckpoint) -> NapiResult<()> {
        self.runtime
            .block_on(
                self.checkpoints
                    .save(&ProjectionCheckpoint::from(checkpoint)),
            )
            .map_err(to_napi_error)
    }

    #[napi(js_name = "resetCheckpoint")]
    pub fn reset_checkpoint(&self, projector: String) -> NapiResult<()> {
        self.runtime
            .block_on(self.checkpoints.reset(&projector))
            .map_err(to_napi_error)
    }
}

#[napi]
pub fn connect_native_runtime(database_url: String) -> NapiResult<NativeEzormRuntime> {
    let runtime = Runtime::new().map_err(to_napi_error)?;
    let store = runtime
        .block_on(SqlEventStore::connect(&database_url))
        .map_err(to_napi_error)?;
    let checkpoints = runtime
        .block_on(SqlCheckpointStore::connect(&database_url))
        .map_err(to_napi_error)?;

    Ok(NativeEzormRuntime {
        runtime,
        store,
        checkpoints,
    })
}

impl TryFrom<NativeEventInput> for NewEvent {
    type Error = serde_json::Error;

    fn try_from(value: NativeEventInput) -> Result<Self, Self::Error> {
        Ok(Self {
            event_type: value.event_type,
            payload: serde_json::from_str(&value.payload_json)?,
            schema_version: value.schema_version,
            metadata: value
                .metadata_json
                .map(|item| serde_json::from_str(&item))
                .transpose()?,
        })
    }
}

impl From<EventRecord> for NativeStoredEvent {
    fn from(value: EventRecord) -> Self {
        Self {
            stream_id: value.stream_id,
            version: value.version as u32,
            sequence: value.sequence as u32,
            event_type: value.event_type,
            payload_json: serde_json::to_string(&value.payload)
                .expect("event payload should always serialize"),
            schema_version: value.schema_version,
            metadata_json: value
                .metadata
                .map(|item| serde_json::to_string(&item).expect("metadata should serialize")),
        }
    }
}

impl From<ProjectionCheckpoint> for NativeProjectionCheckpoint {
    fn from(value: ProjectionCheckpoint) -> Self {
        Self {
            projector: value.projector,
            last_sequence: value.last_sequence as u32,
        }
    }
}

impl From<NativeProjectionCheckpoint> for ProjectionCheckpoint {
    fn from(value: NativeProjectionCheckpoint) -> Self {
        Self {
            projector: value.projector,
            last_sequence: value.last_sequence as u64,
        }
    }
}

fn to_napi_error(error: impl std::fmt::Display) -> Error {
    Error::from_reason(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_binding_manifest() {
        let manifest = NodeBindingManifest::new("aarch64-apple-darwin");
        assert_eq!(manifest.package_name, "@ezorm/runtime-node");
    }

    #[test]
    fn converts_native_events_to_store_events() {
        let event = NewEvent::try_from(NativeEventInput {
            event_type: "account.opened".into(),
            payload_json: "{\"owner\":\"alice\"}".into(),
            schema_version: 1,
            metadata_json: Some("{\"source\":\"test\"}".into()),
        })
        .unwrap();

        assert_eq!(event.event_type, "account.opened");
        assert_eq!(event.schema_version, 1);
        assert_eq!(event.payload["owner"], "alice");
        assert_eq!(event.metadata.unwrap()["source"], "test");
    }

    #[test]
    fn converts_projection_checkpoints() {
        let checkpoint = ProjectionCheckpoint::from(NativeProjectionCheckpoint {
            projector: "balances".into(),
            last_sequence: 7,
        });

        assert_eq!(checkpoint.projector, "balances");
        assert_eq!(checkpoint.last_sequence, 7);
        assert_eq!(
            NativeProjectionCheckpoint::from(checkpoint).last_sequence,
            7
        );
    }
}
