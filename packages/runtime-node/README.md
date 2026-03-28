# @sqlmodel/runtime-node

`@sqlmodel/runtime-node` packages the Node.js runtime bindings used by SQLModel.

## Prebuilt Native Layout

The package looks for prebuilt native bindings at:

```text
native/<target-triple>/sqlmodel_napi.node
```

The build script also writes a flat `native/sqlmodel_napi.node` copy for local
development.

## Build

```sh
pnpm --dir packages/runtime-node run build
pnpm --dir packages/runtime-node run build:native
```
