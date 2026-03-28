#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { main } from "../dist/index.js";

const TYPESCRIPT_CONFIG_FILENAMES = [
  "ezorm.config.ts",
  "ezorm.config.mts",
  "ezorm.config.cts"
];

if (hasTypeScriptConfig(process.cwd())) {
  process.exitCode = runWithTsx();
} else {
  process.exitCode = await main(process.argv.slice(2));
}

function hasTypeScriptConfig(cwd) {
  return TYPESCRIPT_CONFIG_FILENAMES.some((filename) => existsSync(resolve(cwd, filename)));
}

function runWithTsx() {
  const require = createRequire(import.meta.url);
  const tsxPackagePath = require.resolve("tsx/package.json");
  const tsxCliPath = resolve(dirname(tsxPackagePath), "dist", "cli.mjs");
  const entrypointPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const result = spawnSync(process.execPath, [tsxCliPath, entrypointPath, ...process.argv.slice(2)], {
    encoding: "utf8"
  });

  if (result.error) {
    throw result.error;
  }
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  return result.status ?? 1;
}
