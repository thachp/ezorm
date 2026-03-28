use serde::{Deserialize, Serialize};
use sqlmodel_event_store::{EventRecord, NewEvent};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoadStreamRequest {
    pub stream_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppendEventsRequest {
    pub stream_id: String,
    pub expected_version: u64,
    pub events: Vec<NewEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppendEventsResponse {
    pub events: Vec<EventRecord>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_proxy_contracts() {
        let request = AppendEventsRequest {
            stream_id: "account-1".into(),
            expected_version: 0,
            events: vec![NewEvent {
                event_type: "opened".into(),
                payload: json!({}),
                schema_version: 1,
                metadata: None,
            }],
        };

        let encoded = serde_json::to_string(&request).unwrap();
        assert!(encoded.contains("\"expected_version\":0"));
    }
}

