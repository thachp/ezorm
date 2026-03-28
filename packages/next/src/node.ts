import { ensureEzormProxy, type EnsureEzormProxyOptions } from "@ezorm/proxy-node";
import { createNodeRuntime, type NodeRuntimeConnectOptions } from "@ezorm/runtime-node";
import type { OrmClient } from "@ezorm/orm";

const NEXT_NODE_CLIENTS_KEY = Symbol.for("ezorm.next.nodeClients");

export interface NextNodeClientOptions {
  connect?: NodeRuntimeConnectOptions;
}

export interface NextNodeClientCacheOptions extends NextNodeClientOptions {
  cacheKey?: string;
}

export async function createNextNodeClient(options?: NextNodeClientOptions): Promise<OrmClient> {
  return createNodeRuntime({
    connect: options?.connect
  });
}

export function getNextNodeClient(options?: NextNodeClientCacheOptions): Promise<OrmClient> {
  const cacheKey = options?.cacheKey ?? "default";
  const cache = getNodeClientCache();
  const existing = cache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const clientPromise = createNextNodeClient({
    connect: options?.connect
  }).catch((error) => {
    cache.delete(cacheKey);
    throw error;
  });

  cache.set(cacheKey, clientPromise);
  return clientPromise;
}

export async function ensureNextEdgeProxy(options: EnsureEzormProxyOptions): Promise<string> {
  const proxy = await ensureEzormProxy(options);
  return proxy.endpoint;
}

function getNodeClientCache(): Map<string, Promise<OrmClient>> {
  const globalState = globalThis as typeof globalThis & {
    [NEXT_NODE_CLIENTS_KEY]?: Map<string, Promise<OrmClient>>;
  };

  if (!globalState[NEXT_NODE_CLIENTS_KEY]) {
    globalState[NEXT_NODE_CLIENTS_KEY] = new Map<string, Promise<OrmClient>>();
  }

  return globalState[NEXT_NODE_CLIENTS_KEY];
}
