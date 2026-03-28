import { ensureEzormProxy, type EnsureEzormProxyOptions } from "@ezorm/proxy-node";
import { createNodeRuntime } from "@ezorm/runtime-node";
import { NEXT_NODE_RUNTIME } from "./index";

export async function createNextNodeRuntime(
  options?: Parameters<typeof createNodeRuntime>[0]
) {
  return {
    runtime: NEXT_NODE_RUNTIME,
    client: await createNodeRuntime(options)
  };
}

export async function ensureNextEdgeProxy(options: EnsureEzormProxyOptions): Promise<string> {
  const proxy = await ensureEzormProxy(options);
  return proxy.endpoint;
}
