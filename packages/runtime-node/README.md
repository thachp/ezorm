# @ezorm/runtime-node

`@ezorm/runtime-node` is the direct Node.js helper for Ezorm's relational ORM flow.

It wraps `@ezorm/orm` and preserves the same API surface for:

- decorated models
- repository CRUD
- `query(...)`, joins, `include(...)`, `select(...)`
- `load(...)` and `loadMany(...)`
- `pushSchema`
- `pullSchema`

Supported direct connection URLs:

- `sqlite::memory:`
- `sqlite:///absolute/path.db`
- `postgres://...`
- `postgresql://...`
- `mysql://...`
- `mssql://...`
- `sqlserver://...`

Proxy-backed runtimes remain separate. Use `@ezorm/runtime-proxy` with `@ezorm/proxy-node` only when you specifically need the managed proxy flow.

## Usage

```ts
import { Field, Model, PrimaryKey } from "@ezorm/core";
import { createNodeRuntime } from "@ezorm/runtime-node";

@Model({
  table: "todos",
  cache: {
    backend: "file",
    ttlSeconds: 60
  }
})
class Todo {
  @PrimaryKey()
  @Field.string()
  id!: string;

  @Field.string()
  title!: string;
}

const runtime = await createNodeRuntime({
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

`readCache` matches the direct ORM client surface. In v1 it only caches `repository.findById(...)` and `repository.findMany(...)`, uses absolute TTL expiry, and clears that model's repository cache on writes.

## Build

```sh
pnpm --dir packages/runtime-node run build
```
