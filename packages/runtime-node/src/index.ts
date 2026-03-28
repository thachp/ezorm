import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryEventStore, type DomainEvent, type EventStore, type StoredEvent } from "@sqlmodel-ts/events";

export interface NodeRuntimeBinding {
  bootstrap?(): Promise<void>;
  load(streamId: string): Promise<StoredEvent[]>;
  loadAll?(afterSequence?: number): Promise<StoredEvent[]>;
  append(streamId: string, version: number, events: DomainEvent[]): Promise<StoredEvent[]>;
  latestVersion?(streamId: string): Promise<number>;
}

export class InProcessNodeRuntime implements EventStore {
  constructor(private readonly binding: NodeRuntimeBinding) {}

  async bootstrap(): Promise<void> {
    await this.binding.bootstrap?.();
  }

  load(streamId: string): Promise<StoredEvent[]> {
    return this.binding.load(streamId);
  }

  async loadAll(afterSequence = 0): Promise<StoredEvent[]> {
    if (!this.binding.loadAll) {
      throw new Error("loadAll is not available on the native runtime binding yet");
    }
    return this.binding.loadAll(afterSequence);
  }

  append(streamId: string, version: number, events: DomainEvent[]): Promise<StoredEvent[]> {
    return this.binding.append(streamId, version, events);
  }

  async latestVersion(streamId: string): Promise<number> {
    if (this.binding.latestVersion) {
      return this.binding.latestVersion(streamId);
    }
    const events = await this.binding.load(streamId);
    return events.at(-1)?.version ?? 0;
  }
}

export interface NodeRuntimeConnectOptions {
  databaseUrl: string;
  modulePath?: string;
}

export type NodeRuntimeBindingFactory = (
  options: NodeRuntimeConnectOptions
) => Promise<NodeRuntimeBinding>;

export async function createNodeRuntime(
  binding?: NodeRuntimeBinding,
  options?: { factory?: NodeRuntimeBindingFactory; connect?: NodeRuntimeConnectOptions }
): Promise<EventStore> {
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

  return new InMemoryEventStore();
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

interface NativeSqlModelRuntimeInstance {
  bootstrap(): void | Promise<void>;
  load(streamId: string): NativeStoredEvent[] | Promise<NativeStoredEvent[]>;
  loadAll?(afterSequence?: number): NativeStoredEvent[] | Promise<NativeStoredEvent[]>;
  append(
    streamId: string,
    version: number,
    events: NativeEventInput[]
  ): NativeStoredEvent[] | Promise<NativeStoredEvent[]>;
  latestVersion?(streamId: string): number | Promise<number>;
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
      }
    };
  };
}

export function loadNativeModule(modulePath?: string): NativeModule {
  const require = createRequire(import.meta.url);
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    modulePath,
    process.env.SQLMODEL_TS_NAPI_PATH,
    resolve(here, "../../../target/debug/sqlmodel_ts_napi.node"),
    resolve(here, "../../../target/release/sqlmodel_ts_napi.node")
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
    `Unable to load sqlmodel-ts native binding. Tried: ${candidates.join(", ") || "(none)"}. ${
      lastError instanceof Error ? lastError.message : ""
    }`.trim()
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
