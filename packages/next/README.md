# @ezorm/next

`@ezorm/next` is the Next.js adapter for Ezorm's ORM-first workflow.

Use:

- `@ezorm/next/node` for direct Node runtime access in server components, route handlers, and server actions
- `@ezorm/next/edge` only when edge code must call an HTTP proxy endpoint

## Node runtime

```ts
import { getNextNodeClient } from "@ezorm/next/node";

const client = await getNextNodeClient({
  cacheKey: "app",
  connect: { databaseUrl: "sqlite::memory:" }
});
```

`getNextNodeClient(...)` memoizes the client promise on `globalThis`, which keeps local Next development and repeated server execution from creating duplicate direct ORM clients for the same cache key.

## Edge runtime

```ts
import { createNextEdgeClient } from "@ezorm/next/edge";

const client = createNextEdgeClient({
  endpoint: "https://runtime.internal"
});
```

Edge support is proxy-backed only. Relation-aware `query(...)`, `load(...)`, and `loadMany(...)` are not implemented on the proxy runtime yet.
