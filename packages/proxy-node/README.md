# @ezorm/proxy-node

`@ezorm/proxy-node` starts and manages the packaged `ezorm_proxy` binary from server-side Node.js code.

## Usage

```ts
import { ensureEzormProxy } from "@ezorm/proxy-node";

const { endpoint, close } = await ensureEzormProxy({
  databaseUrl: process.env.DATABASE_URL!
});

console.log(endpoint);
await close();
```

## Notes

- `DATABASE_URL` stays explicit.
- `host` and `port` are optional and only needed when you want a stable endpoint.
- Hosted edge deployments still need an externally reachable proxy URL; this package manages local and self-hosted Node-side processes.
