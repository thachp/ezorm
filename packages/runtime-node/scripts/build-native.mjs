import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const workspaceRoot = resolve(packageDir, "../..");
const release = process.argv.includes("--release");
const profile = release ? "release" : "debug";
const crateName = "sqlmodel_napi";
const outputDir = resolve(packageDir, "native");
const outputFile = resolve(outputDir, `${crateName}.node`);

mkdirSync(outputDir, { recursive: true });

const cargoArgs = ["build", "-p", crateName];
if (release) {
  cargoArgs.push("--release");
}

const build = spawnSync("cargo", cargoArgs, {
  cwd: workspaceRoot,
  stdio: "inherit"
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const sourceFile = resolve(
  workspaceRoot,
  "target",
  profile,
  `${libraryPrefix()}${crateName}.${libraryExtension()}`
);

if (!existsSync(sourceFile)) {
  console.error(`Native library not found at ${sourceFile}`);
  process.exit(1);
}

copyFileSync(sourceFile, outputFile);
console.log(`Built native addon: ${outputFile}`);

function libraryPrefix() {
  return process.platform === "win32" ? "" : "lib";
}

function libraryExtension() {
  if (process.platform === "darwin") {
    return "dylib";
  }
  if (process.platform === "win32") {
    return "dll";
  }
  return "so";
}

