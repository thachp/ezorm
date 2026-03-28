import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectRelationalAdapter, detectDialect } from "./relational-adapter";

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

describe("relational adapter", () => {
  it("detects supported relational database urls", () => {
    expect(detectDialect("sqlite::memory:")).toBe("sqlite");
    expect(detectDialect("sqlite:///tmp/ezorm.db")).toBe("sqlite");
    expect(detectDialect("postgres://localhost/ezorm")).toBe("postgres");
    expect(detectDialect("postgresql://localhost/ezorm")).toBe("postgres");
    expect(detectDialect("mysql://localhost/ezorm")).toBe("mysql");
    expect(detectDialect("mssql://localhost/ezorm")).toBe("mssql");
    expect(detectDialect("sqlserver://localhost/ezorm")).toBe("mssql");
  });

  it("rejects unsupported database urls", () => {
    expect(() => detectDialect("redis://localhost")).toThrow(
      "Unsupported database url for @ezorm/orm"
    );
  });

  it("keeps relative sqlite file paths relative to the current working directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ezorm-relative-sqlite-"));
    process.chdir(directory);

    const adapter = await connectRelationalAdapter("sqlite://./relative.db");
    await adapter.execute('CREATE TABLE "todos" ("id" TEXT PRIMARY KEY)');
    await adapter.close();

    expect(await readdir(directory)).toContain("relative.db");
  });
});
