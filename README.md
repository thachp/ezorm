# sqlmodel-ts

`sqlmodel-ts` is the workspace for the `sqlmod` CLI and the supporting CQRS, event, and runtime packages.

## HTTP Runtime Proxy

The Rust proxy crate now ships a real HTTP service for edge and remote runtimes.
Start it with a database URL and point `@sqlmodel/runtime-proxy` or
`createNextEdgeRuntime()` at the resulting endpoint.

```sh
DATABASE_URL=sqlite://sqlmodel.db cargo run -p sqlmodel_proxy
```

The service listens on `127.0.0.1:3000` by default and accepts optional `HOST`
and `PORT` overrides.

## npm CLI

The first publish target is the unscoped `sqlmod` package.

```sh
npm install sqlmod
pnpm add sqlmod
npx sqlmod migrate status
```

Installed usage:

```sh
sqlmod migrate status
sqlmod migrate generate add_users_table
sqlmod projector replay balances
```

## Workspace Validation

```sh
pnpm build:ts
pnpm typecheck
pnpm test:ts
pnpm test
```

Packaging and smoke-test workflows:

```sh
pnpm build:sqlmod
pnpm pack:sqlmod
pnpm smoke:sqlmod
pnpm release:sqlmod
```
