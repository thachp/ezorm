import { copyFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const workspaceRoot = resolve(packageDir, "../..");
const buildOutputDir = resolve(workspaceRoot, "dist/packages/proxy-node/src");
const packageOutputDir = resolve(packageDir, "dist");

const build = spawnSync("pnpm", ["build:ts"], {
  cwd: workspaceRoot,
  stdio: "inherit"
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

mkdirSync(packageOutputDir, { recursive: true });
copyFileSync(resolve(buildOutputDir, "index.js"), resolve(packageOutputDir, "index.js"));
copyFileSync(resolve(buildOutputDir, "index.d.ts"), resolve(packageOutputDir, "index.d.ts"));
