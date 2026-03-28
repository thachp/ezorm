import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths({ projects: [resolve(currentDir, "../../../tsconfig.json")] })],
  test: {
    environment: "node",
    include: ["app/**/*.test.ts*", "lib/**/*.test.ts"]
  }
});
