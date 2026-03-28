# ezorm

`ezorm` is the published CLI package for Ezorm workflows.

## Current Status

The current command surface is implemented and stable enough to inspect with `--help`, but most commands still print queued/demo output rather than executing a fully wired workflow.

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
ezorm migrate generate [name]
ezorm migrate apply
ezorm migrate status
ezorm db pull
ezorm db push
```

## Example Output

```sh
npx ezorm migrate status
# Queued migrate status

npx ezorm db push
# Queued db push
```

For the TypeScript APIs behind Ezorm applications, see the repository root README and the `@ezorm/*` packages.
