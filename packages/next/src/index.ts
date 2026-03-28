export const NEXT_NODE_RUNTIME = "nodejs";
export const NEXT_EDGE_RUNTIME = "edge";

const NODE_ONLY_SQLMODEL_IMPORTS = ["@sqlmodel/runtime-node", "@sqlmodel/proxy-node"];

export function assertEdgeSafeImport(moduleSource: string): void {
  for (const packageName of NODE_ONLY_SQLMODEL_IMPORTS) {
    if (moduleSource.includes(packageName)) {
      throw new Error(`Edge runtime modules must not import ${packageName}`);
    }
  }
}
