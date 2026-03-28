import { describe, expect, it, vi } from "vitest";
import { createNativeBindingFactory, createNodeRuntime, detectNativeTargetTriple } from "./index";

describe("@sqlmodel/runtime-node", () => {
  it("uses a binding factory when a database url is supplied", async () => {
    const bootstrap = vi.fn();
    const runtime = await createNodeRuntime(undefined, {
      connect: { databaseUrl: "sqlite::memory:" },
      factory: async ({ databaseUrl }) => {
        expect(databaseUrl).toBe("sqlite::memory:");
        return {
          bootstrap,
          load: async () => [],
          loadAll: async () => [],
          append: async () => [],
          latestVersion: async () => 0
        };
      }
    });

    await expect(runtime.latestVersion("account-1")).resolves.toBe(0);
    expect(bootstrap).toHaveBeenCalledOnce();
  });

  it("maps native event payloads into the public stored-event shape", async () => {
    const factory = createNativeBindingFactory(() => ({
      connectNativeRuntime() {
        const nativeEvents = [
          {
            streamId: "account-1",
            version: 1,
            sequence: 1,
            eventType: "account.opened",
            payloadJson: JSON.stringify({ owner: "alice" }),
            schemaVersion: 1,
            metadataJson: JSON.stringify({ source: "native" })
          }
        ];
        return {
          bootstrap() {},
          load() {
            return nativeEvents;
          },
          loadAll() {
            return nativeEvents;
          },
          append() {
            return nativeEvents;
          },
          latestVersion() {
            return 1;
          }
        };
      }
    }));

    const binding = await factory({ databaseUrl: "sqlite::memory:" });
    const events = await binding.load("account-1");
    expect(events[0]).toMatchObject({
      streamId: "account-1",
      type: "account.opened",
      payload: { owner: "alice" },
      metadata: { source: "native" }
    });
  });

  it("maps supported platforms to packaged target triples", () => {
    expect(detectNativeTargetTriple("darwin", "arm64")).toBe("aarch64-apple-darwin");
    expect(detectNativeTargetTriple("linux", "x64")).toBe("x86_64-unknown-linux-gnu");
  });

  it("fails fast on unsupported packaged targets", () => {
    expect(() => detectNativeTargetTriple("freebsd", "x64")).toThrow(
      "Unsupported native target for sqlmodel: freebsd/x64"
    );
  });
});
