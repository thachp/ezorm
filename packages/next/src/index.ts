export const NEXT_NODE_RUNTIME = "nodejs";
export const NEXT_EDGE_RUNTIME = "edge";

export function assertEdgeSafeImport(moduleSource: string): void {
  if (moduleSource.includes("@sqlmodel-ts/runtime-node")) {
    throw new Error("Edge runtime modules must not import @sqlmodel-ts/runtime-node");
  }
}

