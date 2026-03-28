# sqlmod

`sqlmod` is the published CLI package for SQLModel workflows.

## Install

```sh
npm install sqlmod
pnpm add sqlmod
```

## Run

```sh
npx sqlmod migrate status
sqlmod migrate apply
sqlmod projector replay balances
```

## Commands

```sh
sqlmod migrate generate [name]
sqlmod migrate apply
sqlmod migrate status
sqlmod projector replay [name]
sqlmod projector reset [name]
sqlmod db pull
```
