import { randomUUID } from "node:crypto";
import {
  CommandBus,
  ProjectorRegistry,
  QueryBus,
  defineCommand,
  defineQuery,
  registerCommandHandler,
  registerProjector,
  registerQueryHandler,
  type Projector
} from "@sqlmodel/cqrs";
import {
  EventSourcedAggregate,
  InMemoryEventStore,
  InMemorySnapshotStore,
  type DomainEvent,
  type EventStore,
  type StoredEvent
} from "@sqlmodel/events";

export interface TodoListItem {
  id: string;
  title: string;
  completed: boolean;
  version: number;
}

export interface TodoReadModelStore {
  get(id: string): Promise<TodoListItem | undefined>;
  list(): Promise<TodoListItem[]>;
  reset(): Promise<void>;
  upsert(item: TodoListItem): Promise<void>;
}

export interface TodoMutationResult {
  todo: TodoListItem;
}

export interface CreateTodoPayload {
  id: string;
  title: string;
  version: number;
}

export interface ToggleTodoPayload {
  version: number;
}

export type TodoCreatedEvent = DomainEvent<{ id: string; title: string }> & {
  type: "todo.created";
};

export type TodoCompletedEvent = DomainEvent<{ id: string }> & {
  type: "todo.completed";
};

export type TodoReopenedEvent = DomainEvent<{ id: string }> & {
  type: "todo.reopened";
};

export type TodoEvent = TodoCreatedEvent | TodoCompletedEvent | TodoReopenedEvent;

export interface TodoDemoServices {
  commandBus: CommandBus;
  eventStore: TodoProjectionRuntime;
  listTodos(): Promise<TodoListItem[]>;
  projectors: ProjectorRegistry;
  queryBus: QueryBus;
  readModelStore: TodoReadModelStore;
  rebuildTodosProjection(): Promise<ProjectionCheckpoint>;
  createTodo(input: { id?: string; title: string }): Promise<TodoMutationResult>;
  completeTodo(id: string): Promise<TodoMutationResult>;
  reopenTodo(id: string): Promise<TodoMutationResult>;
}

export const TODOS_PROJECTOR_NAME = "todos-list";

export interface ProjectionCheckpoint {
  projector: string;
  lastSequence: number;
}

export interface TodoProjectionRuntime extends EventStore {
  loadCheckpoint(projector: string): Promise<ProjectionCheckpoint | undefined>;
  replayProjector(
    projector: string,
    handler: (events: StoredEvent[]) => Promise<void> | void
  ): Promise<ProjectionCheckpoint>;
  resetProjector(projector: string): Promise<void>;
  saveCheckpoint(checkpoint: ProjectionCheckpoint): Promise<void>;
}

export const createTodoCommand = defineCommand<CreateTodoPayload, TodoMutationResult>(
  "todo.create",
  (payload) => {
    if (!payload.id.trim()) {
      throw new Error("Todo id is required");
    }
    if (!payload.title.trim()) {
      throw new Error("Todo title is required");
    }
  }
);

export const completeTodoCommand = defineCommand<ToggleTodoPayload, TodoMutationResult>(
  "todo.complete"
);

export const reopenTodoCommand = defineCommand<ToggleTodoPayload, TodoMutationResult>(
  "todo.reopen"
);

export const listTodosQuery = defineQuery<void, TodoListItem[]>("todo.list");

interface TodoState {
  completed: boolean;
  exists: boolean;
  id: string;
  title: string;
}

function emptyTodoState(): TodoState {
  return {
    completed: false,
    exists: false,
    id: "",
    title: ""
  };
}

export class TodoAggregate extends EventSourcedAggregate<TodoEvent> {
  private state = emptyTodoState();

  create(id: string, title: string): void {
    if (this.state.exists) {
      throw new Error(`Todo ${this.state.id} already exists`);
    }
    this.record({
      type: "todo.created",
      payload: { id, title: title.trim() },
      schemaVersion: 1
    });
  }

  complete(): void {
    this.ensureExists();
    if (this.state.completed) {
      throw new Error(`Todo ${this.state.id} is already completed`);
    }
    this.record({
      type: "todo.completed",
      payload: { id: this.state.id },
      schemaVersion: 1
    });
  }

  reopen(): void {
    this.ensureExists();
    if (!this.state.completed) {
      throw new Error(`Todo ${this.state.id} is already open`);
    }
    this.record({
      type: "todo.reopened",
      payload: { id: this.state.id },
      schemaVersion: 1
    });
  }

  toListItem(version = this.version): TodoListItem {
    this.ensureExists();
    return {
      id: this.state.id,
      title: this.state.title,
      completed: this.state.completed,
      version
    };
  }

  protected apply(event: TodoEvent): void {
    switch (event.type) {
      case "todo.created":
        this.state = {
          completed: false,
          exists: true,
          id: event.payload.id,
          title: event.payload.title
        };
        break;
      case "todo.completed":
        this.state = {
          ...this.state,
          completed: true
        };
        break;
      case "todo.reopened":
        this.state = {
          ...this.state,
          completed: false
        };
        break;
    }
  }

  private ensureExists(): void {
    if (!this.state.exists) {
      throw new Error("Todo does not exist");
    }
  }
}

export class InMemoryTodoReadModelStore implements TodoReadModelStore {
  private readonly items = new Map<string, TodoListItem>();

  async get(id: string): Promise<TodoListItem | undefined> {
    return this.items.get(id);
  }

  async list(): Promise<TodoListItem[]> {
    return [...this.items.values()].sort((left, right) => left.title.localeCompare(right.title));
  }

  async reset(): Promise<void> {
    this.items.clear();
  }

  async upsert(item: TodoListItem): Promise<void> {
    this.items.set(item.id, item);
  }
}

export class InMemoryTodoProjectionRuntime implements TodoProjectionRuntime {
  private readonly checkpoints = new Map<string, ProjectionCheckpoint>();
  private readonly eventStore = new InMemoryEventStore();

  async append(streamId: string, version: number, events: DomainEvent[]): Promise<StoredEvent[]> {
    return this.eventStore.append(streamId, version, events);
  }

  async latestVersion(streamId: string): Promise<number> {
    return this.eventStore.latestVersion(streamId);
  }

  async load(streamId: string): Promise<StoredEvent[]> {
    return this.eventStore.load(streamId);
  }

  async loadAll(afterSequence = 0): Promise<StoredEvent[]> {
    return this.eventStore.loadAll(afterSequence);
  }

  async loadCheckpoint(projector: string): Promise<ProjectionCheckpoint | undefined> {
    return this.checkpoints.get(projector);
  }

  async replayProjector(
    projector: string,
    handler: (events: StoredEvent[]) => Promise<void> | void
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

  async resetProjector(projector: string): Promise<void> {
    this.checkpoints.delete(projector);
  }

  async saveCheckpoint(checkpoint: ProjectionCheckpoint): Promise<void> {
    this.checkpoints.set(checkpoint.projector, checkpoint);
  }
}

export function createTodoProjector(readModelStore: TodoReadModelStore): Projector {
  return {
    name: TODOS_PROJECTOR_NAME,
    handle: async (events: StoredEvent[]) => {
      for (const event of events) {
        switch (event.type) {
          case "todo.created":
            await readModelStore.upsert({
              id: String((event.payload as { id: string }).id),
              title: String((event.payload as { title: string }).title),
              completed: false,
              version: event.version
            });
            break;
          case "todo.completed": {
            const current = await readModelStore.get(String((event.payload as { id: string }).id));
            if (current) {
              await readModelStore.upsert({
                ...current,
                completed: true,
                version: event.version
              });
            }
            break;
          }
          case "todo.reopened": {
            const current = await readModelStore.get(String((event.payload as { id: string }).id));
            if (current) {
              await readModelStore.upsert({
                ...current,
                completed: false,
                version: event.version
              });
            }
            break;
          }
        }
      }
    }
  };
}

async function loadTodo(streamId: string, eventStore: TodoProjectionRuntime): Promise<TodoAggregate> {
  const history = await eventStore.load(streamId);
  return new TodoAggregate().loadFromHistory(history);
}

function streamIdForTodo(id: string): string {
  return `todo-${id}`;
}

export async function createTodoDemoServices(options?: {
  eventStore?: TodoProjectionRuntime;
  readModelStore?: TodoReadModelStore;
}): Promise<TodoDemoServices> {
  const eventStore = options?.eventStore ?? new InMemoryTodoProjectionRuntime();
  const readModelStore = options?.readModelStore ?? new InMemoryTodoReadModelStore();
  const snapshots = new InMemorySnapshotStore();
  const projectors = new ProjectorRegistry();
  const commandBus = new CommandBus({ eventStore, snapshots }, projectors);
  const queryBus = new QueryBus({ eventStore });
  const projector = createTodoProjector(readModelStore);

  registerProjector(projectors, projector);

  registerCommandHandler(commandBus, createTodoCommand, async ({ payload, streamId }) => {
    const aggregate = await loadTodo(streamId, eventStore);
    aggregate.create(payload.id, payload.title);

    return {
      result: {
        todo: aggregate.toListItem(payload.version + 1)
      },
      events: [...aggregate.uncommittedEvents],
      snapshot: {
        streamId,
        version: payload.version,
        schemaVersion: 1,
        state: aggregate.toListItem(payload.version + 1)
      }
    };
  });

  registerCommandHandler(commandBus, completeTodoCommand, async ({ streamId, payload }) => {
    const aggregate = await loadTodo(streamId, eventStore);
    aggregate.complete();

    return {
      result: {
        todo: aggregate.toListItem(payload.version + 1)
      },
      events: [...aggregate.uncommittedEvents],
      snapshot: {
        streamId,
        version: payload.version,
        schemaVersion: 1,
        state: aggregate.toListItem(payload.version + 1)
      }
    };
  });

  registerCommandHandler(commandBus, reopenTodoCommand, async ({ streamId, payload }) => {
    const aggregate = await loadTodo(streamId, eventStore);
    aggregate.reopen();

    return {
      result: {
        todo: aggregate.toListItem(payload.version + 1)
      },
      events: [...aggregate.uncommittedEvents],
      snapshot: {
        streamId,
        version: payload.version,
        schemaVersion: 1,
        state: aggregate.toListItem(payload.version + 1)
      }
    };
  });

  registerQueryHandler(queryBus, listTodosQuery, async () => readModelStore.list());

  async function createTodo(input: { id?: string; title: string }): Promise<TodoMutationResult> {
    const id = input.id ?? randomUUID();
    const result = await commandBus.execute(createTodoCommand, {
      streamId: streamIdForTodo(id),
      payload: {
        id,
        title: input.title,
        version: 0
      }
    });

    return result.result;
  }

  async function completeTodo(id: string): Promise<TodoMutationResult> {
    const streamId = streamIdForTodo(id);
    const version = await eventStore.latestVersion(streamId);
    const result = await commandBus.execute(completeTodoCommand, {
      streamId,
      payload: { version }
    });

    return result.result;
  }

  async function reopenTodo(id: string): Promise<TodoMutationResult> {
    const streamId = streamIdForTodo(id);
    const version = await eventStore.latestVersion(streamId);
    const result = await commandBus.execute(reopenTodoCommand, {
      streamId,
      payload: { version }
    });

    return result.result;
  }

  async function listTodos(): Promise<TodoListItem[]> {
    return queryBus.execute(listTodosQuery, undefined);
  }

  async function rebuildTodosProjection(): Promise<ProjectionCheckpoint> {
    await readModelStore.reset();
    await eventStore.resetProjector(TODOS_PROJECTOR_NAME);
    return eventStore.replayProjector(TODOS_PROJECTOR_NAME, async (events) => {
      await projector.handle(events);
    });
  }

  return {
    commandBus,
    eventStore,
    listTodos,
    projectors,
    queryBus,
    readModelStore,
    rebuildTodosProjection,
    createTodo,
    completeTodo,
    reopenTodo
  };
}
