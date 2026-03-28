import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { packProxyNodeArtifacts } from "./proxy-packaging.mjs";

const workspace = mkdtempSync(resolve(tmpdir(), "sqlmodel-proxy-smoke-"));
const { binaryTarball, proxyNodeTarball } = packProxyNodeArtifacts(workspace);

runInstallSmoke("npm", ["install", proxyNodeTarball, binaryTarball], "npm install smoke test");
runInstallSmoke("pnpm", ["add", proxyNodeTarball, binaryTarball], "pnpm add smoke test");

process.stdout.write(`Managed proxy smoke test passed with ${proxyNodeTarball}\n`);

function runInstallSmoke(command, args, label) {
  const installWorkspace = mkdtempSync(resolve(tmpdir(), "sqlmodel-proxy-install-"));
  run("npm", ["init", "-y"], installWorkspace);
  run(command, args, installWorkspace);

  const smokeScript = resolve(installWorkspace, "proxy-smoke.mjs");
  writeFileSync(
    smokeScript,
    [
      'import { ensureSqlModelProxy } from "@sqlmodel/proxy-node";',
      "",
      "let handle;",
      "",
      "try {",
      "  handle = await ensureSqlModelProxy({",
      '    databaseUrl: "sqlite::memory:"',
      "  });",
      "",
      '  const append = await fetch(`${handle.endpoint}/events/append`, {',
      '    method: "POST",',
      '    headers: { "content-type": "application/json" },',
      '    body: JSON.stringify({',
      '      streamId: "account-1",',
      "      version: 0,",
      '      events: [{ event_type: "account.opened", payload: { owner: "alice" }, schema_version: 1, metadata: null }]',
      "    })",
      "  });",
      "",
      "  if (!append.ok) {",
      '    throw new Error(`append failed with ${append.status}`);',
      "  }",
      "",
      '  const load = await fetch(`${handle.endpoint}/events/load`, {',
      '    method: "POST",',
      '    headers: { "content-type": "application/json" },',
      '    body: JSON.stringify({ streamId: "account-1" })',
      "  });",
      "",
      "  if (!load.ok) {",
      '    throw new Error(`load failed with ${load.status}`);',
      "  }",
      "",
      "  const payload = await load.json();",
      '  if (!Array.isArray(payload.events) || payload.events.length !== 1) {',
      '    throw new Error(`unexpected payload: ${JSON.stringify(payload)}`);',
      "  }",
      "",
      '  console.log("Managed proxy smoke scenario passed");',
      "} finally {",
      "  await handle?.close();",
      "}"
    ].join("\n")
  );

  const result = run("node", [smokeScript], installWorkspace);
  assertOutput(result.stdout, "Managed proxy smoke scenario passed", label);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
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
