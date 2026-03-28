export interface DomainEvent<TPayload = Record<string, unknown>> {
  type: string;
  payload: TPayload;
  schemaVersion?: number;
  metadata?: Record<string, unknown>;
}

export interface StoredEvent<TPayload = Record<string, unknown>> extends DomainEvent<TPayload> {
  streamId: string;
  version: number;
  sequence: number;
  recordedAt: string;
}

export interface Snapshot<TState = Record<string, unknown>> {
  streamId: string;
  version: number;
  schemaVersion: number;
  state: TState;
}

export interface VersionedWrite {
  version: number;
}

export class VersionConflictError extends Error {
  constructor(
    readonly streamId: string,
    readonly expectedVersion: number,
    readonly actualVersion: number
  ) {
    super(
      `Version conflict for ${streamId}: expected ${expectedVersion}, actual ${actualVersion}`
    );
    this.name = "VersionConflictError";
  }
}

export interface EventStore {
  load(streamId: string): Promise<StoredEvent[]>;
  loadAll(afterSequence?: number): Promise<StoredEvent[]>;
  append(streamId: string, version: number, events: DomainEvent[]): Promise<StoredEvent[]>;
  latestVersion(streamId: string): Promise<number>;
}

export class InMemoryEventStore implements EventStore {
  private readonly streams = new Map<string, StoredEvent[]>();
  private sequence = 0;

  async load(streamId: string): Promise<StoredEvent[]> {
    return [...(this.streams.get(streamId) ?? [])];
  }

  async loadAll(afterSequence = 0): Promise<StoredEvent[]> {
    return [...this.streams.values()].flat().filter((event) => event.sequence > afterSequence);
  }

  async latestVersion(streamId: string): Promise<number> {
    const events = this.streams.get(streamId) ?? [];
    return events.at(-1)?.version ?? 0;
  }

  async append(streamId: string, version: number, events: DomainEvent[]): Promise<StoredEvent[]> {
    const currentVersion = (this.streams.get(streamId) ?? []).at(-1)?.version ?? 0;
    if (currentVersion !== version) {
      throw new VersionConflictError(streamId, version, currentVersion);
    }

    const nextEvents = events.map((event, index) => {
      this.sequence += 1;
      return {
        ...event,
        streamId,
        version: version + index + 1,
        sequence: this.sequence,
        recordedAt: new Date().toISOString()
      };
    });

    const existing = this.streams.get(streamId) ?? [];
    this.streams.set(streamId, [...existing, ...nextEvents]);
    return nextEvents;
  }
}

export class InMemorySnapshotStore {
  private readonly snapshots = new Map<string, Snapshot>();

  async load(streamId: string): Promise<Snapshot | undefined> {
    return this.snapshots.get(streamId);
  }

  async save(snapshot: Snapshot): Promise<void> {
    const current = this.snapshots.get(snapshot.streamId);
    if (!current || snapshot.version >= current.version) {
      this.snapshots.set(snapshot.streamId, snapshot);
    }
  }
}

export type Upcaster = (event: StoredEvent) => StoredEvent;

export class UpcasterRegistry {
  private readonly upcasters = new Map<string, Map<number, Upcaster>>();

  register(eventType: string, schemaVersion: number, upcaster: Upcaster): void {
    const current = this.upcasters.get(eventType) ?? new Map<number, Upcaster>();
    current.set(schemaVersion, upcaster);
    this.upcasters.set(eventType, current);
  }

  apply(event: StoredEvent): StoredEvent {
    const currentVersion = event.schemaVersion ?? 1;
    const registered = this.upcasters.get(event.type);
    if (!registered) {
      return event;
    }

    let upgraded = event;
    const sortedVersions = [...registered.keys()].sort((a, b) => a - b);
    for (const version of sortedVersions) {
      if (version > currentVersion) {
        const upcaster = registered.get(version);
        if (upcaster) {
          upgraded = upcaster(upgraded);
        }
      }
    }
    return upgraded;
  }
}

export abstract class EventSourcedAggregate<TEvent extends DomainEvent = DomainEvent> {
  readonly uncommittedEvents: TEvent[] = [];
  version = 0;

  loadFromHistory(history: StoredEvent[]): this {
    for (const event of history) {
      this.apply(event as unknown as TEvent);
      this.version = event.version;
    }
    return this;
  }

  protected record(event: TEvent): void {
    this.uncommittedEvents.push(event);
    this.apply(event);
  }

  protected abstract apply(event: TEvent): void;

  commit(nextVersion: number): void {
    this.version = nextVersion;
    this.uncommittedEvents.length = 0;
  }
}
