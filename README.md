# Scorebase

Raw customer data in, precomputed scores out, served to an app that syncs live and answers plain-English questions.
Everything domain-specific lives in YAML under `configs/<name>/`. The engine never mentions customers or orders.

![Scorebase](docs/screenshot.png)

```
 configs/retail/*.yaml          sources · scores · segments · semantic model · golden queries
 ════════════════════ engine (Python, generic) ════════════════════
 load      raw tables into the warehouse (DuckDB locally, Snowflake in prod)
 load      files, globs, s3:// / https:// URLs or Postgres tables; replace or incremental
 check     per-source data checks (columns, not-null, unique, min rows); a failure stops the run
 score     one entity_scores table, every entity included; scores ordered by their dependencies
 segments  structured rules → SQL counts (same rules run in the browser via Zero)
 publish   warehouse → Postgres, writing only rows that changed; schema follows the config
 codegen   app/src/generated/project.ts: the app's Zero schema and display config
 api       config read/write/validate, previews, runs, guarded read-only SQL, golden matching
 ════════════════════ app (TypeScript) ════════════════════════════
 Zero      Postgres → zero-cache → browser; named queries only (/api/zero/query)
 UI        TanStack Start · React 19 · Tailwind · Recharts
           overview, SQL workspace, a config editor for every YAML file, pipeline runs
 Users     Postgres (schema scorebase_auth): viewer / editor / admin, sessions, audit log
 Ask       verified (golden) query first; otherwise a Mastra + Claude agent writes SQL
```

## Run it

```bash
make setup          # venv, pnpm install, app/.env (Postgres URL + API token), Postgres in Docker
make data           # 20K synthetic customers → scores → Postgres → app schema
make api            # terminal 1: engine API  :8787 (requires the token from app/.env)
make zero           # terminal 2: Zero sync   :4848 (forwards the session cookie)
make app            # terminal 3: web app     :3000; the first visitor creates the admin account
make test           # 52 tests, config validation, 5/5 golden queries, app typecheck
make e2e            # 8 browser tests against the running stack (Playwright)
```

Optional: put `OPENROUTER_API_KEY=...` (or `ANTHROPIC_API_KEY`) in `app/.env` so the Ask box can answer questions that no verified query covers.

## What's verified

| Check | Result |
|---|---|
| Engine, agent and API tests | 52/52 |
| SQL guard | blocks COPY, INSERT … SELECT, SELECT INTO, file/settings functions, other schemas; caps rows on UNION and large LIMITs |
| Read-only query connection | file and network access disabled in DuckDB, so a guard miss still can't read or write files |
| Verified-answer matching | "customers *not* at risk" and "VIPs in Texas" go to the agent instead of a wrong verified answer |
| Browser tests (`tests/e2e`, Playwright) | 8/8: live overview and drawer, verified answer, guard in the SQL workspace, editor save bar, ⌘K palette, viewer invite with forced password change and lockout, wrong password, health and security headers |
| Production build | builds; serves CSP, HSTS, frame and referrer headers; `/api/health` 200 |
| Golden queries through the guard | 5/5 |
| Re-publish with no changes | 0 rows written |
| Edit one row in Postgres | shows in the open page in ~1.5s, no reload |
| Ask box, verified path | answers + Show SQL in the browser |
| Ask box, agent path: Mastra (TS) or LangGraph (Python), `SCOREBASE_AGENT` | both answered unseen questions correctly via OpenRouter, numbers checked against the engine |
| LangGraph control flow (guard retry, give-up after 3) | 2 offline tests with a scripted fake model |
| Snowflake warehouse | code written; not yet run, needs an account |

## Notes

- **Data:** `generate` writes files with TheLook's table and column names. To use the real BigQuery
  `thelook_ecommerce` export, point the paths in `configs/retail/sources.yaml` at it.
- **Generic:** `tests/test_engine.py::test_engine_is_generic` scores countries from labor statistics
  with the same engine and only a different config. The app reads its columns, labels and formats
  from the config through codegen, so a new project needs no app code changes.
- **Agent accuracy:** `scorebase eval retail --agent` asks the agent every golden question with that
  question's own example held out, and compares its result set with the verified one.
- **Production basics:** CSRF checks on state-changing server calls, security headers (CSP and HSTS in
  production), request ids and JSON access logs in the app and the engine API, `/api/health` (app) and
  `/ready` (engine) for load balancers, per-user rate limits on Ask and SQL, self-hosted fonts, light and
  dark themes, error and not-found pages. CI (`.github/workflows/ci.yml`) runs the tests and the typecheck;
  it hasn't run on GitHub yet.
- **Users:** sessions are httpOnly cookies, stored as SHA-256 hashes; passwords use scrypt. Five failed
  sign-ins lock an email or IP for 15 minutes. Disabling a user or resetting a password ends their sessions.
- **Synthetic data caveat:** order rates have a long tail, so the top few customers have 300+ orders.
