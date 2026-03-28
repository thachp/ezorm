import { describe, expect, it } from "vitest";
import { InMemoryEventStore, UpcasterRegistry } from "@ezorm/events";

describe("regression: upcaster-replay", () => {
  it("preserves replay correctness after event schema upgrades", async () => {
    const store = new InMemoryEventStore();
    await store.append("account-1", 0, [
      { type: "deposited", payload: { amount: 10 }, schemaVersion: 1 }
    ]);

    const registry = new UpcasterRegistry();
    registry.register("deposited", 2, (event) => ({
      ...event,
      schemaVersion: 2,
      payload: {
        ...(event.payload as Record<string, unknown>),
        currency: "USD"
      }
    }));

    const upgraded = (await store.load("account-1")).map((event) => registry.apply(event));
    expect(upgraded[0]?.payload).toMatchObject({ amount: 10, currency: "USD" });
    expect(upgraded[0]?.schemaVersion).toBe(2);
  });
});

