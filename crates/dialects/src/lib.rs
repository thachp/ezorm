use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SqlDialect {
    Sqlite,
    Postgres,
    Mysql,
    Mssql,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_supported_dialects() {
        assert_eq!(
            serde_json::to_string(&SqlDialect::Sqlite).unwrap(),
            "\"Sqlite\""
        );
        assert_eq!(
            serde_json::to_string(&SqlDialect::Postgres).unwrap(),
            "\"Postgres\""
        );
        assert_eq!(
            serde_json::to_string(&SqlDialect::Mysql).unwrap(),
            "\"Mysql\""
        );
        assert_eq!(
            serde_json::to_string(&SqlDialect::Mssql).unwrap(),
            "\"Mssql\""
        );
    }
}
