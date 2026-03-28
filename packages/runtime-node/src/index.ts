import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOrmClient, type OrmClient, type OrmClientOptions } from "@sqlmodel/orm";

export interface NodeRuntimeConnectOptions extends OrmClientOptions {
  modulePath?: string;
}

export async function createNodeRuntime(
  options?: { connect?: NodeRuntimeConnectOptions }
): Promise<OrmClient> {
  return createOrmClient({
    databaseUrl: options?.connect?.databaseUrl ?? "sqlite::memory:"
  });
}

export function detectNativeTargetTriple(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch
): string {
  const supportedTargets: Record<string, string> = {
    "darwin:arm64": "aarch64-apple-darwin",
    "darwin:x64": "x86_64-apple-darwin",
    "linux:arm64": "aarch64-unknown-linux-gnu",
    "linux:x64": "x86_64-unknown-linux-gnu",
    "win32:arm64": "aarch64-pc-windows-msvc",
    "win32:x64": "x86_64-pc-windows-msvc"
  };
  const targetTriple = supportedTargets[`${platform}:${arch}`];

  if (!targetTriple) {
    throw new Error(
      `Unsupported native target for sqlmodel: ${platform}/${arch}. Set \`SQLMODEL_NAPI_PATH\` to a compatible .node file.`
    );
  }

  return targetTriple;
}

export function loadNativeModule(modulePath?: string): unknown {
  const require = createRequire(import.meta.url);
  const here = dirname(fileURLToPath(import.meta.url));
  let unsupportedTargetError: Error | undefined;
  let targetTriple: string | undefined;

  try {
    targetTriple = detectNativeTargetTriple();
  } catch (error) {
    unsupportedTargetError = error instanceof Error ? error : new Error(String(error));
  }

  const candidates = [
    modulePath,
    process.env.SQLMODEL_NAPI_PATH,
    targetTriple ? resolve(here, `../native/${targetTriple}/sqlmodel_napi.node`) : undefined,
    resolve(here, "../native/sqlmodel_napi.node"),
    resolve(here, "../../../target/debug/sqlmodel_napi.node"),
    resolve(here, "../../../target/release/sqlmodel_napi.node")
  ].filter((value): value is string => Boolean(value));

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    [
      `Unable to load sqlmodel native binding. Tried: ${candidates.join(", ") || "(none)"}.`,
      unsupportedTargetError?.message,
      "Run `pnpm build:native` during development or publish a prebuilt binary under `native/<target>/sqlmodel_napi.node`.",
      lastError instanceof Error ? lastError.message : ""
    ]
      .filter(Boolean)
      .join(" ")
  );
}
