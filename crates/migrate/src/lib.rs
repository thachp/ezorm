use ezorm_dialects::SqlDialect;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModelTable {
    pub name: String,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MigrationPlan {
    pub safe_statements: Vec<String>,
    pub blocked_changes: Vec<String>,
}

pub fn plan_model_sync(
    dialect: SqlDialect,
    desired: &ModelTable,
    actual: Option<&ModelTable>,
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
        let desired = ModelTable {
            name: "accounts".into(),
            columns: vec![
                "id TEXT".into(),
                "balance INTEGER".into(),
                "currency TEXT".into(),
            ],
        };
        let actual = ModelTable {
            name: "accounts".into(),
            columns: vec!["id TEXT".into(), "balance INTEGER".into()],
        };

        let plan = plan_model_sync(SqlDialect::Sqlite, &desired, Some(&actual));
        assert_eq!(
            plan.safe_statements,
            vec!["ALTER TABLE accounts ADD COLUMN currency TEXT"]
        );
        assert!(plan.blocked_changes.is_empty());
    }

    #[test]
    fn blocks_destructive_drift() {
        let desired = ModelTable {
            name: "accounts".into(),
            columns: vec!["id TEXT".into()],
        };
        let actual = ModelTable {
            name: "accounts".into(),
            columns: vec!["id TEXT".into(), "balance INTEGER".into()],
        };

        let plan = plan_model_sync(SqlDialect::Sqlite, &desired, Some(&actual));
        assert_eq!(
            plan.blocked_changes,
            vec!["Destructive drift detected for accounts.balance INTEGER"]
        );
    }
}
