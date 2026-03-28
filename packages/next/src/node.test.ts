import { describe, expect, it, vi } from "vitest";

const { ensureSqlModelProxy } = vi.hoisted(() => ({
  ensureSqlModelProxy: vi.fn()
}));

vi.mock("@sqlmodel/proxy-node", () => ({
  ensureSqlModelProxy
}));

import { ensureNextEdgeProxy } from "./node";

describe("@sqlmodel/next node runtime", () => {
  it("returns the managed proxy endpoint", async () => {
    ensureSqlModelProxy.mockResolvedValue({
      endpoint: "http://127.0.0.1:4510",
      close: async () => undefined
    });

    await expect(
      ensureNextEdgeProxy({
        databaseUrl: "sqlite://next-edge.db"
      })
    ).resolves.toBe("http://127.0.0.1:4510");

    expect(ensureSqlModelProxy).toHaveBeenCalledWith({
      databaseUrl: "sqlite://next-edge.db"
    });
  });
});
