import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getModelMetadata } from "@ezorm/core";
import {
  connectRelationalAdapter,
  deriveModelSchemas,
  planSchemaDiff,
  type RelationalAdapter,
  type SqlDialect,
  type TableSchema
} from "@ezorm/orm";
import type { CliCommand, EzormCliConfig } from "./index";

const CONFIG_FILENAMES = ["ezorm.config.mjs", "ezorm.config.js", "ezorm.config.cjs"] as const;
const MIGRATION_HISTORY_TABLE = "_ezorm_migrations";
const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<{ default?: EzormCliConfig }>;

interface LoadedCliConfig extends EzormCliConfig {
  cwd: string;
  configPath: string;
  migrationsDir: string;
}

interface MigrationFile {
  filename: string;
  path: string;
  content: string;
  checksum: string;
}

interface MigrationRecord {
  filename: string;
  checksum: string;
  appliedAt: string;
}

interface MigrationState {
  files: MigrationFile[];
  history: MigrationRecord[];
  applied: MigrationFile[];
  pending: MigrationFile[];
  modifiedApplied: Array<{ filename: string; reason: string }>;
}

export async function executeCliCommand(
  command: CliCommand,
  io: Pick<Console, "log" | "error">,
  options?: { cwd?: string }
): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();

  switch (command[0]) {
    case "db":
      if (command[1] === "pull") {
        await runDbPull(io, cwd);
        return;
      }
      await runDbPush(io, cwd);
      return;
    case "migrate":
      if (command[1] === "generate") {
        await runMigrateGenerate(command[2], io, cwd);
        return;
      }
      if (command[1] === "apply") {
        await runMigrateApply(io, cwd);
        return;
      }
      if (command[1] === "status") {
        await runMigrateStatus(io, cwd);
        return;
      }
      await runMigrateResolve(command[2], command[3], io, cwd);
      return;
  }
}

async function runDbPull(io: Pick<Console, "log">, cwd: string): Promise<void> {
  const config = await loadCliConfig(cwd);
  const adapter = await connectRelationalAdapter(config.databaseUrl);

  try {
    io.log(JSON.stringify(await adapter.pullSchema(), null, 2));
  } finally {
    await adapter.close();
  }
}

async function runDbPush(io: Pick<Console, "log">, cwd: string): Promise<void> {
  const config = await loadCliConfig(cwd);
  const adapter = await connectRelationalAdapter(config.databaseUrl);

  try {
    const diff = await planCurrentSchema(adapter, config);
    if (diff.blockedChanges.length > 0) {
      throw new Error(formatBlockedChanges(diff.blockedChanges));
    }

    if (diff.safeStatements.length === 0) {
      io.log("Schema is up to date.");
      return;
    }

    for (const statement of diff.safeStatements) {
      await adapter.execute(statement);
      io.log(statement);
    }
  } finally {
    await adapter.close();
  }
}

async function runMigrateGenerate(
  name: string | undefined,
  io: Pick<Console, "log">,
  cwd: string
): Promise<void> {
  const config = await loadCliConfig(cwd);
  const adapter = await connectRelationalAdapter(config.databaseUrl);

  try {
    const state = await readMigrationState(adapter, config.migrationsDir);
    if (state.modifiedApplied.length > 0) {
      throw new Error(formatModifiedApplied(state.modifiedApplied));
    }

    const diff = await planCurrentSchema(adapter, config);
    if (diff.blockedChanges.length > 0) {
      throw new Error(formatBlockedChanges(diff.blockedChanges));
    }
    if (diff.safeStatements.length === 0) {
      io.log("No schema changes detected.");
      return;
    }

    await mkdir(config.migrationsDir, { recursive: true });
    const filename = createMigrationFilename(name);
    const filePath = resolve(config.migrationsDir, filename);
    const contents = renderMigrationFile(diff.safeStatements);
    await writeFile(filePath, contents, "utf8");
    io.log(`Created migration ${filename}`);
  } finally {
    await adapter.close();
  }
}

async function runMigrateApply(io: Pick<Console, "log">, cwd: string): Promise<void> {
  const config = await loadCliConfig(cwd);
  const adapter = await connectRelationalAdapter(config.databaseUrl);

  try {
    await ensureMigrationHistoryTable(adapter);
    const state = await readMigrationState(adapter, config.migrationsDir);
    if (state.modifiedApplied.length > 0) {
      throw new Error(formatModifiedApplied(state.modifiedApplied));
    }

    if (state.pending.length === 0) {
      io.log("No pending migrations.");
      return;
    }

    for (const file of state.pending) {
      const statements = parseMigrationStatements(file.content);
      try {
        for (const statement of statements) {
          await adapter.execute(statement);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to apply migration ${file.filename}: ${message}\nRun \`ezorm migrate resolve\` if the schema was changed manually.`
        );
      }

      await insertMigrationRecord(adapter, file.filename, file.checksum);
      io.log(`Applied ${file.filename}`);
    }
  } finally {
    await adapter.close();
  }
}

async function runMigrateStatus(io: Pick<Console, "log">, cwd: string): Promise<void> {
  const config = await loadCliConfig(cwd);
  const adapter = await connectRelationalAdapter(config.databaseUrl);

  try {
    const state = await readMigrationState(adapter, config.migrationsDir);
    const diff = await planCurrentSchema(adapter, config);

    io.log(`Applied migrations: ${state.applied.length === 0 ? "none" : state.applied.map((file) => file.filename).join(", ")}`);
    io.log(`Pending migrations: ${state.pending.length === 0 ? "none" : state.pending.map((file) => file.filename).join(", ")}`);
    io.log(
      `Modified applied migrations: ${
        state.modifiedApplied.length === 0
          ? "none"
          : state.modifiedApplied.map((item) => `${item.filename} (${item.reason})`).join(", ")
      }`
    );
    if (diff.safeStatements.length === 0 && diff.blockedChanges.length === 0) {
      io.log("Schema drift: none");
      return;
    }

    if (diff.safeStatements.length > 0) {
      io.log(`Schema drift safe statements: ${diff.safeStatements.join(" | ")}`);
    }
    if (diff.blockedChanges.length > 0) {
      io.log(`Schema drift blocked changes: ${diff.blockedChanges.join(" | ")}`);
    }
  } finally {
    await adapter.close();
  }
}

async function runMigrateResolve(
  action: "applied" | "rolled-back",
  filename: string,
  io: Pick<Console, "log">,
  cwd: string
): Promise<void> {
  const config = await loadCliConfig(cwd);
  const adapter = await connectRelationalAdapter(config.databaseUrl);

  try {
    await ensureMigrationHistoryTable(adapter);
    const history = await readMigrationHistory(adapter);
    const existing = history.find((record) => record.filename === filename);

    if (action === "applied") {
      const filePath = resolve(config.migrationsDir, filename);
      const content = await readFile(filePath, "utf8").catch(() => {
        throw new Error(`Migration file ${filename} does not exist in ${config.migrationsDir}`);
      });
      const checksum = checksumForContent(content);

      if (existing && existing.checksum !== checksum) {
        throw new Error(`Migration ${filename} was already recorded with a different checksum`);
      }
      if (!existing) {
        await insertMigrationRecord(adapter, filename, checksum);
      }
      io.log(`Resolved ${filename} as applied.`);
      return;
    }

    if (!existing) {
      throw new Error(`Migration ${filename} is not recorded as applied.`);
    }

    await deleteMigrationRecord(adapter, filename);
    io.log(`Resolved ${filename} as rolled back.`);
  } finally {
    await adapter.close();
  }
}

async function loadCliConfig(cwd: string): Promise<LoadedCliConfig> {
  const configPath = await findConfigPath(cwd);
  if (!configPath) {
    throw new Error(`Could not find an Ezorm config file in ${cwd}`);
  }

  const configModule = await nativeImport(`${pathToFileURL(configPath).href}?t=${Date.now()}`);
  const config = configModule.default;
  if (!config || typeof config !== "object") {
    throw new Error(`Config ${configPath} must export a default Ezorm config object`);
  }
  if (typeof config.databaseUrl !== "string" || config.databaseUrl.trim().length === 0) {
    throw new Error(`Config ${configPath} must define a non-empty databaseUrl`);
  }
  if (!Array.isArray(config.models) || config.models.length === 0) {
    throw new Error(`Config ${configPath} must define a non-empty models array`);
  }
  for (const model of config.models) {
    getModelMetadata(model);
  }

  return {
    ...config,
    cwd,
    configPath,
    databaseUrl: config.databaseUrl.trim(),
    migrationsDir: resolve(cwd, config.migrationsDir ?? "migrations")
  };
}

async function findConfigPath(cwd: string): Promise<string | undefined> {
  for (const filename of CONFIG_FILENAMES) {
    const configPath = resolve(cwd, filename);
    try {
      await readFile(configPath, "utf8");
      return configPath;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function readMigrationState(
  adapter: RelationalAdapter,
  migrationsDir: string
): Promise<MigrationState> {
  const [files, history] = await Promise.all([
    readMigrationFiles(migrationsDir),
    readMigrationHistory(adapter)
  ]);
  const historyByFilename = new Map(history.map((record) => [record.filename, record]));
  const applied: MigrationFile[] = [];
  const pending: MigrationFile[] = [];
  const modifiedApplied: Array<{ filename: string; reason: string }> = [];

  for (const file of files) {
    const record = historyByFilename.get(file.filename);
    if (!record) {
      pending.push(file);
      continue;
    }
    if (record.checksum !== file.checksum) {
      modifiedApplied.push({ filename: file.filename, reason: "checksum mismatch" });
      continue;
    }
    applied.push(file);
  }

  for (const record of history) {
    if (!files.find((file) => file.filename === record.filename)) {
      modifiedApplied.push({ filename: record.filename, reason: "missing local file" });
    }
  }

  return { files, history, applied, pending, modifiedApplied };
}

async function readMigrationFiles(migrationsDir: string): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    files.map(async (filename) => {
      const path = resolve(migrationsDir, filename);
      const content = await readFile(path, "utf8");
      return {
        filename,
        path,
        content,
        checksum: checksumForContent(content)
      };
    })
  );
}

async function planCurrentSchema(
  adapter: RelationalAdapter,
  config: LoadedCliConfig
) {
  const desiredTables = deriveModelSchemas(adapter.dialect, config.models);
  const actualTables = await adapter.pullSchema();
  return planSchemaDiff(adapter.dialect, desiredTables, actualTables, {
    ignoreTables: [MIGRATION_HISTORY_TABLE]
  });
}

async function readMigrationHistory(adapter: RelationalAdapter): Promise<MigrationRecord[]> {
  const tables = await adapter.pullSchema();
  if (!tables.find((table) => table.name === MIGRATION_HISTORY_TABLE)) {
    return [];
  }

  const rows = await adapter.query(
    `SELECT ${quoteIdentifier(adapter.dialect, "filename")}, ${quoteIdentifier(
      adapter.dialect,
      "checksum"
    )}, ${quoteIdentifier(adapter.dialect, "applied_at")} FROM ${quoteIdentifier(
      adapter.dialect,
      MIGRATION_HISTORY_TABLE
    )} ORDER BY ${quoteIdentifier(adapter.dialect, "filename")} ASC`
  );

  return rows.map((row) => ({
    filename: String(row.filename),
    checksum: String(row.checksum),
    appliedAt: String(row.applied_at)
  }));
}

async function ensureMigrationHistoryTable(adapter: RelationalAdapter): Promise<void> {
  await adapter.execute(createMigrationHistoryTableStatement(adapter.dialect));
}

async function insertMigrationRecord(
  adapter: RelationalAdapter,
  filename: string,
  checksum: string
): Promise<void> {
  const params = [filename, checksum, new Date().toISOString()];
  await adapter.execute(
    `INSERT INTO ${quoteIdentifier(adapter.dialect, MIGRATION_HISTORY_TABLE)} (${quoteIdentifier(
      adapter.dialect,
      "filename"
    )}, ${quoteIdentifier(adapter.dialect, "checksum")}, ${quoteIdentifier(
      adapter.dialect,
      "applied_at"
    )}) VALUES (${placeholder(adapter.dialect, 1)}, ${placeholder(adapter.dialect, 2)}, ${placeholder(
      adapter.dialect,
      3
    )})`,
    params
  );
}

async function deleteMigrationRecord(adapter: RelationalAdapter, filename: string): Promise<void> {
  await adapter.execute(
    `DELETE FROM ${quoteIdentifier(adapter.dialect, MIGRATION_HISTORY_TABLE)} WHERE ${quoteIdentifier(
      adapter.dialect,
      "filename"
    )} = ${placeholder(adapter.dialect, 1)}`,
    [filename]
  );
}

function createMigrationHistoryTableStatement(dialect: SqlDialect): string {
  const statement = `CREATE TABLE ${quoteIdentifier(
    dialect,
    MIGRATION_HISTORY_TABLE
  )} (${quoteIdentifier(dialect, "filename")} ${stringTypeForDialect(dialect)} PRIMARY KEY, ${quoteIdentifier(
    dialect,
    "checksum"
  )} ${stringTypeForDialect(dialect)} NOT NULL, ${quoteIdentifier(
    dialect,
    "applied_at"
  )} ${stringTypeForDialect(dialect)} NOT NULL)`;

  if (dialect === "mssql") {
    return `IF OBJECT_ID(N'${MIGRATION_HISTORY_TABLE}', N'U') IS NULL EXEC(N'${escapeSqlString(statement)}')`;
  }
  return statement.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ");
}

function stringTypeForDialect(dialect: SqlDialect): string {
  if (dialect === "mysql") {
    return "VARCHAR(255)";
  }
  if (dialect === "mssql") {
    return "NVARCHAR(255)";
  }
  return "TEXT";
}

function createMigrationFilename(name?: string): string {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
  const slug = slugify(name ?? "migration");
  return `${timestamp}_${slug}.sql`;
}

function renderMigrationFile(statements: string[]): string {
  return `-- Generated by ezorm\n\n${statements.join(";\n\n")};\n`;
}

function parseMigrationStatements(content: string): string[] {
  const sanitized = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  return sanitized
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function checksumForContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "migration";
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatBlockedChanges(changes: string[]): string {
  return `Blocked schema changes detected:\n- ${changes.join("\n- ")}`;
}

function formatModifiedApplied(items: Array<{ filename: string; reason: string }>): string {
  return `Applied migrations have changed:\n- ${items
    .map((item) => `${item.filename}: ${item.reason}`)
    .join("\n- ")}`;
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

function placeholder(dialect: SqlDialect, index: number): string {
  if (dialect === "postgres") {
    return `$${index}`;
  }
  if (dialect === "mssql") {
    return `@p${index}`;
  }
  return "?";
}

function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}
