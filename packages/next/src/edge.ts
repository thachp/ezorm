import { ProxyOrmClient, type ProxyOrmClientOptions } from "@ezorm/runtime-proxy";
import { assertEdgeSafeImport } from "./index";

export function createNextEdgeClient(options: ProxyOrmClientOptions): ProxyOrmClient {
  return new ProxyOrmClient(options);
}

export { assertEdgeSafeImport };
