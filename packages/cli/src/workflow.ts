import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getModelMetadata, listModelMetadata } from "@ezorm/core";
import {
  connectRelationalAdapter,
  deriveModelSchemas,
  planSchemaDiff,
  type RelationalAdapter,
  type SqlDialect,
  type TableSchema
} from "@ezorm/orm";
import ts from "typescript";
import type { CliCommand, EzormCliConfig, InitCliOptions } from "./index.js";

const CONFIG_FILENAMES = [
  "ezorm.config.ts",
  "ezorm.config.mts",
  "ezorm.config.cts",
  "ezorm.config.mjs",
  "ezorm.config.js",
  "ezorm.config.cjs"
] as const;
const MIGRATION_HISTORY_TABLE = "_ezorm_migrations";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const EXCLUDED_DIRECTORIES = new Set([
  ".next",
  "__tests__",
  "build",
  "coverage",
  "dist",
  "migrations",
  "node_modules",
  "target"
]);
const MODEL_PREFILTER_PATTERNS = ["@Model", "Model("];
const DEFAULT_DATABASE_URL = "sqlite://./ezorm.db";

type ScaffoldLanguage = "ts" | "js";
type ModuleStyle = "esm" | "cjs";

async function loadConfigModule(specifier: string): Promise<{ default?: EzormCliConfig }> {
  return import(/* @vite-ignore */ specifier);
}

interface LoadedCliConfig extends EzormCliConfig {
  cwd: string;
  configPath: string;
  migrationsDir: string;
  models: Function[];
}

interface InitScaffoldResult {
  configPath: string;
  projectRoot: string;
  createdModelPath?: string;
  tsconfigPath?: string;
  tsconfigStatus?: "created" | "updated";
  existingModelFiles: string[];
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
    case "init":
      await runInit(command[1], io, cwd);
      return;
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

async function runInit(
  initOptions: InitCliOptions,
  io: Pick<Console, "log">,
  cwd: string
): Promise<void> {
  const result = await createInitScaffold(cwd, initOptions);

  io.log(`Created ${relative(result.projectRoot, result.configPath) || result.configPath}`);
  if (result.createdModelPath) {
    io.log(`Created ${relative(result.projectRoot, result.createdModelPath)}`);
  } else if (result.existingModelFiles.length > 0) {
    io.log(`Detected existing model files: ${result.existingModelFiles.join(", ")}`);
  }
  if (result.tsconfigPath && result.tsconfigStatus) {
    io.log(`${capitalize(result.tsconfigStatus)} ${relative(result.projectRoot, result.tsconfigPath)}`);
  }
  io.log("Next steps:");
  io.log("  ezorm migrate generate init");
  io.log("  ezorm migrate apply");
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
  const configPaths = await findConfigPaths(cwd);
  if (configPaths.length === 0) {
    throw new Error(`Could not find an Ezorm config file in ${cwd}`);
  }
  if (configPaths.length > 1) {
    throw new Error(
      `Found multiple Ezorm config files in ${cwd}: ${configPaths.map((path) => path.slice(cwd.length + 1)).join(", ")}`
    );
  }
  const [configPath] = configPaths;

  const configModule = await loadConfigModule(`${pathToFileURL(configPath).href}?t=${Date.now()}`);
  const config = configModule.default;
  if (!config || typeof config !== "object") {
    throw new Error(`Config ${configPath} must export a default Ezorm config object`);
  }
  if (typeof config.databaseUrl !== "string" || config.databaseUrl.trim().length === 0) {
    throw new Error(`Config ${configPath} must define a non-empty databaseUrl`);
  }
  const models =
    Array.isArray(config.models) && config.models.length > 0
      ? config.models
      : await discoverModelsFromConfig(configPath, config.modelPaths);

  for (const model of models) {
    getModelMetadata(model);
  }

  return {
    ...config,
    cwd,
    configPath,
    models,
    databaseUrl: config.databaseUrl.trim(),
    migrationsDir: resolve(dirname(configPath), config.migrationsDir ?? "migrations")
  };
}

async function findConfigPaths(cwd: string): Promise<string[]> {
  const configPaths = await Promise.all(
    CONFIG_FILENAMES.map(async (filename) => {
      const configPath = resolve(cwd, filename);
      try {
        await access(configPath);
        return configPath;
      } catch {
        return undefined;
      }
    })
  );

  return configPaths.filter((path): path is string => typeof path === "string");
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

async function createInitScaffold(
  cwd: string,
  initOptions: InitCliOptions
): Promise<InitScaffoldResult> {
  const projectRoot = await findNearestPackageRoot(cwd);
  const existingConfigs = await findConfigPaths(projectRoot);
  if (existingConfigs.length > 0) {
    throw new Error(
      `Found existing Ezorm config file${existingConfigs.length > 1 ? "s" : ""} in ${projectRoot}: ${existingConfigs
        .map((configPath) => relative(projectRoot, configPath))
        .join(", ")}`
    );
  }

  const hasSrcDirectory = await directoryExists(resolve(projectRoot, "src"));
  const existingModelFiles = await findModelSourceFiles(projectRoot, ["."], SOURCE_EXTENSIONS);
  const language = await determineScaffoldLanguage(projectRoot, initOptions.language);
  const moduleStyle = language === "js" ? await detectJavaScriptModuleStyle(projectRoot) : "esm";
  const configPath = resolve(projectRoot, scaffoldConfigFilename(language, moduleStyle));
  const modelPaths = [hasSrcDirectory ? "src" : "."];

  let tsconfigResult: { path: string; status: "created" | "updated" } | undefined;
  if (language === "ts") {
    tsconfigResult = await ensureTypeScriptConfig(projectRoot);
  }

  let createdModelPath: string | undefined;
  if (existingModelFiles.length === 0) {
    createdModelPath = await createExampleTodoModel(projectRoot, language, moduleStyle, hasSrcDirectory);
  }

  await writeFile(configPath, renderConfigFile(language, moduleStyle, modelPaths), "utf8");

  return {
    configPath,
    projectRoot,
    createdModelPath,
    existingModelFiles: existingModelFiles.map((filePath) => relative(projectRoot, filePath)),
    tsconfigPath: tsconfigResult?.path,
    tsconfigStatus: tsconfigResult?.status
  };
}

async function discoverModelsFromConfig(configPath: string, modelPaths?: string[]): Promise<Function[]> {
  const configDir = dirname(configPath);
  const configuredPaths = normalizeModelPaths(modelPaths);
  const scanRoots = configuredPaths.length > 0 ? configuredPaths : await defaultModelPaths(configDir);
  const candidateFiles = await findModelSourceFiles(configDir, scanRoots, SOURCE_EXTENSIONS);

  if (candidateFiles.length === 0) {
    throw new Error(
      `Config ${configPath} must define a non-empty models array or discoverable model files under ${scanRoots.join(", ")}`
    );
  }

  const existingTargets = new Set(listModelMetadata().map((metadata) => metadata.target));
  let importCounter = 0;
  for (const filePath of candidateFiles) {
    try {
      await import(/* @vite-ignore */ `${pathToFileURL(filePath).href}?scan=${Date.now()}-${importCounter++}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load model source ${filePath}: ${message}`);
    }
  }

  const discovered = listModelMetadata()
    .filter((metadata) => !existingTargets.has(metadata.target))
    .map((metadata) => metadata.target);

  if (discovered.length === 0) {
    throw new Error(
      `Config ${configPath} did not discover any models from ${scanRoots.join(
        ", "
      )}. Add models to the config or create files containing @Model.`
    );
  }

  return discovered;
}

function normalizeModelPaths(modelPaths?: string[]): string[] {
  if (!Array.isArray(modelPaths)) {
    return [];
  }

  return modelPaths
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

async function defaultModelPaths(projectRoot: string): Promise<string[]> {
  return (await directoryExists(resolve(projectRoot, "src"))) ? ["src"] : ["."];
}

async function findModelSourceFiles(
  baseDir: string,
  relativeRoots: string[],
  allowedExtensions: Set<string>
): Promise<string[]> {
  const matches = new Set<string>();

  for (const relativeRoot of relativeRoots) {
    const rootPath = resolve(baseDir, relativeRoot);
    const rootStats = await stat(rootPath).catch(() => undefined);
    if (!rootStats) {
      continue;
    }

    if (rootStats.isDirectory()) {
      await collectModelFiles(rootPath, allowedExtensions, matches);
      continue;
    }

    if (rootStats.isFile() && allowedExtensions.has(extensionOf(rootPath))) {
      const content = await readFile(rootPath, "utf8");
      if (looksLikeModelSource(content) && !shouldExcludeFile(rootPath)) {
        matches.add(rootPath);
      }
    }
  }

  return [...matches].sort((left, right) => left.localeCompare(right));
}

async function collectModelFiles(
  directory: string,
  allowedExtensions: Set<string>,
  matches: Set<string>
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      await collectModelFiles(entryPath, allowedExtensions, matches);
      continue;
    }

    if (!entry.isFile() || shouldExcludeFile(entry.name) || !allowedExtensions.has(extensionOf(entry.name))) {
      continue;
    }

    const content = await readFile(entryPath, "utf8");
    if (looksLikeModelSource(content)) {
      matches.add(entryPath);
    }
  }
}

function looksLikeModelSource(content: string): boolean {
  return MODEL_PREFILTER_PATTERNS.some((pattern) => content.includes(pattern));
}

function shouldExcludeFile(filePath: string): boolean {
  return /\.test\.[^.]+$/.test(filePath) || /\.spec\.[^.]+$/.test(filePath);
}

function extensionOf(filePath: string): string {
  const match = filePath.match(/(\.[^.]+)$/);
  return match ? match[1] : "";
}

async function findNearestPackageRoot(cwd: string): Promise<string> {
  let current = resolve(cwd);

  while (true) {
    if (await pathExists(resolve(current, "package.json"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return resolve(cwd);
    }
    current = parent;
  }
}

async function determineScaffoldLanguage(
  projectRoot: string,
  preferredLanguage?: ScaffoldLanguage
): Promise<ScaffoldLanguage> {
  if (preferredLanguage) {
    return preferredLanguage;
  }

  return (await pathExists(resolve(projectRoot, "tsconfig.json"))) ? "ts" : "js";
}

async function detectJavaScriptModuleStyle(projectRoot: string): Promise<ModuleStyle> {
  const packagePath = resolve(projectRoot, "package.json");
  const content = await readFile(packagePath, "utf8").catch(() => undefined);
  if (!content) {
    return "cjs";
  }

  try {
    const packageJson = JSON.parse(content) as { type?: string };
    return packageJson.type === "module" ? "esm" : "cjs";
  } catch {
    return "cjs";
  }
}

function scaffoldConfigFilename(language: ScaffoldLanguage, moduleStyle: ModuleStyle): string {
  if (language === "ts") {
    return "ezorm.config.ts";
  }

  return moduleStyle === "esm" ? "ezorm.config.mjs" : "ezorm.config.cjs";
}

function renderConfigFile(
  language: ScaffoldLanguage,
  moduleStyle: ModuleStyle,
  modelPaths: string[]
): string {
  const objectLiteral = [
    "{",
    `  databaseUrl: ${JSON.stringify(DEFAULT_DATABASE_URL)},`,
    `  modelPaths: ${JSON.stringify(modelPaths)}`,
    "}"
  ].join("\n");

  if (language === "ts" || moduleStyle === "esm") {
    return `export default ${objectLiteral};\n`;
  }

  return `module.exports = ${objectLiteral};\n`;
}

async function createExampleTodoModel(
  projectRoot: string,
  language: ScaffoldLanguage,
  moduleStyle: ModuleStyle,
  hasSrcDirectory: boolean
): Promise<string> {
  const modelPath = hasSrcDirectory
    ? resolve(projectRoot, "src", "models", language === "ts" ? "todo.ts" : "todo.js")
    : resolve(projectRoot, "models", language === "ts" ? "todo.ts" : "todo.js");

  if (await pathExists(modelPath)) {
    throw new Error(`Refusing to overwrite existing scaffold file ${modelPath}`);
  }

  await mkdir(dirname(modelPath), { recursive: true });
  await writeFile(modelPath, renderTodoModel(language, moduleStyle), "utf8");
  return modelPath;
}

function renderTodoModel(language: ScaffoldLanguage, moduleStyle: ModuleStyle): string {
  if (language === "ts") {
    return [
      'import { Field, Model, PrimaryKey } from "@ezorm/core";',
      "",
      '@Model({ table: "todos" })',
      "export class Todo {",
      "  @PrimaryKey()",
      "  @Field.string()",
      "  id!: string;",
      "",
      "  @Field.string()",
      "  title!: string;",
      "}"
    ].join("\n") + "\n";
  }

  if (moduleStyle === "esm") {
    return [
      'import { Field, Model, PrimaryKey } from "@ezorm/core";',
      "",
      "class Todo {}",
      "",
      'Field.string()(Todo.prototype, "id");',
      'PrimaryKey()(Todo.prototype, "id");',
      'Field.string()(Todo.prototype, "title");',
      'Model({ table: "todos" })(Todo);',
      "",
      "export { Todo };"
    ].join("\n") + "\n";
  }

  return [
    'const { Field, Model, PrimaryKey } = require("@ezorm/core");',
    "",
    "class Todo {}",
    "",
    'Field.string()(Todo.prototype, "id");',
    'PrimaryKey()(Todo.prototype, "id");',
    'Field.string()(Todo.prototype, "title");',
    'Model({ table: "todos" })(Todo);',
    "",
    "module.exports = { Todo };"
  ].join("\n") + "\n";
}

async function ensureTypeScriptConfig(
  projectRoot: string
): Promise<{ path: string; status: "created" | "updated" } | undefined> {
  const tsconfigPath = resolve(projectRoot, "tsconfig.json");
  const existing = await readFile(tsconfigPath, "utf8").catch(() => undefined);

  if (!existing) {
    const config = {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        experimentalDecorators: true,
        emitDecoratorMetadata: true
      }
    };
    await writeJsonFile(tsconfigPath, config);
    return { path: tsconfigPath, status: "created" };
  }

  const parsed = ts.parseConfigFileTextToJson(tsconfigPath, existing);
  if (parsed.error) {
    throw new Error(`Could not parse ${tsconfigPath}: ${parsed.error.messageText}`);
  }

  const config = (parsed.config ?? {}) as { compilerOptions?: Record<string, unknown> };
  const compilerOptions = { ...(config.compilerOptions ?? {}) };
  const nextConfig = { ...config, compilerOptions };
  let changed = false;

  if (compilerOptions.experimentalDecorators !== true) {
    compilerOptions.experimentalDecorators = true;
    changed = true;
  }
  if (compilerOptions.emitDecoratorMetadata !== true) {
    compilerOptions.emitDecoratorMetadata = true;
    changed = true;
  }

  if (!changed) {
    return undefined;
  }

  await writeJsonFile(tsconfigPath, nextConfig);
  return { path: tsconfigPath, status: "updated" };
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  const directoryStats = await stat(directoryPath).catch(() => undefined);
  return Boolean(directoryStats?.isDirectory());
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
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
