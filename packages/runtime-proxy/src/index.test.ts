import { describe, expect, it, vi } from "vitest";
import { VersionConflictError } from "@sqlmodel/events";
import { ProxyRuntimeClient, ProxyRuntimeError } from "./index";

describe("@sqlmodel/runtime-proxy", () => {
  it("posts load requests and unwraps event lists", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        events: [
          {
            streamId: "account-1",
            version: 1,
            sequence: 1,
            type: "account.opened",
            payload: { owner: "alice" },
            schemaVersion: 1,
            recordedAt: new Date(0).toISOString()
          }
        ]
      })
    );
    const client = new ProxyRuntimeClient({
      endpoint: "http://runtime.internal/",
      fetchImpl
    });

    await expect(client.load("account-1")).resolves.toMatchObject([
      { streamId: "account-1", type: "account.opened" }
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://runtime.internal/events/load",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ streamId: "account-1" })
      })
    );
  });

  it("posts append requests with the current contract body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        events: [
          {
            streamId: "account-1",
            version: 1,
            sequence: 1,
            type: "account.opened",
            payload: {},
            schemaVersion: 1,
            recordedAt: new Date(0).toISOString()
          }
        ]
      })
    );
    const client = new ProxyRuntimeClient({ endpoint: "http://runtime.internal", fetchImpl });

    await client.append("account-1", 0, [{ type: "account.opened", payload: {} }]);

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://runtime.internal/events/append",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          streamId: "account-1",
          version: 0,
          events: [{ type: "account.opened", payload: {} }]
        })
      })
    );
  });

  it("calls the dedicated latest-version route", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ version: 3 }));
    const client = new ProxyRuntimeClient({ endpoint: "http://runtime.internal", fetchImpl });

    await expect(client.latestVersion("account-1")).resolves.toBe(3);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://runtime.internal/events/latest-version",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ streamId: "account-1" })
      })
    );
  });

  it("maps version conflicts into VersionConflictError", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          code: "version_conflict",
          message: "Version conflict for account-1: expected 0, actual 1",
          details: {
            streamId: "account-1",
            expectedVersion: 0,
            actualVersion: 1
          }
        },
        409
      )
    );
    const client = new ProxyRuntimeClient({ endpoint: "http://runtime.internal", fetchImpl });

    await expect(client.append("account-1", 0, [])).rejects.toEqual(
      new VersionConflictError("account-1", 0, 1)
    );
  });

  it("preserves proxy error details for non-conflict failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          code: "internal_error",
          message: "database is unavailable"
        },
        500
      )
    );
    const client = new ProxyRuntimeClient({ endpoint: "http://runtime.internal", fetchImpl });

    await expect(client.load("account-1")).rejects.toMatchObject({
      name: "ProxyRuntimeError",
      status: 500,
      code: "internal_error",
      message: "database is unavailable"
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
