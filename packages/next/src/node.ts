import { ensureSqlModelProxy, type EnsureSqlModelProxyOptions } from "@sqlmodel/proxy-node";
import { createNodeRuntime } from "@sqlmodel/runtime-node";
import { NEXT_NODE_RUNTIME } from "./index";

export async function createNextNodeRuntime(
  options?: Parameters<typeof createNodeRuntime>[0]
) {
  return {
    runtime: NEXT_NODE_RUNTIME,
    client: await createNodeRuntime(options)
  };
}

export async function ensureNextEdgeProxy(options: EnsureSqlModelProxyOptions): Promise<string> {
  const proxy = await ensureSqlModelProxy(options);
  return proxy.endpoint;
}
