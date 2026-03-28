use serde::{Deserialize, Serialize};
use sqlmodel_dialects::SqlDialect;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectionTable {
    pub name: String,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MigrationPlan {
    pub safe_statements: Vec<String>,
    pub blocked_changes: Vec<String>,
}

pub fn plan_projection_sync(
    dialect: SqlDialect,
    desired: &ProjectionTable,
    actual: Option<&ProjectionTable>,
) -> MigrationPlan {
    match actual {
        None => MigrationPlan {
            safe_statements: vec![format!(
                "CREATE TABLE {} ({}) /* {:?} */",
                desired.name,
                desired.columns.join(", "),
                dialect
            )],
            blocked_changes: vec![],
        },
        Some(actual_table) => {
            let safe_statements = desired
                .columns
                .iter()
                .filter(|column| !actual_table.columns.contains(*column))
                .map(|column| format!("ALTER TABLE {} ADD COLUMN {}", desired.name, column))
                .collect::<Vec<_>>();

            let blocked_changes = actual_table
                .columns
                .iter()
                .filter(|column| !desired.columns.contains(*column))
                .map(|column| format!("Destructive drift detected for {}.{}", desired.name, column))
                .collect::<Vec<_>>();

            MigrationPlan {
                safe_statements,
                blocked_changes,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_additive_changes_only() {
        let desired = ProjectionTable {
            name: "account_projection".into(),
            columns: vec![
                "id TEXT".into(),
                "balance INTEGER".into(),
                "currency TEXT".into(),
            ],
        };
        let actual = ProjectionTable {
            name: "account_projection".into(),
            columns: vec!["id TEXT".into(), "balance INTEGER".into()],
        };

        let plan = plan_projection_sync(SqlDialect::Sqlite, &desired, Some(&actual));
        assert_eq!(
            plan.safe_statements,
            vec!["ALTER TABLE account_projection ADD COLUMN currency TEXT"]
        );
        assert!(plan.blocked_changes.is_empty());
    }

    #[test]
    fn blocks_destructive_drift() {
        let desired = ProjectionTable {
            name: "account_projection".into(),
            columns: vec!["id TEXT".into()],
        };
        let actual = ProjectionTable {
            name: "account_projection".into(),
            columns: vec!["id TEXT".into(), "balance INTEGER".into()],
        };

        let plan = plan_projection_sync(SqlDialect::Sqlite, &desired, Some(&actual));
        assert_eq!(
            plan.blocked_changes,
            vec!["Destructive drift detected for account_projection.balance INTEGER"]
        );
    }
}
