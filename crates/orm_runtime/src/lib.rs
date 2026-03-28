use std::{collections::{BTreeMap, HashMap}, time::Duration};

use ezorm_dialects::SqlDialect;
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value};
use sqlx::{
    mysql::{MySqlArguments, MySqlPoolOptions, MySqlRow},
    postgres::{PgArguments, PgPoolOptions, PgRow},
    query::Query,
    sqlite::{SqliteArguments, SqlitePoolOptions, SqliteRow},
    MySql, MySqlPool, PgPool, Postgres, Row, Sqlite, SqlitePool,
};
use thiserror::Error;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RelationalPoolOptions {
    pub min_connections: Option<u32>,
    pub max_connections: Option<u32>,
    pub acquire_timeout_ms: Option<u64>,
    pub idle_timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OrmModelMetadata {
    pub name: String,
    pub table: String,
    pub fields: Vec<OrmFieldMetadata>,
    pub indices: Vec<OrmIndexMetadata>,
    pub relations: Vec<OrmRelationMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrmFieldMetadata {
    pub name: String,
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default)]
    pub nullable: bool,
    #[serde(default)]
    pub default_value: Option<Value>,
    #[serde(default)]
    pub primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrmIndexMetadata {
    pub name: Option<String>,
    pub fields: Vec<String>,
    #[serde(default)]
    pub unique: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OrmRelationMetadata {
    pub kind: String,
    pub name: String,
    pub target_model: String,
    #[serde(default)]
    pub foreign_key: Option<String>,
    #[serde(default)]
    pub target_key: Option<String>,
    #[serde(default)]
    pub local_key: Option<String>,
    #[serde(default)]
    pub through_table: Option<String>,
    #[serde(default)]
    pub source_key: Option<String>,
    #[serde(default)]
    pub through_source_key: Option<String>,
    #[serde(default)]
    pub through_target_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrmFindManyOptions {
    #[serde(default, rename = "where", alias = "whereClause")]
    pub where_clause: Option<BTreeMap<String, Value>>,
    #[serde(default)]
    pub order_by: Option<OrmOrderBy>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrmOrderBy {
    pub field: String,
    #[serde(default = "default_sort_direction")]
    pub direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TableSchema {
    pub name: String,
    pub columns: Vec<TableColumnSchema>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableColumnSchema {
    pub name: String,
    #[serde(rename = "type")]
    pub type_name: String,
    pub not_null: bool,
    pub primary_key: bool,
}

#[derive(Debug, Error)]
pub enum OrmRuntimeError {
    #[error("unsupported database url `{0}`")]
    UnsupportedDatabaseUrl(String),
    #[error("unsupported database dialect `{0}`")]
    UnsupportedDialect(String),
    #[error("model `{0}` must declare exactly one primary key field")]
    InvalidPrimaryKey(String),
    #[error("model `{model}` references unknown field `{field}`")]
    UnknownField { model: String, field: String },
    #[error("model `{model}` references unknown relation target `{target}`")]
    UnknownRelationTarget { model: String, target: String },
    #[error("record `{0}` does not exist")]
    RecordNotFound(String),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Serde(#[from] serde_json::Error),
}

#[derive(Debug, Clone)]
pub struct SqlOrmRuntime {
    pool: RelationalPool,
    dialect: SqlDialect,
}

#[derive(Debug, Clone)]
enum RelationalPool {
    Sqlite(SqlitePool),
    Postgres(PgPool),
    Mysql(MySqlPool),
}

impl SqlOrmRuntime {
    pub async fn connect(
        database_url: &str,
        pool_options: Option<RelationalPoolOptions>,
    ) -> Result<Self, OrmRuntimeError> {
        let dialect = dialect_from_url(database_url)?;
        let pool_options = pool_options.unwrap_or_default();
        let pool = match dialect {
            SqlDialect::Sqlite => RelationalPool::Sqlite(
                apply_sqlite_pool_options(SqlitePoolOptions::new(), &pool_options)
                    .max_connections(pool_options.max_connections.unwrap_or(1))
                    .connect(database_url)
                    .await?,
            ),
            SqlDialect::Postgres => RelationalPool::Postgres(
                apply_pg_pool_options(PgPoolOptions::new(), &pool_options)
                    .max_connections(pool_options.max_connections.unwrap_or(5))
                    .connect(database_url)
                    .await?,
            ),
            SqlDialect::Mysql => RelationalPool::Mysql(
                apply_mysql_pool_options(MySqlPoolOptions::new(), &pool_options)
                    .max_connections(pool_options.max_connections.unwrap_or(5))
                    .connect(database_url)
                    .await?,
            ),
        };

        Ok(Self { pool, dialect })
    }

    pub fn dialect(&self) -> SqlDialect {
        self.dialect
    }

    pub async fn create(
        &self,
        model: &OrmModelMetadata,
        input: &JsonMap<String, Value>,
    ) -> Result<(), OrmRuntimeError> {
        let sql = insert_sql(self.dialect, model);

        match &self.pool {
            RelationalPool::Sqlite(pool) => {
                let mut query = sqlx::query(&sql);
                for field in &model.fields {
                    let value = input.get(&field.name).unwrap_or(&Value::Null);
                    query = bind_sqlite_query(query, field, value)?;
                }
                query.execute(pool).await?;
            }
            RelationalPool::Postgres(pool) => {
                let mut query = sqlx::query(&sql);
                for field in &model.fields {
                    let value = input.get(&field.name).unwrap_or(&Value::Null);
                    query = bind_postgres_query(query, field, value)?;
                }
                query.execute(pool).await?;
            }
            RelationalPool::Mysql(pool) => {
                let mut query = sqlx::query(&sql);
                for field in &model.fields {
                    let value = input.get(&field.name).unwrap_or(&Value::Null);
                    query = bind_mysql_query(query, field, value)?;
                }
                query.execute(pool).await?;
            }
        }

        Ok(())
    }

    pub async fn find_by_id(
        &self,
        model: &OrmModelMetadata,
        id: &str,
    ) -> Result<Option<JsonMap<String, Value>>, OrmRuntimeError> {
        let primary_key = primary_key_field(model)?;
        let sql = format!(
            "SELECT * FROM {} WHERE {} = {}",
            quote_identifier(self.dialect, &model.table),
            quote_identifier(self.dialect, &primary_key.name),
            placeholder(self.dialect, 1)
        );

        match &self.pool {
            RelationalPool::Sqlite(pool) => {
                let row = bind_sqlite_query(sqlx::query(&sql), primary_key, &Value::String(id.into()))?
                    .fetch_optional(pool)
                    .await?;
                row.map(|item| row_to_value_sqlite(model, item)).transpose()
            }
            RelationalPool::Postgres(pool) => {
                let row =
                    bind_postgres_query(sqlx::query(&sql), primary_key, &Value::String(id.into()))?
                        .fetch_optional(pool)
                        .await?;
                row.map(|item| row_to_value_postgres(model, item)).transpose()
            }
            RelationalPool::Mysql(pool) => {
                let row = bind_mysql_query(sqlx::query(&sql), primary_key, &Value::String(id.into()))?
                    .fetch_optional(pool)
                    .await?;
                row.map(|item| row_to_value_mysql(model, item)).transpose()
            }
        }
    }

    pub async fn find_many(
        &self,
        model: &OrmModelMetadata,
        options: Option<OrmFindManyOptions>,
    ) -> Result<Vec<JsonMap<String, Value>>, OrmRuntimeError> {
        let options = options.unwrap_or(OrmFindManyOptions {
            where_clause: None,
            order_by: None,
        });
        let mut parameters = Vec::new();
        let mut sql = format!("SELECT * FROM {}", quote_identifier(self.dialect, &model.table));

        if let Some(where_clause) = &options.where_clause {
            let mut predicates = Vec::new();
            for (index, (field_name, value)) in where_clause.iter().enumerate() {
                field_by_name(model, field_name)?;
                predicates.push(format!(
                    "{} = {}",
                    quote_identifier(self.dialect, field_name),
                    placeholder(self.dialect, index + 1)
                ));
                parameters.push((field_name.clone(), value.clone()));
            }
            if !predicates.is_empty() {
                sql.push_str(" WHERE ");
                sql.push_str(&predicates.join(" AND "));
            }
        }

        if let Some(order_by) = &options.order_by {
            field_by_name(model, &order_by.field)?;
            let direction = order_by.direction.to_uppercase();
            let direction = if direction == "DESC" { "DESC" } else { "ASC" };
            sql.push_str(" ORDER BY ");
            sql.push_str(&quote_identifier(self.dialect, &order_by.field));
            sql.push(' ');
            sql.push_str(direction);
        }

        match &self.pool {
            RelationalPool::Sqlite(pool) => {
                let mut query = sqlx::query(&sql);
                for (field_name, value) in &parameters {
                    query = bind_sqlite_query(query, field_by_name(model, field_name)?, value)?;
                }
                let rows = query.fetch_all(pool).await?;
                rows.into_iter()
                    .map(|row| row_to_value_sqlite(model, row))
                    .collect()
            }
            RelationalPool::Postgres(pool) => {
                let mut query = sqlx::query(&sql);
                for (field_name, value) in &parameters {
                    query = bind_postgres_query(query, field_by_name(model, field_name)?, value)?;
                }
                let rows = query.fetch_all(pool).await?;
                rows.into_iter()
                    .map(|row| row_to_value_postgres(model, row))
                    .collect()
            }
            RelationalPool::Mysql(pool) => {
                let mut query = sqlx::query(&sql);
                for (field_name, value) in &parameters {
                    query = bind_mysql_query(query, field_by_name(model, field_name)?, value)?;
                }
                let rows = query.fetch_all(pool).await?;
                rows.into_iter()
                    .map(|row| row_to_value_mysql(model, row))
                    .collect()
            }
        }
    }

    pub async fn update(
        &self,
        model: &OrmModelMetadata,
        id: &str,
        input: &JsonMap<String, Value>,
    ) -> Result<(), OrmRuntimeError> {
        let primary_key = primary_key_field(model)?;
        let fields: Vec<_> = model
            .fields
            .iter()
            .filter(|field| field.name != primary_key.name)
            .collect();
        let assignments = fields
            .iter()
            .enumerate()
            .map(|(index, field)| {
                format!(
                    "{} = {}",
                    quote_identifier(self.dialect, &field.name),
                    placeholder(self.dialect, index + 1)
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "UPDATE {} SET {} WHERE {} = {}",
            quote_identifier(self.dialect, &model.table),
            assignments,
            quote_identifier(self.dialect, &primary_key.name),
            placeholder(self.dialect, fields.len() + 1)
        );

        let affected_rows = match &self.pool {
            RelationalPool::Sqlite(pool) => {
                let mut query = sqlx::query(&sql);
                for field in &fields {
                    let value = input.get(&field.name).unwrap_or(&Value::Null);
                    query = bind_sqlite_query(query, field, value)?;
                }
                query = bind_sqlite_query(query, primary_key, &Value::String(id.into()))?;
                query.execute(pool).await?.rows_affected()
            }
            RelationalPool::Postgres(pool) => {
                let mut query = sqlx::query(&sql);
                for field in &fields {
                    let value = input.get(&field.name).unwrap_or(&Value::Null);
                    query = bind_postgres_query(query, field, value)?;
                }
                query = bind_postgres_query(query, primary_key, &Value::String(id.into()))?;
                query.execute(pool).await?.rows_affected()
            }
            RelationalPool::Mysql(pool) => {
                let mut query = sqlx::query(&sql);
                for field in &fields {
                    let value = input.get(&field.name).unwrap_or(&Value::Null);
                    query = bind_mysql_query(query, field, value)?;
                }
                query = bind_mysql_query(query, primary_key, &Value::String(id.into()))?;
                query.execute(pool).await?.rows_affected()
            }
        };

        if affected_rows == 0 {
            return Err(OrmRuntimeError::RecordNotFound(id.into()));
        }

        Ok(())
    }

    pub async fn delete(
        &self,
        model: &OrmModelMetadata,
        id: &str,
    ) -> Result<(), OrmRuntimeError> {
        let primary_key = primary_key_field(model)?;
        let sql = format!(
            "DELETE FROM {} WHERE {} = {}",
            quote_identifier(self.dialect, &model.table),
            quote_identifier(self.dialect, &primary_key.name),
            placeholder(self.dialect, 1)
        );

        match &self.pool {
            RelationalPool::Sqlite(pool) => {
                bind_sqlite_query(sqlx::query(&sql), primary_key, &Value::String(id.into()))?
                    .execute(pool)
                    .await?;
            }
            RelationalPool::Postgres(pool) => {
                bind_postgres_query(sqlx::query(&sql), primary_key, &Value::String(id.into()))?
                    .execute(pool)
                    .await?;
            }
            RelationalPool::Mysql(pool) => {
                bind_mysql_query(sqlx::query(&sql), primary_key, &Value::String(id.into()))?
                    .execute(pool)
                    .await?;
            }
        }

        Ok(())
    }

    pub async fn push_schema(
        &self,
        models: &[OrmModelMetadata],
    ) -> Result<Vec<String>, OrmRuntimeError> {
        let statements = create_schema_statements(self.dialect, models)?;

        match &self.pool {
            RelationalPool::Sqlite(pool) => {
                for statement in &statements {
                    sqlx::query(statement).execute(pool).await?;
                }
            }
            RelationalPool::Postgres(pool) => {
                for statement in &statements {
                    sqlx::query(statement).execute(pool).await?;
                }
            }
            RelationalPool::Mysql(pool) => {
                for statement in &statements {
                    sqlx::query(statement).execute(pool).await?;
                }
            }
        }

        Ok(statements)
    }

    pub async fn pull_schema(&self) -> Result<Vec<TableSchema>, OrmRuntimeError> {
        match &self.pool {
            RelationalPool::Sqlite(pool) => pull_schema_sqlite(pool).await,
            RelationalPool::Postgres(pool) => pull_schema_postgres(pool).await,
            RelationalPool::Mysql(pool) => pull_schema_mysql(pool).await,
        }
    }
}

fn apply_sqlite_pool_options(
    mut options: SqlitePoolOptions,
    pool_options: &RelationalPoolOptions,
) -> SqlitePoolOptions {
    if let Some(min) = pool_options.min_connections {
        options = options.min_connections(min);
    }
    if let Some(timeout) = pool_options.acquire_timeout_ms {
        options = options.acquire_timeout(Duration::from_millis(timeout));
    }
    if let Some(timeout) = pool_options.idle_timeout_ms {
        options = options.idle_timeout(Some(Duration::from_millis(timeout)));
    }
    options
}

fn apply_pg_pool_options(
    mut options: PgPoolOptions,
    pool_options: &RelationalPoolOptions,
) -> PgPoolOptions {
    if let Some(min) = pool_options.min_connections {
        options = options.min_connections(min);
    }
    if let Some(timeout) = pool_options.acquire_timeout_ms {
        options = options.acquire_timeout(Duration::from_millis(timeout));
    }
    if let Some(timeout) = pool_options.idle_timeout_ms {
        options = options.idle_timeout(Some(Duration::from_millis(timeout)));
    }
    options
}

fn apply_mysql_pool_options(
    mut options: MySqlPoolOptions,
    pool_options: &RelationalPoolOptions,
) -> MySqlPoolOptions {
    if let Some(min) = pool_options.min_connections {
        options = options.min_connections(min);
    }
    if let Some(timeout) = pool_options.acquire_timeout_ms {
        options = options.acquire_timeout(Duration::from_millis(timeout));
    }
    if let Some(timeout) = pool_options.idle_timeout_ms {
        options = options.idle_timeout(Some(Duration::from_millis(timeout)));
    }
    options
}

fn dialect_from_url(database_url: &str) -> Result<SqlDialect, OrmRuntimeError> {
    if database_url.starts_with("sqlite:") || database_url.starts_with("file:") {
        Ok(SqlDialect::Sqlite)
    } else if database_url.starts_with("postgres://")
        || database_url.starts_with("postgresql://")
    {
        Ok(SqlDialect::Postgres)
    } else if database_url.starts_with("mysql://") {
        Ok(SqlDialect::Mysql)
    } else {
        Err(OrmRuntimeError::UnsupportedDatabaseUrl(database_url.into()))
    }
}

fn insert_sql(dialect: SqlDialect, model: &OrmModelMetadata) -> String {
    let fields = model
        .fields
        .iter()
        .map(|field| quote_identifier(dialect, &field.name))
        .collect::<Vec<_>>()
        .join(", ");
    let placeholders = (1..=model.fields.len())
        .map(|index| placeholder(dialect, index))
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "INSERT INTO {} ({fields}) VALUES ({placeholders})",
        quote_identifier(dialect, &model.table)
    )
}

fn create_schema_statements(
    dialect: SqlDialect,
    models: &[OrmModelMetadata],
) -> Result<Vec<String>, OrmRuntimeError> {
    let models_by_name = models
        .iter()
        .map(|model| (model.name.clone(), model))
        .collect::<HashMap<_, _>>();
    let mut statements = Vec::new();

    for model in models {
        statements.push(create_table_statement(dialect, model));
        statements.extend(create_index_statements(dialect, model));
        statements.extend(create_many_to_many_statements(dialect, model, &models_by_name)?);
    }

    statements.sort();
    statements.dedup();
    Ok(statements)
}

fn create_table_statement(dialect: SqlDialect, model: &OrmModelMetadata) -> String {
    let columns = model
        .fields
        .iter()
        .map(|field| {
            let mut parts = vec![
                quote_identifier(dialect, &field.name),
                sql_type_for_field(dialect, field).to_string(),
            ];
            if field.primary_key {
                parts.push("PRIMARY KEY".into());
            }
            if !field.nullable && field.default_value.is_none() {
                parts.push("NOT NULL".into());
            }
            if let Some(default_value) = &field.default_value {
                parts.push(format!(
                    "DEFAULT {}",
                    default_value_sql(dialect, field, default_value)
                ));
            }
            parts.join(" ")
        })
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "CREATE TABLE IF NOT EXISTS {} ({columns})",
        quote_identifier(dialect, &model.table)
    )
}

fn create_index_statements(dialect: SqlDialect, model: &OrmModelMetadata) -> Vec<String> {
    model
        .indices
        .iter()
        .enumerate()
        .map(|(index_position, index)| {
            let name = index
                .name
                .clone()
                .unwrap_or_else(|| format!("{}_{}_{}", model.table, index.fields.join("_"), index_position));
            format!(
                "CREATE {}INDEX IF NOT EXISTS {} ON {} ({})",
                if index.unique { "UNIQUE " } else { "" },
                quote_identifier(dialect, &name),
                quote_identifier(dialect, &model.table),
                index
                    .fields
                    .iter()
                    .map(|field| quote_identifier(dialect, field))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })
        .collect()
}

fn create_many_to_many_statements(
    dialect: SqlDialect,
    model: &OrmModelMetadata,
    models_by_name: &HashMap<String, &OrmModelMetadata>,
) -> Result<Vec<String>, OrmRuntimeError> {
    let mut statements = Vec::new();

    for relation in &model.relations {
        if relation.kind != "manyToMany" {
            continue;
        }

        let target = models_by_name.get(&relation.target_model).ok_or_else(|| {
            OrmRuntimeError::UnknownRelationTarget {
                model: model.name.clone(),
                target: relation.target_model.clone(),
            }
        })?;
        let source_field = field_by_name(
            model,
            relation
                .source_key
                .as_deref()
                .ok_or_else(|| OrmRuntimeError::UnknownField {
                    model: model.name.clone(),
                    field: "sourceKey".into(),
                })?,
        )?;
        let target_field = field_by_name(
            target,
            relation
                .target_key
                .as_deref()
                .ok_or_else(|| OrmRuntimeError::UnknownField {
                    model: target.name.clone(),
                    field: "targetKey".into(),
                })?,
        )?;
        let through_table = relation.through_table.as_deref().ok_or_else(|| {
            OrmRuntimeError::UnknownField {
                model: model.name.clone(),
                field: "throughTable".into(),
            }
        })?;
        let through_source_key = relation.through_source_key.as_deref().ok_or_else(|| {
            OrmRuntimeError::UnknownField {
                model: model.name.clone(),
                field: "throughSourceKey".into(),
            }
        })?;
        let through_target_key = relation.through_target_key.as_deref().ok_or_else(|| {
            OrmRuntimeError::UnknownField {
                model: model.name.clone(),
                field: "throughTargetKey".into(),
            }
        })?;
        let unique_index_name =
            format!("{through_table}_{through_source_key}_{through_target_key}_unique");

        statements.push(format!(
            "CREATE TABLE IF NOT EXISTS {} ({} {} NOT NULL, {} {} NOT NULL)",
            quote_identifier(dialect, through_table),
            quote_identifier(dialect, through_source_key),
            sql_type_for_field(dialect, source_field),
            quote_identifier(dialect, through_target_key),
            sql_type_for_field(dialect, target_field)
        ));
        statements.push(format!(
            "CREATE UNIQUE INDEX IF NOT EXISTS {} ON {} ({}, {})",
            quote_identifier(dialect, &unique_index_name),
            quote_identifier(dialect, through_table),
            quote_identifier(dialect, through_source_key),
            quote_identifier(dialect, through_target_key)
        ));
    }

    Ok(statements)
}

fn primary_key_field(model: &OrmModelMetadata) -> Result<&OrmFieldMetadata, OrmRuntimeError> {
    let primary_keys = model
        .fields
        .iter()
        .filter(|field| field.primary_key)
        .collect::<Vec<_>>();
    if primary_keys.len() != 1 {
        return Err(OrmRuntimeError::InvalidPrimaryKey(model.name.clone()));
    }
    Ok(primary_keys[0])
}

fn field_by_name<'a>(
    model: &'a OrmModelMetadata,
    field_name: &str,
) -> Result<&'a OrmFieldMetadata, OrmRuntimeError> {
    model.fields.iter().find(|field| field.name == field_name).ok_or_else(|| {
        OrmRuntimeError::UnknownField {
            model: model.name.clone(),
            field: field_name.into(),
        }
    })
}

fn placeholder(dialect: SqlDialect, index: usize) -> String {
    match dialect {
        SqlDialect::Sqlite | SqlDialect::Mysql => "?".into(),
        SqlDialect::Postgres => format!("${index}"),
    }
}

fn quote_identifier(dialect: SqlDialect, identifier: &str) -> String {
    match dialect {
        SqlDialect::Mysql => format!("`{}`", identifier.replace('`', "``")),
        SqlDialect::Sqlite | SqlDialect::Postgres => {
            format!("\"{}\"", identifier.replace('"', "\"\""))
        }
    }
}

fn quote_sql_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn sql_type_for_field(dialect: SqlDialect, field: &OrmFieldMetadata) -> &'static str {
    match (dialect, field.field_type.as_str()) {
        (SqlDialect::Sqlite, "string") => "TEXT",
        (SqlDialect::Sqlite, "number") => "REAL",
        (SqlDialect::Sqlite, "boolean") => "INTEGER",
        (SqlDialect::Sqlite, "json") => "TEXT",
        (SqlDialect::Postgres, "string") => "TEXT",
        (SqlDialect::Postgres, "number") => "DOUBLE PRECISION",
        (SqlDialect::Postgres, "boolean") => "BOOLEAN",
        (SqlDialect::Postgres, "json") => "TEXT",
        (SqlDialect::Mysql, "string") => "VARCHAR(255)",
        (SqlDialect::Mysql, "number") => "DOUBLE",
        (SqlDialect::Mysql, "boolean") => "BOOLEAN",
        (SqlDialect::Mysql, "json") => "LONGTEXT",
        (_, _) => "TEXT",
    }
}

fn default_value_sql(dialect: SqlDialect, field: &OrmFieldMetadata, value: &Value) -> String {
    match field.field_type.as_str() {
        "boolean" => match dialect {
            SqlDialect::Postgres => {
                if value.as_bool().unwrap_or(false) {
                    "TRUE".into()
                } else {
                    "FALSE".into()
                }
            }
            SqlDialect::Sqlite | SqlDialect::Mysql => {
                if value.as_bool().unwrap_or(false) {
                    "1".into()
                } else {
                    "0".into()
                }
            }
        },
        "number" => value.to_string(),
        "json" => quote_sql_string(&value.to_string()),
        _ => quote_sql_string(value.as_str().unwrap_or_default()),
    }
}

fn bind_sqlite_query<'q>(
    query: Query<'q, Sqlite, SqliteArguments<'q>>,
    field: &OrmFieldMetadata,
    value: &Value,
) -> Result<Query<'q, Sqlite, SqliteArguments<'q>>, OrmRuntimeError> {
    Ok(match field.field_type.as_str() {
        "boolean" => {
            if let Some(boolean) = value.as_bool() {
                query.bind(if boolean { 1_i64 } else { 0_i64 })
            } else {
                query.bind(Option::<i64>::None)
            }
        }
        "number" => {
            if let Some(number) = value.as_f64() {
                query.bind(number)
            } else {
                query.bind(Option::<f64>::None)
            }
        }
        "json" => {
            if value.is_null() {
                query.bind(Option::<String>::None)
            } else {
                query.bind(serde_json::to_string(value)?)
            }
        }
        _ => {
            if let Some(string) = value.as_str() {
                query.bind(string.to_owned())
            } else if value.is_null() {
                query.bind(Option::<String>::None)
            } else {
                query.bind(value.to_string())
            }
        }
    })
}

fn bind_postgres_query<'q>(
    query: Query<'q, Postgres, PgArguments>,
    field: &OrmFieldMetadata,
    value: &Value,
) -> Result<Query<'q, Postgres, PgArguments>, OrmRuntimeError> {
    Ok(match field.field_type.as_str() {
        "boolean" => {
            if let Some(boolean) = value.as_bool() {
                query.bind(boolean)
            } else {
                query.bind(Option::<bool>::None)
            }
        }
        "number" => {
            if let Some(number) = value.as_f64() {
                query.bind(number)
            } else {
                query.bind(Option::<f64>::None)
            }
        }
        "json" => {
            if value.is_null() {
                query.bind(Option::<String>::None)
            } else {
                query.bind(serde_json::to_string(value)?)
            }
        }
        _ => {
            if let Some(string) = value.as_str() {
                query.bind(string.to_owned())
            } else if value.is_null() {
                query.bind(Option::<String>::None)
            } else {
                query.bind(value.to_string())
            }
        }
    })
}

fn bind_mysql_query<'q>(
    query: Query<'q, MySql, MySqlArguments>,
    field: &OrmFieldMetadata,
    value: &Value,
) -> Result<Query<'q, MySql, MySqlArguments>, OrmRuntimeError> {
    Ok(match field.field_type.as_str() {
        "boolean" => {
            if let Some(boolean) = value.as_bool() {
                query.bind(boolean)
            } else {
                query.bind(Option::<bool>::None)
            }
        }
        "number" => {
            if let Some(number) = value.as_f64() {
                query.bind(number)
            } else {
                query.bind(Option::<f64>::None)
            }
        }
        "json" => {
            if value.is_null() {
                query.bind(Option::<String>::None)
            } else {
                query.bind(serde_json::to_string(value)?)
            }
        }
        _ => {
            if let Some(string) = value.as_str() {
                query.bind(string.to_owned())
            } else if value.is_null() {
                query.bind(Option::<String>::None)
            } else {
                query.bind(value.to_string())
            }
        }
    })
}

fn row_to_value_sqlite(
    model: &OrmModelMetadata,
    row: SqliteRow,
) -> Result<JsonMap<String, Value>, OrmRuntimeError> {
    row_to_value(model, |field| match field.field_type.as_str() {
        "boolean" => row
            .try_get::<Option<i64>, _>(field.name.as_str())
            .map(|value| value.map(|item| Value::Bool(item != 0)).unwrap_or(Value::Null)),
        "number" => row
            .try_get::<Option<f64>, _>(field.name.as_str())
            .map(|value| value.map(Value::from).unwrap_or(Value::Null)),
        "json" => decode_json_column(row.try_get::<Option<String>, _>(field.name.as_str())?) ,
        _ => row
            .try_get::<Option<String>, _>(field.name.as_str())
            .map(|value| value.map(Value::String).unwrap_or(Value::Null)),
    })
}

fn row_to_value_postgres(
    model: &OrmModelMetadata,
    row: PgRow,
) -> Result<JsonMap<String, Value>, OrmRuntimeError> {
    row_to_value(model, |field| match field.field_type.as_str() {
        "boolean" => row
            .try_get::<Option<bool>, _>(field.name.as_str())
            .map(|value| value.map(Value::Bool).unwrap_or(Value::Null)),
        "number" => row
            .try_get::<Option<f64>, _>(field.name.as_str())
            .map(|value| value.map(Value::from).unwrap_or(Value::Null)),
        "json" => decode_json_column(row.try_get::<Option<String>, _>(field.name.as_str())?) ,
        _ => row
            .try_get::<Option<String>, _>(field.name.as_str())
            .map(|value| value.map(Value::String).unwrap_or(Value::Null)),
    })
}

fn row_to_value_mysql(
    model: &OrmModelMetadata,
    row: MySqlRow,
) -> Result<JsonMap<String, Value>, OrmRuntimeError> {
    row_to_value(model, |field| match field.field_type.as_str() {
        "boolean" => row
            .try_get::<Option<bool>, _>(field.name.as_str())
            .map(|value| value.map(Value::Bool).unwrap_or(Value::Null)),
        "number" => row
            .try_get::<Option<f64>, _>(field.name.as_str())
            .map(|value| value.map(Value::from).unwrap_or(Value::Null)),
        "json" => decode_json_column(row.try_get::<Option<String>, _>(field.name.as_str())?) ,
        _ => row
            .try_get::<Option<String>, _>(field.name.as_str())
            .map(|value| value.map(Value::String).unwrap_or(Value::Null)),
    })
}

fn row_to_value<F>(
    model: &OrmModelMetadata,
    mut mapper: F,
) -> Result<JsonMap<String, Value>, OrmRuntimeError>
where
    F: FnMut(&OrmFieldMetadata) -> Result<Value, sqlx::Error>,
{
    let mut map = JsonMap::new();
    for field in &model.fields {
        map.insert(field.name.clone(), mapper(field)?);
    }
    Ok(map)
}

fn decode_json_column(value: Option<String>) -> Result<Value, sqlx::Error> {
    match value {
        Some(value) => serde_json::from_str(&value)
            .map_err(|error| sqlx::Error::Decode(Box::new(error))),
        None => Ok(Value::Null),
    }
}

async fn pull_schema_sqlite(pool: &SqlitePool) -> Result<Vec<TableSchema>, OrmRuntimeError> {
    let tables = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await?;

    let mut schemas = Vec::new();
    for table in tables {
        let name = table.try_get::<String, _>("name")?;
        let pragma_sql = format!("PRAGMA table_info({})", quote_sql_string(&name));
        let columns = sqlx::query(&pragma_sql).fetch_all(pool).await?;
        schemas.push(TableSchema {
            name,
            columns: columns
                .into_iter()
                .map(|column| {
                    Ok(TableColumnSchema {
                        name: column.try_get("name")?,
                        type_name: column.try_get("type")?,
                        not_null: column.try_get::<i64, _>("notnull")? == 1,
                        primary_key: column.try_get::<i64, _>("pk")? == 1,
                    })
                })
                .collect::<Result<Vec<_>, sqlx::Error>>()?,
        });
    }

    Ok(schemas)
}

async fn pull_schema_postgres(pool: &PgPool) -> Result<Vec<TableSchema>, OrmRuntimeError> {
    let tables = sqlx::query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name ASC",
    )
    .fetch_all(pool)
    .await?;
    let mut schemas = Vec::new();

    for table in tables {
        let name = table.try_get::<String, _>("table_name")?;
        let columns = sqlx::query(
            "SELECT c.column_name, c.data_type, c.is_nullable, EXISTS (SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema WHERE tc.table_schema = c.table_schema AND tc.table_name = c.table_name AND tc.constraint_type = 'PRIMARY KEY' AND kcu.column_name = c.column_name) AS primary_key FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = $1 ORDER BY c.ordinal_position ASC",
        )
        .bind(&name)
        .fetch_all(pool)
        .await?;

        schemas.push(TableSchema {
            name,
            columns: columns
                .into_iter()
                .map(|column| {
                    Ok(TableColumnSchema {
                        name: column.try_get("column_name")?,
                        type_name: column.try_get("data_type")?,
                        not_null: column.try_get::<String, _>("is_nullable")? == "NO",
                        primary_key: column.try_get("primary_key")?,
                    })
                })
                .collect::<Result<Vec<_>, sqlx::Error>>()?,
        });
    }

    Ok(schemas)
}

async fn pull_schema_mysql(pool: &MySqlPool) -> Result<Vec<TableSchema>, OrmRuntimeError> {
    let tables = sqlx::query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name ASC",
    )
    .fetch_all(pool)
    .await?;
    let mut schemas = Vec::new();

    for table in tables {
        let name = table.try_get::<String, _>("table_name")?;
        let columns = sqlx::query(
            "SELECT column_name, column_type, is_nullable, column_key FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position ASC",
        )
        .bind(&name)
        .fetch_all(pool)
        .await?;

        schemas.push(TableSchema {
            name,
            columns: columns
                .into_iter()
                .map(|column| {
                    Ok(TableColumnSchema {
                        name: column.try_get("column_name")?,
                        type_name: column.try_get("column_type")?,
                        not_null: column.try_get::<String, _>("is_nullable")? == "NO",
                        primary_key: column.try_get::<String, _>("column_key")? == "PRI",
                    })
                })
                .collect::<Result<Vec<_>, sqlx::Error>>()?,
        });
    }

    Ok(schemas)
}

fn default_sort_direction() -> String {
    "asc".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn user_model() -> OrmModelMetadata {
        OrmModelMetadata {
            name: "User".into(),
            table: "users".into(),
            fields: vec![
                OrmFieldMetadata {
                    name: "id".into(),
                    field_type: "string".into(),
                    nullable: false,
                    default_value: None,
                    primary_key: true,
                },
                OrmFieldMetadata {
                    name: "email".into(),
                    field_type: "string".into(),
                    nullable: false,
                    default_value: None,
                    primary_key: false,
                },
                OrmFieldMetadata {
                    name: "active".into(),
                    field_type: "boolean".into(),
                    nullable: false,
                    default_value: Some(Value::Bool(true)),
                    primary_key: false,
                },
            ],
            indices: vec![OrmIndexMetadata {
                name: Some("users_email_unique".into()),
                fields: vec!["email".into()],
                unique: true,
            }],
            relations: vec![],
        }
    }

    #[test]
    fn detects_supported_database_urls() {
        assert_eq!(dialect_from_url("sqlite::memory:").unwrap(), SqlDialect::Sqlite);
        assert_eq!(
            dialect_from_url("postgres://localhost/db").unwrap(),
            SqlDialect::Postgres
        );
        assert_eq!(dialect_from_url("mysql://localhost/db").unwrap(), SqlDialect::Mysql);
    }

    #[test]
    fn rejects_unsupported_database_urls() {
        let error = dialect_from_url("mssql://localhost/db").unwrap_err();
        assert!(matches!(error, OrmRuntimeError::UnsupportedDatabaseUrl(_)));
    }

    #[tokio::test]
    async fn pushes_schema_and_runs_crud_in_sqlite() {
        let runtime = SqlOrmRuntime::connect("sqlite::memory:", None).await.unwrap();
        let user = user_model();

        let statements = runtime.push_schema(&[user.clone()]).await.unwrap();
        assert!(!statements.is_empty());

        runtime
            .create(
                &user,
                &JsonMap::from_iter([
                    ("id".into(), Value::String("usr_1".into())),
                    ("email".into(), Value::String("alice@example.com".into())),
                    ("active".into(), Value::Bool(true)),
                ]),
            )
            .await
            .unwrap();

        let found = runtime.find_by_id(&user, "usr_1").await.unwrap().unwrap();
        assert_eq!(found["email"], json!("alice@example.com"));

        let filtered = runtime
            .find_many(
                &user,
                Some(OrmFindManyOptions {
                    where_clause: Some(BTreeMap::from([(
                        "email".into(),
                        Value::String("alice@example.com".into()),
                    )])),
                    order_by: Some(OrmOrderBy {
                        field: "email".into(),
                        direction: "asc".into(),
                    }),
                }),
            )
            .await
            .unwrap();
        assert_eq!(filtered.len(), 1);

        runtime
            .update(
                &user,
                "usr_1",
                &JsonMap::from_iter([
                    ("id".into(), Value::String("usr_1".into())),
                    ("email".into(), Value::String("updated@example.com".into())),
                    ("active".into(), Value::Bool(false)),
                ]),
            )
            .await
            .unwrap();

        let updated = runtime.find_by_id(&user, "usr_1").await.unwrap().unwrap();
        assert_eq!(updated["email"], json!("updated@example.com"));
        assert_eq!(updated["active"], json!(false));

        let schema = runtime.pull_schema().await.unwrap();
        assert_eq!(schema[0].name, "users");

        runtime.delete(&user, "usr_1").await.unwrap();
        assert!(runtime.find_by_id(&user, "usr_1").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn postgres_integration_runs_when_configured() {
        let Some(database_url) = std::env::var("EZORM_TEST_POSTGRES_URL").ok() else {
            return;
        };
        let runtime = SqlOrmRuntime::connect(&database_url, None).await.unwrap();
        let user = user_model();
        runtime.push_schema(&[user.clone()]).await.unwrap();
        runtime
            .create(
                &user,
                &JsonMap::from_iter([
                    ("id".into(), Value::String("pg_1".into())),
                    ("email".into(), Value::String("postgres@example.com".into())),
                    ("active".into(), Value::Bool(true)),
                ]),
            )
            .await
            .unwrap();
        assert!(runtime.find_by_id(&user, "pg_1").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn mysql_integration_runs_when_configured() {
        let Some(database_url) = std::env::var("EZORM_TEST_MYSQL_URL").ok() else {
            return;
        };
        let runtime = SqlOrmRuntime::connect(&database_url, None).await.unwrap();
        let user = user_model();
        runtime.push_schema(&[user.clone()]).await.unwrap();
        runtime
            .create(
                &user,
                &JsonMap::from_iter([
                    ("id".into(), Value::String("my_1".into())),
                    ("email".into(), Value::String("mysql@example.com".into())),
                    ("active".into(), Value::Bool(true)),
                ]),
            )
            .await
            .unwrap();
        assert!(runtime.find_by_id(&user, "my_1").await.unwrap().is_some());
    }
}
