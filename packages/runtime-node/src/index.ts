import { createOrmClient, type OrmClient, type OrmClientOptions } from "@ezorm/orm";

export type NodeRuntimeConnectOptions = OrmClientOptions;

export async function createNodeRuntime(
  options?: { connect?: NodeRuntimeConnectOptions }
): Promise<OrmClient> {
  return createOrmClient({
    databaseUrl: options?.connect?.databaseUrl ?? "sqlite::memory:"
  });
}
