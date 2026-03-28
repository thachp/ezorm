import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corePackageDir = resolve(rootDir, "packages/core");
const ormPackageDir = resolve(rootDir, "packages/orm");
const cliPackageDir = resolve(rootDir, "packages/cli");
const workspace = mkdtempSync(resolve(tmpdir(), "ezorm-smoke-"));

const coreTarballPath = packPackage(corePackageDir);
const ormTarballPath = packPackage(ormPackageDir);
const tarballPath = packPackage(cliPackageDir);

runNpmInstallSmoke();
runPnpmAddSmoke();
runNpxPackageSmoke();

process.stdout.write(`Smoke test passed with ${tarballPath}\n`);

function packPackage(cwd) {
  const packResult = spawnSync(
    "npm",
    ["pack", "--json", "--pack-destination", workspace],
    {
      cwd,
      encoding: "utf8"
    }
  );

  if (packResult.status !== 0) {
    if (packResult.stdout) {
      process.stderr.write(packResult.stdout);
    }
    if (packResult.stderr) {
      process.stderr.write(packResult.stderr);
    }
    process.exit(packResult.status ?? 1);
  }

  const [{ filename }] = parsePackOutput(packResult.stdout);
  return resolve(workspace, filename);
}

function runNpmInstallSmoke() {
  const installWorkspace = mkdtempSync(resolve(tmpdir(), "ezorm-install-"));
  run("npm", ["init", "-y"], installWorkspace);
  run("npm", ["install", coreTarballPath, ormTarballPath, tarballPath], installWorkspace);
  assertOutput(run("npx", ["ezorm", "--help"], installWorkspace).stdout, "Usage:", "npm install smoke test");
  assertOutput(run("npx", ["ezorm", "init", "--ts"], installWorkspace).stdout, "Created ezorm.config.ts", "npm init smoke test");
  assert(existsSync(resolve(installWorkspace, "models/todo.ts")), "npm init should create a TypeScript todo model");
  assertOutput(
    readFileSync(resolve(installWorkspace, "tsconfig.json"), "utf8"),
    '"emitDecoratorMetadata": true',
    "npm init should patch tsconfig"
  );
  assertOutput(
    run("npx", ["ezorm", "db", "push"], installWorkspace).stdout,
    'CREATE TABLE IF NOT EXISTS "todos"',
    "npm install TypeScript scan fallback smoke test"
  );
}

function runPnpmAddSmoke() {
  const installWorkspace = mkdtempSync(resolve(tmpdir(), "ezorm-pnpm-"));
  writeFileSync(
    resolve(installWorkspace, "package.json"),
    `${JSON.stringify(
      {
        name: "ezorm-pnpm-smoke",
        private: true,
        dependencies: {
          "@ezorm/core": `file:${coreTarballPath}`,
          "@ezorm/orm": `file:${ormTarballPath}`,
          ezorm: `file:${tarballPath}`
        },
        pnpm: {
          overrides: {
            "@ezorm/core": `file:${coreTarballPath}`,
            "@ezorm/orm": `file:${ormTarballPath}`
          }
        }
      },
      null,
      2
    )}\n`
  );
  run("pnpm", ["install"], installWorkspace);
  assertOutput(
    run("pnpm", ["exec", "ezorm", "--help"], installWorkspace).stdout,
    "Usage:",
    "pnpm add smoke test"
  );
  assertOutput(
    run("pnpm", ["exec", "ezorm", "init", "--js"], installWorkspace).stdout,
    "Created ezorm.config.cjs",
    "pnpm init js smoke test"
  );
  assert(existsSync(resolve(installWorkspace, "models/todo.js")), "pnpm init --js should create a JavaScript todo model");
  assertOutput(
    run("pnpm", ["exec", "ezorm", "db", "push"], installWorkspace).stdout,
    'CREATE TABLE IF NOT EXISTS "todos"',
    "pnpm add JavaScript scan fallback smoke test"
  );
}

function runNpxPackageSmoke() {
  const npxWorkspace = mkdtempSync(resolve(tmpdir(), "ezorm-npx-"));
  assertOutput(
    run(
      "npx",
      [
        "--yes",
        "--package",
        coreTarballPath,
        "--package",
        ormTarballPath,
        "--package",
        tarballPath,
        "ezorm",
        "--help"
      ],
      npxWorkspace
    ).stdout,
    "Usage:",
    "npx package smoke test"
  );
}

function run(command, args, cwd = workspace) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    if (result.stdout) {
      process.stderr.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exit(result.status ?? 1);
  }

  return result;
}

function assertOutput(actual, expected, label) {
  if (!actual.includes(expected)) {
    throw new Error(`${label} expected "${expected}" but received "${actual.trim()}"`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parsePackOutput(stdout) {
  const match = stdout.match(/\[\s*{\s*"id":[\s\S]*\]\s*$/);

  if (!match) {
    throw new Error(`Could not parse npm pack output: ${stdout}`);
  }

  return JSON.parse(match[0]);
}
