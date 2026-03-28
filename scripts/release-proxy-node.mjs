import { spawnSync } from "node:child_process";
import { rootDir } from "./proxy-packaging.mjs";

run("pnpm", ["pack:proxy-node"]);
run("pnpm", ["smoke:proxy-node"]);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
