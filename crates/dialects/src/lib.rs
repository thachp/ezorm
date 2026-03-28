use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SqlDialect {
    Sqlite,
    Postgres,
    Mysql,
}

pub fn framework_schema(dialect: SqlDialect) -> Vec<String> {
    match dialect {
        SqlDialect::Sqlite => vec![
            "CREATE TABLE IF NOT EXISTS event_store (stream_id TEXT NOT NULL, version INTEGER NOT NULL, sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, schema_version INTEGER NOT NULL, payload TEXT NOT NULL, metadata TEXT, UNIQUE(stream_id, version));".into(),
            "CREATE TABLE IF NOT EXISTS snapshots (stream_id TEXT PRIMARY KEY, version INTEGER NOT NULL, schema_version INTEGER NOT NULL, state TEXT NOT NULL);".into(),
            "CREATE TABLE IF NOT EXISTS projection_checkpoints (projector TEXT PRIMARY KEY, last_sequence INTEGER NOT NULL);".into(),
        ],
        SqlDialect::Postgres => vec![
            "CREATE TABLE IF NOT EXISTS event_store (stream_id TEXT NOT NULL, version BIGINT NOT NULL, sequence BIGSERIAL PRIMARY KEY, event_type TEXT NOT NULL, schema_version INTEGER NOT NULL, payload TEXT NOT NULL, metadata TEXT, UNIQUE(stream_id, version));".into(),
            "CREATE TABLE IF NOT EXISTS snapshots (stream_id TEXT PRIMARY KEY, version BIGINT NOT NULL, schema_version INTEGER NOT NULL, state TEXT NOT NULL);".into(),
            "CREATE TABLE IF NOT EXISTS projection_checkpoints (projector TEXT PRIMARY KEY, last_sequence BIGINT NOT NULL);".into(),
        ],
        SqlDialect::Mysql => vec![
            "CREATE TABLE IF NOT EXISTS event_store (stream_id VARCHAR(255) NOT NULL, version BIGINT NOT NULL, sequence BIGINT AUTO_INCREMENT PRIMARY KEY, event_type TEXT NOT NULL, schema_version INTEGER NOT NULL, payload LONGTEXT NOT NULL, metadata LONGTEXT NULL, UNIQUE KEY event_store_stream_version_unique (stream_id, version));".into(),
            "CREATE TABLE IF NOT EXISTS snapshots (stream_id VARCHAR(255) PRIMARY KEY, version BIGINT NOT NULL, schema_version INTEGER NOT NULL, state LONGTEXT NOT NULL);".into(),
            "CREATE TABLE IF NOT EXISTS projection_checkpoints (projector VARCHAR(255) PRIMARY KEY, last_sequence BIGINT NOT NULL);".into(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emits_schema_for_all_supported_dialects() {
        assert_eq!(framework_schema(SqlDialect::Sqlite).len(), 3);
        assert!(
            framework_schema(SqlDialect::Postgres)[0].contains("UNIQUE(stream_id, version)"),
            "postgres should enforce stream version uniqueness"
        );
        assert!(
            framework_schema(SqlDialect::Mysql)[0].contains("AUTO_INCREMENT"),
            "mysql should use AUTO_INCREMENT sequence"
        );
    }
}
