import { describe, expect, it } from "vitest";
import { formatCliHelp, parseCliCommand, runCli } from "sqlmod";

describe("regression: cli-routing", () => {
  it("parses projector replay commands consistently", () => {
    expect(parseCliCommand(["projector", "replay", "balances"])).toEqual([
      "projector",
      "replay",
      "balances"
    ]);
    expect(runCli(["migrate", "status"])).toBe("Queued migrate status");
  });

  it("documents the sqlmod command surface", () => {
    expect(formatCliHelp()).toContain("sqlmod migrate status");
  });
});
