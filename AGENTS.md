# ezorm Agent Guide

## Workspace Overview

- TypeScript workspace commands live at the repository root via `pnpm`.
- Rust workspace validation lives at the repository root via `cargo`.
- Model metadata primitives live in `packages/core`, and the primary ORM/runtime workflow lives in `packages/orm`.
- Runnable examples live under `examples/apps`, and shared example-only code lives under `examples/packages`.
- The maintained todo examples use decorated models plus repository CRUD over SQLite-backed storage; the demo defaults to `sqlite::memory:` so process restarts clear data.
- The HTTP runtime proxy lives in `crates/proxy`, packaged Node-side lifecycle management lives in `packages/proxy-node`, and edge-facing TypeScript clients should use `packages/runtime-proxy` plus `packages/next/node` or `packages/proxy-node` instead of documenting manual Cargo startup.
- Keep workflow documentation aligned with the actual workspace surface before adding new commands, adapters, or schema behavior.

## Preferred Workflow

- Inspect the current package, crate, and CLI surface before adding a new workflow command or query.
- Prefer the root validation commands that already exist: `pnpm typecheck`, `pnpm test:ts`, `pnpm test`, and `cargo test`.
- Keep adapters thin. CLI parsing and other public entrypoints should delegate business logic into shared ORM/repository helpers instead of reimplementing it inline.
- Proxy bootstrap should go through `@ezorm/proxy-node` or `@ezorm/next/node`; do not reintroduce manual `cargo run -p ezorm_proxy` as the default developer workflow.
- When a workflow changes, update `AGENTS.md` and any related docs in the same change.

## Common Commands

Root scripts:

- `pnpm build:ts`
- `pnpm build:proxy-node`
- `pnpm build:ezorm`
- `pnpm example:build`
- `pnpm example:nest:dev`
- `pnpm example:next:dev`
- `pnpm example:test`
- `pnpm pack:proxy-node`
- `pnpm typecheck`
- `pnpm pack:ezorm`
- `pnpm smoke:proxy-node`
- `pnpm smoke:ezorm`
- `pnpm release:proxy-node`
- `pnpm release:ezorm`
- `pnpm test:ts`
- `pnpm test`
- `cargo test`

Current CLI command workflows:

- `ezorm migrate generate [name]`
- `ezorm migrate apply`
- `ezorm db push`

Current CLI query workflows:

- `ezorm migrate status`
- `ezorm db pull`

Current example workflows:

- NestJS todo backend: `examples/apps/nest-todo-api`
- Next.js Tailwind todo frontend: `examples/apps/next-todo-web`
- Shared todo domain demo code: `examples/packages/todo-domain`

## ORM Rules

- New public application workflows should be modeled around decorated models and repository CRUD.
- `@ezorm/core` owns metadata, validation, indices, and relation declarations.
- `@ezorm/orm` owns schema push/pull and CRUD behavior through repositories.
- Keep primary key handling simple in v1: application-supplied keys and single-column primary keys only.
- Relation-aware reads should go through explicit key-mapped `BelongsTo` / `HasMany` metadata, `client.query(...)`, and explicit `load(...)` or `loadMany(...)` calls.
- CLI and adapters should route through shared ORM client/repository helpers instead of embedding SQL logic inline.

## Guardrails

- Do not document commands or queries that are not implemented in code.
- Do not document manual Cargo proxy startup as the default edge or remote runtime workflow when the managed Node launcher covers the same path.
- Keep docs aligned with the ORM-first surface. Do not reintroduce alternate non-ORM workflows into maintained examples or top-level documentation.
- Use `packages/cli/src/index.ts` as the source of truth for the current CLI workflow surface.
- Use `package.json`, `packages/cli/package.json`, and `Cargo.toml` as the source of truth for root validation commands and npm packaging workflows.
- The todo examples intentionally default to SQLite in-memory storage in v1, so docs should note that Nest restarts clear state.

## Commit Guidelines

- After completing a task that changes files, agents should create a git commit automatically unless the user explicitly asks not to commit.
- Auto-generated commits must still use a Conventional Commit message with an appropriate scope when helpful, for example `feat(orm): add repository CRUD runtime`.
- Do not revert unrelated user changes in a dirty workspace.
