# Changelog

## Unreleased

- Dashboards: editors compose dashboards from widgets (live segment size, SQL metric, score distribution, bar, horizontal bar, line, area or donut chart from a query with a six-color palette, table, note) on a three-column grid; stored in `scorebase_app.dashboards`; four sample dashboards can be created from the demo project.
- Configuration editors redesigned: a Setup page lists the six files in order with their status; list-based sections use a list-and-detail layout with search and keyboard selection; forms are split into named groups with one-line explanations.
- New sign-in page, page transitions, staggered card entrances, and an animated water scene on the overview.
- Pelagix brand: logo, favicon, and navy-tinted light and dark themes.
- README rewritten as a reference, with a demo-data walkthrough and three diagrams (architecture, pipeline, data model) under `docs/`.
- MIT license.
- The engine API is a FastAPI application. OpenAPI docs are served at `/docs` while it runs. Error codes are specific: 400 for blocked SQL, 408 for query timeouts, 422 for config validation, 401 for a missing token.
- Postgres as a warehouse (`warehouse.kind: postgres`). Sources are read by DuckDB and copied into a Postgres schema; scoring, segments and publish all run there. Tested in CI.
- A score may set its own `from`, `where` and `key_expr`, so scores can aggregate from different tables. Scores that share a base query are grouped into one aggregate.
- `attributes` in project.yaml copies columns from the entity table into the score table, so segments and the members table can use text values such as a state or a channel.
- Segment rules: `match: any` as well as `all`; operators `in`, `not_in`, `is_null`, `is_not_null`; string values and lists.
- `publish.history: true` keeps a `<table>_history` table with one row per entity per run.
- Security fix: source preview and load only accept local paths under `$SCOREBASE_HOME/data`, and remote URLs only when they start with a prefix listed in `SCOREBASE_REMOTE_SOURCES`. Before this, an editor could point a source at any file on the engine host or at any URL.
- Login lockout and per-user rate limits are stored in Postgres, so several app instances share them.
- Pipeline run history is stored in Postgres when `SCOREBASE_PG_URL` is set, so it survives restarts and is visible from any API instance.
- The Mastra (TypeScript) agent is removed. The LangGraph agent in the engine is the only text-to-SQL agent; the model key is read by the engine API, not the app.
- `scorebase init <name>` writes a starter config directory.
- Docker images for the engine and the app, a `zero` build target for zero-cache, and a `stack` compose profile that runs everything.
- `SCOREBASE_HOME` points the engine at the directory that holds `configs/` and `data/`, so the package can run outside the repository.
- `make dev` runs the engine API, zero-cache and the app in one terminal.

## 0.1.0

First working version: config-driven load, score, segments and diff publish on DuckDB; the web app with live sync, SQL workspace, config editors, users and audit log; verified queries and the text-to-SQL agent.
