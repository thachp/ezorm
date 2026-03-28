# @ezorm/runtime-node

`@ezorm/runtime-node` packages the Node.js runtime bindings used by Ezorm.

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
