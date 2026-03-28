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
ezorm migrate generate [name]
ezorm migrate apply
ezorm migrate status
ezorm migrate resolve --applied <filename>
ezorm migrate resolve --rolled-back <filename>
ezorm db pull
ezorm db push
```

## Config

```sh
cat > ezorm.config.mjs <<'EOF'
import { TodoModel } from "./models.js";

export default {
  databaseUrl: "sqlite:///tmp/ezorm.db",
  models: [TodoModel]
};
EOF
```

`migrations/` is the default migration directory. Set `migrationsDir` in the config to override it.

## Example Workflow

```sh
npx ezorm migrate generate init
npx ezorm migrate apply
npx ezorm migrate status
npx ezorm db pull
npx ezorm db push
```

`db push` is the direct additive schema-sync shortcut for development. `migrate resolve` only reconciles migration history; it does not execute SQL.

For the TypeScript APIs behind Ezorm applications, see the repository root README and the `@ezorm/*` packages.
