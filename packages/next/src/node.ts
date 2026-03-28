import { ensureSqlModelProxy, type EnsureSqlModelProxyOptions } from "@sqlmodel/proxy-node";
import { createNodeRuntime, type NodeRuntimeBinding } from "@sqlmodel/runtime-node";
import { NEXT_NODE_RUNTIME } from "./index";

export async function createNextNodeRuntime(
  binding?: NodeRuntimeBinding,
  options?: Parameters<typeof createNodeRuntime>[1]
) {
  return {
    runtime: NEXT_NODE_RUNTIME,
    store: await createNodeRuntime(binding, options)
  };
}

export async function ensureNextEdgeProxy(options: EnsureSqlModelProxyOptions): Promise<string> {
  const proxy = await ensureSqlModelProxy(options);
  return proxy.endpoint;
}
