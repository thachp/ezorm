import { readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const PUBLISHABLE_JS_PACKAGES = [
  "@ezorm/core",
  "@ezorm/orm",
  "@ezorm/runtime-node",
  "@ezorm/runtime-proxy",
  "@ezorm/proxy-node",
  "@ezorm/next",
  "@ezorm/nestjs",
  "ezorm"
];

export const RELEASED_PROXY_BINARY_PACKAGES = [
  "@ezorm/proxy-bin-x86_64-unknown-linux-gnu",
  "@ezorm/proxy-bin-x86_64-apple-darwin",
  "@ezorm/proxy-bin-aarch64-apple-darwin",
  "@ezorm/proxy-bin-x86_64-pc-windows-msvc"
];

export const VERSIONED_WORKSPACE_PACKAGES = [
  ...PUBLISHABLE_JS_PACKAGES,
  ...RELEASED_PROXY_BINARY_PACKAGES,
  "@ezorm/proxy-bin-aarch64-unknown-linux-gnu",
  "@ezorm/proxy-bin-aarch64-pc-windows-msvc"
];

export const PUBLISH_ORDER = [
  "@ezorm/core",
  "@ezorm/orm",
  "@ezorm/runtime-node",
  "@ezorm/runtime-proxy",
  ...RELEASED_PROXY_BINARY_PACKAGES,
  "@ezorm/proxy-node",
  "@ezorm/next",
  "@ezorm/nestjs",
  "ezorm"
];

const PACKAGE_DIR_BY_NAME = {
  ezorm: "packages/cli",
  "@ezorm/core": "packages/core",
  "@ezorm/orm": "packages/orm",
  "@ezorm/runtime-node": "packages/runtime-node",
  "@ezorm/runtime-proxy": "packages/runtime-proxy",
  "@ezorm/proxy-node": "packages/proxy-node",
  "@ezorm/next": "packages/next",
  "@ezorm/nestjs": "packages/nestjs",
  "@ezorm/proxy-bin-aarch64-apple-darwin": "packages/proxy-bin-aarch64-apple-darwin",
  "@ezorm/proxy-bin-aarch64-pc-windows-msvc": "packages/proxy-bin-aarch64-pc-windows-msvc",
  "@ezorm/proxy-bin-aarch64-unknown-linux-gnu": "packages/proxy-bin-aarch64-unknown-linux-gnu",
  "@ezorm/proxy-bin-x86_64-apple-darwin": "packages/proxy-bin-x86_64-apple-darwin",
  "@ezorm/proxy-bin-x86_64-pc-windows-msvc": "packages/proxy-bin-x86_64-pc-windows-msvc",
  "@ezorm/proxy-bin-x86_64-unknown-linux-gnu": "packages/proxy-bin-x86_64-unknown-linux-gnu"
};

export function resolvePackageDir(packageName) {
  const relativeDir = PACKAGE_DIR_BY_NAME[packageName];

  if (!relativeDir) {
    throw new Error(`Unknown workspace package: ${packageName}`);
  }

  return resolve(rootDir, relativeDir);
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readPackageManifest(packageName) {
  return readJson(resolve(resolvePackageDir(packageName), "package.json"));
}

export function assertWorkspaceVersionConsistency() {
  let workspaceVersion;

  for (const packageName of VERSIONED_WORKSPACE_PACKAGES) {
    const manifest = readPackageManifest(packageName);

    if (typeof manifest.version !== "string" || !manifest.version.trim()) {
      throw new Error(`Package ${packageName} is missing a valid version.`);
    }

    if (!workspaceVersion) {
      workspaceVersion = manifest.version;
      continue;
    }

    if (manifest.version !== workspaceVersion) {
      throw new Error(
        `Workspace version mismatch: ${packageName} is ${manifest.version}, expected ${workspaceVersion}.`
      );
    }
  }

  for (const packageName of VERSIONED_WORKSPACE_PACKAGES) {
    const manifest = readPackageManifest(packageName);

    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      const dependencies = manifest[field];
      if (!dependencies || typeof dependencies !== "object") {
        continue;
      }

      for (const dependencyName of Object.keys(dependencies)) {
        if (!VERSIONED_WORKSPACE_PACKAGES.includes(dependencyName)) {
          continue;
        }

        if (dependencies[dependencyName] !== workspaceVersion) {
          throw new Error(
            `${packageName} ${field}.${dependencyName} must be pinned to ${workspaceVersion}, found ${dependencies[dependencyName]}.`
          );
        }
      }
    }
  }

  return workspaceVersion;
}

export function updateWorkspaceVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid version: ${version}`);
  }

  for (const packageName of VERSIONED_WORKSPACE_PACKAGES) {
    const packageJsonPath = resolve(resolvePackageDir(packageName), "package.json");
    const manifest = readJson(packageJsonPath);

    manifest.version = version;

    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      const dependencies = manifest[field];
      if (!dependencies || typeof dependencies !== "object") {
        continue;
      }

      for (const dependencyName of Object.keys(dependencies)) {
        if (VERSIONED_WORKSPACE_PACKAGES.includes(dependencyName)) {
          dependencies[dependencyName] = version;
        }
      }
    }

    writeJson(packageJsonPath, manifest);
  }
}

export function resetOutputDirectory(outputDir) {
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
}

export function tarballNameFor(packageName, version) {
  return `${packageName.replace(/^@/, "").replace(/\//g, "-")}-${version}.tgz`;
}
