import {
  getModelMetadata,
  type FieldMetadata,
  type ModelMetadata
} from "@ezorm/core";
import type { SqlDialect } from "./relational-adapter";

export interface TableIndexSchema {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface TableSchema {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    notNull: boolean;
    primaryKey: boolean;
    defaultValue?: unknown;
  }>;
  indices: TableIndexSchema[];
}

export interface SchemaDiff {
  safeStatements: string[];
  blockedChanges: string[];
}

export function deriveModelSchemas(
  dialect: SqlDialect,
  models: Array<Function | ModelMetadata>
): TableSchema[] {
  const tables = new Map<string, TableSchema>();

  for (const model of models) {
    const metadata = typeof model === "function" ? getModelMetadata(model) : model;
    mergeTableSchema(tables, {
      name: metadata.table,
      columns: metadata.fields.map((field) => ({
        name: field.name,
        type: sqlTypeForField(dialect, field),
        notNull: !field.nullable && field.defaultValue === undefined,
        primaryKey: Boolean(field.primaryKey),
        defaultValue: field.defaultValue
      })),
      indices: metadata.indices.map((index, indexPosition) => ({
        name: index.name ?? defaultIndexName(metadata.table, index.fields, indexPosition),
        columns: [...index.fields],
        unique: Boolean(index.unique)
      }))
    });

    for (const relation of metadata.relations) {
      if (relation.kind !== "manyToMany") {
        continue;
      }

      const targetMetadata = getModelMetadata(relation.target());
      const sourceField = fieldMetadata(metadata, relation.sourceKey);
      const targetField = fieldMetadata(targetMetadata, relation.targetKey);
      mergeTableSchema(tables, {
        name: relation.throughTable,
        columns: [
          {
            name: relation.throughSourceKey,
            type: sqlTypeForField(dialect, sourceField),
            notNull: true,
            primaryKey: false
          },
          {
            name: relation.throughTargetKey,
            type: sqlTypeForField(dialect, targetField),
            notNull: true,
            primaryKey: false
          }
        ],
        indices: [
          {
            name: `${relation.throughTable}_${relation.throughSourceKey}_${relation.throughTargetKey}_unique`,
            columns: [relation.throughSourceKey, relation.throughTargetKey],
            unique: true
          }
        ]
      });
    }
  }

  return [...tables.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function createSchemaStatementsForModels(
  dialect: SqlDialect,
  models: Array<Function | ModelMetadata>
): string[] {
  return uniqueStatements(
    deriveModelSchemas(dialect, models).flatMap((table) => createTableStatements(dialect, table))
  );
}

export function planSchemaDiff(
  dialect: SqlDialect,
  desiredTables: TableSchema[],
  actualTables: TableSchema[],
  options?: { ignoreTables?: string[] }
): SchemaDiff {
  const desiredByName = new Map(desiredTables.map((table) => [table.name, normalizeTableSchema(table)]));
  const actualByName = new Map(
    actualTables
      .filter((table) => !options?.ignoreTables?.includes(table.name))
      .map((table) => [table.name, normalizeTableSchema(table)])
  );

  const safeStatements: string[] = [];
  const blockedChanges: string[] = [];

  for (const desired of desiredByName.values()) {
    const actual = actualByName.get(desired.name);
    if (!actual) {
      safeStatements.push(...createTableStatements(dialect, desired));
      continue;
    }

    const desiredColumns = new Map(desired.columns.map((column) => [column.name, column]));
    const actualColumns = new Map(actual.columns.map((column) => [column.name, column]));

    for (const desiredColumn of desired.columns) {
      const actualColumn = actualColumns.get(desiredColumn.name);
      if (!actualColumn) {
        safeStatements.push(createAddColumnStatement(dialect, desired.name, desiredColumn));
        continue;
      }

      const expectedType = normalizeType(desiredColumn.type);
      const actualType = normalizeType(actualColumn.type);
      if (actualType !== expectedType) {
        blockedChanges.push(
          `Column ${desired.name}.${desiredColumn.name} has type ${actualColumn.type} but model expects ${desiredColumn.type}`
        );
      }
      if (actualColumn.notNull !== desiredColumn.notNull) {
        blockedChanges.push(
          `Column ${desired.name}.${desiredColumn.name} nullability does not match the model`
        );
      }
      if (actualColumn.primaryKey !== desiredColumn.primaryKey) {
        blockedChanges.push(
          `Column ${desired.name}.${desiredColumn.name} primary key shape does not match the model`
        );
      }
    }

    for (const actualColumn of actual.columns) {
      if (!desiredColumns.has(actualColumn.name)) {
        blockedChanges.push(
          `Column ${desired.name}.${actualColumn.name} exists in the database but not in the model`
        );
      }
    }

    const desiredIndices = new Map(desired.indices.map((index) => [index.name, index]));
    const actualIndices = new Map(actual.indices.map((index) => [index.name, index]));

    for (const desiredIndex of desired.indices) {
      const actualIndex = actualIndices.get(desiredIndex.name);
      if (!actualIndex) {
        safeStatements.push(createIndexStatement(dialect, desired.name, desiredIndex));
        continue;
      }

      if (
        actualIndex.unique !== desiredIndex.unique ||
        actualIndex.columns.length !== desiredIndex.columns.length ||
        actualIndex.columns.some((column, index) => column !== desiredIndex.columns[index])
      ) {
        blockedChanges.push(
          `Index ${desiredIndex.name} on ${desired.name} does not match the model definition`
        );
      }
    }

    for (const actualIndex of actual.indices) {
      if (!desiredIndices.has(actualIndex.name)) {
        blockedChanges.push(
          `Index ${actualIndex.name} exists on ${desired.name} but not in the model`
        );
      }
    }
  }

  return {
    safeStatements: uniqueStatements(safeStatements),
    blockedChanges: uniqueStatements(blockedChanges)
  };
}

function mergeTableSchema(target: Map<string, TableSchema>, incoming: TableSchema): void {
  const existing = target.get(incoming.name);
  if (!existing) {
    target.set(incoming.name, {
      name: incoming.name,
      columns: incoming.columns.map((column) => ({ ...column })),
      indices: incoming.indices.map((index) => ({ ...index, columns: [...index.columns] }))
    });
    return;
  }

  for (const column of incoming.columns) {
    const current = existing.columns.find((item) => item.name === column.name);
    if (!current) {
      existing.columns.push({ ...column });
      continue;
    }

    if (
      normalizeType(current.type) !== normalizeType(column.type) ||
      current.notNull !== column.notNull ||
      current.primaryKey !== column.primaryKey
    ) {
      throw new Error(`Conflicting schema definitions for table ${incoming.name}.${column.name}`);
    }
  }

  for (const index of incoming.indices) {
    const current = existing.indices.find((item) => item.name === index.name);
    if (!current) {
      existing.indices.push({ ...index, columns: [...index.columns] });
      continue;
    }

    if (
      current.unique !== index.unique ||
      current.columns.length !== index.columns.length ||
      current.columns.some((column, position) => column !== index.columns[position])
    ) {
      throw new Error(`Conflicting index definitions for table ${incoming.name}.${index.name}`);
    }
  }
}

function normalizeTableSchema(table: TableSchema): TableSchema {
  return {
    name: table.name,
    columns: table.columns.map((column) => ({ ...column })),
    indices: table.indices
      .map((index) => ({ ...index, columns: [...index.columns] }))
      .sort((left, right) => left.name.localeCompare(right.name))
  };
}

function createTableStatements(dialect: SqlDialect, table: TableSchema): string[] {
  return [
    createTableStatement(dialect, table),
    ...table.indices.map((index) => createIndexStatement(dialect, table.name, index))
  ];
}

function createTableStatement(dialect: SqlDialect, table: TableSchema): string {
  const columns = table.columns.map((column) => renderColumnDefinition(dialect, column));
  return schemaStatementWithExistenceGuard(
    dialect,
    "table",
    table.name,
    `CREATE TABLE ${quoteIdentifier(dialect, table.name)} (${columns.join(", ")})`
  );
}

function createAddColumnStatement(
  dialect: SqlDialect,
  tableName: string,
  column: TableSchema["columns"][number]
): string {
  return `ALTER TABLE ${quoteIdentifier(dialect, tableName)} ADD COLUMN ${renderColumnDefinition(
    dialect,
    column
  )}`;
}

function createIndexStatement(
  dialect: SqlDialect,
  tableName: string,
  index: TableIndexSchema
): string {
  const createIndexSql = `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${quoteIdentifier(
    dialect,
    index.name
  )} ON ${quoteIdentifier(dialect, tableName)} (${index.columns
    .map((column) => quoteIdentifier(dialect, column))
    .join(", ")})`;

  return schemaStatementWithExistenceGuard(dialect, "index", index.name, createIndexSql, tableName);
}

function renderColumnDefinition(
  dialect: SqlDialect,
  column: TableSchema["columns"][number]
): string {
  const parts = [
    quoteIdentifier(dialect, column.name),
    column.type,
    column.primaryKey ? "PRIMARY KEY" : "",
    column.notNull ? "NOT NULL" : "",
    column.defaultValue !== undefined ? `DEFAULT ${defaultValueSql(dialect, column)}` : ""
  ].filter(Boolean);

  return parts.join(" ");
}

function fieldMetadata(metadata: ModelMetadata, name: string): FieldMetadata {
  const field = metadata.fields.find((item) => item.name === name);
  if (!field) {
    throw new Error(`Unknown field ${name} on model ${metadata.name}`);
  }
  return field;
}

function defaultIndexName(tableName: string, fields: string[], indexPosition: number): string {
  return `${tableName}_${fields.join("_")}_${indexPosition}`;
}

function sqlTypeForField(dialect: SqlDialect, field: FieldMetadata): string {
  switch (field.type) {
    case "string":
      return dialect === "mysql" ? "VARCHAR(255)" : dialect === "mssql" ? "NVARCHAR(255)" : "TEXT";
    case "number":
      if (dialect === "postgres") {
        return "DOUBLE PRECISION";
      }
      if (dialect === "mysql") {
        return "DOUBLE";
      }
      if (dialect === "mssql") {
        return "FLOAT";
      }
      return "REAL";
    case "boolean":
      if (dialect === "postgres" || dialect === "mysql") {
        return "BOOLEAN";
      }
      if (dialect === "mssql") {
        return "BIT";
      }
      return "INTEGER";
    case "json":
      if (dialect === "mysql") {
        return "LONGTEXT";
      }
      if (dialect === "mssql") {
        return "NVARCHAR(MAX)";
      }
      return "TEXT";
    default:
      return "TEXT";
  }
}

function defaultValueSql(
  dialect: SqlDialect,
  column: Pick<TableSchema["columns"][number], "type" | "defaultValue">
): string {
  if (column.type === "BIT" || column.type === "BOOLEAN" || column.type === "INTEGER") {
    if (typeof column.defaultValue === "boolean") {
      return dialect === "postgres" ? (column.defaultValue ? "TRUE" : "FALSE") : column.defaultValue ? "1" : "0";
    }
  }
  if (typeof column.defaultValue === "number") {
    return String(column.defaultValue);
  }
  if (column.defaultValue !== undefined && typeof column.defaultValue === "object") {
    return quoteSqlString(JSON.stringify(column.defaultValue));
  }
  return quoteSqlString(String(column.defaultValue));
}

function normalizeType(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function schemaStatementWithExistenceGuard(
  dialect: SqlDialect,
  kind: "table" | "index",
  name: string,
  statement: string,
  tableName?: string
): string {
  if (dialect === "mssql") {
    if (kind === "table") {
      return `IF OBJECT_ID(N'${escapeSqlString(name)}', N'U') IS NULL EXEC(N'${escapeSqlString(statement)}')`;
    }
    return `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'${escapeSqlString(
      name
    )}' AND object_id = OBJECT_ID(N'${escapeSqlString(tableName ?? "")}')) EXEC(N'${escapeSqlString(
      statement
    )}')`;
  }

  if (dialect === "mysql" && kind === "index") {
    return statement;
  }

  const marker = kind === "table" ? "CREATE TABLE " : "CREATE INDEX ";
  if (statement.startsWith("CREATE UNIQUE INDEX ")) {
    return statement.replace("CREATE UNIQUE INDEX ", "CREATE UNIQUE INDEX IF NOT EXISTS ");
  }
  return statement.replace(marker, `${marker}IF NOT EXISTS `);
}

function quoteIdentifier(dialect: SqlDialect, value: string): string {
  if (dialect === "mysql") {
    return `\`${value.replaceAll("`", "``")}\``;
  }
  if (dialect === "mssql") {
    return `[${value.replaceAll("]", "]]")}]`;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteSqlString(value: string): string {
  return `'${escapeSqlString(value)}'`;
}

function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

function uniqueStatements(values: string[]): string[] {
  return [...new Set(values)];
}
