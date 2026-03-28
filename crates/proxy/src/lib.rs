use axum::{
    extract::{rejection::JsonRejection, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use ezorm_orm_runtime::{
    OrmFindManyOptions, OrmModelMetadata, OrmRuntimeError, RelationalPoolOptions, SqlOrmRuntime,
    TableSchema,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ErrorResponse {
    pub code: String,
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ProxyHttpError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Internal(String),
}

#[derive(Debug, Clone)]
struct OrmProxyState {
    runtime: SqlOrmRuntime,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrmCreateRequest {
    pub model: OrmModelMetadata,
    pub input: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrmFindByIdRequest {
    pub model: OrmModelMetadata,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrmFindManyRequest {
    pub model: OrmModelMetadata,
    #[serde(default)]
    pub options: Option<OrmFindManyOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrmUpdateRequest {
    pub model: OrmModelMetadata,
    pub id: String,
    pub input: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrmDeleteRequest {
    pub model: OrmModelMetadata,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PushSchemaRequest {
    pub models: Vec<OrmModelMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PushSchemaResponse {
    pub statements: Vec<String>,
}

pub async fn create_proxy_app(
    database_url: &str,
    pool_options: Option<RelationalPoolOptions>,
) -> Result<Router, ProxyHttpError> {
    let runtime = SqlOrmRuntime::connect(database_url, pool_options).await?;
    Ok(create_router(runtime))
}

pub fn create_router(runtime: SqlOrmRuntime) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/orm/create", post(orm_create))
        .route("/orm/find-by-id", post(orm_find_by_id))
        .route("/orm/find-many", post(orm_find_many))
        .route("/orm/update", post(orm_update))
        .route("/orm/delete", post(orm_delete))
        .route("/orm/schema/push", post(push_schema))
        .route("/orm/schema/pull", post(pull_schema))
        .with_state(OrmProxyState { runtime })
}

impl IntoResponse for ProxyHttpError {
    fn into_response(self) -> Response {
        let (status, body) = match self {
            Self::BadRequest(message) => (
                StatusCode::BAD_REQUEST,
                ErrorResponse {
                    code: "bad_request".into(),
                    message,
                },
            ),
            Self::NotFound(message) => (
                StatusCode::NOT_FOUND,
                ErrorResponse {
                    code: "not_found".into(),
                    message,
                },
            ),
            Self::Internal(message) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                ErrorResponse {
                    code: "internal_error".into(),
                    message,
                },
            ),
        };

        (status, Json(body)).into_response()
    }
}

impl From<OrmRuntimeError> for ProxyHttpError {
    fn from(error: OrmRuntimeError) -> Self {
        match error {
            OrmRuntimeError::UnsupportedDatabaseUrl(database_url) => {
                Self::BadRequest(format!("unsupported database url `{database_url}`"))
            }
            OrmRuntimeError::UnsupportedDialect(dialect) => {
                Self::BadRequest(format!("unsupported database dialect `{dialect}`"))
            }
            OrmRuntimeError::RecordNotFound(record_id) => {
                Self::NotFound(format!("record `{record_id}` does not exist"))
            }
            OrmRuntimeError::InvalidPrimaryKey(model) => {
                Self::BadRequest(format!(
                    "model `{model}` must declare exactly one primary key field"
                ))
            }
            OrmRuntimeError::UnknownField { model, field } => {
                Self::BadRequest(format!("model `{model}` references unknown field `{field}`"))
            }
            OrmRuntimeError::UnknownRelationTarget { model, target } => {
                Self::BadRequest(format!(
                    "model `{model}` references unknown relation target `{target}`"
                ))
            }
            OrmRuntimeError::Sqlx(error) => Self::Internal(error.to_string()),
            OrmRuntimeError::Serde(error) => Self::Internal(error.to_string()),
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

async fn orm_create(
    State(state): State<OrmProxyState>,
    payload: Result<Json<OrmCreateRequest>, JsonRejection>,
) -> Result<StatusCode, ProxyHttpError> {
    let Json(payload) = payload.map_err(ProxyHttpError::from)?;
    state.runtime.create(&payload.model, &payload.input).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn orm_find_by_id(
    State(state): State<OrmProxyState>,
    payload: Result<Json<OrmFindByIdRequest>, JsonRejection>,
) -> Result<Json<Option<serde_json::Map<String, serde_json::Value>>>, ProxyHttpError> {
    let Json(payload) = payload.map_err(ProxyHttpError::from)?;
    let record = state.runtime.find_by_id(&payload.model, &payload.id).await?;
    Ok(Json(record))
}

async fn orm_find_many(
    State(state): State<OrmProxyState>,
    payload: Result<Json<OrmFindManyRequest>, JsonRejection>,
) -> Result<Json<Vec<serde_json::Map<String, serde_json::Value>>>, ProxyHttpError> {
    let Json(payload) = payload.map_err(ProxyHttpError::from)?;
    let records = state.runtime.find_many(&payload.model, payload.options).await?;
    Ok(Json(records))
}

async fn orm_update(
    State(state): State<OrmProxyState>,
    payload: Result<Json<OrmUpdateRequest>, JsonRejection>,
) -> Result<StatusCode, ProxyHttpError> {
    let Json(payload) = payload.map_err(ProxyHttpError::from)?;
    state
        .runtime
        .update(&payload.model, &payload.id, &payload.input)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn orm_delete(
    State(state): State<OrmProxyState>,
    payload: Result<Json<OrmDeleteRequest>, JsonRejection>,
) -> Result<StatusCode, ProxyHttpError> {
    let Json(payload) = payload.map_err(ProxyHttpError::from)?;
    state.runtime.delete(&payload.model, &payload.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn push_schema(
    State(state): State<OrmProxyState>,
    payload: Result<Json<PushSchemaRequest>, JsonRejection>,
) -> Result<Json<PushSchemaResponse>, ProxyHttpError> {
    let Json(payload) = payload.map_err(ProxyHttpError::from)?;
    let statements = state.runtime.push_schema(&payload.models).await?;
    Ok(Json(PushSchemaResponse { statements }))
}

async fn pull_schema(
    State(state): State<OrmProxyState>,
    payload: Result<Json<serde_json::Value>, JsonRejection>,
) -> Result<Json<Vec<TableSchema>>, ProxyHttpError> {
    let Json(_payload) = payload.map_err(ProxyHttpError::from)?;
    let schema = state.runtime.pull_schema().await?;
    Ok(Json(schema))
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

    #[tokio::test]
    async fn healthcheck_reports_ready() {
        let app = create_proxy_app("sqlite::memory:", None).await.unwrap();

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
    async fn proxy_serves_repository_crud_and_schema_routes() {
        let app = create_proxy_app("sqlite::memory:", None).await.unwrap();
        let model = user_model_metadata();

        let push_response = app
            .clone()
            .oneshot(json_request(
                "/orm/schema/push",
                json!({ "models": [model.clone()] }),
            ))
            .await
            .unwrap();
        let push_body: PushSchemaResponse = read_json(push_response).await;
        assert!(!push_body.statements.is_empty());

        let create_response = app
            .clone()
            .oneshot(json_request(
                "/orm/create",
                json!({
                    "model": model.clone(),
                    "input": {
                        "id": "usr_1",
                        "email": "alice@example.com",
                        "active": true
                    }
                }),
            ))
            .await
            .unwrap();
        assert_eq!(create_response.status(), StatusCode::NO_CONTENT);

        let find_many_response = app
            .clone()
            .oneshot(json_request(
                "/orm/find-many",
                json!({
                    "model": model.clone(),
                    "options": {
                        "where": { "email": "alice@example.com" },
                        "orderBy": { "field": "email", "direction": "asc" }
                    }
                }),
            ))
            .await
            .unwrap();
        let records: Vec<serde_json::Map<String, serde_json::Value>> =
            read_json(find_many_response).await;
        assert_eq!(records.len(), 1);

        let update_response = app
            .clone()
            .oneshot(json_request(
                "/orm/update",
                json!({
                    "model": model.clone(),
                    "id": "usr_1",
                    "input": {
                        "id": "usr_1",
                        "email": "updated@example.com",
                        "active": false
                    }
                }),
            ))
            .await
            .unwrap();
        assert_eq!(update_response.status(), StatusCode::NO_CONTENT);

        let find_response = app
            .clone()
            .oneshot(json_request(
                "/orm/find-by-id",
                json!({
                    "model": model.clone(),
                    "id": "usr_1"
                }),
            ))
            .await
            .unwrap();
        let record: Option<serde_json::Map<String, serde_json::Value>> = read_json(find_response).await;
        let record = record.unwrap();
        assert_eq!(
            record.get("email"),
            Some(&serde_json::Value::String("updated@example.com".into()))
        );
        assert_eq!(record.get("active"), Some(&serde_json::Value::Bool(false)));

        let delete_response = app
            .clone()
            .oneshot(json_request(
                "/orm/delete",
                json!({
                    "model": model.clone(),
                    "id": "usr_1"
                }),
            ))
            .await
            .unwrap();
        assert_eq!(delete_response.status(), StatusCode::NO_CONTENT);

        let deleted_response = app
            .clone()
            .oneshot(json_request(
                "/orm/find-by-id",
                json!({
                    "model": model,
                    "id": "usr_1"
                }),
            ))
            .await
            .unwrap();
        let deleted: Option<serde_json::Map<String, serde_json::Value>> = read_json(deleted_response).await;
        assert!(deleted.is_none());

        let pull_response = app
            .oneshot(json_request("/orm/schema/pull", json!({})))
            .await
            .unwrap();
        let schema: Vec<TableSchema> = read_json(pull_response).await;
        assert_eq!(schema.len(), 1);
        assert_eq!(schema[0].name, "users");
    }

    #[tokio::test]
    async fn proxy_maps_missing_records_to_404() {
        let app = create_proxy_app("sqlite::memory:", None).await.unwrap();
        let model = user_model_metadata();

        app.clone()
            .oneshot(json_request(
                "/orm/schema/push",
                json!({ "models": [model.clone()] }),
            ))
            .await
            .unwrap();

        let response = app
            .oneshot(json_request(
                "/orm/update",
                json!({
                    "model": model,
                    "id": "missing",
                    "input": {
                        "id": "missing",
                        "email": "missing@example.com",
                        "active": true
                    }
                }),
            ))
            .await
            .unwrap();
        let status = response.status();
        let body: ErrorResponse = read_json(response).await;

        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body.code, "not_found");
    }

    #[tokio::test]
    async fn end_to_end_http_service_serves_runtime_routes() {
        let app = create_proxy_app("sqlite::memory:", None).await.unwrap();
        let (address, server) = spawn_test_server(app).await;
        let client = reqwest::Client::new();
        let model = json!({
            "name": "User",
            "table": "users",
            "fields": [
                { "name": "id", "type": "string", "primaryKey": true },
                { "name": "email", "type": "string" },
                { "name": "active", "type": "boolean", "defaultValue": true }
            ],
            "indices": [],
            "relations": []
        });

        let push_response = client
            .post(format!("http://{address}/orm/schema/push"))
            .json(&json!({ "models": [model.clone()] }))
            .send()
            .await
            .unwrap();
        assert!(push_response.status().is_success());

        let create_response = client
            .post(format!("http://{address}/orm/create"))
            .json(&json!({
                "model": model.clone(),
                "input": {
                    "id": "usr_1",
                    "email": "alice@example.com",
                    "active": true
                }
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(create_response.status(), StatusCode::NO_CONTENT);

        let find_many_response = client
            .post(format!("http://{address}/orm/find-many"))
            .json(&json!({
                "model": model,
                "options": {
                    "where": { "email": "alice@example.com" }
                }
            }))
            .send()
            .await
            .unwrap();
        let find_many_body: Vec<serde_json::Map<String, serde_json::Value>> =
            find_many_response.json().await.unwrap();

        server.abort();

        assert_eq!(find_many_body.len(), 1);
        assert_eq!(
            find_many_body[0].get("email"),
            Some(&serde_json::Value::String("alice@example.com".into()))
        );
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

    fn user_model_metadata() -> OrmModelMetadata {
        OrmModelMetadata {
            name: "User".into(),
            table: "users".into(),
            fields: vec![
                ezorm_orm_runtime::OrmFieldMetadata {
                    name: "id".into(),
                    field_type: "string".into(),
                    nullable: false,
                    default_value: None,
                    primary_key: true,
                },
                ezorm_orm_runtime::OrmFieldMetadata {
                    name: "email".into(),
                    field_type: "string".into(),
                    nullable: false,
                    default_value: None,
                    primary_key: false,
                },
                ezorm_orm_runtime::OrmFieldMetadata {
                    name: "active".into(),
                    field_type: "boolean".into(),
                    nullable: false,
                    default_value: Some(serde_json::Value::Bool(true)),
                    primary_key: false,
                },
            ],
            indices: vec![],
            relations: vec![],
        }
    }
}
