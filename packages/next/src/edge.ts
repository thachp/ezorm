import { ProxyOrmClient } from "@ezorm/runtime-proxy";
import { NEXT_EDGE_RUNTIME, assertEdgeSafeImport } from "./index";

export function createNextEdgeRuntime(endpoint: string) {
  return {
    runtime: NEXT_EDGE_RUNTIME,
    client: new ProxyOrmClient({ endpoint })
  };
}

export { assertEdgeSafeImport };
