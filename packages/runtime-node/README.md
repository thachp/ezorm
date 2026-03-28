# @ezorm/runtime-node

`@ezorm/runtime-node` packages the Node.js runtime bindings used by Ezorm.

## Current Runtime Behavior

- Direct SQLite flows still work through `@ezorm/orm`.
- `createNodeRuntime({ connect })` uses the native Rust runtime for PostgreSQL, MySQL, and SQLite connections that specify pool settings.
- The pooled runtime currently supports repository CRUD plus `pushSchema` / `pullSchema`.
- Relation-aware `query(...)`, `load(...)`, and `loadMany(...)` are not implemented on the pooled runtime yet.

## Pool Options

```ts
await createNodeRuntime({
  connect: {
    databaseUrl: "postgres://user:pass@localhost/ezorm",
    pool: {
      minConnections: 1,
      maxConnections: 8,
      acquireTimeoutMs: 5000,
      idleTimeoutMs: 10000
    }
  }
});
```

## Prebuilt Native Layout

The package looks for prebuilt native bindings at:

```text
native/<target-triple>/ezorm_napi.node
```

The build script also writes a flat `native/ezorm_napi.node` copy for local
development.

## Build

```sh
pnpm --dir packages/runtime-node run build
pnpm --dir packages/runtime-node run build:native
```
