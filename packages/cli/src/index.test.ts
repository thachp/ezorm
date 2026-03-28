import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { Field, Index, Model, PrimaryKey } from "@ezorm/core";
import { main, parseCliCommand } from "./index";

const originalCwd = process.cwd();
const tempDirectories: string[] = [];

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
