# ezorm

`ezorm` is the CLI package for Ezorm workflows. This repository also contains the `@ezorm/*` TypeScript packages for model metadata, ORM repositories, and framework/runtime integration.

> Current status
>
> - `@ezorm/core` + `@ezorm/orm` are the primary application path.
> - The `ezorm` CLI surface is implemented, but most commands still print queued/demo output.
> - The Nest and Next todo examples are the best end-to-end references today.
> - The example ORM flow defaults to SQLite in-memory, so restarting the Nest API clears data.

## Why Ezorm Is Different

Ezorm is intentionally split into a small TypeScript ORM surface and a Rust-backed relational runtime surface instead of treating every environment as the same deployment target. `@ezorm/core` keeps model metadata, validation, indices, and relations in decorated TypeScript classes, and `@ezorm/orm` builds a focused repository and read-query API on top of that model layer. Today, the main TypeScript ORM path is SQLite-only through `node:sqlite`, while the Rust relational components handle pooled SQL connections for SQLite, PostgreSQL, and MySQL through SQLx. That makes connection pooling and runtime shape an explicit architectural choice instead of something hidden behind a single adapter.

| Dimension | ezorm | Prisma | Many TypeScript ORMs |
| --- | --- | --- | --- |
| Model definition | Decorated TypeScript classes in `@ezorm/core` | Schema file plus generated client | Varies between decorators, schema builders, and active-record style models |
| Validation / metadata | Model definitions produce runtime metadata plus input validation from the same source | Type safety centers on the generated client and schema, not decorator metadata | Often split between ORM metadata and separate validation libraries |
| Repository API shape | Small CRUD repositories plus explicit read queries, joins, includes, and relation loaders | Generated model delegates with broader query APIs | Often larger query-builder or repository surfaces |
| Database support today | `@ezorm/orm` currently targets SQLite via `node:sqlite`; Rust relational components use SQLx-backed SQLite, PostgreSQL, and MySQL; MSSQL is not currently supported | Multi-database support is part of the main client/runtime story | Varies by adapter and dialect |
| Connection pooling today | Rust relational components use pooled SQLx connections; the main TypeScript ORM path is not yet a pooled cross-database abstraction | Connection management is handled inside the Prisma runtime stack | Usually delegated to the driver, adapter, or ORM runtime |
| Runtime / deployment shape | Can run directly in local Node SQLite flows or move relational work behind Rust-backed runtime and proxy helpers | Usually presented as one generated client talking to the database from server runtimes | Usually optimized for direct database access from the app runtime |
| Schema workflow today | `pushSchema` and `pullSchema` exist in the ORM, and the CLI currently exposes the intended workflow surface while most commands still print queued/demo output | Migration and introspection workflows are core product features | Varies widely across tools |
| Current scope | Focused on decorated models, repository CRUD, explicit read queries, relation loading, and runtime plumbing | Broader generated-client ORM platform | Usually broader dialect and workflow coverage, depending on the project |

Current limits are important:

- The main `@ezorm/orm` package is still SQLite-only today.
- Rust relational pooling currently applies to the SQLx-backed event-store, snapshot, and projection components, not to the full TypeScript ORM API.
- Query support is intentionally focused on repository CRUD plus explicit read queries and relation loading.
- The CLI command surface is implemented, but most commands still print queued/demo output.

If you want the current ezorm product path, start with the `@ezorm/core` and `@ezorm/orm` model and repository flow shown below, then add runtimes and adapters as needed.

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

`findMany` still supports exact-match scalar filters and simple ordering for single-table CRUD.

For relation-aware reads, use the read query builder and explicit loaders:

```ts
import { BelongsTo, Field, HasMany, Model, PrimaryKey } from "@ezorm/core";
import { createOrmClient } from "@ezorm/orm";

@Model({ table: "users" })
class User {
  @PrimaryKey()
  @Field.string()
  id!: string;

  @Field.string()
  email!: string;

  @HasMany(() => Post, { localKey: "id", foreignKey: "userId" })
  posts!: Post[];
}

@Model({ table: "posts" })
class Post {
  @PrimaryKey()
  @Field.string()
  id!: string;

  @Field.string()
  userId!: string;

  @Field.string()
  title!: string;

  @BelongsTo(() => User, { foreignKey: "userId", targetKey: "id" })
  author!: User | undefined;
}

const client = await createOrmClient({
  databaseUrl: "sqlite::memory:"
});

await client.pushSchema([User, Post]);

const posts = await client
  .query(Post)
  .join("author")
  .where("author.email", "=", "alice@example.com")
  .include("author")
  .orderBy("title", "asc")
  .all();

const users = await client.query(User).include("posts").all();
await client.load(Post, posts[0], "author");
```

Current relation support is intentionally narrow:

- `BelongsTo` and `HasMany` only
- explicit key mappings are required
- `client.query(Model)` is read-only
- `include(...)`, `load(...)`, and `loadMany(...)` are explicit async APIs
- no many-to-many, no implicit property lazy loading, and no custom `select()` builder yet

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

## License

Ezorm is available under the [MIT License](/Users/thachp/repos/sqlmodel-ts/LICENSE). Copyright (c) 2026 ezorm contributors.
