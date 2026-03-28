import { describe, expect, it, vi } from "vitest";
import {
  createNativeBindingFactory,
  createNodeRuntime,
  createProjectorRuntime,
  detectNativeTargetTriple
} from "./index";

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
          latestVersion: async () => 0,
          loadCheckpoint: async () => undefined,
          saveCheckpoint: async () => undefined,
          resetCheckpoint: async () => undefined
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
          },
          loadCheckpoint() {
            return { projector: "balances", lastSequence: 1 };
          },
          saveCheckpoint() {},
          resetCheckpoint() {}
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
    await expect(binding.loadCheckpoint?.("balances")).resolves.toEqual({
      projector: "balances",
      lastSequence: 1
    });
  });

  it("replays projectors from persisted checkpoints and supports reset", async () => {
    const checkpoints = new Map<string, number>();
    const runtime = await createProjectorRuntime({
      load: async () => [],
      loadAll: async (afterSequence = 0) =>
        [
          {
            streamId: "account-1",
            version: 1,
            sequence: 1,
            type: "account.opened",
            payload: { owner: "alice" },
            schemaVersion: 1,
            recordedAt: new Date(0).toISOString()
          },
          {
            streamId: "account-1",
            version: 2,
            sequence: 2,
            type: "account.deposited",
            payload: { amount: 10 },
            schemaVersion: 1,
            recordedAt: new Date(0).toISOString()
          }
        ].filter((event) => event.sequence > afterSequence),
      append: async () => [],
      latestVersion: async () => 2,
      loadCheckpoint: async (projector) => {
        const lastSequence = checkpoints.get(projector);
        return lastSequence === undefined ? undefined : { projector, lastSequence };
      },
      saveCheckpoint: async (checkpoint) => {
        checkpoints.set(checkpoint.projector, checkpoint.lastSequence);
      },
      resetCheckpoint: async (projector) => {
        checkpoints.delete(projector);
      }
    });

    const handler = vi.fn();
    const firstReplay = await runtime.replayProjector("balances", handler);
    const secondReplay = await runtime.replayProjector("balances", handler);
    await runtime.resetProjector("balances");
    const thirdReplay = await runtime.replayProjector("balances", handler);

    expect(firstReplay.lastSequence).toBe(2);
    expect(secondReplay.lastSequence).toBe(2);
    expect(thirdReplay.lastSequence).toBe(2);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("defaults to an in-memory projector runtime when no binding is supplied", async () => {
    const runtime = await createProjectorRuntime();

    await runtime.append("account-1", 0, [
      {
        type: "account.opened",
        payload: { owner: "alice" }
      }
    ]);

    const checkpoint = await runtime.replayProjector("balances", async () => undefined);
    expect(checkpoint.lastSequence).toBe(1);
    await expect(runtime.loadCheckpoint("balances")).resolves.toEqual(checkpoint);
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
