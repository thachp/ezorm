import { describe, expect, it, vi } from "vitest";
import { InMemoryEventStore, InMemorySnapshotStore } from "@ezorm/events";
import {
  CommandBus,
  ProjectorRegistry,
  QueryBus,
  defineCommand,
  defineQuery,
  registerCommandHandler,
  registerProjector,
  registerQueryHandler
} from "./index";

describe("@ezorm/cqrs", () => {
  it("requires version on all command writes", async () => {
    const command = defineCommand<{ version: number; amount: number }, string>("deposit");
    const store = new InMemoryEventStore();
    const bus = new CommandBus({ eventStore: store });

    registerCommandHandler(bus, command, async ({ payload }) => ({
      result: `deposited:${payload.amount}`,
      events: [{ type: "account.deposited", payload: { amount: payload.amount }, schemaVersion: 1 }]
    }));

    await expect(
      bus.execute(command, {
        streamId: "account-1",
        payload: { amount: 10 } as { version: number; amount: number }
      })
    ).rejects.toThrow(/requires a numeric version/);
  });

  it("dispatches stored events to projectors after successful writes", async () => {
    const command = defineCommand<{ version: number; amount: number }, string>("deposit");
    const store = new InMemoryEventStore();
    const snapshots = new InMemorySnapshotStore();
    const projectors = new ProjectorRegistry();
    const projectorHandle = vi.fn();

    registerProjector(projectors, {
      name: "balances",
      handle: async (events) => projectorHandle(events)
    });

    const bus = new CommandBus({ eventStore: store, snapshots }, projectors);
    registerCommandHandler(bus, command, async ({ payload, streamId }) => ({
      result: streamId,
      events: [{ type: "account.deposited", payload: { amount: payload.amount }, schemaVersion: 1 }],
      snapshot: {
        streamId,
        version: payload.version,
        schemaVersion: 1,
        state: { balance: payload.amount }
      }
    }));

    const result = await bus.execute(command, {
      streamId: "account-1",
      payload: { version: 0, amount: 15 }
    });

    expect(result.events[0]?.version).toBe(1);
    expect(projectorHandle).toHaveBeenCalledOnce();
    await expect(snapshots.load("account-1")).resolves.toMatchObject({ version: 1 });
  });

  it("registers and executes typed queries", async () => {
    const query = defineQuery<{ streamId: string }, number>("balance");
    const store = new InMemoryEventStore();
    await store.append("account-1", 0, [
      { type: "account.deposited", payload: { amount: 10 }, schemaVersion: 1 },
      { type: "account.deposited", payload: { amount: 5 }, schemaVersion: 1 }
    ]);

    const bus = new QueryBus({ eventStore: store });
    registerQueryHandler(bus, query, async ({ streamId }, context) => {
      const events = await context.eventStore.load(streamId);
      return events.reduce((total, event) => total + Number((event.payload as { amount: number }).amount ?? 0), 0);
    });

    await expect(bus.execute(query, { streamId: "account-1" })).resolves.toBe(15);
  });
});
