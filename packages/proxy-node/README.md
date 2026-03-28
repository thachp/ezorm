# @ezorm/proxy-node

`@ezorm/proxy-node` starts and manages the packaged `ezorm_proxy` binary from server-side Node.js code.

## Usage

```ts
import { ensureEzormProxy } from "@ezorm/proxy-node";

const { endpoint, close } = await ensureEzormProxy({
  databaseUrl: process.env.DATABASE_URL!,
  pool: {
    minConnections: 1,
    maxConnections: 8
  }
});

console.log(endpoint);
await close();
```

## Notes

- `DATABASE_URL` stays explicit.
- `pool` is optional and forwards SQLx pool settings into the managed proxy process.
- `host` and `port` are optional and only needed when you want a stable endpoint.
- The managed proxy serves pooled ORM CRUD plus `pushSchema` / `pullSchema` for SQLite, PostgreSQL, and MySQL.
- Relation-aware `query(...)`, `load(...)`, and `loadMany(...)` are not implemented on the pooled proxy runtime yet.
- Hosted edge deployments still need an externally reachable proxy URL; this package manages local and self-hosted Node-side processes.
