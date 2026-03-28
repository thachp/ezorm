# sqlmodel-ts

`sqlmod` is the CLI package for SQLModel workflows. This repository also contains the `@sqlmodel/*` TypeScript packages for model metadata, ORM repositories, and framework/runtime integration.

> Current status
>
> - `@sqlmodel/core` + `@sqlmodel/orm` are the primary application path.
> - The `sqlmod` CLI surface is implemented, but most commands still print queued/demo output.
> - The Nest and Next todo examples are the best end-to-end references today.
> - The example ORM flow defaults to SQLite in-memory, so restarting the Nest API clears data.

## Start Here

If you have never used this library before, use this order:

1. Run `npx sqlmod --help` to see the current CLI surface.
2. Install `@sqlmodel/core` and `@sqlmodel/orm`.
3. Define a decorated model class.
4. Create an ORM client and use a repository.
5. Add a runtime or framework adapter only after the model/repository flow works.

## Install By Intent

| Goal | Command |
| --- | --- |
| Try the CLI without installing anything | `npx sqlmod --help` |
| Define model metadata with decorators | `npm install @sqlmodel/core` |
| Persist models with repository CRUD | `npm install @sqlmodel/orm` |
| Add a Node.js runtime helper | `npm install @sqlmodel/runtime-node` |
| Add Next.js helpers | `npm install @sqlmodel/next` |
| Add NestJS wiring | `npm install @sqlmodel/nestjs` |

## Try The CLI In 30 Seconds

```sh
npx sqlmod --help
```

Current output:

```text
Usage:
  sqlmod migrate generate [name]
  sqlmod migrate apply
  sqlmod migrate status
  sqlmod db pull
  sqlmod db push
```

Today, these commands are best treated as workflow discovery. They parse the supported ORM-first command surface and mostly print queued/demo output rather than executing a fully wired migration or introspection workflow.

## Define Your First Model

If your first question is "how do I define the model?", start with `@sqlmodel/core`.

```ts
import {
  Field,
  Model,
  PrimaryKey,
  getModelMetadata,
  validateModelInput
} from "@sqlmodel/core";

@Model({ table: "todos" })
class Todo {
  @PrimaryKey()
  @Field.string()
  id!: string;

  @Field.string()
  title!: string;

  @Field.boolean({ defaultValue: false })
  completed!: boolean;
}

console.log(getModelMetadata(Todo));
console.log(
  validateModelInput(Todo, {
    id: "todo_1",
    title: "Ship the README",
    completed: false
  })
);
```

This gives you immediate metadata and validation:

- `getModelMetadata(...)` shows the resolved table, fields, indices, and relations.
- `validateModelInput(...)` checks plain input objects against field definitions.

## Persist The Model With A Repository

`@sqlmodel/orm` is the primary runtime package. It creates a SQL-backed client and exposes repositories for CRUD operations.

```ts
import { Field, Model, PrimaryKey } from "@sqlmodel/core";
import { createOrmClient } from "@sqlmodel/orm";

@Model({ table: "todos" })
class Todo {
  @PrimaryKey()
  @Field.string()
  id!: string;

  @Field.string()
  title!: string;

  @Field.boolean({ defaultValue: false })
  completed!: boolean;
}

const client = await createOrmClient({
  databaseUrl: "sqlite::memory:"
});

await client.pushSchema([Todo]);

const todos = client.repository(Todo);

await todos.create({
  id: "todo_1",
  title: "Ship the README",
  completed: false
});

console.log(await todos.findById("todo_1"));
console.log(
  await todos.findMany({
    orderBy: { field: "title", direction: "asc" }
  })
);
```

The repository surface is intentionally small in v1:

- `create`
- `findById`
- `findMany`
- `update`
- `delete`

`findMany` supports exact-match scalar filters and simple ordering. Relations are metadata-only today and are not loaded automatically.

## CLI Workflows Available Today

The current public CLI surface is defined in [`packages/cli/src/index.ts`](/Users/thachp/repos/sqlmodel-ts/packages/cli/src/index.ts):

```sh
sqlmod migrate generate [name]
sqlmod migrate apply
sqlmod migrate status
sqlmod db pull
sqlmod db push
```

Current demo behavior:

```sh
npx sqlmod migrate status
# Queued migrate status

npx sqlmod db push
# Queued db push
```

Inside this workspace, you can build and run the local CLI with:

```sh
pnpm build:sqlmod
node packages/cli/bin/sqlmod.js --help
```

## Choose A Runtime

Once your model/repository flow is in place, pick the adapter that matches your app:

- `@sqlmodel/runtime-node`
- `@sqlmodel/next`
  Use `@sqlmodel/next/node` for Next.js code running on the Node.js runtime, or `@sqlmodel/next/edge` when edge code must talk to an HTTP endpoint.
- `@sqlmodel/nestjs`

The maintained examples live here:

- NestJS todo backend: [`examples/apps/nest-todo-api`](/Users/thachp/repos/sqlmodel-ts/examples/apps/nest-todo-api)
- Next.js Tailwind todo frontend: [`examples/apps/next-todo-web`](/Users/thachp/repos/sqlmodel-ts/examples/apps/next-todo-web)
- Shared todo domain code: [`examples/packages/todo-domain`](/Users/thachp/repos/sqlmodel-ts/examples/packages/todo-domain)

## Legacy CQRS/Event Packages

`@sqlmodel/cqrs` and `@sqlmodel/events` still exist in the workspace, but they are no longer the primary product path. New examples, docs, and maintained workflows should start with `@sqlmodel/core` + `@sqlmodel/orm`.
