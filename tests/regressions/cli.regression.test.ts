import { describe, expect, it } from "vitest";
import { parseCliCommand, runCli } from "@sqlmodel/cli";

describe("regression: cli-routing", () => {
  it("parses projector replay commands consistently", () => {
    expect(parseCliCommand(["projector", "replay", "balances"])).toEqual([
      "projector",
      "replay",
      "balances"
    ]);
    expect(runCli(["migrate", "status"])).toBe("Queued migrate status");
  });
});
