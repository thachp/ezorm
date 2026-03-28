export const NEXT_NODE_RUNTIME = "nodejs";
export const NEXT_EDGE_RUNTIME = "edge";

const NODE_ONLY_EZORM_IMPORTS = [
  "@ezorm/runtime-node",
  "@ezorm/proxy-node",
  "@ezorm/orm"
];

export function assertEdgeSafeImport(moduleSource: string): void {
  for (const packageName of NODE_ONLY_EZORM_IMPORTS) {
    if (moduleSource.includes(packageName)) {
      throw new Error(`Edge runtime modules must not import ${packageName}`);
    }
  }
}
