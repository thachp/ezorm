# sqlmod

`sqlmod` is the published CLI package for SQLModel workflows.

## Current Status

The current command surface is implemented and stable enough to inspect with `--help`, but most commands still print queued/demo output rather than executing a fully wired workflow.

## Run Without Installing

```sh
npx sqlmod --help
```

## Install Locally

```sh
npm install sqlmod
```

## Commands

```text
sqlmod migrate generate [name]
sqlmod migrate apply
sqlmod migrate status
sqlmod projector replay [name]
sqlmod projector reset [name]
sqlmod db pull
```

## Example Output

```sh
npx sqlmod migrate status
# Queued migrate status

npx sqlmod projector replay balances
# Queued projector replay balances
```

For the TypeScript APIs behind SQLModel applications, see the repository root README and the `@sqlmodel/*` packages.
