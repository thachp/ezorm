# @ezorm/runtime-proxy

`@ezorm/runtime-proxy` is the HTTP client for Ezorm's pooled proxy runtime.

## Install

```sh
npm install @ezorm/runtime-proxy
```

## Usage

```ts
import { ProxyOrmClient } from "@ezorm/runtime-proxy";

const client = new ProxyOrmClient({
  endpoint: "http://127.0.0.1:4000"
});
```
