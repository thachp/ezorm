import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { packProxyNodeArtifacts } from "./proxy-packaging.mjs";

const workspace = mkdtempSync(resolve(tmpdir(), "ezorm-proxy-smoke-"));
const { binaryTarball, proxyNodeTarball } = packProxyNodeArtifacts(workspace);

runInstallSmoke("npm", ["install", proxyNodeTarball, binaryTarball], "npm install smoke test");
runInstallSmoke("pnpm", ["add", proxyNodeTarball, binaryTarball], "pnpm add smoke test");

process.stdout.write(`Managed proxy smoke test passed with ${proxyNodeTarball}\n`);

function runInstallSmoke(command, args, label) {
  const installWorkspace = mkdtempSync(resolve(tmpdir(), "ezorm-proxy-install-"));
  run("npm", ["init", "-y"], installWorkspace);
  run(command, args, installWorkspace);

  const smokeScript = resolve(installWorkspace, "proxy-smoke.mjs");
  writeFileSync(
    smokeScript,
    [
      'import { ensureEzormProxy } from "@ezorm/proxy-node";',
      "",
      "let handle;",
      "",
      "try {",
      "  handle = await ensureEzormProxy({",
      '    databaseUrl: "sqlite::memory:"',
      "  });",
      "",
      '  const push = await fetch(`${handle.endpoint}/orm/schema/push`, {',
      '    method: "POST",',
      '    headers: { "content-type": "application/json" },',
      '    body: JSON.stringify({',
      '      models: [{',
      '        name: "User",',
      '        table: "users",',
      '        fields: [',
      '          { name: "id", type: "string", primaryKey: true },',
      '          { name: "email", type: "string" }',
      "        ],",
      '        indices: [],',
      '        relations: []',
      "      }]",
      "    })",
      "  });",
      "",
      "  if (!push.ok) {",
      '    throw new Error(`push failed with ${push.status}`);',
      "  }",
      "",
      '  const create = await fetch(`${handle.endpoint}/orm/create`, {',
      '    method: "POST",',
      '    headers: { "content-type": "application/json" },',
      '    body: JSON.stringify({',
      '      model: {',
      '        name: "User",',
      '        table: "users",',
      '        fields: [',
      '          { name: "id", type: "string", primaryKey: true },',
      '          { name: "email", type: "string" }',
      "        ],",
      '        indices: [],',
      '        relations: []',
      "      },",
      '      input: { id: "usr_1", email: "alice@example.com" }',
      "    })",
      "  });",
      "",
      "  if (!create.ok) {",
      '    throw new Error(`create failed with ${create.status}`);',
      "  }",
      "",
      '  const find = await fetch(`${handle.endpoint}/orm/find-by-id`, {',
      '    method: "POST",',
      '    headers: { "content-type": "application/json" },',
      '    body: JSON.stringify({',
      '      model: {',
      '        name: "User",',
      '        table: "users",',
      '        fields: [',
      '          { name: "id", type: "string", primaryKey: true },',
      '          { name: "email", type: "string" }',
      "        ],",
      '        indices: [],',
      '        relations: []',
      "      },",
      '      id: "usr_1"',
      "    })",
      "  });",
      "",
      "  if (!find.ok) {",
      '    throw new Error(`find failed with ${find.status}`);',
      "  }",
      "",
      "  const payload = await find.json();",
      '  if (payload?.email !== "alice@example.com") {',
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
