import type { DomainEvent, EventStore, Snapshot, StoredEvent, VersionedWrite } from "@sqlmodel/events";

export interface CommandDefinition<TPayload extends VersionedWrite, TResult> {
  name: string;
  validate?: (payload: TPayload) => void;
}

export interface QueryDefinition<TPayload, TResult> {
  name: string;
  validate?: (payload: TPayload) => void;
}

export interface CommandContext {
  eventStore: EventStore;
  snapshots?: {
    save(snapshot: Snapshot): Promise<void>;
    load(streamId: string): Promise<Snapshot | undefined>;
  };
}

export interface QueryContext {
  eventStore: EventStore;
}

export interface CommandEnvelope<TPayload extends VersionedWrite> {
  streamId: string;
  payload: TPayload;
}

export interface CommandResult<TResult> {
  result: TResult;
  events: StoredEvent[];
}

export type CommandHandler<TPayload extends VersionedWrite, TResult> = (
  envelope: CommandEnvelope<TPayload>,
  context: CommandContext
) => Promise<{ result: TResult; events: DomainEvent[]; snapshot?: Snapshot }>;

export type QueryHandler<TPayload, TResult> = (
  payload: TPayload,
  context: QueryContext
) => Promise<TResult>;

export interface Projector {
  name: string;
  handle(events: StoredEvent[]): Promise<void>;
}

export function defineCommand<TPayload extends VersionedWrite, TResult>(
  name: string,
  validate?: (payload: TPayload) => void
): CommandDefinition<TPayload, TResult> {
  return { name, validate };
}

export function defineQuery<TPayload, TResult>(
  name: string,
  validate?: (payload: TPayload) => void
): QueryDefinition<TPayload, TResult> {
  return { name, validate };
}

export class ProjectorRegistry {
  private readonly projectors = new Map<string, Projector>();

  register(projector: Projector): void {
    if (this.projectors.has(projector.name)) {
      throw new Error(`Projector ${projector.name} is already registered`);
    }
    this.projectors.set(projector.name, projector);
  }

  async dispatch(events: StoredEvent[]): Promise<void> {
    await Promise.all([...this.projectors.values()].map((projector) => projector.handle(events)));
  }
}

export class CommandBus {
  private readonly handlers = new Map<string, CommandHandler<VersionedWrite, unknown>>();

  constructor(
    private readonly context: CommandContext,
    private readonly projectors = new ProjectorRegistry()
  ) {}

  register<TPayload extends VersionedWrite, TResult>(
    definition: CommandDefinition<TPayload, TResult>,
    handler: CommandHandler<TPayload, TResult>
  ): void {
    this.handlers.set(definition.name, handler as CommandHandler<VersionedWrite, unknown>);
  }

  async execute<TPayload extends VersionedWrite, TResult>(
    definition: CommandDefinition<TPayload, TResult>,
    envelope: CommandEnvelope<TPayload>
  ): Promise<CommandResult<TResult>> {
    if (typeof envelope.payload.version !== "number") {
      throw new Error(`Command ${definition.name} requires a numeric version`);
    }
    definition.validate?.(envelope.payload);
    const handler = this.handlers.get(definition.name) as
      | CommandHandler<TPayload, TResult>
      | undefined;
    if (!handler) {
      throw new Error(`No command handler registered for ${definition.name}`);
    }
    const outcome = await handler(envelope, this.context);
    const storedEvents = await this.context.eventStore.append(
      envelope.streamId,
      envelope.payload.version,
      outcome.events
    );

    if (outcome.snapshot && this.context.snapshots) {
      await this.context.snapshots.save({
        ...outcome.snapshot,
        streamId: envelope.streamId,
        version: storedEvents.at(-1)?.version ?? envelope.payload.version
      });
    }

    await this.projectors.dispatch(storedEvents);
    return {
      result: outcome.result,
      events: storedEvents
    };
  }
}

export class QueryBus {
  private readonly handlers = new Map<string, QueryHandler<unknown, unknown>>();

  constructor(private readonly context: QueryContext) {}

  register<TPayload, TResult>(
    definition: QueryDefinition<TPayload, TResult>,
    handler: QueryHandler<TPayload, TResult>
  ): void {
    this.handlers.set(definition.name, handler as QueryHandler<unknown, unknown>);
  }

  async execute<TPayload, TResult>(
    definition: QueryDefinition<TPayload, TResult>,
    payload: TPayload
  ): Promise<TResult> {
    definition.validate?.(payload);
    const handler = this.handlers.get(definition.name) as QueryHandler<TPayload, TResult> | undefined;
    if (!handler) {
      throw new Error(`No query handler registered for ${definition.name}`);
    }
    return handler(payload, this.context);
  }
}

export function registerCommandHandler<TPayload extends VersionedWrite, TResult>(
  bus: CommandBus,
  definition: CommandDefinition<TPayload, TResult>,
  handler: CommandHandler<TPayload, TResult>
): void {
  bus.register(definition, handler);
}

export function registerQueryHandler<TPayload, TResult>(
  bus: QueryBus,
  definition: QueryDefinition<TPayload, TResult>,
  handler: QueryHandler<TPayload, TResult>
): void {
  bus.register(definition, handler);
}

export function registerProjector(registry: ProjectorRegistry, projector: Projector): void {
  registry.register(projector);
}
