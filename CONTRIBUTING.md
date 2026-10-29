# Contributing

## Setup

You need Python 3.11 or newer, Node 22 with pnpm 10, and Docker (for Postgres).

```bash
make setup     # venv with the engine installed, pnpm install, app/.env, Postgres in Docker
make data      # synthetic retail data, scored and published
make dev       # engine API, zero-cache and the web app in one terminal
```

`make dev` runs the same three commands as `make api`, `make zero` and `make app`. Use the separate targets when you want each process in its own terminal.

## Tests

```bash
make test      # engine and API tests, config validation, golden queries, app typecheck
make e2e       # browser tests against a running stack (pip install playwright && playwright install chromium)
```

Engine tests live in `tests/`. They copy the retail project into a temp directory and run against DuckDB, so they need no services. Tests that need Postgres (the Postgres warehouse, publish) read `SCOREBASE_TEST_PG_URL` and skip when it is not set; `make setup` gives you a local Postgres at `postgresql://scorebase:scorebase@localhost:5433/scorebase`.

The browser suite in `tests/e2e/` needs the full stack running on `E2E_BASE_URL` and either an empty users table (it creates the first admin) or `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` for an existing admin.

## Where things are

| Path | What |
|---|---|
| `engine/scorebase/schema.py` | The shape of every config file. The CLI, the API and the app's editor all validate through it. |
| `app/src/lib/types.ts` | The same shapes in TypeScript, for the editor. Change both together. |
| `engine/scorebase/scorer.py` | Turns scores.yaml into one SQL statement. |
| `engine/scorebase/sqlguard.py` | What user and agent SQL may do. Add a test for every new rule. |
| `engine/scorebase/api.py` | The HTTP API the app calls. `/docs` shows the OpenAPI page when it is running. |
| `app/src/server/` | Server functions: auth, config, ask. Browser code never calls the engine directly. |
| `app/src/generated/project.ts` | Written by `scorebase codegen`. Never edit by hand. |
| `docs/configuration.md` | The config reference. Update it with any schema change. |

## Conventions

- Keep modules small and give each one a docstring that says what it is for and what it is not.
- The engine must stay generic. Nothing under `engine/` may mention customers, orders or any other domain word; those belong in `configs/`.
- No new dependencies without a reason in the PR. The engine's runtime dependencies are deliberately few.
- SQL that reaches the warehouse from a user or a model goes through `sqlguard.check`. No exceptions.
- Identifiers that come from config or requests go through `warehouse.ident` or `warehouse.bare` before they are put in SQL.
- Plain English in messages and docs. Error messages name the file and field (`scores.3.sql: ...`).

## Pull requests

- One change per PR. A refactor and a behaviour change are two PRs.
- `make test` passes.
- A config change updates `schema.py`, `types.ts` and `docs/configuration.md`.
- A behaviour change has a test, or the PR explains why it cannot.
- Add a line under Unreleased in `CHANGELOG.md`.
