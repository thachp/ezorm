import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createNodeRuntime: vi.fn(),
  ensureEzormProxy: vi.fn()
}));

vi.mock("@ezorm/runtime-node", () => ({
  createNodeRuntime: mocks.createNodeRuntime
}));

vi.mock("@ezorm/proxy-node", () => ({
  ensureEzormProxy: mocks.ensureEzormProxy
}));

import { createNextNodeClient, ensureNextEdgeProxy, getNextNodeClient } from "./node";

describe("@ezorm/next node runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNodeClientCache();
  });

  it("creates a direct ORM client for node usage", async () => {
    const client = { kind: "node-client" };
    mocks.createNodeRuntime.mockResolvedValue(client);

    await expect(
      createNextNodeClient({
        connect: { databaseUrl: "sqlite::memory:" }
      })
    ).resolves.toBe(client);

    expect(mocks.createNodeRuntime).toHaveBeenCalledWith({
      connect: { databaseUrl: "sqlite::memory:" }
    });
  });

  it("reuses a cached node client for the same cache key", async () => {
    const firstClient = { kind: "cached-client" };
    mocks.createNodeRuntime.mockResolvedValue(firstClient);

    const clientA = getNextNodeClient({
      cacheKey: "todos",
      connect: { databaseUrl: "sqlite::memory:" }
    });
    const clientB = getNextNodeClient({
      cacheKey: "todos",
      connect: { databaseUrl: "sqlite:///ignored.db" }
    });

    await expect(clientA).resolves.toBe(firstClient);
    await expect(clientB).resolves.toBe(firstClient);
    expect(mocks.createNodeRuntime).toHaveBeenCalledTimes(1);
  });

  it("creates distinct cached clients for different cache keys", async () => {
    const firstClient = { kind: "client-a" };
    const secondClient = { kind: "client-b" };
    mocks.createNodeRuntime.mockResolvedValueOnce(firstClient).mockResolvedValueOnce(secondClient);

    await expect(getNextNodeClient({ cacheKey: "a" })).resolves.toBe(firstClient);
    await expect(getNextNodeClient({ cacheKey: "b" })).resolves.toBe(secondClient);
    expect(mocks.createNodeRuntime).toHaveBeenCalledTimes(2);
  });

  it("returns the managed proxy endpoint", async () => {
    mocks.ensureEzormProxy.mockResolvedValue({
      endpoint: "http://127.0.0.1:4510",
      close: async () => undefined
    });

    await expect(
      ensureNextEdgeProxy({
        databaseUrl: "sqlite://next-edge.db"
      })
    ).resolves.toBe("http://127.0.0.1:4510");

    expect(mocks.ensureEzormProxy).toHaveBeenCalledWith({
      databaseUrl: "sqlite://next-edge.db"
    });
  });
});

function resetNodeClientCache(): void {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("ezorm.next.nodeClients")];
}
