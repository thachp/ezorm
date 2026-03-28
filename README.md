# ezorm

`ezorm` is the CLI package for Ezorm workflows. This repository also contains the `@ezorm/*` TypeScript packages for model metadata, ORM repositories, and framework/runtime integration.

> Current status
>
> - `@ezorm/core` + `@ezorm/orm` are the primary application path.
> - The `ezorm` CLI surface is implemented, but most commands still print queued/demo output.
> - The Nest and Next todo examples are the best end-to-end references today.
> - The example ORM flow defaults to SQLite in-memory, so restarting the example processes clears data.

## Why Ezorm Is Different

Ezorm is intentionally split into a small TypeScript ORM surface and an optional Rust-backed proxy runtime instead of treating every environment as the same deployment target. `@ezorm/core` keeps model metadata, validation, indices, and relations in decorated TypeScript classes, and `@ezorm/orm` builds a focused repository and read-query API on top of that model layer. The direct `@ezorm/orm` path and `@ezorm/runtime-node` support SQLite, PostgreSQL, MySQL, and MSSQL from Node, while `@ezorm/runtime-proxy` plus the managed proxy provide pooled repository CRUD plus schema push/pull for SQLite, PostgreSQL, MySQL, and MSSQL through the Rust runtime components. That makes connection pooling and runtime shape an explicit architectural choice instead of something hidden behind a single adapter.

| Dimension | ezorm | Prisma | Many TypeScript ORMs |
| --- | --- | --- | --- |
| Model definition | Decorated TypeScript classes in `@ezorm/core` | Schema file plus generated client | Varies between decorators, schema builders, and active-record style models |
| Validation / metadata | Model definitions produce runtime metadata plus input validation from the same source | Type safety centers on the generated client and schema, not decorator metadata | Often split between ORM metadata and separate validation libraries |
| Repository API shape | Small CRUD repositories plus explicit read queries, joins, includes, and relation loaders | Generated model delegates with broader query APIs | Often larger query-builder or repository surfaces |
| Database support today | Direct `@ezorm/orm` and `@ezorm/runtime-node` support SQLite, PostgreSQL, MySQL, and MSSQL; `@ezorm/runtime-proxy` supports pooled CRUD and schema sync for SQLite, PostgreSQL, MySQL, and MSSQL | Multi-database support is part of the main client/runtime story | Varies by adapter and dialect |
| Connection pooling today | `@ezorm/runtime-proxy` uses pooled Rust database connections; direct `@ezorm/orm` and `@ezorm/runtime-node` use direct driver connections in the app runtime | Connection management is handled inside the Prisma runtime stack | Usually delegated to the driver, adapter, or ORM runtime |
| Runtime / deployment shape | Can run directly in local Node SQLite flows or move relational work behind Rust-backed runtime and proxy helpers | Usually presented as one generated client talking to the database from server runtimes | Usually optimized for direct database access from the app runtime |
| Schema workflow today | `pushSchema` and `pullSchema` exist in the ORM, and the CLI currently exposes the intended workflow surface while most commands still print queued/demo output | Migration and introspection workflows are core product features | Varies widely across tools |
| Current scope | Focused on decorated models, repository CRUD, explicit read queries, query-scoped lazy relations, projection selects, and runtime plumbing | Broader generated-client ORM platform | Usually broader dialect and workflow coverage, depending on the project |

Current limits are important:

- Direct `@ezorm/orm` and `@ezorm/runtime-node` support SQLite, PostgreSQL, MySQL, and MSSQL.
- Cross-database pooled ORM CRUD and schema sync are available through `@ezorm/runtime-proxy` and the managed proxy runtime for SQLite, PostgreSQL, MySQL, and MSSQL.
- Query support is intentionally focused on repository CRUD plus explicit read queries, query-scoped lazy relations, projection selects, and relation loading.
- Relation-aware `query(...)`, `load(...)`, and `loadMany(...)` are not implemented on the proxy-backed runtime yet.
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
| Add the Next.js ORM adapter | `npm install @ezorm/next` |
| Add the NestJS ORM adapter | `npm install @ezorm/nestjs` |

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
await posts[0].author;
await users[0].posts;
await client.load(Post, posts[0], "author");

const projected = await client
  .query(Post)
  .join("author")
  .select<{ title: string; authorEmail: string }>({
    title: "title",
    authorEmail: "author.email"
  })
  .orderBy("title", "asc")
  .all();
```

Current relation support is intentionally narrow:

- `BelongsTo`, `HasMany`, and `ManyToMany`
- explicit key mappings are required
- `client.query(Model)` is read-only
- query results are model instances with non-enumerable lazy relation properties
- relation properties are promise-valued, for example `await post.author` and `await user.posts`
- `include(...)` prewarms lazy relation caches on query entities without changing the enumerable row shape
- `load(...)` and `loadMany(...)` remain the explicit plain-object relation APIs
- `select(...)` switches the query into flat projection mode and returns plain rows

Many-to-many relations use an explicit join table and remain read-oriented in v1:

```ts
import { Field, ManyToMany, Model, PrimaryKey } from "@ezorm/core";

@Model({ table: "posts" })
class Post {
  @PrimaryKey()
  @Field.string()
  id!: string;

  @Field.string()
  title!: string;

  @ManyToMany(() => Tag, {
    throughTable: "post_tags",
    sourceKey: "id",
    throughSourceKey: "post_id",
    targetKey: "id",
    throughTargetKey: "tag_id"
  })
  tags!: Tag[];
}

@Model({ table: "tags" })
class Tag {
  @PrimaryKey()
  @Field.string()
  id!: string;

  @Field.string()
  label!: string;
}

await client.pushSchema([Post, Tag]);

const postsWithOrmTag = await client
  .query(Post)
  .join("tags")
  .where("tags.label", "=", "orm")
  .include("tags")
  .all();

await postsWithOrmTag[0].tags;
```

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

- `@ezorm/runtime-node` for direct local SQLite Node.js usage
- `@ezorm/runtime-proxy` plus `@ezorm/proxy-node` when you need pooled or cross-database ORM transport
- `@ezorm/next`
  Use `@ezorm/next/node` to create or reuse a cached direct ORM client in server components, route handlers, and server actions. Use `@ezorm/next/edge` only when edge code must talk to an HTTP proxy endpoint.
- `@ezorm/nestjs`
  Use `EzormModule.forRoot(...)` and `EzormModule.forFeature([...])` to wire an `OrmClient` and repositories into Nest DI.

Minimal Next.js node usage:

```ts
import { getNextNodeClient } from "@ezorm/next/node";

const client = await getNextNodeClient({
  cacheKey: "app",
  connect: { databaseUrl: "sqlite::memory:" }
});
```

Minimal NestJS usage:

```ts
import { Module } from "@nestjs/common";
import { EzormModule, InjectEzormRepository } from "@ezorm/nestjs";
import { Todo } from "./todo.model";

@Module({
  imports: [
    EzormModule.forRoot({
      connect: { databaseUrl: "sqlite::memory:" }
    }),
    EzormModule.forFeature([Todo])
  ]
})
export class AppModule {}
```

The maintained examples live here:

- NestJS todo backend: [`examples/apps/nest-todo-api`](/Users/thachp/repos/sqlmodel-ts/examples/apps/nest-todo-api)
- Next.js Tailwind todo frontend: [`examples/apps/next-todo-web`](/Users/thachp/repos/sqlmodel-ts/examples/apps/next-todo-web)
- Shared todo domain code: [`examples/packages/todo-domain`](/Users/thachp/repos/sqlmodel-ts/examples/packages/todo-domain)

## Notes

The maintained product path is `@ezorm/core` + `@ezorm/orm`, with `@ezorm/runtime-proxy` as the optional pooled transport. The examples, adapters, and CLI in this repository are intentionally centered on simple ORM-style CRUD workflows with direct framework integration instead of CQRS-style indirection.

## License

Ezorm is available under the [MIT License](/Users/thachp/repos/sqlmodel-ts/LICENSE). Copyright (c) 2026 ezorm contributors.
