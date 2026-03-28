import { describe, expect, it, vi } from "vitest";

const { ensureEzormProxy } = vi.hoisted(() => ({
  ensureEzormProxy: vi.fn()
}));

vi.mock("@ezorm/proxy-node", () => ({
  ensureEzormProxy
}));

import { ensureNextEdgeProxy } from "./node";

describe("@ezorm/next node runtime", () => {
  it("returns the managed proxy endpoint", async () => {
    ensureEzormProxy.mockResolvedValue({
      endpoint: "http://127.0.0.1:4510",
      close: async () => undefined
    });

    await expect(
      ensureNextEdgeProxy({
        databaseUrl: "sqlite://next-edge.db"
      })
    ).resolves.toBe("http://127.0.0.1:4510");

    expect(ensureEzormProxy).toHaveBeenCalledWith({
      databaseUrl: "sqlite://next-edge.db"
    });
  });
});
