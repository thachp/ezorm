# ezorm

`ezorm` is the CLI package for Ezorm workflows. This repository also contains the `@ezorm/*` TypeScript packages for model metadata, ORM repositories, and framework/runtime integration.

> Current status
>
> - `@ezorm/core` + `@ezorm/orm` are the primary application path.
> - The `ezorm` CLI surface is implemented, but most commands still print queued/demo output.
> - The Nest and Next todo examples are the best end-to-end references today.
> - The example ORM flow defaults to SQLite in-memory, so restarting the Nest API clears data.

## Start Here

If you have never used this library before, use this order:

1. Run `npx ezorm --help` to see the current CLI surface.
2. Install `@ezorm/core` and `@ezorm/orm`.
3. Define a decorated model class.
4. Create an ORM client and use a repository.
5. Add a runtime or framework adapter only after the model/repository flow works.

## Install By Intent

| Goal | Command |
| --- | --- |
| Try the CLI without installing anything | `npx ezorm --help` |
| Define model metadata with decorators | `npm install @ezorm/core` |
| Persist models with repository CRUD | `npm install @ezorm/orm` |
| Add a Node.js runtime helper | `npm install @ezorm/runtime-node` |
| Add Next.js helpers | `npm install @ezorm/next` |
| Add NestJS wiring | `npm install @ezorm/nestjs` |

## Try The CLI In 30 Seconds

```sh
npx ezorm --help
```

Current output:

```text
Usage:
  ezorm migrate generate [name]
  ezorm migrate apply
  ezorm migrate status
  ezorm db pull
  ezorm db push
```

Today, these commands are best treated as workflow discovery. They parse the supported ORM-first command surface and mostly print queued/demo output rather than executing a fully wired migration or introspection workflow.

## Define Your First Model

If your first question is "how do I define the model?", start with `@ezorm/core`.

```ts
import {
  Field,
  Model,
  PrimaryKey,
  getModelMetadata,
  validateModelInput
} from "@ezorm/core";

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

`@ezorm/orm` is the primary runtime package. It creates a SQL-backed client and exposes repositories for CRUD operations.

```ts
import { Field, Model, PrimaryKey } from "@ezorm/core";
import { createOrmClient } from "@ezorm/orm";

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
ezorm migrate generate [name]
ezorm migrate apply
ezorm migrate status
ezorm db pull
ezorm db push
```

Current demo behavior:

```sh
npx ezorm migrate status
# Queued migrate status

npx ezorm db push
# Queued db push
```

Inside this workspace, you can build and run the local CLI with:

```sh
pnpm build:ezorm
node packages/cli/bin/ezorm.js --help
```

## Choose A Runtime

Once your model/repository flow is in place, pick the adapter that matches your app:

- `@ezorm/runtime-node`
- `@ezorm/next`
  Use `@ezorm/next/node` for Next.js code running on the Node.js runtime, or `@ezorm/next/edge` when edge code must talk to an HTTP endpoint.
- `@ezorm/nestjs`

The maintained examples live here:

- NestJS todo backend: [`examples/apps/nest-todo-api`](/Users/thachp/repos/sqlmodel-ts/examples/apps/nest-todo-api)
- Next.js Tailwind todo frontend: [`examples/apps/next-todo-web`](/Users/thachp/repos/sqlmodel-ts/examples/apps/next-todo-web)
- Shared todo domain code: [`examples/packages/todo-domain`](/Users/thachp/repos/sqlmodel-ts/examples/packages/todo-domain)

## Notes

The maintained product path is `@ezorm/core` + `@ezorm/orm`. The examples, adapters, and CLI in this repository are intentionally centered on simple ORM-style CRUD workflows.
