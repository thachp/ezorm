import { ProxyRuntimeClient } from "@sqlmodel-ts/runtime-proxy";
import { NEXT_EDGE_RUNTIME, assertEdgeSafeImport } from "./index";

export function createNextEdgeRuntime(endpoint: string) {
  return {
    runtime: NEXT_EDGE_RUNTIME,
    store: new ProxyRuntimeClient({ endpoint })
  };
}

export { assertEdgeSafeImport };
