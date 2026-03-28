# sqlmodel-ts

`sqlmodel-ts` is the workspace for the `sqlmod` CLI and the supporting CQRS, event, and runtime packages.

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
