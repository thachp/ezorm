import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  PUBLISHABLE_JS_PACKAGES,
  PUBLISH_ORDER,
  assertWorkspaceVersionConsistency,
  readPackageManifest,
  resetOutputDirectory,
  resolvePackageDir,
  rootDir,
  tarballNameFor
} from "./npm-release-manifest.mjs";
import {
  RELEASED_PROXY_TARGET_TRIPLES,
  buildCurrentPlatformProxyBinary,
  packageProxyBinaryPackage
} from "./proxy-packaging.mjs";

const DEFAULT_JS_OUTPUT_DIR = resolve(rootDir, ".artifacts/npm-packages");
const DEFAULT_PROXY_BINARY_OUTPUT_DIR = resolve(rootDir, ".artifacts/npm-binaries");

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "assert-workspace-version":
  case "read-version":
    process.stdout.write(`${assertWorkspaceVersionConsistency()}\n`);
    break;
  case "build-js-packages":
    buildJsPackages();
    break;
  case "pack-js-packages":
    packJsPackages(args[0] ? resolve(rootDir, args[0]) : DEFAULT_JS_OUTPUT_DIR);
    break;
  case "verify-unpublished":
    verifyUnpublishedPackages();
    break;
  case "pack-proxy-binary":
    packProxyBinary(args);
    break;
  case "publish-artifacts":
    publishArtifacts(args[0] ? resolve(rootDir, args[0]) : resolve(rootDir, ".artifacts/release"));
    break;
  default:
    throw new Error(
      [
        "Usage:",
        "  node ./scripts/npm-release.mjs assert-workspace-version",
        "  node ./scripts/npm-release.mjs read-version",
        "  node ./scripts/npm-release.mjs build-js-packages",
        "  node ./scripts/npm-release.mjs pack-js-packages [outputDir]",
        "  node ./scripts/npm-release.mjs verify-unpublished",
        "  node ./scripts/npm-release.mjs pack-proxy-binary <targetTriple> [outputDir] [binaryPath]",
        "  node ./scripts/npm-release.mjs publish-artifacts [artifactsDir]"
      ].join("\n")
    );
}

function buildJsPackages() {
  assertWorkspaceVersionConsistency();

  for (const packageName of PUBLISHABLE_JS_PACKAGES) {
    run(
      "pnpm",
      ["--dir", resolvePackageDir(packageName), "run", "build"],
      { stdio: "inherit" }
    );
  }
}

function packJsPackages(outputDir) {
  assertWorkspaceVersionConsistency();
  resetOutputDirectory(outputDir);

  for (const packageName of PUBLISHABLE_JS_PACKAGES) {
    const manifest = readPackageManifest(packageName);
    const result = run(
      "npm",
      ["pack", "--json", "--pack-destination", outputDir],
      {
        cwd: resolvePackageDir(packageName)
      }
    );

    const [{ filename }] = parsePackOutput(result.stdout);
    process.stdout.write(`Packed ${manifest.name}@${manifest.version} -> ${filename}\n`);
  }
}

function verifyUnpublishedPackages() {
  const version = assertWorkspaceVersionConsistency();

  for (const packageName of PUBLISH_ORDER) {
    const result = spawnSync("npm", ["view", `${packageName}@${version}`, "version", "--json"], {
      cwd: rootDir,
      encoding: "utf8"
    });

    if (result.status === 0) {
      throw new Error(`Package ${packageName}@${version} is already published.`);
    }

    const output = `${result.stdout}\n${result.stderr}`;
    const missingPackage =
      output.includes("E404") ||
      output.includes("404") ||
      output.includes("is not in this registry") ||
      output.includes("No match found");

    if (!missingPackage) {
      throw new Error(`Failed to check npm for ${packageName}@${version}:\n${output.trim()}`);
    }
  }

  process.stdout.write(`Verified npm availability for ${version}\n`);
}

function packProxyBinary(args) {
  const [targetTriple, outputDirArg, binaryPathArg] = args;

  if (!targetTriple) {
    throw new Error("pack-proxy-binary requires a target triple.");
  }

  if (!RELEASED_PROXY_TARGET_TRIPLES.includes(targetTriple)) {
    throw new Error(
      `Unsupported release proxy target ${targetTriple}. Expected one of ${RELEASED_PROXY_TARGET_TRIPLES.join(", ")}.`
    );
  }

  const outputDir = outputDirArg
    ? resolve(rootDir, outputDirArg)
    : DEFAULT_PROXY_BINARY_OUTPUT_DIR;

  if (!outputDirArg) {
    resetOutputDirectory(outputDir);
  }

  const sourceBinaryPath = binaryPathArg
    ? resolve(rootDir, binaryPathArg)
    : buildCurrentPlatformProxyBinary(targetTriple);
  const result = packageProxyBinaryPackage({
    outputDir,
    sourceBinaryPath,
    targetTriple
  });

  process.stdout.write(
    `Packed ${result.packageName}@${assertWorkspaceVersionConsistency()} -> ${result.filename}\n`
  );
}

function publishArtifacts(artifactsDir) {
  const version = assertWorkspaceVersionConsistency();

  for (const packageName of PUBLISH_ORDER) {
    const tarballPath = findTarballPath(artifactsDir, tarballNameFor(packageName, version));
    const args = ["publish", tarballPath, "--provenance"];

    if (packageName.startsWith("@")) {
      args.push("--access", "public");
    }

    run("npm", args, { stdio: "inherit" });
  }
}

function findTarballPath(rootSearchDir, filename) {
  const matches = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name === filename) {
        matches.push(entryPath);
      }
    }
  };

  visit(rootSearchDir);

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one artifact named ${filename} in ${rootSearchDir}, found ${matches.length}.`
    );
  }

  return matches[0];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe"
  });

  if (result.status !== 0) {
    if (options.stdio !== "inherit") {
      if (result.stdout) {
        process.stderr.write(result.stdout);
      }
      if (result.stderr) {
        process.stderr.write(result.stderr);
      }
    }

    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }

  return result;
}

function parsePackOutput(stdout) {
  const match = stdout.match(/\[\s*{\s*"id":[\s\S]*\]\s*$/);

  if (!match) {
    throw new Error(`Could not parse npm pack output: ${stdout}`);
  }

  return JSON.parse(match[0]);
}
