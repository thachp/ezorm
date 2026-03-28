import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { Field, Index, Model, PrimaryKey } from "@ezorm/core";
import { main, parseCliCommand } from "./index";

const originalCwd = process.cwd();
const tempDirectories: string[] = [];
let cliBuildPrepared = false;

@Model({ table: "todos" })
@Index(["title"], { name: "todos_title_idx" })
class CliTodoModel {
  @PrimaryKey()
  @Field.string()
  id!: string;

  @Field.string()
  title!: string;
}

afterEach(async () => {
  process.chdir(originalCwd);
  delete (globalThis as { __EZORM_TEST_CONFIG__?: unknown }).__EZORM_TEST_CONFIG__;
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe("ezorm CLI", () => {
  it("parses init commands", () => {
    expect(parseCliCommand(["init"])).toEqual(["init", {}]);
    expect(parseCliCommand(["init", "--ts"])).toEqual(["init", { language: "ts" }]);
    expect(parseCliCommand(["init", "--js"])).toEqual(["init", { language: "js" }]);
    expect(() => parseCliCommand(["init", "--ts", "--js"])).toThrow(
      "Init accepts either --ts or --js, not both"
    );
  });

  it("parses resolve commands", () => {
    expect(parseCliCommand(["migrate", "resolve", "--applied", "001_init.sql"])).toEqual([
      "migrate",
      "resolve",
      "applied",
      "001_init.sql"
    ]);
    expect(parseCliCommand(["migrate", "resolve", "--rolled-back", "001_init.sql"])).toEqual([
      "migrate",
      "resolve",
      "rolled-back",
      "001_init.sql"
    ]);
  });

  it("pushes schema, becomes a no-op on rerun, and pulls schema snapshots", async () => {
    const directory = await createCliWorkspace();
    const io = createIo();

    expect(await main(["db", "push"], io, { cwd: directory })).toBe(0);
    expect(io.logs.join("\n")).toContain('CREATE TABLE IF NOT EXISTS "todos"');
    expect(io.logs.join("\n")).toContain('CREATE INDEX IF NOT EXISTS "todos_title_idx"');

    io.logs.length = 0;
    expect(await main(["db", "push"], io, { cwd: directory })).toBe(0);
    expect(io.logs).toEqual(["Schema is up to date."]);

    io.logs.length = 0;
    expect(await main(["db", "pull"], io, { cwd: directory })).toBe(0);
    const schema = JSON.parse(io.logs[0]) as Array<Record<string, unknown>>;
    expect(schema).toEqual([
      {
        name: "todos",
        columns: [
          { name: "id", type: "TEXT", notNull: true, primaryKey: true },
          { name: "title", type: "TEXT", notNull: true, primaryKey: false }
        ],
        indices: [
          {
            name: "todos_title_idx",
            columns: ["title"],
            unique: false
          }
        ]
      }
    ]);
  });

  it("generates, applies, detects checksum drift, and resolves migration history", async () => {
    const directory = await createCliWorkspace();
    const io = createIo();

    expect(await main(["migrate", "generate", "init"], io, { cwd: directory })).toBe(0);
    const migrationFiles = await readdir(join(directory, "migrations"));
    expect(migrationFiles).toHaveLength(1);
    const [migrationFile] = migrationFiles;

    io.logs.length = 0;
    expect(await main(["migrate", "status"], io, { cwd: directory })).toBe(0);
    expect(io.logs.join("\n")).toContain(`Pending migrations: ${migrationFile}`);

    io.logs.length = 0;
    expect(await main(["migrate", "apply"], io, { cwd: directory })).toBe(0);
    expect(io.logs).toContain(`Applied ${migrationFile}`);

    io.logs.length = 0;
    expect(await main(["migrate", "status"], io, { cwd: directory })).toBe(0);
    expect(io.logs.join("\n")).toContain(`Applied migrations: ${migrationFile}`);
    expect(io.logs.join("\n")).toContain("Schema drift: none");

    const migrationPath = join(directory, "migrations", migrationFile);
    const originalContent = await readFile(migrationPath, "utf8");
    await writeFile(migrationPath, `${originalContent}\n-- changed\n`, "utf8");

    io.errors.length = 0;
    expect(await main(["migrate", "apply"], io, { cwd: directory })).toBe(1);
    expect(io.errors.join("\n")).toContain("Applied migrations have changed");

    await writeFile(migrationPath, originalContent, "utf8");

    const manualMigration = "99999999999999_manual.sql";
    await writeFile(
      join(directory, "migrations", manualMigration),
      'ALTER TABLE "todos" ADD COLUMN "notes" TEXT;\n',
      "utf8"
    );

    io.logs.length = 0;
    expect(await main(["migrate", "resolve", "--applied", manualMigration], io, { cwd: directory })).toBe(0);
    expect(io.logs).toContain(`Resolved ${manualMigration} as applied.`);

    io.logs.length = 0;
    expect(await main(["db", "pull"], io, { cwd: directory })).toBe(0);
    expect(io.logs[0]).not.toContain("notes");

    io.logs.length = 0;
    expect(await main(["migrate", "resolve", "--rolled-back", manualMigration], io, { cwd: directory })).toBe(0);
    expect(io.logs).toContain(`Resolved ${manualMigration} as rolled back.`);

    io.logs.length = 0;
    expect(await main(["migrate", "status"], io, { cwd: directory })).toBe(0);
    expect(io.logs.join("\n")).toContain(`Pending migrations: ${manualMigration}`);
  });

  it(
    "loads decorator-authored TypeScript models from ezorm.config.ts via the published bin path",
    async () => {
      await ensureCliBuild();
      const directory = await createTypeScriptCliWorkspace();

      const pushResult = runCliBinary(["db", "push"], directory);
      expect(pushResult.status).toBe(0);
      expect(pushResult.stdout).toContain('CREATE TABLE IF NOT EXISTS "todos"');
      expect(pushResult.stdout).toContain('CREATE INDEX IF NOT EXISTS "todos_title_idx"');

      const rerunResult = runCliBinary(["db", "push"], directory);
      expect(rerunResult.status).toBe(0);
      expect(rerunResult.stdout).toContain("Schema is up to date.");
    },
    15_000
  );

  it(
    "discovers TypeScript models imported through a separate @ezorm/core package copy via the published bin path",
    async () => {
      await ensureCliBuild();
      const directory = await createTypeScriptCliWorkspaceWithExternalCoreCopy();

      const pushResult = runCliBinary(["db", "push"], directory);
      expect(pushResult.status).toBe(0);
      expect(pushResult.stdout).toContain('CREATE TABLE IF NOT EXISTS "todos"');
      expect(pushResult.stderr).toBe("");
    },
    15_000
  );

  it(
    "generates full column definitions for decorator-authored TypeScript models via the published bin path",
    async () => {
      await ensureCliBuild();
      const directory = await createTypeScriptCliWorkspace();

      const generateResult = runCliBinary(["migrate", "generate", "init"], directory);
      expect(generateResult.status).toBe(0);
      expect(generateResult.stdout).toContain("Created migration");

      const migrationFiles = await readdir(join(directory, "migrations"));
      expect(migrationFiles).toHaveLength(1);
      const migrationContent = await readFile(join(directory, "migrations", migrationFiles[0]), "utf8");
      expect(migrationContent).toContain(
        'CREATE TABLE IF NOT EXISTS "todos" ("id" TEXT PRIMARY KEY NOT NULL, "title" TEXT NOT NULL, "completed" INTEGER DEFAULT 0)'
      );
      expect(migrationContent).toContain(
        'CREATE INDEX IF NOT EXISTS "todos_title_idx" ON "todos" ("title")'
      );
    },
    15_000
  );

  it("fails clearly when multiple config files are present", async () => {
    const directory = await createCliWorkspace();
    const io = createIo();

    await writeFile(
      join(directory, "ezorm.config.ts"),
      "export default globalThis.__EZORM_TEST_CONFIG__;\n",
      "utf8"
    );

    expect(await main(["db", "push"], io, { cwd: directory })).toBe(1);
    expect(io.errors.join("\n")).toContain("Found multiple Ezorm config files");
    expect(io.errors.join("\n")).toContain("ezorm.config.ts");
    expect(io.errors.join("\n")).toContain("ezorm.config.mjs");
  });

  it("initializes a TypeScript project, patches tsconfig, and creates a todo model", async () => {
    const directory = await createWorkspaceRoot({
      packageJson: { name: "init-ts", private: true },
      tsconfig: {
        extends: "./tsconfig.base.json",
        compilerOptions: {
          target: "ES2022",
          experimentalDecorators: false
        }
      },
      createSrcDirectory: true
    });
    const io = createIo();

    expect(await main(["init"], io, { cwd: directory })).toBe(0);

    const configContent = await readFile(join(directory, "ezorm.config.ts"), "utf8");
    expect(configContent).toContain('databaseUrl: "sqlite://./ezorm.db"');
    expect(configContent).toContain('modelPaths: ["src/models"]');

    const modelContent = await readFile(join(directory, "src/models/todo.ts"), "utf8");
    expect(modelContent).toContain('@Model({ table: "todos" })');
    expect(modelContent).toContain("export class Todo");

    const tsconfig = JSON.parse(await readFile(join(directory, "tsconfig.json"), "utf8")) as {
      extends?: string;
      compilerOptions?: Record<string, unknown>;
    };
    expect(tsconfig.extends).toBe("./tsconfig.base.json");
    expect(tsconfig.compilerOptions?.experimentalDecorators).toBe(true);
    expect(tsconfig.compilerOptions?.emitDecoratorMetadata).toBe(true);
  });

  it("initializes from a nested cwd at the nearest package root", async () => {
    const directory = await createWorkspaceRoot({
      packageJson: { name: "nested-root", private: true },
      tsconfig: {
        compilerOptions: {
          target: "ES2022"
        }
      },
      createSrcDirectory: true
    });
    const nestedDirectory = join(directory, "src/features/todos");
    await mkdir(nestedDirectory, { recursive: true });
    const io = createIo();

    expect(await main(["init"], io, { cwd: nestedDirectory })).toBe(0);
    expect(await readFile(join(directory, "ezorm.config.ts"), "utf8")).toContain("modelPaths");
  });

  it("falls back to the exact cwd when no package root exists", async () => {
    const directory = await createBareWorkspace();
    const io = createIo();

    expect(await main(["init", "--js"], io, { cwd: directory })).toBe(0);
    expect(await readFile(join(directory, "ezorm.config.cjs"), "utf8")).toContain("module.exports");
    expect(await readFile(join(directory, "ezorm.config.cjs"), "utf8")).toContain('modelPaths: ["models"]');
    expect(await readFile(join(directory, "models/todo.js"), "utf8")).toContain("module.exports = { Todo }");
  });

  it("uses package type to choose JavaScript scaffold style", async () => {
    const directory = await createWorkspaceRoot({
      packageJson: { name: "init-js", private: true, type: "module" },
      createSrcDirectory: true
    });
    const io = createIo();

    expect(await main(["init", "--js"], io, { cwd: directory })).toBe(0);
    expect(await readFile(join(directory, "ezorm.config.mjs"), "utf8")).toContain("export default");
    expect(await readFile(join(directory, "src/models/todo.js"), "utf8")).toContain(
      'import { Field, Model, PrimaryKey } from "@ezorm/core";'
    );
  });

  it("does not create the example todo model when an existing model is present", async () => {
    const directory = await createWorkspaceRoot({
      packageJson: { name: "existing-model", private: true },
      tsconfig: {
        compilerOptions: {
          target: "ES2022"
        }
      },
      createSrcDirectory: true
    });
    await writeFile(
      join(directory, "src/existing-model.ts"),
      [
        'import { Field, Model, PrimaryKey } from "@ezorm/core";',
        "",
        '@Model({ table: "existing_todos" })',
        "export class ExistingTodo {",
        "  @PrimaryKey()",
        "  @Field.string()",
        "  id!: string;",
        "}"
      ].join("\n"),
      "utf8"
    );
    const io = createIo();

    expect(await main(["init"], io, { cwd: directory })).toBe(0);
    expect(io.logs.join("\n")).toContain("Detected existing model files");
    expect(await fileExists(join(directory, "src/models/todo.ts"))).toBe(false);
  });

  it("creates a tsconfig when TypeScript scaffolding is requested", async () => {
    const directory = await createWorkspaceRoot({
      packageJson: { name: "create-tsconfig", private: true }
    });
    const io = createIo();

    expect(await main(["init", "--ts"], io, { cwd: directory })).toBe(0);
    const tsconfig = JSON.parse(await readFile(join(directory, "tsconfig.json"), "utf8")) as {
      compilerOptions?: Record<string, unknown>;
    };
    expect(tsconfig.compilerOptions?.experimentalDecorators).toBe(true);
    expect(tsconfig.compilerOptions?.emitDecoratorMetadata).toBe(true);
  });

  it("discovers TypeScript models when config.models is omitted", async () => {
    const directory = await createWorkspaceRoot({
      packageJson: { name: "scan-ts", private: true },
      tsconfig: {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          experimentalDecorators: true,
          emitDecoratorMetadata: true
        }
      },
      createSrcDirectory: true
    });
    const io = createIo();

    await writeFile(
      join(directory, "src/models.ts"),
      [
        'import { Field, Index, Model, PrimaryKey } from "@ezorm/core";',
        "",
        '@Model({ table: "todos" })',
        '@Index(["title"], { name: "todos_title_idx" })',
        "export class Todo {",
        "  @PrimaryKey()",
        "  @Field.string()",
        "  id!: string;",
        "",
        "  @Field.string()",
        "  title!: string;",
        "}"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(directory, "ezorm.config.ts"),
      [
        "export default {",
        `  databaseUrl: ${JSON.stringify(`sqlite://${join(directory, "app.sqlite")}`)},`,
        '  modelPaths: ["src"]',
        "};"
      ].join("\n"),
      "utf8"
    );

    expect(await main(["db", "push"], io, { cwd: directory })).toBe(0);
    expect(io.logs.join("\n")).toContain('CREATE TABLE IF NOT EXISTS "todos"');
    expect(io.logs.join("\n")).toContain('CREATE INDEX IF NOT EXISTS "todos_title_idx"');
  });

  it("prefers src/models when config.modelPaths is omitted", async () => {
    const directory = await createWorkspaceRoot({
      packageJson: { name: "scan-default-src-models", private: true },
      tsconfig: {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          experimentalDecorators: true,
          emitDecoratorMetadata: true
        }
      },
      createSrcDirectory: true
    });
    const io = createIo();

    await mkdir(join(directory, "src", "models"), { recursive: true });
    await writeFile(
      join(directory, "src", "models", "todo.ts"),
      [
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
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(directory, "src", "test.ts"),
      [
        'import { Field, Model, PrimaryKey } from "@ezorm/core";',
        "",
        '@Model({ table: "ignored_todos" })',
        "class IgnoredTodo {",
        "  @PrimaryKey()",
        "  @Field.string()",
        "  id!: string;",
        "}",
        "",
        'throw new Error("default scan should not load src/test.ts when src/models exists");'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(directory, "ezorm.config.ts"),
      [
        "export default {",
        `  databaseUrl: ${JSON.stringify(`sqlite://${join(directory, "app.sqlite")}`)},`,
        "};"
      ].join("\n"),
      "utf8"
    );

    expect(await main(["db", "push"], io, { cwd: directory })).toBe(0);
    io.logs.length = 0;
    expect(await main(["db", "pull"], io, { cwd: directory })).toBe(0);
    expect(io.logs[0]).toContain('"todos"');
    expect(io.logs[0]).not.toContain("ignored_todos");
  });

  it("prefers models when config.modelPaths is omitted and src/models is absent", async () => {
    const directory = await createWorkspaceRoot({
      packageJson: { name: "scan-default-models", private: true }
    });
    const io = createIo();

    await mkdir(join(directory, "models"), { recursive: true });
    await writeFile(
      join(directory, "models", "todo.js"),
      [
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
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(directory, "stray.js"),
      [
        'const { Field, Model, PrimaryKey } = require("@ezorm/core");',
        "",
        "class IgnoredTodo {}",
        "",
        'Field.string()(IgnoredTodo.prototype, "id");',
        'PrimaryKey()(IgnoredTodo.prototype, "id");',
        'Field.string()(IgnoredTodo.prototype, "title");',
        'Model({ table: "ignored_todos" })(IgnoredTodo);',
        "",
        'throw new Error("default scan should not load stray.js when models exists");'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(directory, "ezorm.config.cjs"),
      [
        "module.exports = {",
        `  databaseUrl: ${JSON.stringify(`sqlite://${join(directory, "app.sqlite")}`)},`,
        "};"
      ].join("\n"),
      "utf8"
    );

    expect(await main(["db", "push"], io, { cwd: directory })).toBe(0);
    io.logs.length = 0;
    expect(await main(["db", "pull"], io, { cwd: directory })).toBe(0);
    expect(io.logs[0]).toContain('"todos"');
    expect(io.logs[0]).not.toContain("ignored_todos");
  });

  it("falls back to src when config.modelPaths is omitted and no conventional model directory exists", async () => {
    const directory = await createWorkspaceRoot({
      packageJson: { name: "scan-default-src", private: true },
      tsconfig: {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          experimentalDecorators: true,
          emitDecoratorMetadata: true
        }
      },
      createSrcDirectory: true
    });
    const io = createIo();

    await writeFile(
      join(directory, "src", "models.ts"),
      [
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
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(directory, "ezorm.config.ts"),
      [
        "export default {",
        `  databaseUrl: ${JSON.stringify(`sqlite://${join(directory, "app.sqlite")}`)},`,
        "};"
      ].join("\n"),
      "utf8"
    );

    expect(await main(["db", "push"], io, { cwd: directory })).toBe(0);
    expect(io.logs.join("\n")).toContain('CREATE TABLE IF NOT EXISTS "todos"');
  });

  it("falls back to the project root when config.modelPaths is omitted and no src directory exists", async () => {
    const directory = await createWorkspaceRoot({
      packageJson: { name: "scan-default-root", private: true }
    });
    const io = createIo();

    await writeFile(
      join(directory, "todo.js"),
      [
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
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(directory, "ezorm.config.cjs"),
      [
        "module.exports = {",
        `  databaseUrl: ${JSON.stringify(`sqlite://${join(directory, "app.sqlite")}`)},`,
        "};"
      ].join("\n"),
      "utf8"
    );

    expect(await main(["db", "push"], io, { cwd: directory })).toBe(0);
    expect(io.logs.join("\n")).toContain('CREATE TABLE IF NOT EXISTS "todos"');
  });

  it("discovers TypeScript models for migrate generate when config.models is omitted", async () => {
    const directory = await createWorkspaceRoot({
      packageJson: { name: "scan-ts-generate", private: true },
      tsconfig: {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          experimentalDecorators: true,
          emitDecoratorMetadata: true
        }
      },
      createSrcDirectory: true
    });
    const io = createIo();

    await writeFile(
      join(directory, "src/models.ts"),
      [
        'import { Field, Index, Model, PrimaryKey } from "@ezorm/core";',
        "",
        '@Model({ table: "todos" })',
        '@Index(["title"], { name: "todos_title_idx" })',
        "export class Todo {",
        "  @PrimaryKey()",
        "  @Field.string()",
        "  id!: string;",
        "",
        "  @Field.string()",
        "  title!: string;",
        "",
        "  @Field.boolean({ defaultValue: false })",
        "  completed!: boolean;",
        "}"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(directory, "ezorm.config.ts"),
      [
        "export default {",
        `  databaseUrl: ${JSON.stringify(`sqlite://${join(directory, "app.sqlite")}`)},`,
        '  modelPaths: ["src"]',
        "};"
      ].join("\n"),
      "utf8"
    );

    expect(await main(["migrate", "generate", "init"], io, { cwd: directory })).toBe(0);
    const migrationFiles = await readdir(join(directory, "migrations"));
    expect(migrationFiles).toHaveLength(1);
    const migrationContent = await readFile(join(directory, "migrations", migrationFiles[0]), "utf8");
    expect(migrationContent).toContain(
      'CREATE TABLE IF NOT EXISTS "todos" ("id" TEXT PRIMARY KEY NOT NULL, "title" TEXT NOT NULL, "completed" INTEGER DEFAULT 0)'
    );
    expect(migrationContent).toContain(
      'CREATE INDEX IF NOT EXISTS "todos_title_idx" ON "todos" ("title")'
    );
  });

  it("discovers JavaScript models when config.models is omitted", async () => {
    const directory = await createWorkspaceRoot({
      packageJson: { name: "scan-js", private: true }
    });
    const io = createIo();

    await mkdir(join(directory, "models"), { recursive: true });
    await writeFile(
      join(directory, "models/todo.js"),
      [
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
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(directory, "ezorm.config.cjs"),
      [
        "module.exports = {",
        `  databaseUrl: ${JSON.stringify(`sqlite://${join(directory, "app.sqlite")}`)},`,
        '  modelPaths: ["."]',
        "};"
      ].join("\n"),
      "utf8"
    );

    expect(await main(["db", "push"], io, { cwd: directory })).toBe(0);
    expect(io.logs.join("\n")).toContain('CREATE TABLE IF NOT EXISTS "todos"');
  });

  it("ignores excluded directories during scan fallback", async () => {
    const directory = await createWorkspaceRoot({
      packageJson: { name: "scan-excludes", private: true }
    });
    const io = createIo();

    await mkdir(join(directory, "src"), { recursive: true });
    await mkdir(join(directory, "__tests__"), { recursive: true });
    await writeFile(
      join(directory, "src/todo.js"),
      [
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
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(directory, "__tests__/ignored.js"),
      [
        'const { Field, Model, PrimaryKey } = require("@ezorm/core");',
        "",
        "class IgnoredTodo {}",
        "",
        'Field.string()(IgnoredTodo.prototype, "id");',
        'PrimaryKey()(IgnoredTodo.prototype, "id");',
        'Field.string()(IgnoredTodo.prototype, "title");',
        'Model({ table: "ignored_todos" })(IgnoredTodo);',
        "",
        "module.exports = { IgnoredTodo };"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(directory, "ezorm.config.cjs"),
      [
        "module.exports = {",
        `  databaseUrl: ${JSON.stringify(`sqlite://${join(directory, "app.sqlite")}`)},`,
        '  modelPaths: ["."]',
        "};"
      ].join("\n"),
      "utf8"
    );

    expect(await main(["db", "push"], io, { cwd: directory })).toBe(0);
    io.logs.length = 0;
    expect(await main(["db", "pull"], io, { cwd: directory })).toBe(0);
    expect(io.logs[0]).toContain('"todos"');
    expect(io.logs[0]).not.toContain("ignored_todos");
  });

  it("fails clearly when scan fallback cannot find any models", async () => {
    const directory = await createWorkspaceRoot({
      packageJson: { name: "scan-none", private: true }
    });
    const io = createIo();

    await writeFile(
      join(directory, "ezorm.config.cjs"),
      [
        "module.exports = {",
        `  databaseUrl: ${JSON.stringify(`sqlite://${join(directory, "app.sqlite")}`)},`,
        '  modelPaths: ["."]',
        "};"
      ].join("\n"),
      "utf8"
    );

    expect(await main(["db", "push"], io, { cwd: directory })).toBe(1);
    expect(io.errors.join("\n")).toContain("discoverable model files");
    expect(io.errors.join("\n")).toContain('Prefer narrow modelPaths such as "src/models" or "models"');
  });

  it("fails fast for incomplete model metadata across schema-producing commands", async () => {
    const directory = await createInvalidCliWorkspace();
    const io = createIo();

    expect(await main(["migrate", "generate", "init"], io, { cwd: directory })).toBe(1);
    expect(io.errors.join("\n")).toContain("Model BrokenTodo for table todos must declare at least one field");
    await expect(readdir(join(directory, "migrations"))).rejects.toThrow();

    io.errors.length = 0;
    expect(await main(["db", "push"], io, { cwd: directory })).toBe(1);
    expect(io.errors.join("\n")).toContain("Model BrokenTodo for table todos must declare at least one field");

    io.errors.length = 0;
    expect(await main(["migrate", "status"], io, { cwd: directory })).toBe(1);
    expect(io.errors.join("\n")).toContain("Model BrokenTodo for table todos must declare at least one field");
  });
});

async function createCliWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ezorm-cli-"));
  tempDirectories.push(directory);

  const databasePath = join(directory, "app.sqlite");
  (globalThis as { __EZORM_TEST_CONFIG__?: unknown }).__EZORM_TEST_CONFIG__ = {
    databaseUrl: `sqlite://${databasePath}`,
    models: [CliTodoModel]
  };
  await writeFile(
    join(directory, "ezorm.config.mjs"),
    "export default globalThis.__EZORM_TEST_CONFIG__;\n",
    "utf8"
  );

  return directory;
}

async function createWorkspaceRoot(options: {
  packageJson?: Record<string, unknown>;
  tsconfig?: Record<string, unknown>;
  createSrcDirectory?: boolean;
}): Promise<string> {
  const baseDirectory = join(originalCwd, "packages/cli/.tmp");
  await mkdir(baseDirectory, { recursive: true });
  const directory = await mkdtemp(join(baseDirectory, "ezorm-init-"));
  tempDirectories.push(directory);

  if (options.packageJson) {
    await writeFile(join(directory, "package.json"), `${JSON.stringify(options.packageJson, null, 2)}\n`, "utf8");
  }
  if (options.tsconfig) {
    await writeFile(join(directory, "tsconfig.json"), `${JSON.stringify(options.tsconfig, null, 2)}\n`, "utf8");
  }
  if (options.createSrcDirectory) {
    await mkdir(join(directory, "src"), { recursive: true });
  }

  return directory;
}

async function createBareWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ezorm-init-bare-"));
  tempDirectories.push(directory);
  return directory;
}

async function createTypeScriptCliWorkspace(): Promise<string> {
  const baseDirectory = join(originalCwd, "packages/cli/.tmp");
  await mkdir(baseDirectory, { recursive: true });
  const directory = await mkdtemp(join(baseDirectory, "ezorm-cli-ts-"));
  tempDirectories.push(directory);

  await writeFile(
    join(directory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          experimentalDecorators: true,
          emitDecoratorMetadata: true
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(directory, "models.ts"),
    [
      'import { Field, Index, Model, PrimaryKey } from "@ezorm/core";',
      "",
      '@Model({ table: "todos" })',
      '@Index(["title"], { name: "todos_title_idx" })',
      "export class Todo {",
      "  @PrimaryKey()",
      "  @Field.string()",
      "  id!: string;",
      "",
      "  @Field.string()",
      "  title!: string;",
      "",
      "  @Field.boolean({ defaultValue: false })",
      "  completed!: boolean;",
      "}"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(directory, "ezorm.config.ts"),
    [
      'import { Todo } from "./models.ts";',
      "",
      "export default {",
      `  databaseUrl: ${JSON.stringify(`sqlite://${join(directory, "app.sqlite")}`)},`,
      "  models: [Todo]",
      "};"
    ].join("\n"),
    "utf8"
  );

  return directory;
}

async function createTypeScriptCliWorkspaceWithExternalCoreCopy(): Promise<string> {
  const directory = await createWorkspaceRoot({
    packageJson: { name: "scan-ts-external-core", private: true },
    tsconfig: {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        experimentalDecorators: true,
        emitDecoratorMetadata: true
      }
    },
    createSrcDirectory: true
  });

  await createExternalCorePackageCopy(directory);
  await mkdir(join(directory, "src", "models"), { recursive: true });
  await writeFile(
    join(directory, "src", "models", "todo.ts"),
    [
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
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(directory, "ezorm.config.ts"),
    [
      "export default {",
      `  databaseUrl: ${JSON.stringify(`sqlite://${join(directory, "app.sqlite")}`)},`,
      '  modelPaths: ["src/models"]',
      "};"
    ].join("\n"),
    "utf8"
  );

  return directory;
}

async function createInvalidCliWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ezorm-cli-invalid-"));
  tempDirectories.push(directory);

  class BrokenTodo {}
  Model({ table: "todos" })(BrokenTodo);

  const databasePath = join(directory, "app.sqlite");
  (globalThis as { __EZORM_TEST_CONFIG__?: unknown }).__EZORM_TEST_CONFIG__ = {
    databaseUrl: `sqlite://${databasePath}`,
    models: [BrokenTodo]
  };
  await writeFile(
    join(directory, "ezorm.config.mjs"),
    "export default globalThis.__EZORM_TEST_CONFIG__;\n",
    "utf8"
  );

  return directory;
}

async function ensureCliBuild(): Promise<void> {
  if (cliBuildPrepared) {
    return;
  }

  const result = spawnSync("pnpm", ["build:ezorm"], {
    cwd: originalCwd,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Failed to build ezorm CLI package");
  }

  cliBuildPrepared = true;
}

async function createExternalCorePackageCopy(directory: string): Promise<void> {
  const packageRoot = join(directory, "node_modules", "@ezorm", "core");
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify(
      {
        name: "@ezorm/core",
        type: "module",
        exports: {
          ".": "./src/index.ts"
        }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  await cp(resolve(originalCwd, "packages/core/src/index.ts"), join(packageRoot, "src", "index.ts"));
  await cp(resolve(originalCwd, "packages/core/src/metadata.ts"), join(packageRoot, "src", "metadata.ts"));
  await cp(resolve(originalCwd, "packages/core/src/types.ts"), join(packageRoot, "src", "types.ts"));

  const indexSource = await readFile(join(packageRoot, "src", "index.ts"), "utf8");
  await writeFile(
    join(packageRoot, "src", "index.ts"),
    indexSource.replaceAll("./metadata.js", "./metadata.ts").replaceAll("./types.js", "./types.ts"),
    "utf8"
  );

  const metadataSource = await readFile(join(packageRoot, "src", "metadata.ts"), "utf8");
  await writeFile(
    join(packageRoot, "src", "metadata.ts"),
    metadataSource.replaceAll("./types.js", "./types.ts"),
    "utf8"
  );
}

function runCliBinary(argv: string[], cwd: string) {
  return spawnSync(process.execPath, [join(originalCwd, "packages/cli/bin/ezorm.js"), ...argv], {
    cwd,
    encoding: "utf8"
  });
}

function createIo() {
  return {
    logs: [] as string[],
    errors: [] as string[],
    log(message?: unknown) {
      this.logs.push(String(message ?? ""));
    },
    error(message?: unknown) {
      this.errors.push(String(message ?? ""));
    }
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}
