import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const proxyNodePackageDir = resolve(rootDir, "packages/proxy-node");
export const RELEASED_PROXY_TARGET_TRIPLES = [
  "x86_64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc"
];

const BINARY_PACKAGE_BY_TARGET = {
  "aarch64-apple-darwin": "@ezorm/proxy-bin-aarch64-apple-darwin",
  "x86_64-apple-darwin": "@ezorm/proxy-bin-x86_64-apple-darwin",
  "aarch64-unknown-linux-gnu": "@ezorm/proxy-bin-aarch64-unknown-linux-gnu",
  "x86_64-unknown-linux-gnu": "@ezorm/proxy-bin-x86_64-unknown-linux-gnu",
  "aarch64-pc-windows-msvc": "@ezorm/proxy-bin-aarch64-pc-windows-msvc",
  "x86_64-pc-windows-msvc": "@ezorm/proxy-bin-x86_64-pc-windows-msvc"
};

export function detectProxyTargetTriple(platform = process.platform, arch = process.arch) {
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
    throw new Error(`Unsupported proxy target for packaging: ${platform}/${arch}`);
  }

  return targetTriple;
}

export function packProxyNodeArtifacts(outputDir) {
  mkdirSync(outputDir, { recursive: true });

  const binaryPackage = packCurrentPlatformBinaryPackage(outputDir);
  const proxyNodePackage = packNpmPackage(proxyNodePackageDir, outputDir);

  return {
    binaryTarball: resolve(outputDir, binaryPackage.filename),
    binaryPackageName: binaryPackage.packageName,
    proxyNodeTarball: resolve(outputDir, proxyNodePackage.filename),
    targetTriple: binaryPackage.targetTriple
  };
}

export function packCurrentPlatformBinaryPackage(outputDir) {
  mkdirSync(outputDir, { recursive: true });

  const targetTriple = detectProxyTargetTriple();
  const sourceBinaryPath = buildCurrentPlatformProxyBinary(targetTriple);
  return packageProxyBinaryPackage({
    outputDir,
    sourceBinaryPath,
    targetTriple
  });
}

export function packNpmPackage(packageDir, outputDir) {
  const result = spawnSync("npm", ["pack", "--json", "--pack-destination", outputDir], {
    cwd: packageDir,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  const [{ filename }] = parsePackOutput(result.stdout);
  return { filename };
}

export function packageProxyBinaryPackage({ outputDir, sourceBinaryPath, targetTriple }) {
  mkdirSync(outputDir, { recursive: true });

  const packageName = getBinaryPackageNameForTarget(targetTriple);
  const executableName = executableNameForTarget(targetTriple);
  const templateDir = resolve(rootDir, "packages", packageName.replace("@ezorm/", ""));
  const stagingDir = mkdtempSync(resolve(tmpdir(), "ezorm-proxy-bin-"));

  mkdirSync(resolve(stagingDir, "bin"), { recursive: true });
  copyFileSync(resolve(templateDir, "package.json"), resolve(stagingDir, "package.json"));
  copyFileSync(resolve(templateDir, "README.md"), resolve(stagingDir, "README.md"));

  const licensePath = resolve(templateDir, "LICENSE");
  if (existsSync(licensePath)) {
    copyFileSync(licensePath, resolve(stagingDir, "LICENSE"));
  }

  copyFileSync(sourceBinaryPath, resolve(stagingDir, "bin", executableName));

  const packResult = packNpmPackage(stagingDir, outputDir);
  return {
    ...packResult,
    packageName,
    targetTriple
  };
}

export function buildCurrentPlatformProxyBinary(targetTriple = detectProxyTargetTriple()) {
  const currentTargetTriple = detectProxyTargetTriple();

  if (currentTargetTriple !== targetTriple) {
    throw new Error(
      `Current runner target ${currentTargetTriple} does not match requested target ${targetTriple}.`
    );
  }

  const executableName = executableNameForTarget(targetTriple);
  const build = spawnSync("cargo", ["build", "-p", "ezorm_proxy", "--release"], {
    cwd: rootDir,
    stdio: "inherit"
  });

  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }

  const sourceBinary = resolve(rootDir, "target", "release", executableName);
  if (!existsSync(sourceBinary)) {
    throw new Error(`Proxy binary not found at ${sourceBinary}`);
  }

  return sourceBinary;
}

export function executableNameForTarget(targetTriple) {
  return targetTriple.includes("windows") ? "ezorm_proxy.exe" : "ezorm_proxy";
}

export function getBinaryPackageNameForTarget(targetTriple) {
  const packageName = BINARY_PACKAGE_BY_TARGET[targetTriple];

  if (!packageName) {
    throw new Error(`Unsupported proxy package target: ${targetTriple}`);
  }

  return packageName;
}

function parsePackOutput(stdout) {
  const match = stdout.match(/\[\s*{\s*"id":[\s\S]*\]\s*$/);

  if (!match) {
    throw new Error(`Could not parse npm pack output: ${stdout}`);
  }

  return JSON.parse(match[0]);
}
