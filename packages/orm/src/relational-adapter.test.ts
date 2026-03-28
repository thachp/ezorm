import { describe, expect, it } from "vitest";
import { detectDialect } from "./relational-adapter";

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
});
