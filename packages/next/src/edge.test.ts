import { describe, expect, it } from "vitest";
import { ProxyOrmClient } from "@ezorm/runtime-proxy";
import { createNextEdgeClient } from "./edge";

describe("@ezorm/next edge runtime", () => {
  it("builds a proxy-backed client for edge usage", () => {
    const client = createNextEdgeClient({ endpoint: "https://runtime.internal" });

    expect(client).toBeInstanceOf(ProxyOrmClient);
  });
});
