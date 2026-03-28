import { describe, expect, it } from "vitest";
import { formatCliHelp, parseCliCommand } from "ezorm";

describe("regression: cli-routing", () => {
  it("parses the ORM-first command surface consistently", () => {
    expect(parseCliCommand(["db", "push"])).toEqual(["db", "push"]);
    expect(parseCliCommand(["migrate", "status"])).toEqual(["migrate", "status"]);
    expect(parseCliCommand(["migrate", "resolve", "--applied", "001_init.sql"])).toEqual([
      "migrate",
      "resolve",
      "applied",
      "001_init.sql"
    ]);
  });

  it("documents the ezorm command surface", () => {
    expect(formatCliHelp()).toContain("ezorm migrate status");
    expect(formatCliHelp()).toContain("ezorm migrate resolve --applied <filename>");
    expect(formatCliHelp()).toContain("ezorm db push");
    expect(formatCliHelp()).not.toContain("ezorm projector replay");
  });
});
