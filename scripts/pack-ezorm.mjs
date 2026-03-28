import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = resolve(rootDir, "packages/cli");
const outputDir = resolve(rootDir, ".artifacts/ezorm");

mkdirSync(outputDir, { recursive: true });

const result = spawnSync(
  "npm",
  ["pack", "--json", "--pack-destination", outputDir],
  {
    cwd: packageDir,
    encoding: "utf8"
  }
);

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

process.stdout.write(result.stdout);
