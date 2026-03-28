use axum::{
    extract::{rejection::JsonRejection, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use ezorm_event_store::{EventRecord, EventStoreError, NewEvent, SqlEventStore};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoadStreamRequest {
    pub stream_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoadStreamResponse {
    pub events: Vec<EventRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoadAllEventsRequest {
    #[serde(default)]
    pub after_sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoadAllEventsResponse {
    pub events: Vec<EventRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppendEventsRequest {
    pub stream_id: String,
    pub version: u64,
    pub events: Vec<NewEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppendEventsResponse {
    pub events: Vec<EventRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LatestVersionRequest {
    pub stream_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LatestVersionResponse {
    pub version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDetails {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_version: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ErrorResponse {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<ErrorDetails>,
}

#[derive(Debug, thiserror::Error)]
pub enum ProxyHttpError {
    #[error("{0}")]
    BadRequest(String),
    #[error("version conflict for stream `{stream_id}`: expected {expected_version}, actual {actual_version}")]
    VersionConflict {
        stream_id: String,
        expected_version: u64,
        actual_version: u64,
    },
    #[error("{0}")]
    Internal(String),
}

#[derive(Debug, Clone)]
struct ProxyState {
    store: SqlEventStore,
}

pub async fn create_proxy_app(database_url: &str) -> Result<Router, ProxyHttpError> {
    let store = SqlEventStore::connect(database_url).await?;
    store.bootstrap().await?;
    Ok(create_router(store))
}

pub fn create_router(store: SqlEventStore) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/events/load", post(load_events))
        .route("/events/load-all", post(load_all_events))
        .route("/events/append", post(append_events))
        .route("/events/latest-version", post(latest_version))
        .with_state(ProxyState { store })
}

impl IntoResponse for ProxyHttpError {
    fn into_response(self) -> Response {
        let (status, body) = match self {
            Self::BadRequest(message) => (
                StatusCode::BAD_REQUEST,
                ErrorResponse {
                    code: "bad_request".into(),
                    message,
                    details: None,
                },
            ),
            Self::VersionConflict {
                stream_id,
                expected_version,
                actual_version,
            } => (
                StatusCode::CONFLICT,
                ErrorResponse {
                    code: "version_conflict".into(),
                    message: format!(
                        "Version conflict for {stream_id}: expected {expected_version}, actual {actual_version}"
                    ),
                    details: Some(ErrorDetails {
                        stream_id: Some(stream_id),
                        expected_version: Some(expected_version),
                        actual_version: Some(actual_version),
                    }),
                },
            ),
            Self::Internal(message) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                ErrorResponse {
                    code: "internal_error".into(),
                    message,
                    details: None,
                },
            ),
        };

        (status, Json(body)).into_response()
    }
}

impl From<EventStoreError> for ProxyHttpError {
    fn from(error: EventStoreError) -> Self {
        match error {
            EventStoreError::VersionConflict {
                stream_id,
                expected_version,
                actual_version,
            } => Self::VersionConflict {
                stream_id,
                expected_version,
                actual_version,
            },
            EventStoreError::UnsupportedDatabaseUrl(database_url) => {
                Self::BadRequest(format!("unsupported database url `{database_url}`"))
            }
            EventStoreError::Sqlx(error) => Self::Internal(error.to_string()),
            EventStoreError::Serde(error) => Self::Internal(error.to_string()),
        }
    }
}

impl From<JsonRejection> for ProxyHttpError {
    fn from(rejection: JsonRejection) -> Self {
        Self::BadRequest(rejection.body_text())
    }
}

async fn health() -> StatusCode {
    StatusCode::OK
}

async fn load_events(
    State(state): State<ProxyState>,
    payload: Result<Json<LoadStreamRequest>, JsonRejection>,
) -> Result<Json<LoadStreamResponse>, ProxyHttpError> {
    let Json(payload) = payload.map_err(ProxyHttpError::from)?;
    let events = state.store.load_stream(&payload.stream_id).await?;
    Ok(Json(LoadStreamResponse { events }))
}

async fn load_all_events(
    State(state): State<ProxyState>,
    payload: Result<Json<LoadAllEventsRequest>, JsonRejection>,
) -> Result<Json<LoadAllEventsResponse>, ProxyHttpError> {
    let Json(payload) = payload.map_err(ProxyHttpError::from)?;
    let events = state.store.load_all_after(payload.after_sequence).await?;
    Ok(Json(LoadAllEventsResponse { events }))
}

async fn append_events(
    State(state): State<ProxyState>,
    payload: Result<Json<AppendEventsRequest>, JsonRejection>,
) -> Result<Json<AppendEventsResponse>, ProxyHttpError> {
    let Json(payload) = payload.map_err(ProxyHttpError::from)?;
    let events = state
        .store
        .append(&payload.stream_id, payload.version, payload.events)
        .await?;
    Ok(Json(AppendEventsResponse { events }))
}

async fn latest_version(
    State(state): State<ProxyState>,
    payload: Result<Json<LatestVersionRequest>, JsonRejection>,
) -> Result<Json<LatestVersionResponse>, ProxyHttpError> {
    let Json(payload) = payload.map_err(ProxyHttpError::from)?;
    let version = state.store.latest_version(&payload.stream_id).await?;
    Ok(Json(LatestVersionResponse { version }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use serde::de::DeserializeOwned;
    use serde_json::json;
    use std::net::SocketAddr;
    use tokio::{net::TcpListener, task::JoinHandle};
    use tower::ServiceExt;

    #[test]
    fn serializes_proxy_contracts() {
        let append_request = AppendEventsRequest {
            stream_id: "account-1".into(),
            version: 0,
            events: vec![NewEvent {
                event_type: "opened".into(),
                payload: json!({}),
                schema_version: 1,
                metadata: None,
            }],
        };
        let latest_version_response = LatestVersionResponse { version: 3 };

        let encoded_request = serde_json::to_string(&append_request).unwrap();
        let encoded_response = serde_json::to_string(&latest_version_response).unwrap();
        let decoded_request: AppendEventsRequest = serde_json::from_str(&encoded_request).unwrap();
        let decoded_response: LatestVersionResponse =
            serde_json::from_str(&encoded_response).unwrap();

        assert!(encoded_request.contains("\"streamId\":\"account-1\""));
        assert!(encoded_request.contains("\"version\":0"));
        assert_eq!(decoded_request, append_request);
        assert_eq!(decoded_response, latest_version_response);
    }

    #[tokio::test]
    async fn startup_bootstraps_schema() {
        let app = create_proxy_app("sqlite::memory:").await.unwrap();

        let response = app
            .oneshot(json_request(
                "/events/load",
                json!({ "streamId": "account-1" }),
            ))
            .await
            .unwrap();
        let body: LoadStreamResponse = read_json(response).await;

        assert!(body.events.is_empty());
    }

    #[tokio::test]
    async fn healthcheck_reports_ready() {
        let app = create_proxy_app("sqlite::memory:").await.unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn load_returns_ordered_stream_events() {
        let app = create_proxy_app("sqlite::memory:").await.unwrap();

        let append_response = app
            .clone()
            .oneshot(json_request(
                "/events/append",
                json!({
                    "streamId": "account-1",
                    "version": 0,
                    "events": [
                        {
                            "event_type": "opened",
                            "payload": {},
                            "schema_version": 1,
                            "metadata": null
                        },
                        {
                            "event_type": "deposited",
                            "payload": { "amount": 10 },
                            "schema_version": 1,
                            "metadata": null
                        }
                    ]
                }),
            ))
            .await
            .unwrap();
        let appended: AppendEventsResponse = read_json(append_response).await;

        let load_response = app
            .oneshot(json_request(
                "/events/load",
                json!({ "streamId": "account-1" }),
            ))
            .await
            .unwrap();
        let loaded: LoadStreamResponse = read_json(load_response).await;

        assert_eq!(appended.events.len(), 2);
        assert_eq!(loaded.events.len(), 2);
        assert_eq!(loaded.events[0].event_type, "opened");
        assert_eq!(loaded.events[0].version, 1);
        assert_eq!(loaded.events[1].event_type, "deposited");
        assert_eq!(loaded.events[1].version, 2);
    }

    #[tokio::test]
    async fn load_all_filters_by_sequence() {
        let app = create_proxy_app("sqlite::memory:").await.unwrap();

        app.clone()
            .oneshot(json_request(
                "/events/append",
                json!({
                    "streamId": "account-1",
                    "version": 0,
                    "events": [
                        {
                            "event_type": "opened",
                            "payload": {},
                            "schema_version": 1,
                            "metadata": null
                        }
                    ]
                }),
            ))
            .await
            .unwrap();

        app.clone()
            .oneshot(json_request(
                "/events/append",
                json!({
                    "streamId": "account-2",
                    "version": 0,
                    "events": [
                        {
                            "event_type": "opened",
                            "payload": { "owner": "alice" },
                            "schema_version": 1,
                            "metadata": null
                        }
                    ]
                }),
            ))
            .await
            .unwrap();

        let response = app
            .oneshot(json_request(
                "/events/load-all",
                json!({ "afterSequence": 1 }),
            ))
            .await
            .unwrap();
        let body: LoadAllEventsResponse = read_json(response).await;

        assert_eq!(body.events.len(), 1);
        assert_eq!(body.events[0].stream_id, "account-2");
        assert_eq!(body.events[0].sequence, 2);
    }

    #[tokio::test]
    async fn append_returns_stored_events_with_versions_and_sequences() {
        let app = create_proxy_app("sqlite::memory:").await.unwrap();

        let response = app
            .oneshot(json_request(
                "/events/append",
                json!({
                    "streamId": "account-1",
                    "version": 0,
                    "events": [
                        {
                            "event_type": "opened",
                            "payload": {},
                            "schema_version": 1,
                            "metadata": null
                        }
                    ]
                }),
            ))
            .await
            .unwrap();
        let body: AppendEventsResponse = read_json(response).await;

        assert_eq!(body.events.len(), 1);
        assert_eq!(body.events[0].stream_id, "account-1");
        assert_eq!(body.events[0].version, 1);
        assert_eq!(body.events[0].sequence, 1);
    }

    #[tokio::test]
    async fn latest_version_returns_zero_for_empty_streams_and_current_version_otherwise() {
        let app = create_proxy_app("sqlite::memory:").await.unwrap();

        let empty_response = app
            .clone()
            .oneshot(json_request(
                "/events/latest-version",
                json!({ "streamId": "account-1" }),
            ))
            .await
            .unwrap();
        let empty: LatestVersionResponse = read_json(empty_response).await;

        app.clone()
            .oneshot(json_request(
                "/events/append",
                json!({
                    "streamId": "account-1",
                    "version": 0,
                    "events": [
                        {
                            "event_type": "opened",
                            "payload": {},
                            "schema_version": 1,
                            "metadata": null
                        }
                    ]
                }),
            ))
            .await
            .unwrap();

        let loaded_response = app
            .oneshot(json_request(
                "/events/latest-version",
                json!({ "streamId": "account-1" }),
            ))
            .await
            .unwrap();
        let loaded: LatestVersionResponse = read_json(loaded_response).await;

        assert_eq!(empty.version, 0);
        assert_eq!(loaded.version, 1);
    }

    #[tokio::test]
    async fn version_conflicts_return_409() {
        let app = create_proxy_app("sqlite::memory:").await.unwrap();

        app.clone()
            .oneshot(json_request(
                "/events/append",
                json!({
                    "streamId": "account-1",
                    "version": 0,
                    "events": [
                        {
                            "event_type": "opened",
                            "payload": {},
                            "schema_version": 1,
                            "metadata": null
                        }
                    ]
                }),
            ))
            .await
            .unwrap();

        let response = app
            .oneshot(json_request(
                "/events/append",
                json!({
                    "streamId": "account-1",
                    "version": 0,
                    "events": [
                        {
                            "event_type": "deposited",
                            "payload": { "amount": 10 },
                            "schema_version": 1,
                            "metadata": null
                        }
                    ]
                }),
            ))
            .await
            .unwrap();
        let status = response.status();
        let body: ErrorResponse = read_json(response).await;

        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body.code, "version_conflict");
        assert_eq!(
            body.details,
            Some(ErrorDetails {
                stream_id: Some("account-1".into()),
                expected_version: Some(0),
                actual_version: Some(1),
            })
        );
    }

    #[tokio::test]
    async fn end_to_end_http_service_serves_runtime_routes() {
        let app = create_proxy_app("sqlite::memory:").await.unwrap();
        let (address, server) = spawn_test_server(app).await;
        let client = reqwest::Client::new();

        let append_response = client
            .post(format!("http://{address}/events/append"))
            .json(&json!({
                "streamId": "account-1",
                "version": 0,
                "events": [
                    {
                        "event_type": "opened",
                        "payload": {},
                        "schema_version": 1,
                        "metadata": null
                    }
                ]
            }))
            .send()
            .await
            .unwrap();
        let append_body: AppendEventsResponse = append_response.json().await.unwrap();

        let version_response = client
            .post(format!("http://{address}/events/latest-version"))
            .json(&json!({ "streamId": "account-1" }))
            .send()
            .await
            .unwrap();
        let version_body: LatestVersionResponse = version_response.json().await.unwrap();

        server.abort();

        assert_eq!(append_body.events[0].stream_id, "account-1");
        assert_eq!(version_body.version, 1);
    }

    fn json_request(path: &str, body: serde_json::Value) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    async fn read_json<T: DeserializeOwned>(response: Response) -> T {
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    async fn spawn_test_server(app: Router) -> (SocketAddr, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        (address, server)
    }
}
