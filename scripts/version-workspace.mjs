import { updateWorkspaceVersion } from "./npm-release-manifest.mjs";

const [version] = process.argv.slice(2);

if (!version) {
  throw new Error("Usage: node ./scripts/version-workspace.mjs <version>");
}

updateWorkspaceVersion(version);
process.stdout.write(`Updated workspace packages to ${version}\n`);
