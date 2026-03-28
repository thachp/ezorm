import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryEventStore, type DomainEvent, type EventStore, type StoredEvent } from "@sqlmodel/events";

export interface ProjectionCheckpoint {
  projector: string;
  lastSequence: number;
}

export type ProjectorReplayHandler = (events: StoredEvent[]) => void | Promise<void>;
type MaybePromise<T> = T | Promise<T>;

export interface NodeRuntimeBinding {
  bootstrap?(): MaybePromise<void>;
  load(streamId: string): MaybePromise<StoredEvent[]>;
  loadAll?(afterSequence?: number): MaybePromise<StoredEvent[]>;
  append(streamId: string, version: number, events: DomainEvent[]): MaybePromise<StoredEvent[]>;
  latestVersion?(streamId: string): MaybePromise<number>;
  loadCheckpoint?(projector: string): MaybePromise<ProjectionCheckpoint | undefined>;
  saveCheckpoint?(checkpoint: ProjectionCheckpoint): MaybePromise<void>;
  resetCheckpoint?(projector: string): MaybePromise<void>;
}

export interface ProjectorRuntime extends EventStore {
  loadCheckpoint(projector: string): Promise<ProjectionCheckpoint | undefined>;
  saveCheckpoint(checkpoint: ProjectionCheckpoint): Promise<void>;
  resetProjector(projector: string): Promise<void>;
  replayProjector(
    projector: string,
    handler: ProjectorReplayHandler
  ): Promise<ProjectionCheckpoint>;
}

export class InProcessNodeRuntime implements ProjectorRuntime {
  private readonly inMemoryCheckpoints = new Map<string, ProjectionCheckpoint>();

  constructor(private readonly binding: NodeRuntimeBinding) {}

  async bootstrap(): Promise<void> {
    await this.binding.bootstrap?.();
  }

  async load(streamId: string): Promise<StoredEvent[]> {
    return this.binding.load(streamId);
  }

  async loadAll(afterSequence = 0): Promise<StoredEvent[]> {
    if (!this.binding.loadAll) {
      throw new Error("loadAll is not available on the native runtime binding yet");
    }
    return this.binding.loadAll(afterSequence);
  }

  async append(streamId: string, version: number, events: DomainEvent[]): Promise<StoredEvent[]> {
    return this.binding.append(streamId, version, events);
  }

  async latestVersion(streamId: string): Promise<number> {
    if (this.binding.latestVersion) {
      return this.binding.latestVersion(streamId);
    }
    const events = await this.binding.load(streamId);
    return events.at(-1)?.version ?? 0;
  }

  async loadCheckpoint(projector: string): Promise<ProjectionCheckpoint | undefined> {
    if (this.binding.loadCheckpoint) {
      return this.binding.loadCheckpoint(projector);
    }
    return this.inMemoryCheckpoints.get(projector);
  }

  async saveCheckpoint(checkpoint: ProjectionCheckpoint): Promise<void> {
    if (this.binding.saveCheckpoint) {
      await this.binding.saveCheckpoint(checkpoint);
      return;
    }
    this.inMemoryCheckpoints.set(checkpoint.projector, checkpoint);
  }

  async resetProjector(projector: string): Promise<void> {
    if (this.binding.resetCheckpoint) {
      await this.binding.resetCheckpoint(projector);
      return;
    }
    this.inMemoryCheckpoints.delete(projector);
  }

  async replayProjector(
    projector: string,
    handler: ProjectorReplayHandler
  ): Promise<ProjectionCheckpoint> {
    const lastSequence = (await this.loadCheckpoint(projector))?.lastSequence ?? 0;
    const events = await this.loadAll(lastSequence);
    const checkpoint = {
      projector,
      lastSequence: events.at(-1)?.sequence ?? lastSequence
    };

    if (events.length > 0) {
      await handler(events);
    }

    await this.saveCheckpoint(checkpoint);
    return checkpoint;
  }
}

export interface NodeRuntimeConnectOptions {
  databaseUrl: string;
  modulePath?: string;
}

export type NodeRuntimeBindingFactory = (
  options: NodeRuntimeConnectOptions
) => Promise<NodeRuntimeBinding>;

export async function createProjectorRuntime(
  binding?: NodeRuntimeBinding,
  options?: { factory?: NodeRuntimeBindingFactory; connect?: NodeRuntimeConnectOptions }
): Promise<ProjectorRuntime> {
  if (binding) {
    const runtime = new InProcessNodeRuntime(binding);
    await runtime.bootstrap();
    return runtime;
  }

  if (options?.factory && options.connect) {
    const runtime = new InProcessNodeRuntime(await options.factory(options.connect));
    await runtime.bootstrap();
    return runtime;
  }

  if (options?.connect) {
    const runtime = new InProcessNodeRuntime(
      await createNativeBindingFactory()(options.connect)
    );
    await runtime.bootstrap();
    return runtime;
  }

  const runtime = new InProcessNodeRuntime(createInMemoryBinding());
  await runtime.bootstrap();
  return runtime;
}

export async function createNodeRuntime(
  binding?: NodeRuntimeBinding,
  options?: { factory?: NodeRuntimeBindingFactory; connect?: NodeRuntimeConnectOptions }
): Promise<EventStore> {
  return createProjectorRuntime(binding, options);
}

interface NativeEventInput {
  eventType: string;
  payloadJson: string;
  schemaVersion?: number;
  metadataJson?: string;
}

interface NativeStoredEvent {
  streamId: string;
  version: number;
  sequence: number;
  eventType: string;
  payloadJson: string;
  schemaVersion: number;
  metadataJson?: string;
}

interface NativeProjectionCheckpoint {
  projector: string;
  lastSequence: number;
}

interface NativeSqlModelRuntimeInstance {
  bootstrap(): MaybePromise<void>;
  load(streamId: string): MaybePromise<NativeStoredEvent[]>;
  loadAll?(afterSequence?: number): MaybePromise<NativeStoredEvent[]>;
  append(
    streamId: string,
    version: number,
    events: NativeEventInput[]
  ): MaybePromise<NativeStoredEvent[]>;
  latestVersion?(streamId: string): MaybePromise<number>;
  loadCheckpoint?(projector: string): MaybePromise<NativeProjectionCheckpoint | undefined>;
  saveCheckpoint?(checkpoint: NativeProjectionCheckpoint): MaybePromise<void>;
  resetCheckpoint?(projector: string): MaybePromise<void>;
}

interface NativeModule {
  connectNativeRuntime(
    databaseUrl: string
  ): NativeSqlModelRuntimeInstance | Promise<NativeSqlModelRuntimeInstance>;
}

export type NativeModuleLoader = (modulePath?: string) => NativeModule;

export function createNativeBindingFactory(loader: NativeModuleLoader = loadNativeModule): NodeRuntimeBindingFactory {
  return async ({ databaseUrl, modulePath }) => {
    const nativeModule = loader(modulePath);
    const runtime = await nativeModule.connectNativeRuntime(databaseUrl);

    return {
      bootstrap: async () => {
        await runtime.bootstrap();
      },
      load: async (streamId) => mapStoredEvents(await runtime.load(streamId)),
      loadAll: async (afterSequence = 0) => {
        if (!runtime.loadAll) {
          throw new Error("Native runtime does not implement loadAll");
        }
        return mapStoredEvents(await runtime.loadAll(afterSequence));
      },
      append: async (streamId, version, events) =>
        mapStoredEvents(
          await runtime.append(
            streamId,
            version,
            events.map((event) => ({
              eventType: event.type,
              payloadJson: JSON.stringify(event.payload),
              schemaVersion: event.schemaVersion ?? 1,
              metadataJson: event.metadata === undefined ? undefined : JSON.stringify(event.metadata)
            }))
          )
        ),
      latestVersion: async (streamId) => {
        if (runtime.latestVersion) {
          return runtime.latestVersion(streamId);
        }
        const events = await runtime.load(streamId);
        return events.at(-1)?.version ?? 0;
      },
      loadCheckpoint: async (projector) =>
        runtime.loadCheckpoint
          ? mapProjectionCheckpoint(await runtime.loadCheckpoint(projector))
          : undefined,
      saveCheckpoint: async (checkpoint) => {
        if (!runtime.saveCheckpoint) {
          throw new Error("Native runtime does not implement saveCheckpoint");
        }
        await runtime.saveCheckpoint({
          projector: checkpoint.projector,
          lastSequence: checkpoint.lastSequence
        });
      },
      resetCheckpoint: async (projector) => {
        if (!runtime.resetCheckpoint) {
          throw new Error("Native runtime does not implement resetCheckpoint");
        }
        await runtime.resetCheckpoint(projector);
      }
    };
  };
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

export function loadNativeModule(modulePath?: string): NativeModule {
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
      return require(candidate) as NativeModule;
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

function mapStoredEvents(events: NativeStoredEvent[]): StoredEvent[] {
  return events.map((event) => ({
    streamId: event.streamId,
    version: event.version,
    sequence: event.sequence,
    type: event.eventType,
    payload: JSON.parse(event.payloadJson) as Record<string, unknown>,
    schemaVersion: event.schemaVersion,
    metadata: event.metadataJson
      ? (JSON.parse(event.metadataJson) as Record<string, unknown>)
      : undefined,
    recordedAt: new Date(0).toISOString()
  }));
}

function mapProjectionCheckpoint(
  checkpoint: NativeProjectionCheckpoint | undefined
): ProjectionCheckpoint | undefined {
  if (!checkpoint) {
    return undefined;
  }
  return {
    projector: checkpoint.projector,
    lastSequence: checkpoint.lastSequence
  };
}

function createInMemoryBinding(): NodeRuntimeBinding {
  const store = new InMemoryEventStore();

  return {
    load: async (streamId) => store.load(streamId),
    loadAll: async (afterSequence = 0) => store.loadAll(afterSequence),
    append: async (streamId, version, events) => store.append(streamId, version, events),
    latestVersion: async (streamId) => store.latestVersion(streamId)
  };
}
