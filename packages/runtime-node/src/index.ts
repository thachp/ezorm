import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createOrmClient,
  createRuntimeOrmClient,
  type FindManyOptions,
  type OrmClient,
  type OrmClientOptions,
  type SerializedModelMetadata,
  type TableSchema
} from "@ezorm/orm";

export interface NodeRuntimeConnectOptions extends OrmClientOptions {
  modulePath?: string;
  pool?: NodeRuntimePoolOptions;
}

export interface NodeRuntimePoolOptions {
  minConnections?: number;
  maxConnections?: number;
  acquireTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export async function createNodeRuntime(
  options?: { connect?: NodeRuntimeConnectOptions }
): Promise<OrmClient> {
  const connect = options?.connect ?? { databaseUrl: "sqlite::memory:" };
  if (!shouldUseNativeRuntime(connect)) {
    return createOrmClient({
      databaseUrl: connect.databaseUrl
    });
  }

  const native = loadNativeModule(connect.modulePath) as NativeModule;
  const binding = native.connectNativeRuntime(connect.databaseUrl, connect.pool);

  return createRuntimeOrmClient(
    {
      async create(model, input) {
        binding.create(JSON.stringify(model), JSON.stringify(input));
      },
      async findById(model, id) {
        const raw = binding.findById(JSON.stringify(model), id);
        return raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
      },
      async findMany(model, queryOptions) {
        const raw = binding.findMany(
          JSON.stringify(model),
          queryOptions ? JSON.stringify(queryOptions) : undefined
        );
        return JSON.parse(raw) as Array<Record<string, unknown>>;
      },
      async update(model, id, input) {
        binding.update(JSON.stringify(model), id, JSON.stringify(input));
      },
      async delete(model, id) {
        binding.deleteRecord(JSON.stringify(model), id);
      },
      async pushSchema(models) {
        return {
          statements: binding.pushSchema(JSON.stringify(models))
        };
      },
      async pullSchema() {
        return JSON.parse(binding.pullSchema()) as TableSchema[];
      },
      async close() {
        binding.close?.();
      }
    },
    "@ezorm/runtime-node does not support relation-aware queries or loaders on the pooled SQL runtime yet."
  );
}

export function shouldUseNativeRuntime(options: NodeRuntimeConnectOptions): boolean {
  return Boolean(options.pool) || !isDirectSqliteUrl(options.databaseUrl);
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
      `Unsupported native target for ezorm: ${platform}/${arch}. Set \`EZORM_NAPI_PATH\` to a compatible .node file.`
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
    process.env.EZORM_NAPI_PATH,
    targetTriple ? resolve(here, `../native/${targetTriple}/ezorm_napi.node`) : undefined,
    resolve(here, "../native/ezorm_napi.node"),
    resolve(here, "../../../target/debug/ezorm_napi.node"),
    resolve(here, "../../../target/release/ezorm_napi.node")
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
      `Unable to load ezorm native binding. Tried: ${candidates.join(", ") || "(none)"}.`,
      unsupportedTargetError?.message,
      "Run `pnpm build:native` during development or publish a prebuilt binary under `native/<target>/ezorm_napi.node`.",
      lastError instanceof Error ? lastError.message : ""
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function isDirectSqliteUrl(databaseUrl: string): boolean {
  return databaseUrl === "sqlite::memory:" || databaseUrl.startsWith("sqlite://");
}

interface NativeModule {
  connectNativeRuntime(
    databaseUrl: string,
    poolOptions?: NodeRuntimePoolOptions
  ): NativeRuntimeBinding;
}

interface NativeRuntimeBinding {
  create(modelJson: string, inputJson: string): void;
  findById(modelJson: string, id: string): string | undefined;
  findMany(modelJson: string, optionsJson?: string): string;
  update(modelJson: string, id: string, inputJson: string): void;
  deleteRecord(modelJson: string, id: string): void;
  pushSchema(modelsJson: string): string[];
  pullSchema(): string;
  close?(): void;
}
