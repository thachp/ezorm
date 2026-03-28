import { DatabaseSync } from "node:sqlite";
import type { TableSchema } from "./schema.js";

export type SqlDialect = "sqlite" | "postgres" | "mysql" | "mssql";
type AdapterParameter = string | number | bigint | Uint8Array | boolean | null;
export type AdapterTableSchema = TableSchema;

export interface RelationalAdapter {
  readonly dialect: SqlDialect;
  query(sql: string, params?: AdapterParameter[]): Promise<Array<Record<string, unknown>>>;
  execute(sql: string, params?: AdapterParameter[]): Promise<void>;
  pullSchema(): Promise<AdapterTableSchema[]>;
  close(): Promise<void>;
}

export function detectDialect(databaseUrl: string): SqlDialect {
  if (databaseUrl === "sqlite::memory:" || databaseUrl.startsWith("sqlite://")) {
    return "sqlite";
  }
  if (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
    return "postgres";
  }
  if (databaseUrl.startsWith("mysql://")) {
    return "mysql";
  }
  if (databaseUrl.startsWith("mssql://") || databaseUrl.startsWith("sqlserver://")) {
    return "mssql";
  }

  throw new Error(`Unsupported database url for @ezorm/orm: ${databaseUrl}`);
}

export async function connectRelationalAdapter(databaseUrl: string): Promise<RelationalAdapter> {
  const dialect = detectDialect(databaseUrl);

  switch (dialect) {
    case "sqlite":
      return connectSqliteAdapter(databaseUrl);
    case "postgres":
      return connectPostgresAdapter(databaseUrl);
    case "mysql":
      return connectMysqlAdapter(databaseUrl);
    case "mssql":
      return connectMssqlAdapter(databaseUrl);
  }
}

function connectSqliteAdapter(databaseUrl: string): RelationalAdapter {
  const database = new DatabaseSync(resolveSqliteFilename(databaseUrl));

  return {
    dialect: "sqlite",
    async query(sql, params = []) {
      return database.prepare(sql).all(...(params as Array<string | number | bigint | Uint8Array | null>)) as Array<
        Record<string, unknown>
      >;
    },
    async execute(sql, params = []) {
      database.prepare(sql).run(...(params as Array<string | number | bigint | Uint8Array | null>));
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
        })),
        indices: (database.prepare(`PRAGMA index_list(${quoteSqlString(name)})`).all() as Array<{
          name: string;
          unique: number;
          origin: string;
        }>)
          .filter((index) => index.origin !== "pk" && !index.name.startsWith("sqlite_"))
          .map((index) => ({
            name: index.name,
            columns: (
              database.prepare(`PRAGMA index_info(${quoteSqlString(index.name)})`).all() as Array<{
                name: string;
                seqno: number;
              }>
            )
              .sort((left, right) => left.seqno - right.seqno)
              .map((column) => column.name),
            unique: index.unique === 1
          }))
      }));
    },
    async close() {
      database.close();
    }
  };
}

async function connectPostgresAdapter(databaseUrl: string): Promise<RelationalAdapter> {
  const pg = await import("pg");
  const pool = new (pg as any).Pool({ connectionString: databaseUrl });

  return {
    dialect: "postgres",
    async query(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows as Array<Record<string, unknown>>;
    },
    async execute(sql, params = []) {
      await pool.query(sql, params);
    },
    async pullSchema() {
      const tables = await pool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name ASC"
      );
      const schemas: AdapterTableSchema[] = [];

      for (const table of tables.rows as Array<{ table_name: string }>) {
        const columns = await pool.query(
          "SELECT c.column_name, c.data_type, c.is_nullable, EXISTS (SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema WHERE tc.table_schema = c.table_schema AND tc.table_name = c.table_name AND tc.constraint_type = 'PRIMARY KEY' AND kcu.column_name = c.column_name) AS primary_key FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = $1 ORDER BY c.ordinal_position ASC",
          [table.table_name]
        );
        const indices = await pool.query(
          "SELECT i.relname AS index_name, ix.indisunique AS is_unique, array_agg(a.attname ORDER BY keys.ordinality) AS columns FROM pg_class t JOIN pg_namespace ns ON ns.oid = t.relnamespace JOIN pg_index ix ON ix.indrelid = t.oid JOIN pg_class i ON i.oid = ix.indexrelid JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS keys(attnum, ordinality) ON TRUE JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = keys.attnum WHERE ns.nspname = 'public' AND t.relname = $1 AND NOT ix.indisprimary GROUP BY i.relname, ix.indisunique ORDER BY i.relname ASC",
          [table.table_name]
        );
        schemas.push({
          name: table.table_name,
          columns: (columns.rows as Array<Record<string, unknown>>).map((column) => ({
            name: String(column.column_name),
            type: String(column.data_type),
            notNull: column.is_nullable === "NO",
            primaryKey: Boolean(column.primary_key)
          })),
          indices: (indices.rows as Array<Record<string, unknown>>).map((index) => ({
            name: String(index.index_name),
            columns: Array.isArray(index.columns) ? index.columns.map((column) => String(column)) : [],
            unique: Boolean(index.is_unique)
          }))
        });
      }

      return schemas;
    },
    async close() {
      await pool.end();
    }
  };
}

async function connectMysqlAdapter(databaseUrl: string): Promise<RelationalAdapter> {
  const mysql = await import("mysql2/promise");
  const pool = mysql.createPool(databaseUrl);

  return {
    dialect: "mysql",
    async query(sql, params = []) {
      const [rows] = await pool.query(sql, params);
      return normalizeResultRows(rows);
    },
    async execute(sql, params = []) {
      await pool.query(sql, params);
    },
    async pullSchema() {
      const [tableRows] = await pool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name ASC"
      );
      const schemas: AdapterTableSchema[] = [];

      for (const table of normalizeResultRows(tableRows) as Array<{ table_name: string }>) {
        const [columnRows] = await pool.query(
          "SELECT column_name, column_type, is_nullable, column_key FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position ASC",
          [table.table_name]
        );
        const [indexRows] = await pool.query(
          "SELECT index_name, non_unique, column_name, seq_in_index FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name <> 'PRIMARY' ORDER BY index_name ASC, seq_in_index ASC",
          [table.table_name]
        );
        const groupedIndices = new Map<string, { unique: boolean; columns: string[] }>();
        for (const row of normalizeResultRows(indexRows)) {
          const indexName = String(row.index_name);
          const current = groupedIndices.get(indexName) ?? {
            unique: Number(row.non_unique) === 0,
            columns: []
          };
          current.columns.push(String(row.column_name));
          groupedIndices.set(indexName, current);
        }
        schemas.push({
          name: table.table_name,
          columns: normalizeResultRows(columnRows).map((column) => ({
            name: String(column.column_name),
            type: String(column.column_type),
            notNull: column.is_nullable === "NO",
            primaryKey: column.column_key === "PRI"
          })),
          indices: [...groupedIndices.entries()].map(([name, index]) => ({
            name,
            columns: [...index.columns],
            unique: index.unique
          }))
        });
      }

      return schemas;
    },
    async close() {
      await pool.end();
    }
  };
}

async function connectMssqlAdapter(databaseUrl: string): Promise<RelationalAdapter> {
  const rawModule = await import("mssql");
  const sql = ("default" in rawModule ? (rawModule as { default: unknown }).default : rawModule) as any;
  const pool = await new sql.ConnectionPool(parseMssqlConfig(databaseUrl)).connect();

  return {
    dialect: "mssql",
    async query(queryText, params = []) {
      const request = createMssqlRequest(sql, pool, params);
      const result = await request.query(queryText);
      return (result.recordset ?? []) as Array<Record<string, unknown>>;
    },
    async execute(queryText, params = []) {
      const request = createMssqlRequest(sql, pool, params);
      await request.query(queryText);
    },
    async pullSchema() {
      const tables = await pool
        .request()
        .query(
          "SELECT TABLE_NAME AS table_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME ASC"
        );
      const schemas: AdapterTableSchema[] = [];

      for (const table of (tables.recordset ?? []) as Array<{ table_name: string }>) {
        const request = pool.request();
        request.input("p1", sql.NVarChar, table.table_name);
        const columns = await request.query(
          "SELECT c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type, c.CHARACTER_MAXIMUM_LENGTH AS character_maximum_length, c.IS_NULLABLE AS is_nullable, CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA WHERE tc.TABLE_NAME = c.TABLE_NAME AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND kcu.COLUMN_NAME = c.COLUMN_NAME) THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS primary_key FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_NAME = @p1 ORDER BY c.ORDINAL_POSITION ASC"
        );
        const indexRequest = pool.request();
        indexRequest.input("p1", sql.NVarChar, table.table_name);
        const indices = await indexRequest.query(
          "SELECT i.name AS index_name, i.is_unique AS is_unique, c.name AS column_name, ic.key_ordinal AS key_ordinal FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id WHERE i.object_id = OBJECT_ID(@p1) AND i.is_primary_key = 0 AND i.is_hypothetical = 0 ORDER BY i.name ASC, ic.key_ordinal ASC"
        );
        const groupedIndices = new Map<string, { unique: boolean; columns: string[] }>();
        for (const row of (indices.recordset ?? []) as Array<Record<string, unknown>>) {
          const indexName = String(row.index_name);
          const current = groupedIndices.get(indexName) ?? {
            unique: Boolean(row.is_unique),
            columns: []
          };
          current.columns.push(String(row.column_name));
          groupedIndices.set(indexName, current);
        }
        schemas.push({
          name: table.table_name,
          columns: ((columns.recordset ?? []) as Array<Record<string, unknown>>).map((column) => ({
            name: String(column.column_name),
            type: normalizeMssqlColumnType(
              String(column.data_type),
              Number(column.character_maximum_length)
            ),
            notNull: column.is_nullable === "NO",
            primaryKey: Boolean(column.primary_key)
          })),
          indices: [...groupedIndices.entries()].map(([name, index]) => ({
            name,
            columns: [...index.columns],
            unique: index.unique
          }))
        });
      }

      return schemas;
    },
    async close() {
      await pool.close();
    }
  };
}

function createMssqlRequest(sql: any, pool: any, params: AdapterParameter[]): any {
  const request = pool.request();
  params.forEach((value, index) => {
    const name = `p${index + 1}`;
    if (value === null || value === undefined) {
      request.input(name, sql.NVarChar, null);
      return;
    }
    if (typeof value === "boolean") {
      request.input(name, sql.Bit, value);
      return;
    }
    if (typeof value === "number") {
      request.input(name, sql.Float, value);
      return;
    }
    request.input(name, sql.NVarChar, String(value));
  });
  return request;
}

function normalizeResultRows(rows: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map((row) => ({ ...(row as Record<string, unknown>) }));
}

function normalizeMssqlColumnType(type: string, maxLength: number): string {
  const normalized = type.toUpperCase();
  if (normalized === "NVARCHAR") {
    return maxLength < 0 ? "NVARCHAR(MAX)" : `NVARCHAR(${maxLength})`;
  }
  return normalized;
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

function parseMssqlConfig(databaseUrl: string): Record<string, unknown> {
  const normalizedUrl = databaseUrl.startsWith("sqlserver://")
    ? `mssql://${databaseUrl.slice("sqlserver://".length)}`
    : databaseUrl;
  const url = new URL(normalizedUrl);
  const encrypt = url.searchParams.get("encrypt");
  const trustServerCertificate = url.searchParams.get("trustServerCertificate");

  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    server: url.hostname,
    port: url.port ? Number(url.port) : 1433,
    database: url.pathname.replace(/^\/+/, "") || undefined,
    options: {
      encrypt: encrypt === "true",
      trustServerCertificate: trustServerCertificate !== "false"
    }
  };
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
