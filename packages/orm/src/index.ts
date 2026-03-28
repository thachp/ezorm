import { DatabaseSync } from "node:sqlite";
import {
  getModelMetadata,
  validateModelInput,
  type FieldMetadata,
  type ModelMetadata
} from "@ezorm/core";

type SqlScalar = string | number | boolean | null;
type DatabaseValue = string | number | null;

export interface OrmClientOptions {
  databaseUrl: string;
}

export interface FindManyOptions<T extends object> {
  where?: Partial<Record<Extract<keyof T, string>, SqlScalar>>;
  orderBy?: {
    field: Extract<keyof T, string>;
    direction?: "asc" | "desc";
  };
}

export interface Repository<T extends object> {
  create(input: T): Promise<T>;
  findById(id: string): Promise<T | undefined>;
  findMany(options?: FindManyOptions<T>): Promise<T[]>;
  update(id: string, patch: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}

export interface OrmClient {
  repository<T extends object>(model: ModelClass<T>): Repository<T>;
  pushSchema(models: Function[]): Promise<{ statements: string[] }>;
  pullSchema(): Promise<TableSchema[]>;
  close(): Promise<void>;
}

export interface TableSchema {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    notNull: boolean;
    primaryKey: boolean;
  }>;
}

export interface ModelClass<T extends object> {
  new (): T;
}

export async function createOrmClient(options: OrmClientOptions): Promise<OrmClient> {
  const database = new DatabaseSync(resolveSqliteFilename(options.databaseUrl));
  const ensuredTables = new Set<string>();

  async function ensureTable(model: Function): Promise<void> {
    const metadata = getModelMetadata(model);
    if (ensuredTables.has(metadata.table)) {
      return;
    }

    database.exec(createTableStatement(metadata));
    for (const statement of createIndexStatements(metadata)) {
      database.exec(statement);
    }
    ensuredTables.add(metadata.table);
  }

  return {
    repository<T extends object>(model: ModelClass<T>): Repository<T> {
      const metadata = getModelMetadata(model);
      const primaryKey = getPrimaryKeyField(metadata);

      return {
        async create(input) {
          await ensureTable(model);
          const payload = normalizeInput(metadata, input);
          const issues = validateModelInput(model, payload);
          if (issues.length > 0) {
            throw new Error(issues.map((issue) => `${issue.field}: ${issue.message}`).join(", "));
          }

          const fields = metadata.fields.map((field) => field.name);
          const placeholders = fields.map(() => "?").join(", ");
          const values = fields.map(
            (field) => toDatabaseValue(fieldMetadata(metadata, field), payload[field])
          );

          database
            .prepare(
              `INSERT INTO ${quoteIdentifier(metadata.table)} (${fields
                .map(quoteIdentifier)
                .join(", ")}) VALUES (${placeholders})`
            )
            .run(...values);

          return payload as T;
        },

        async findById(id) {
          await ensureTable(model);
          const row = database
            .prepare(
              `SELECT * FROM ${quoteIdentifier(metadata.table)} WHERE ${quoteIdentifier(primaryKey.name)} = ?`
            )
            .get(id) as Record<string, unknown> | undefined;
          return row ? mapRow(metadata, row) as T : undefined;
        },

        async findMany(options = {}) {
          await ensureTable(model);
          const whereEntries = Object.entries(options.where ?? {}).filter(([, value]) => value !== undefined);
          const clauses = whereEntries.map(([field]) => `${quoteIdentifier(field)} = ?`);
          const orderBy = options.orderBy
            ? ` ORDER BY ${quoteIdentifier(options.orderBy.field)} ${String(
                options.orderBy.direction ?? "asc"
              ).toUpperCase()}`
            : "";
          const sql = [
            `SELECT * FROM ${quoteIdentifier(metadata.table)}`,
            clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
            orderBy
          ].join("");
          const rows = database
            .prepare(sql)
            .all(
              ...whereEntries.map(([field, value]) =>
                toDatabaseValue(fieldMetadata(metadata, field), value)
              )
            ) as Record<string, unknown>[];
          return rows.map((row) => mapRow(metadata, row) as T);
        },

        async update(id, patch) {
          await ensureTable(model);
          const current = await this.findById(id);
          if (!current) {
            throw new Error(`Record ${id} does not exist`);
          }

          if (primaryKey.name in patch && String(patch[primaryKey.name as keyof T]) !== id) {
            throw new Error(`Primary key ${primaryKey.name} cannot be updated`);
          }

          const next = normalizeInput(metadata, { ...current, ...patch, [primaryKey.name]: id });
          const issues = validateModelInput(model, next);
          if (issues.length > 0) {
            throw new Error(issues.map((issue) => `${issue.field}: ${issue.message}`).join(", "));
          }

          const assignments = metadata.fields
            .filter((field) => field.name !== primaryKey.name)
            .map((field) => `${quoteIdentifier(field.name)} = ?`);
          const values = metadata.fields
            .filter((field) => field.name !== primaryKey.name)
            .map((field) => toDatabaseValue(field, next[field.name]));

          database
            .prepare(
              `UPDATE ${quoteIdentifier(metadata.table)} SET ${assignments.join(", ")} WHERE ${quoteIdentifier(
                primaryKey.name
              )} = ?`
            )
            .run(...values, id);

          return next as T;
        },

        async delete(id) {
          await ensureTable(model);
          database
            .prepare(
              `DELETE FROM ${quoteIdentifier(metadata.table)} WHERE ${quoteIdentifier(primaryKey.name)} = ?`
            )
            .run(id);
        }
      };
    },

    async pushSchema(models) {
      const statements = models.flatMap((model) => {
        const metadata = getModelMetadata(model);
        return [createTableStatement(metadata), ...createIndexStatements(metadata)];
      });

      for (const model of models) {
        await ensureTable(model);
      }

      return { statements };
    },

    async pullSchema() {
      const tableRows = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
        )
        .all() as Array<{ name: string }>;

      return tableRows.map(({ name }) => ({
        name,
        columns: (database.prepare(`PRAGMA table_info(${quoteSqlString(name)})`).all() as Array<{
          name: string;
          type: string;
          notnull: number;
          pk: number;
        }>).map((column) => ({
          name: column.name,
          type: column.type,
          notNull: column.notnull === 1,
          primaryKey: column.pk === 1
        }))
      }));
    },

    async close() {
      database.close();
    }
  };
}

function resolveSqliteFilename(databaseUrl: string): string {
  if (databaseUrl === "sqlite::memory:") {
    return ":memory:";
  }
  if (databaseUrl.startsWith("sqlite://")) {
    const path = databaseUrl.slice("sqlite://".length);
    return path.startsWith("/") ? path : `/${path}`;
  }
  throw new Error(`Unsupported database url for @ezorm/orm: ${databaseUrl}`);
}

function createTableStatement(metadata: ModelMetadata): string {
  const columns = metadata.fields.map((field) => {
    const parts = [
      quoteIdentifier(field.name),
      sqlTypeForField(field),
      field.primaryKey ? "PRIMARY KEY" : "",
      !field.nullable && field.defaultValue === undefined ? "NOT NULL" : "",
      field.defaultValue !== undefined ? `DEFAULT ${defaultValueSql(field)}` : ""
    ].filter(Boolean);
    return parts.join(" ");
  });

  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(metadata.table)} (${columns.join(", ")})`;
}

function createIndexStatements(metadata: ModelMetadata): string[] {
  return metadata.indices.map((index, indexPosition) => {
    const name = index.name ?? `${metadata.table}_${index.fields.join("_")}_${indexPosition}`;
    return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${quoteIdentifier(
      name
    )} ON ${quoteIdentifier(metadata.table)} (${index.fields.map(quoteIdentifier).join(", ")})`;
  });
}

function getPrimaryKeyField(metadata: ModelMetadata): FieldMetadata {
  const primaryKeys = metadata.fields.filter((field) => field.primaryKey);
  if (primaryKeys.length !== 1) {
    throw new Error(`Model ${metadata.name} must declare exactly one primary key field`);
  }
  return primaryKeys[0];
}

function fieldMetadata(metadata: ModelMetadata, name: string): FieldMetadata {
  const field = metadata.fields.find((item) => item.name === name);
  if (!field) {
    throw new Error(`Unknown field ${name} on model ${metadata.name}`);
  }
  return field;
}

function normalizeInput<T extends object>(metadata: ModelMetadata, input: Partial<T>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const field of metadata.fields) {
    const value = input[field.name as keyof T];
    normalized[field.name] = value === undefined ? field.defaultValue ?? undefined : value;
  }
  return normalized;
}

function mapRow(metadata: ModelMetadata, row: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const field of metadata.fields) {
    mapped[field.name] = fromDatabaseValue(field, row[field.name]);
  }
  return mapped;
}

function toDatabaseValue(field: FieldMetadata, value: unknown): DatabaseValue {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  if (field.type === "boolean") {
    return value ? 1 : 0;
  }
  if (field.type === "json") {
    return JSON.stringify(value);
  }
  if (field.type === "number") {
    return Number(value);
  }
  return String(value);
}

function fromDatabaseValue(field: FieldMetadata, value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (field.type === "boolean") {
    return Number(value) === 1;
  }
  if (field.type === "json") {
    return JSON.parse(String(value));
  }
  return value;
}

function sqlTypeForField(field: FieldMetadata): string {
  switch (field.type) {
    case "string":
      return "TEXT";
    case "number":
      return "REAL";
    case "boolean":
      return "INTEGER";
    case "json":
      return "TEXT";
    default:
      return "TEXT";
  }
}

function defaultValueSql(field: FieldMetadata): string {
  if (field.type === "boolean") {
    return field.defaultValue ? "1" : "0";
  }
  if (field.type === "number") {
    return String(field.defaultValue);
  }
  if (field.type === "json") {
    return quoteSqlString(JSON.stringify(field.defaultValue));
  }
  return quoteSqlString(String(field.defaultValue));
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
