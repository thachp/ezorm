import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertEdgeSafeImport } from "@sqlmodel/next";

describe("regression: next-edge-import", () => {
  it("keeps the edge entrypoint free of native runtime imports", () => {
    const source = readFileSync(
      new URL("../../packages/next/src/edge.ts", import.meta.url),
      "utf8"
    );

    expect(() => assertEdgeSafeImport(source)).not.toThrow();
  });

  it("rejects managed proxy imports in edge modules", () => {
    expect(() => assertEdgeSafeImport('import "@sqlmodel/proxy-node";')).toThrow(
      "Edge runtime modules must not import @sqlmodel/proxy-node"
    );
  });
});
