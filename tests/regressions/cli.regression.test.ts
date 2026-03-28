import { describe, expect, it } from "vitest";
import { formatCliHelp, parseCliCommand, runCli } from "ezorm";

describe("regression: cli-routing", () => {
  it("parses the ORM-first command surface consistently", () => {
    expect(parseCliCommand(["db", "push"])).toEqual(["db", "push"]);
    expect(runCli(["migrate", "status"])).toBe("Queued migrate status");
  });

  it("documents the ezorm command surface", () => {
    expect(formatCliHelp()).toContain("ezorm migrate status");
    expect(formatCliHelp()).toContain("ezorm db push");
    expect(formatCliHelp()).not.toContain("ezorm projector replay");
  });
});
