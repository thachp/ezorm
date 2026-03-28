# sqlmodel-ts

`sqlmod` is the CLI and package surface for the SQLModel workspace. This repo contains the current CLI package, CQRS and event-sourcing primitives, runtime adapters for Node.js and edge deployments, and framework helpers for Next.js and NestJS.

## What is `sqlmod`?

`sqlmod` packages a SQLModel workflow built around event-sourced persistence and CQRS:

- `@sqlmodel/events` defines domain events, stored events, snapshots, versioned writes, and event store contracts.
- `@sqlmodel/cqrs` provides `CommandBus`, `QueryBus`, typed command/query definitions, and projector registration.
- `@sqlmodel/proxy-node` manages packaged Rust proxy binaries from server-side Node.js code.
- `@sqlmodel/runtime-node` exposes a Node.js runtime backed by native bindings or an in-memory fallback.
- `@sqlmodel/runtime-proxy` talks to the Rust HTTP proxy for edge and remote runtimes.
- `@sqlmodel/next` adds Next.js helpers for Node and edge runtime wiring.
- `@sqlmodel/nestjs` provides NestJS module/provider wiring around an event store, command bus, query bus, and optional projectors.

Today, the runtime and proxy layers are real, and the CLI already exposes the intended workflow surface for migrations, projector maintenance, and schema inspection. The current CLI implementation is still a queued placeholder shell, so the README below shows both the command shape and the exact current demo output.

## Install

The first publish target is the unscoped `sqlmod` package.

```sh
npm install sqlmod
pnpm add sqlmod
npx sqlmod --help
```

Inside this workspace, you can build and run the local CLI with:

```sh
pnpm build:sqlmod
node packages/cli/bin/sqlmod.js --help
```

## Current CLI Surface

`sqlmod --help` currently prints:

```text
Usage:
  sqlmod migrate generate [name]
  sqlmod migrate apply
  sqlmod migrate status
  sqlmod projector replay [name]
  sqlmod projector reset [name]
  sqlmod db pull
```

These commands are the current public CLI surface defined in `packages/cli/src/index.ts`.

## CLI Demos

The CLI currently parses supported commands and prints `Queued ...` output. Use these examples to demo the current surface without assuming migrations, projector replay, or schema pull are fully wired through yet.

### `sqlmod migrate generate [name]`

Represents generating a migration plan or artifact for a named change.

```sh
node packages/cli/bin/sqlmod.js migrate generate add_users_table
```

```text
Queued migrate generate add_users_table
```

### `sqlmod migrate apply`

Represents applying the pending migration workflow.

```sh
node packages/cli/bin/sqlmod.js migrate apply
```

```text
Queued migrate apply
```

### `sqlmod migrate status`

Represents checking migration status without mutating state.

```sh
node packages/cli/bin/sqlmod.js migrate status
```

```text
Queued migrate status
```

### `sqlmod projector replay [name]`

Represents replaying projector state from the stored event stream and persisted checkpoints.

```sh
node packages/cli/bin/sqlmod.js projector replay balances
```

```text
Queued projector replay balances
```

### `sqlmod projector reset [name]`

Represents clearing a projector checkpoint so a later replay can reprocess from the beginning.

```sh
node packages/cli/bin/sqlmod.js projector reset balances
```

```text
Queued projector reset balances
```

### `sqlmod db pull`

Represents a read-only database inspection workflow.

```sh
node packages/cli/bin/sqlmod.js db pull
```

```text
Queued db pull
```

## Use With Next.js

`@sqlmodel/next` exposes two integration paths:

- `@sqlmodel/next/node` for Node.js runtime code that can use the native runtime binding directly
- `@sqlmodel/next/edge` for edge code that must talk to the HTTP proxy through `@sqlmodel/runtime-proxy`

### Next.js Node Runtime Quickstart

Use `createNextNodeRuntime(binding?, options?)` when your route handlers or server actions run on the Node.js runtime.

```ts
import { createNextNodeRuntime } from "@sqlmodel/next/node";

export async function createStore() {
  const { runtime, store } = await createNextNodeRuntime(undefined, {
    connect: { databaseUrl: process.env.DATABASE_URL! }
  });

  console.log(runtime); // "nodejs"
  return store;
}
```

This path goes through `@sqlmodel/runtime-node`, which can connect to the native runtime binding or fall back to an in-memory runtime when no connection options are supplied.

### Next.js Edge Runtime Quickstart

For local development and self-hosted Node deployments, start the proxy from server-side Node.js code:

```sh
pnpm add @sqlmodel/proxy-node
```

```ts
import { ensureSqlModelProxy } from "@sqlmodel/proxy-node";

const { endpoint } = await ensureSqlModelProxy({
  databaseUrl: process.env.DATABASE_URL!
});

console.log(endpoint);
```

`@sqlmodel/next/node` exposes the same bootstrap as a convenience helper:

```ts
import { ensureNextEdgeProxy } from "@sqlmodel/next/node";

const endpoint = await ensureNextEdgeProxy({
  databaseUrl: process.env.DATABASE_URL!
});
```

Then point your edge code at that endpoint:

```ts
import { createNextEdgeRuntime } from "@sqlmodel/next/edge";

export const runtime = "edge";

const sqlmodel = createNextEdgeRuntime(process.env.SQLMODEL_PROXY_URL!);

export const store = sqlmodel.store;
```

Current boundary for edge usage:

- Edge modules must not import `@sqlmodel/runtime-node`.
- Edge modules must not import `@sqlmodel/proxy-node`.
- Edge requests should go through `@sqlmodel/runtime-proxy`.
- `ensureSqlModelProxy()` and `ensureNextEdgeProxy()` are server-only helpers for local and self-hosted Node environments.
- Hosted edge deployments still need an externally reachable `SQLMODEL_PROXY_URL`.
- The managed launcher keeps `DATABASE_URL` explicit and accepts optional `host` and `port` overrides when you need a stable endpoint.

## Use With NestJS

`@sqlmodel/nestjs` currently provides module and provider wiring, not a full application scaffold or automatic CQRS bootstrapping. You construct the event store and buses yourself, then pass them into `SqlModelModule.forRoot(...)`.

```ts
import { CommandBus, ProjectorRegistry, QueryBus } from "@sqlmodel/cqrs";
import { SqlModelModule } from "@sqlmodel/nestjs";
import { createNodeRuntime } from "@sqlmodel/runtime-node";

export async function createSqlModelNestModule() {
  const eventStore = await createNodeRuntime(undefined, {
    connect: { databaseUrl: process.env.DATABASE_URL! }
  });

  const projectors = new ProjectorRegistry();
  const commandBus = new CommandBus({ eventStore }, projectors);
  const queryBus = new QueryBus({ eventStore });

  return SqlModelModule.forRoot({
    eventStore,
    commandBus,
    queryBus,
    projectors
  });
}
```

If you want the raw Nest provider descriptors instead of the module wrapper, use `createSqlModelProviders(options)` with the same `eventStore`, `commandBus`, `queryBus`, and optional `projectors`.

## Local Demo Workflow

1. Build the local CLI and inspect the current command surface.

```sh
pnpm build:sqlmod
node packages/cli/bin/sqlmod.js --help
```

2. Demo any current CLI workflow from the workspace.

```sh
node packages/cli/bin/sqlmod.js migrate status
node packages/cli/bin/sqlmod.js projector replay balances
node packages/cli/bin/sqlmod.js db pull
```

3. Choose the framework/runtime path that matches your app:

- Next.js Node runtime: `createNextNodeRuntime()`
- Next.js Edge runtime: `ensureNextEdgeProxy()` plus `createNextEdgeRuntime()`
- NestJS API service: `SqlModelModule.forRoot(...)` or `createSqlModelProviders(...)`

## Validate The Workspace

```sh
pnpm build:ts
pnpm typecheck
pnpm test:ts
pnpm test
```

Packaging and smoke-test workflows:

```sh
pnpm build:proxy-node
pnpm pack:proxy-node
pnpm smoke:proxy-node
pnpm release:proxy-node
pnpm build:sqlmod
pnpm pack:sqlmod
pnpm smoke:sqlmod
pnpm release:sqlmod
```

## Example Todo Apps

The repo now includes a minimal end-to-end todo demo:

- `examples/apps/nest-todo-api`: NestJS REST backend that owns the aggregate, commands, projector, and query reads
- `examples/apps/next-todo-web`: Next.js App Router frontend styled with Tailwind CSS
- `examples/packages/todo-domain`: shared aggregate, command/query definitions, projector, and in-memory read model

Run the backend and frontend in separate terminals:

```sh
pnpm install
pnpm example:nest:dev
pnpm example:next:dev
```

The frontend defaults to `TODO_API_BASE_URL=http://localhost:4000`. The demo intentionally keeps all state in memory, so restarting the Nest API clears todos, snapshots, and projection checkpoints.

Example-specific validation:

```sh
pnpm example:test
pnpm example:build
```
