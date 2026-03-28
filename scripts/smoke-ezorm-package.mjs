import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = resolve(rootDir, "packages/cli");
const workspace = mkdtempSync(resolve(tmpdir(), "ezorm-smoke-"));

const packResult = spawnSync(
  "npm",
  ["pack", "--json", "--pack-destination", workspace],
  {
    cwd: packageDir,
    encoding: "utf8"
  }
);

if (packResult.status !== 0) {
  process.stderr.write(packResult.stderr);
  process.exit(packResult.status ?? 1);
}

const [{ filename }] = parsePackOutput(packResult.stdout);
const tarballPath = resolve(workspace, filename);

run("npm", ["init", "-y"]);
run("npm", ["install", tarballPath]);
assertOutput(
  run("npx", ["ezorm", "migrate", "status"]).stdout,
  "Queued migrate status",
  "npm install smoke test"
);

run("pnpm", ["add", tarballPath]);
assertOutput(
  run("pnpm", ["exec", "ezorm", "migrate", "status"]).stdout,
  "Queued migrate status",
  "pnpm add smoke test"
);

assertOutput(
  run("npx", ["--yes", "--package", tarballPath, "ezorm", "migrate", "status"]).stdout,
  "Queued migrate status",
  "npx package smoke test"
);

process.stdout.write(`Smoke test passed with ${tarballPath}\n`);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: workspace,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  return result;
}

function assertOutput(actual, expected, label) {
  if (!actual.includes(expected)) {
    throw new Error(`${label} expected "${expected}" but received "${actual.trim()}"`);
  }
}

function parsePackOutput(stdout) {
  const match = stdout.match(/\[\s*{\s*"id":[\s\S]*\]\s*$/);

  if (!match) {
    throw new Error(`Could not parse npm pack output: ${stdout}`);
  }

  return JSON.parse(match[0]);
}
