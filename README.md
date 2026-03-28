# sqlmodel-ts

`sqlmod` is the CLI package for SQLModel workflows. This repository also contains the `@sqlmodel/*` TypeScript packages for model metadata, CQRS, event sourcing, and framework/runtime integration.

> Current status
>
> - The `sqlmod` CLI surface is implemented, but most commands currently print queued/demo output.
> - The examples in this repo are the best end-to-end reference today.
> - The Nest todo example is intentionally in-memory, so restarting it clears state.

## Start Here

If you have never used this library before, use this order:

1. Run `npx sqlmod --help` to see the current CLI surface.
2. If you want to build with the library, install the `@sqlmodel/*` packages and create a small model/domain file.
3. Add a runtime or framework adapter only after the model/domain is defined.

`npx` is the fastest way to inspect the CLI. `npm install` is for building application code with the TypeScript packages.

## Install By Intent

| Goal | Command |
| --- | --- |
| Try the CLI without installing anything | `npx sqlmod --help` |
| Define model metadata with decorators | `npm install @sqlmodel/core` |
| Build an event-sourced domain with commands and queries | `npm install @sqlmodel/events @sqlmodel/cqrs` |
| Add a Node.js runtime | `npm install @sqlmodel/runtime-node` |
| Add Next.js helpers | `npm install @sqlmodel/next` |
| Add NestJS wiring | `npm install @sqlmodel/nestjs` |

## Try The CLI In 30 Seconds

Run:

```sh
npx sqlmod --help
```

Current output:

```text
Usage:
  sqlmod migrate generate [name]
  sqlmod migrate apply
  sqlmod migrate status
  sqlmod projector replay [name]
  sqlmod projector reset [name]
  sqlmod db pull
```

Today, these commands are best treated as workflow discovery. They parse the supported command surface and mostly print queued/demo output rather than executing a fully wired migration or projector workflow.

## Define Your First Model

If your first question is "how do I define the model?", start with `@sqlmodel/core`. It provides decorators that register model metadata and input validation rules.

Enable decorators in your TypeScript config:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true
  }
}
```

Then create a small model file:

```ts
import {
  Aggregate,
  Field,
  PrimaryKey,
  Projection,
  getModelMetadata,
  validateModelInput
} from "@sqlmodel/core";

@Aggregate()
class TodoAggregateModel {
  @PrimaryKey()
  @Field.string()
  id!: string;

  @Field.string()
  title!: string;

  @Field.boolean({ defaultValue: false })
  completed!: boolean;
}

@Projection()
class TodoListItemModel {
  @PrimaryKey()
  @Field.string()
  id!: string;

  @Field.string()
  title!: string;

  @Field.boolean()
  completed!: boolean;
}

console.log(getModelMetadata(TodoAggregateModel));
console.log(
  validateModelInput(TodoAggregateModel, {
    id: "todo_1",
    title: "Ship the README",
    completed: false
  })
);
```

This gives you something observable immediately:

- `getModelMetadata(...)` shows the registered fields, indices, and relations for the class.
- `validateModelInput(...)` checks plain input objects against the field definitions.

Important boundary: decorators describe model metadata. They do not persist data, append events, or answer queries by themselves.

## Turn That Model Into A Working Domain

The actual write/read workflow today is event-sourced and CQRS-based:

- commands go through `CommandBus`
- queries go through `QueryBus`
- writes append events to an event store
- read behavior comes from querying stored events directly or via projectors/read models

This is the smallest working shape:

```ts
import {
  CommandBus,
  QueryBus,
  defineCommand,
  defineQuery,
  registerCommandHandler,
  registerQueryHandler
} from "@sqlmodel/cqrs";
import {
  EventSourcedAggregate,
  InMemoryEventStore,
  type DomainEvent
} from "@sqlmodel/events";

type TodoCreatedEvent = DomainEvent<{ id: string; title: string }> & {
  type: "todo.created";
};

type TodoEvent = TodoCreatedEvent;

class TodoAggregate extends EventSourcedAggregate<TodoEvent> {
  private exists = false;
  private title = "";

  create(id: string, title: string): void {
    if (this.exists) {
      throw new Error(`Todo ${id} already exists`);
    }

    this.record({
      type: "todo.created",
      payload: { id, title },
      schemaVersion: 1
    });
  }

  getTitle(): string {
    if (!this.exists) {
      throw new Error("Todo does not exist");
    }
    return this.title;
  }

  protected apply(event: TodoEvent): void {
    if (event.type === "todo.created") {
      this.exists = true;
      this.title = event.payload.title;
    }
  }
}

const createTodo = defineCommand<{ version: number; title: string }, { title: string }>(
  "todo.create"
);
const getTodoTitle = defineQuery<{ streamId: string }, string>("todo.title");

const eventStore = new InMemoryEventStore();
const commandBus = new CommandBus({ eventStore });
const queryBus = new QueryBus({ eventStore });

registerCommandHandler(commandBus, createTodo, async ({ streamId, payload }, context) => {
  const history = await context.eventStore.load(streamId);
  const aggregate = new TodoAggregate().loadFromHistory(history);

  aggregate.create(streamId, payload.title);

  return {
    result: { title: payload.title },
    events: aggregate.uncommittedEvents
  };
});

registerQueryHandler(queryBus, getTodoTitle, async ({ streamId }, context) => {
  const history = await context.eventStore.load(streamId);
  return new TodoAggregate().loadFromHistory(history).getTitle();
});

await commandBus.execute(createTodo, {
  streamId: "todo_1",
  payload: { version: 0, title: "Ship the README" }
});

console.log(await queryBus.execute(getTodoTitle, { streamId: "todo_1" }));
```

Use decorators and CQRS together like this:

- `@sqlmodel/core` describes the shape of your aggregate/projection models.
- `@sqlmodel/events` and `@sqlmodel/cqrs` define how writes and reads actually behave.

For a complete example with commands, queries, projectors, snapshots, and a read model, see [`examples/packages/todo-domain`](./examples/packages/todo-domain).

## CLI Workflows Available Today

The current public CLI surface is defined in [`packages/cli/src/index.ts`](./packages/cli/src/index.ts):

```sh
sqlmod migrate generate [name]
sqlmod migrate apply
sqlmod migrate status
sqlmod projector replay [name]
sqlmod projector reset [name]
sqlmod db pull
```

Current demo behavior:

```sh
npx sqlmod migrate status
# Queued migrate status

npx sqlmod projector replay balances
# Queued projector replay balances
```

Inside this workspace, you can build and run the local CLI with:

```sh
pnpm build:sqlmod
node packages/cli/bin/sqlmod.js --help
```

## Choose A Runtime

Once your model/domain is in place, pick the adapter that matches your app:

- `@sqlmodel/runtime-node`
  Use `createNodeRuntime(...)` when your Node.js app should talk directly to the native runtime binding or an in-memory fallback.
- `@sqlmodel/next`
  Use `@sqlmodel/next/node` for Next.js code running on the Node.js runtime, or `@sqlmodel/next/edge` when your edge code must talk to the HTTP proxy.
- `@sqlmodel/nestjs`
  Use `SqlModelModule.forRoot(...)` or `createSqlModelProviders(...)` to expose an event store, command bus, query bus, and optional projectors through Nest dependency injection.

### Next.js Node Runtime

```ts
import { createNextNodeRuntime } from "@sqlmodel/next/node";

const { runtime, store } = await createNextNodeRuntime(undefined, {
  connect: { databaseUrl: process.env.DATABASE_URL! }
});

console.log(runtime); // "nodejs"
console.log(store);
```

### Next.js Edge Runtime

Start the Rust proxy:

```sh
DATABASE_URL=sqlite://sqlmodel.db cargo run -p sqlmodel_proxy
```

Then point edge code at it:

```ts
import { createNextEdgeRuntime } from "@sqlmodel/next/edge";

export const runtime = "edge";

const sqlmodel = createNextEdgeRuntime(
  process.env.SQLMODEL_PROXY_URL ?? "http://127.0.0.1:3000"
);
```

### NestJS

```ts
import { CommandBus, ProjectorRegistry, QueryBus } from "@sqlmodel/cqrs";
import { SqlModelModule } from "@sqlmodel/nestjs";
import { createNodeRuntime } from "@sqlmodel/runtime-node";

const eventStore = await createNodeRuntime(undefined, {
  connect: { databaseUrl: process.env.DATABASE_URL! }
});

const projectors = new ProjectorRegistry();
const commandBus = new CommandBus({ eventStore }, projectors);
const queryBus = new QueryBus({ eventStore });

const sqlmodelModule = SqlModelModule.forRoot({
  eventStore,
  commandBus,
  queryBus,
  projectors
});
```

## Try The Example Apps

This repo includes a minimal todo demo:

- `examples/packages/todo-domain`
  Shared aggregate, command/query definitions, projector, and in-memory read model.
- `examples/apps/nest-todo-api`
  NestJS REST backend that owns the aggregate, commands, projector, and query reads.
- `examples/apps/next-todo-web`
  Next.js frontend that talks to the Nest API over HTTP.

Run the examples in separate terminals:

```sh
pnpm install
pnpm example:nest:dev
pnpm example:next:dev
```

The frontend defaults to `TODO_API_BASE_URL=http://localhost:4000`. Restarting the Nest API clears todos, snapshots, and projection checkpoints because the example is intentionally in-memory in v1.

Example-specific validation:

```sh
pnpm example:test
pnpm example:build
```

## Validate The Workspace

```sh
pnpm build:ts
pnpm typecheck
pnpm test:ts
pnpm test
```

Packaging and smoke-test workflows:

```sh
pnpm build:sqlmod
pnpm pack:sqlmod
pnpm smoke:sqlmod
pnpm release:sqlmod
```
