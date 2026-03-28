import { describe, expect, it } from "vitest";
import { ProxyOrmClient } from "@ezorm/runtime-proxy";
import { NEXT_EDGE_RUNTIME } from "./index";
import { createNextEdgeRuntime } from "./edge";

describe("@ezorm/next edge runtime", () => {
  it("builds a proxy-backed client for edge usage", () => {
    const runtime = createNextEdgeRuntime("https://runtime.internal");

    expect(runtime.runtime).toBe(NEXT_EDGE_RUNTIME);
    expect(runtime.client).toBeInstanceOf(ProxyOrmClient);
  });
});
