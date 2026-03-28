# ezorm

Ezorm is a TypeScript ORM built around decorated models, repository CRUD, explicit read queries, and an optional managed proxy runtime.

The practical path today is:

- `@ezorm/core` defines decorated models plus runtime metadata and validation.
- `@ezorm/orm` is the primary direct Node.js ORM for SQLite, PostgreSQL, MySQL, and MSSQL.
- `ezorm` is the CLI for migrations and schema workflows from an explicit `ezorm.config.*` file.
- The maintained Nest and Next todo apps are the best end-to-end references in this repository.
- The maintained examples default to `sqlite::memory:`, so restarting those processes clears data.

## Start Here

If you are new to ezorm, use this order:

1. Install `@ezorm/core` and `@ezorm/orm`.
2. Define a decorated model.
3. Create a client, run `pushSchema`, and use a repository.
4. Add the CLI for checked-in migration workflows.
5. Add a framework adapter or proxy runtime only after the direct ORM flow works.

Recommended first install:

```sh
npm install @ezorm/core @ezorm/orm
```

Install by intent:

| Goal | Package |
| --- | --- |
| Define model metadata with decorators | `@ezorm/core` |
| Use direct Node.js ORM repositories and queries | `@ezorm/orm` |
| Use the CLI for migrations and schema workflows | `ezorm` |
| Wrap the direct ORM with a Node runtime helper | `@ezorm/runtime-node` |
| Reuse direct ORM clients in Next.js Node runtimes | `@ezorm/next` |
| Wire ORM clients and repositories into Nest DI | `@ezorm/nestjs` |
| Use the pooled HTTP proxy client | `@ezorm/runtime-proxy` |
| Start and manage the packaged proxy process from Node.js | `@ezorm/proxy-node` |

To inspect the current CLI surface without installing anything:

```sh
npx ezorm --help
```

## Define Your First Model

Start with `@ezorm/core` when you want model metadata and input validation from the same decorated class.

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

That gives you:

- runtime metadata for tables, fields, indices, and relations
- input validation from the same model definition

## Build Your First CRUD Flow

`@ezorm/orm` is the primary Node.js ORM surface. The fastest first run is SQLite in memory.

```ts
import { Field, Model, PrimaryKey } from '@ezorm/core';
import { createOrmClient } from '@ezorm/orm';

@Model({ table: 'todos' })
class Todo {
  @PrimaryKey()
  @Field.string()
  id!: string;

  @Field.string()
  title!: string;

  @Field.boolean({ defaultValue: false })
  completed!: boolean;
}

const run = async () => {
  const client = await createOrmClient({
    databaseUrl: 'sqlite::memory:',
  });

  await client.pushSchema([Todo]);

  const todos = client.repository(Todo);

  await todos.create({
    id: 'todo_1',
    title: 'Ship the README',
    completed: false,
  });

  console.log(await todos.findById('todo_1'));

  console.log(
    await todos.findMany({
      orderBy: { field: 'title', direction: 'asc' },
    }),
  );

  console.log(
    await todos.update('todo_1', {
      completed: true,
    }),
  );

  await todos.delete('todo_1');

  await client.close();
};

void run();
```

The repository API is intentionally small in v1:

- `create`
- `findById`
- `findMany`
- `update`
- `delete`

`findMany(...)` supports exact-match scalar filters and simple ordering for single-table CRUD.

## Enable Repository Read Cache

`readCache` is opt-in on the direct ORM path. Use it when you want cached repository reads for `findById(...)` and `findMany(...)`.

```ts
import { createOrmClient } from "@ezorm/orm";

const client = await createOrmClient({
  databaseUrl: "sqlite::memory:",
  readCache: {
    default: {
      backend: "memory",
      ttlSeconds: 30
    }
  }
});
```

The same cache configuration is available through `@ezorm/runtime-node`:

```ts
import { createNodeRuntime } from "@ezorm/runtime-node";

const client = await createNodeRuntime({
  connect: {
    databaseUrl: "sqlite::memory:",
    readCache: {
      default: {
        backend: "memory",
        ttlSeconds: 30
      }
    }
  }
});
```

Current cache behavior:

- `readCache` is opt-in.
- It applies only to `repository.findById(...)` and `repository.findMany(...)`.
- TTL is absolute from write time.
- `create`, `update`, and `delete` clear that model's cached repository entries.

## Manage Schema With The CLI

The `ezorm` CLI uses a project-level config file named one of:

- `ezorm.config.ts`
- `ezorm.config.mts`
- `ezorm.config.cts`
- `ezorm.config.mjs`
- `ezorm.config.js`
- `ezorm.config.cjs`

The config must export:

- `databaseUrl`
- optional `models`
- optional `modelPaths`
- optional `migrationsDir`

Example:

```ts
export default {
  databaseUrl: "sqlite:///tmp/ezorm.db",
  modelPaths: ["src/models"],
  migrationsDir: "migrations"
};
```

If `models` is omitted, the CLI scans `modelPaths` and imports files containing `@Model` or `Model(...)` before deriving schema metadata. Generated configs prefer `src/models` or `models`. Explicit `models` still override scan mode, and broad scan roots such as `["src"]` or `["."]` may import unrelated matching modules.

Use `npx ezorm init` to scaffold the config in the nearest package root, add a minimal Todo model when the project does not already have one, and patch `tsconfig.json` for decorator support in TypeScript projects. TypeScript and JavaScript scaffolds default `modelPaths` to `["src/models"]` when `src/` exists or `["models"]` otherwise.

TypeScript config files can still import decorator-authored `.ts` model classes directly. JavaScript config files remain supported for ESM and CommonJS projects.

Current CLI commands:

```text
ezorm init [--ts|--js]
ezorm migrate generate [name]
ezorm migrate apply
ezorm migrate status
ezorm migrate resolve --applied <filename>
ezorm migrate resolve --rolled-back <filename>
ezorm db pull
ezorm db push
```

Typical workflow:

```sh
npx ezorm init
npx ezorm migrate generate init
npx ezorm migrate apply
npx ezorm migrate status
npx ezorm db pull
npx ezorm db push
```

Command behavior today:

- `init` writes `ezorm.config.*`, adds an example Todo model when needed, and patches TypeScript decorator compiler flags for TS scaffolds.
- `migrate generate` writes additive SQL migration files.
- `migrate apply` executes pending migration files and records them in `_ezorm_migrations`.
- `migrate status` shows migration state.
- `migrate resolve` only reconciles migration history. It does not execute SQL.
- `db pull` prints the live schema as JSON.
- `db push` applies additive schema drift directly without updating migration history, which makes it the development shortcut rather than the checked-in migration path.

## Read Relations As A Next Step

Use repository CRUD for simple writes and single-table reads. Use `client.query(...)` plus explicit relation metadata for relation-aware reads.

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
await client.loadMany(User, users, "posts");

const projected = await client
  .query(Post)
  .join("author")
  .select<{ title: string; authorEmail: string }>({
    title: "title",
    authorEmail: "author.email"
  })
  .orderBy("title", "asc")
  .all();

console.log(projected);
```

Current relation behavior:

- `BelongsTo`, `HasMany`, and `ManyToMany` are supported.
- Relation metadata requires explicit key mappings.
- `client.query(Model)` is read-only.
- `include(...)` prewarms lazy relation caches on query entities.
- `await post.author` and `await user.posts` read lazy relation properties from query results.
- `load(...)` and `loadMany(...)` are the explicit plain-object relation loaders.
- `select(...)` switches the query into flat projection mode and returns plain rows.

Relation-aware `query(...)`, `load(...)`, and `loadMany(...)` are available on the direct ORM path. They are not implemented on proxy-backed runtimes yet.

## Choose A Runtime Or Framework Adapter

Choose the smallest layer that matches your deployment shape.

### Direct `@ezorm/orm`

Use this first. It is the primary direct Node.js ORM surface for SQLite, PostgreSQL, MySQL, and MSSQL.

### `@ezorm/runtime-node`

Use this when you want a thin Node runtime wrapper but the same direct ORM behavior surface.

```ts
import { createNodeRuntime } from "@ezorm/runtime-node";

const client = await createNodeRuntime({
  connect: { databaseUrl: "sqlite::memory:" }
});
```

### `@ezorm/next/node`

Use this in Next.js server components, route handlers, and server actions when you want a cached direct ORM client.

```ts
import { getNextNodeClient } from "@ezorm/next/node";

const client = await getNextNodeClient({
  cacheKey: "app",
  connect: { databaseUrl: "sqlite::memory:" }
});
```

### `@ezorm/nestjs`

Use this when you want an `OrmClient` and repositories wired through Nest dependency injection.

```ts
import { Module } from "@nestjs/common";
import { EzormModule } from "@ezorm/nestjs";
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

### Optional proxy runtime

Use `@ezorm/runtime-proxy` and `@ezorm/proxy-node` only when you specifically need the managed proxy flow.

- `@ezorm/proxy-node` starts and manages the packaged proxy binary from Node.js.
- `@ezorm/runtime-proxy` is the HTTP client for that proxy.
- The managed proxy supports pooled repository CRUD plus `pushSchema` and `pullSchema` for SQLite, PostgreSQL, MySQL, and MSSQL.
- Relation-aware `query(...)`, `load(...)`, and `loadMany(...)` are not implemented on the pooled proxy runtime yet.
- For Node-managed proxy usage, prefer `@ezorm/proxy-node` instead of documenting manual Cargo startup as the default workflow.

## Examples And Current Limits

Use these examples when you want a complete application reference:

- NestJS todo backend: [examples/apps/nest-todo-api](examples/apps/nest-todo-api)
- Next.js todo frontend: [examples/apps/next-todo-web](examples/apps/next-todo-web)
- Shared todo domain code: [examples/packages/todo-domain](examples/packages/todo-domain)

Current limits that matter when you are evaluating the workflow:

- The maintained todo examples default to `sqlite::memory:`, so process restarts clear state.
- Direct `@ezorm/orm` and `@ezorm/runtime-node` support SQLite, PostgreSQL, MySQL, and MSSQL.
- Proxy-backed runtimes support pooled CRUD plus `pushSchema` and `pullSchema` for SQLite, PostgreSQL, MySQL, and MSSQL.
- Relation-aware `query(...)`, `load(...)`, and `loadMany(...)` remain direct-ORM features today.
- Primary key handling is intentionally simple in v1: application-supplied keys and single-column primary keys only.

## Why Ezorm Is Different

Ezorm keeps a few design choices explicit:

- decorated model classes are the source for metadata, validation, indices, and relations
- repository CRUD stays small, while relation-aware reads move into explicit `query(...)` flows
- runtime shape is an architectural choice, with a clear split between direct ORM usage and the managed proxy path
- schema workflows stay explicit through `pushSchema`, `pullSchema`, and CLI migrations driven by config

## Maintainer Release Workflow

Use the committed package manifests as the source of truth for npm releases.

1. Update versions with `pnpm version:workspace <version>`.
2. Commit and merge the version bump to `main`.
3. GitHub Actions publishes the npm packages automatically and pushes `v<version>` after the publish step succeeds.

## License

Ezorm is available under the [MIT License](LICENSE). Copyright (c) 2026 ezorm contributors.
