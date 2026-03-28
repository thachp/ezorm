use napi::bindgen_prelude::Result as NapiResult;
use napi::Error;
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use sqlmodel_event_store::{EventRecord, NewEvent, SqlEventStore};
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
            package_name: "@sqlmodel/runtime-node".into(),
            binary_name: "sqlmodel_napi".into(),
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

#[napi]
pub struct NativeSqlModelRuntime {
    runtime: Runtime,
    store: SqlEventStore,
}

#[napi]
impl NativeSqlModelRuntime {
    #[napi]
    pub fn bootstrap(&self) -> NapiResult<()> {
        self.runtime
            .block_on(self.store.bootstrap())
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
            .block_on(self.store.load_all_after(after_sequence.unwrap_or(0) as u64))
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
}

#[napi]
pub fn connect_native_runtime(database_url: String) -> NapiResult<NativeSqlModelRuntime> {
    let runtime = Runtime::new().map_err(to_napi_error)?;
    let store = runtime
        .block_on(SqlEventStore::connect(&database_url))
        .map_err(to_napi_error)?;

    Ok(NativeSqlModelRuntime { runtime, store })
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

fn to_napi_error(error: impl std::fmt::Display) -> Error {
    Error::from_reason(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_binding_manifest() {
        let manifest = NodeBindingManifest::new("aarch64-apple-darwin");
        assert_eq!(manifest.package_name, "@sqlmodel/runtime-node");
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
}
