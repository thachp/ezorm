import { resolve } from "node:path";

export function createWorkspaceAliases(rootDir: string): Record<string, string> {
  return {
    "@ezorm/core": resolve(rootDir, "packages/core/src/index.ts"),
    "@ezorm/example-todo-domain": resolve(rootDir, "examples/packages/todo-domain/src/index.ts"),
    "@ezorm/nestjs": resolve(rootDir, "packages/nestjs/src/index.ts"),
    "@ezorm/next": resolve(rootDir, "packages/next/src/index.ts"),
    "@ezorm/next/edge": resolve(rootDir, "packages/next/src/edge.ts"),
    "@ezorm/next/node": resolve(rootDir, "packages/next/src/node.ts"),
    "@ezorm/orm": resolve(rootDir, "packages/orm/src/index.ts"),
    "@ezorm/proxy-node": resolve(rootDir, "packages/proxy-node/src/index.ts"),
    "@ezorm/runtime-node": resolve(rootDir, "packages/runtime-node/src/index.ts"),
    "@ezorm/runtime-proxy": resolve(rootDir, "packages/runtime-proxy/src/index.ts")
  };
}
