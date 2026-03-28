import { describe, expect, it } from "vitest";
import {
  EventSourcedAggregate,
  InMemoryEventStore,
  InMemorySnapshotStore,
  UpcasterRegistry,
  VersionConflictError,
  type DomainEvent,
  type StoredEvent
} from "./index";

class AccountAggregate extends EventSourcedAggregate<DomainEvent<{ amount: number }>> {
  balance = 0;

  deposit(amount: number): void {
    this.record({ type: "account.deposited", payload: { amount }, schemaVersion: 1 });
  }

  protected apply(event: DomainEvent<{ amount: number }>): void {
    if (event.type === "account.deposited") {
      this.balance += event.payload.amount;
    }
  }
}

describe("@ezorm/events", () => {
  it("appends events with strict version checks", async () => {
    const store = new InMemoryEventStore();
    await store.append("account-1", 0, [{ type: "account.opened", payload: {}, schemaVersion: 1 }]);

    await expect(
      store.append("account-1", 0, [{ type: "account.deposited", payload: { amount: 10 } }])
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it("stores only the latest snapshot for a stream", async () => {
    const snapshots = new InMemorySnapshotStore();
    await snapshots.save({ streamId: "account-1", version: 2, schemaVersion: 1, state: { balance: 20 } });
    await snapshots.save({ streamId: "account-1", version: 1, schemaVersion: 1, state: { balance: 10 } });

    await expect(snapshots.load("account-1")).resolves.toMatchObject({ version: 2 });
  });

  it("replays history through an aggregate", async () => {
    const store = new InMemoryEventStore();
    await store.append("account-1", 0, [
      { type: "account.deposited", payload: { amount: 10 }, schemaVersion: 1 },
      { type: "account.deposited", payload: { amount: 5 }, schemaVersion: 1 }
    ]);

    const aggregate = new AccountAggregate().loadFromHistory(await store.load("account-1"));
    expect(aggregate.balance).toBe(15);
    expect(aggregate.version).toBe(2);
  });

  it("upcasts historical events for replay", () => {
    const registry = new UpcasterRegistry();
    registry.register("account.deposited", 2, (event) => ({
      ...event,
      schemaVersion: 2,
      payload: {
        ...(event.payload as Record<string, unknown>),
        currency: "USD"
      }
    }));

    const upgraded = registry.apply({
      streamId: "account-1",
      version: 1,
      sequence: 1,
      recordedAt: new Date().toISOString(),
      type: "account.deposited",
      payload: { amount: 10 },
      schemaVersion: 1
    } satisfies StoredEvent);

    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.payload).toMatchObject({ amount: 10, currency: "USD" });
  });
});
