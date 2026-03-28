import { describe, expect, it } from "vitest";
import { InMemoryEventStore, VersionConflictError } from "@sqlmodel-ts/events";

describe("regression: version-conflict", () => {
  it("rejects stale version writes and prevents duplicate append under retry", async () => {
    const store = new InMemoryEventStore();
    await store.append("account-1", 0, [{ type: "opened", payload: {}, schemaVersion: 1 }]);

    const attempts = await Promise.allSettled([
      store.append("account-1", 1, [{ type: "deposited", payload: { amount: 10 }, schemaVersion: 1 }]),
      store.append("account-1", 1, [{ type: "deposited", payload: { amount: 10 }, schemaVersion: 1 }])
    ]);

    const fulfilled = attempts.filter(
      (
        attempt
      ): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof store.append>>> =>
        attempt.status === "fulfilled"
    );
    const rejected = attempts.filter((attempt): attempt is PromiseRejectedResult => attempt.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(VersionConflictError);
    await expect(store.load("account-1")).resolves.toHaveLength(2);
  });
});
