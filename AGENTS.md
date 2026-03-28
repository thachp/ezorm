# sqlmodel-ts Agent Guide

## Workspace Overview

- TypeScript workspace commands live at the repository root via `pnpm`.
- Rust workspace validation lives at the repository root via `cargo`.
- CQRS and event-sourcing primitives live in `packages/cqrs` and `packages/events`.
- Keep workflow documentation aligned with the actual workspace surface before adding new commands or adapters.

## Preferred Workflow

- Inspect the current package, crate, and CLI surface before adding a new workflow command or query.
- Prefer the root validation commands that already exist: `pnpm typecheck`, `pnpm test:ts`, `pnpm test`, and `cargo test`.
- Keep adapters thin. CLI parsing and other public entrypoints should delegate business logic into shared CQRS handlers instead of reimplementing it inline.
- When a workflow changes, update `AGENTS.md` and any related docs in the same change.

## Common Commands

Root scripts:

- `pnpm build:ts`
- `pnpm typecheck`
- `pnpm test:ts`
- `pnpm test`
- `cargo test`

Current CLI command workflows:

- `orm migrate generate [name]`
- `orm migrate apply`
- `orm projector replay [name]`
- `orm projector reset [name]`

Current CLI query workflows:

- `orm migrate status`
- `orm db pull`

## CQRS Rules

- Every new workflow must be modeled as either a command or a query, never both.
- Commands must go through `CommandBus` and command handlers before they are exposed through the CLI or any future adapter.
- Queries must go through `QueryBus` and query handlers and remain read-only over stored state.
- Commands may mutate event streams, snapshots, projections, or migration artifacts.
- Queries must not append events, rewrite snapshots, reset projectors, generate migrations, or otherwise change persisted state.
- If a feature needs both write and read behavior, split it into paired command and query handlers before exposing it publicly.
- Keep projectors, event store access, and snapshot persistence behind the shared CQRS layer instead of embedding that logic in adapters.

## Guardrails

- Do not document commands or queries that are not implemented in code.
- Keep command and query classifications one-way in docs and code. If a command starts returning read-model behavior, split that behavior into a separate query.
- Use `packages/cli/src/index.ts` as the source of truth for the current CLI workflow surface.
- Use `package.json` and `Cargo.toml` as the source of truth for root validation commands.

## Commit Guidelines

- After completing a task that changes files, agents should create a git commit automatically unless the user explicitly asks not to commit.
- Auto-generated commits must still use a Conventional Commit message with an appropriate scope when helpful, for example `docs(agents): add cqrs workflow rules`.
- Do not revert unrelated user changes in a dirty workspace.
