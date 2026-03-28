# ezorm

`ezorm` is the published CLI package for Ezorm workflows.

## Run Without Installing

```sh
npx ezorm --help
```

## Install Locally

```sh
npm install ezorm
```

## Commands

```text
ezorm init [--ts|--js]
ezorm migrate generate [name]
ezorm migrate apply
ezorm migrate status
ezorm migrate resolve --applied <filename>
ezorm migrate resolve --rolled-back <filename>
ezorm db pull
ezorm db push
```

## Config

Start with the scaffold:

```sh
npx ezorm init
```

Supported config filenames:

- `ezorm.config.ts`
- `ezorm.config.mts`
- `ezorm.config.cts`
- `ezorm.config.mjs`
- `ezorm.config.js`
- `ezorm.config.cjs`

Config files must export:

- `databaseUrl`
- optional `models`
- optional `modelPaths`
- optional `migrationsDir`

When `models` is omitted, the CLI scans `modelPaths` for files containing `@Model` or `Model(...)` and derives the schema from the discovered model metadata.

TypeScript scaffolds write `ezorm.config.ts`, ensure `experimentalDecorators` and `emitDecoratorMetadata` are enabled in `tsconfig.json`, and create an example `Todo` model when the project does not already contain one.

Schema-producing commands fail fast when a loaded model resolves to incomplete metadata, such as no fields or no single-column primary key. If `migrate generate`, `migrate status`, or `db push` report invalid model metadata, check that your decorators executed, the model is loaded through a supported TypeScript or JavaScript entrypoint, and TypeScript decorator settings are enabled.

JavaScript scaffolds write `ezorm.config.mjs` for ESM packages and `ezorm.config.cjs` otherwise. The generated JavaScript Todo example uses direct decorator function calls so it can run without TypeScript syntax.

`migrations/` is the default migration directory. Set `migrationsDir` in the config to override it.

## Example Workflow

```sh
npx ezorm init
npx ezorm migrate generate init
npx ezorm migrate apply
npx ezorm migrate status
npx ezorm db pull
npx ezorm db push
```

`db push` is the direct additive schema-sync shortcut for development. `migrate resolve` only reconciles migration history; it does not execute SQL.

For the TypeScript APIs behind Ezorm applications, see the repository root README and the `@ezorm/*` packages.
