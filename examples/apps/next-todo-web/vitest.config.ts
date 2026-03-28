import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { createWorkspaceAliases } from "../../vitest.workspace-alias";

const currentDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(currentDir, "../../..");

export default defineConfig({
  resolve: {
    alias: createWorkspaceAliases(workspaceRoot)
  },
  plugins: [tsconfigPaths({ projects: [resolve(currentDir, "../../../tsconfig.json")] })],
  test: {
    environment: "node",
    include: ["app/**/*.test.ts*", "lib/**/*.test.ts"]
  }
});
