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

## Build

```sh
pnpm --dir packages/runtime-node run build
```
