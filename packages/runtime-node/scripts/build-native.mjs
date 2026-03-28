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
const targetTriple = detectTargetTriple(process.platform, process.arch);
const outputDir = resolve(packageDir, "native", targetTriple);
const flatOutputDir = resolve(packageDir, "native");
const outputFile = resolve(outputDir, `${crateName}.node`);
const flatOutputFile = resolve(flatOutputDir, `${crateName}.node`);

mkdirSync(outputDir, { recursive: true });
mkdirSync(flatOutputDir, { recursive: true });

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
copyFileSync(sourceFile, flatOutputFile);
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

function detectTargetTriple(platform, arch) {
  const supportedTargets = {
    "darwin:arm64": "aarch64-apple-darwin",
    "darwin:x64": "x86_64-apple-darwin",
    "linux:arm64": "aarch64-unknown-linux-gnu",
    "linux:x64": "x86_64-unknown-linux-gnu",
    "win32:arm64": "aarch64-pc-windows-msvc",
    "win32:x64": "x86_64-pc-windows-msvc"
  };
  const targetTriple = supportedTargets[`${platform}:${arch}`];

  if (!targetTriple) {
    console.error(
      `Unsupported native target for sqlmodel: ${platform}/${arch}. Build on a supported target or provide SQLMODEL_NAPI_PATH at runtime.`
    );
    process.exit(1);
  }

  return targetTriple;
}
