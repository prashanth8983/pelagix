# Deploying Pelagix

Pelagix is four processes: Postgres, the engine API, zero-cache and the web app. Postgres holds the published scores, users, sessions, audit log, rate limits and run history. The engine API owns the warehouse (a DuckDB file, or a Postgres schema) and the config files. zero-cache replicates the published tables to browsers. The web app is what people open.

## Prerequisites

Postgres 15 or newer with `wal_level = logical`, because zero-cache replicates from it. A single database is enough; the app uses the `public` schema for published tables, `scorebase_auth` for users and sessions, `scorebase_meta` for run history, and (with the Postgres warehouse) a `warehouse` schema for raw and scored tables.

Python 3.11 or newer for the engine, Node 22 for the app and zero-cache, or Docker for all three.

## The quick way: Docker Compose

```bash
export SCOREBASE_API_TOKEN=$(openssl rand -hex 24)
export VITE_ZERO_CACHE_URL=https://zero.example.com   # how browsers reach zero-cache
docker compose --profile stack up --build -d
docker compose --profile stack exec engine python -m scorebase run retail
```

Open the app on port 3000. The first visitor creates the admin account. `./configs` and `./data` are mounted into the engine container, so config edits made in the app land in your checkout and survive restarts.

The compose file is a starting point: it runs Postgres with a fixed password and no TLS. For anything beyond a trial, run Postgres yourself and put a reverse proxy in front of the app and zero-cache.

## Running the processes yourself

Engine API, one instance per project:

```bash
pip install "scorebase[agent] @ file:./engine"   # or pip install -e ./engine[agent]
export SCOREBASE_HOME=/srv/scorebase                # holds configs/ and data/
export SCOREBASE_PG_URL=postgresql://...
export SCOREBASE_API_TOKEN=...
python -m scorebase.api retail --host 127.0.0.1 --port 8787
```

zero-cache:

```bash
cd app && pnpm install --frozen-lockfile
ZERO_UPSTREAM_DB=postgresql://... ZERO_REPLICA_FILE=/var/lib/scorebase/replica.db \
ZERO_QUERY_URL=http://127.0.0.1:3000/api/zero/query ZERO_QUERY_FORWARD_COOKIES=true \
ZERO_ENABLE_CRUD_MUTATIONS=false pnpm exec zero-cache
```

Web app:

```bash
cd app && VITE_ZERO_CACHE_URL=https://zero.example.com pnpm build
NODE_ENV=production PORT=3000 node server.mjs
```

`VITE_ZERO_CACHE_URL` is read at build time and put in the browser bundle, so build the app for the hostname browsers will use. Running `scorebase codegen` after a config change rewrites `app/src/generated/project.ts`; the app must be rebuilt when the score table's columns change.

## Environment variables

| Variable | Read by | Required | Meaning |
|---|---|---|---|
| `SCOREBASE_HOME` | engine | no | Directory holding `configs/` and `data/`. Defaults to the current directory if it has `configs/`, else the repository. |
| `SCOREBASE_PG_URL` | engine, app | yes | The app database. The engine publishes scores to it and stores run history in it; the app stores users, sessions, limits. The name is configurable per project via `publish.postgres_url_env`. |
| `SCOREBASE_API_TOKEN` | engine, app | yes in production | Shared bearer token. The engine refuses every request without it when set; the app sends it. |
| `SCOREBASE_API_URL` | app | no | Where the app finds the engine API. Default `http://localhost:8787`. |
| `SCOREBASE_WAREHOUSE_URL` | engine | with `warehouse.kind: postgres` | Postgres URL for the warehouse schema. Name configurable via `warehouse.url_env`. |
| `SCOREBASE_REMOTE_SOURCES` | engine | no | Comma-separated URL prefixes a source `path` may use, for example `s3://my-bucket/exports/`. Empty means local files only. |
| `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` | engine | no | A model key for the Ask agent. Without one, Ask answers only from verified queries. |
| `SCOREBASE_MODEL` | engine | no | Model id override for the agent. |
| `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_PASSWORD`, `SNOWFLAKE_ROLE`, `SNOWFLAKE_WAREHOUSE`, `SNOWFLAKE_DATABASE`, `SNOWFLAKE_SCHEMA` | engine | with `warehouse.kind: snowflake` | Snowflake credentials. This warehouse is untested. |
| `VITE_ZERO_CACHE_URL` | app (build time) | yes | URL browsers use to reach zero-cache. |
| `ZERO_UPSTREAM_DB`, `ZERO_REPLICA_FILE`, `ZERO_QUERY_URL`, `ZERO_QUERY_FORWARD_COOKIES`, `ZERO_ENABLE_CRUD_MUTATIONS` | zero-cache | yes | Standard zero-cache settings. Keep CRUD mutations off; the app never writes through Zero. |
| `NODE_ENV=production` | app | yes | Turns on the CSP, HSTS and secure cookies. |
| `PORT`, `HOST` | app | no | Where `server.mjs` listens. Defaults 3000 and 0.0.0.0. |

The engine also reads `app/.env` when it is started with `--env-file` or from the repository, so a single file can hold the shared values in development.

## Network layout

Expose two things to users, both behind a reverse proxy that terminates TLS: the web app and zero-cache (it uses WebSockets, so the proxy must pass `Upgrade`). Everything else stays private.

The engine API must not be reachable from outside. It has one shared token and no per-user roles; the app's server side enforces roles before calling it. Bind it to localhost or a private network, and firewall port 8787.

Postgres accepts connections from the engine, the app and zero-cache only. zero-cache needs a replication-capable role.

With `NODE_ENV=production` the app sends a Content-Security-Policy that allows connections to `self` and the zero-cache URL only. If you put zero-cache on another origin, set `VITE_ZERO_CACHE_URL` to it at build time so the CSP includes it.

## Backups

Back up three things. Postgres, with your usual tooling. The `configs/` directory, which is plain YAML and belongs in version control as well as in backups; each save also keeps the previous file under `configs/<project>/.history/`. The `data/` directory, which holds the DuckDB warehouse, generated or downloaded source files, and run logs when there is no Postgres. With the Postgres warehouse the DuckDB file is not used and raw tables live in the database backup.

## Scaling

The web app can run as several instances behind a load balancer. Sessions, login lockout, rate limits and run history are in Postgres, so nothing depends on which instance serves a request. The app's small in-memory cache of the engine's context lasts five seconds and is harmless to duplicate.

zero-cache runs as one instance per replica file. See the Zero documentation for its own multi-node setup.

The engine API runs as one instance per project. It owns the config files on disk and, with DuckDB, the warehouse file, which allows one writer. Pipeline runs start as subprocesses of the API, so the API instance is also where runs execute. With the Postgres warehouse the DuckDB file goes away and the warehouse itself scales with Postgres, but config files still live on the API host; keep them on a persistent volume and, if you ever need more than one API instance, put `configs/` on shared storage and accept that two instances could save the same file at the same time.

## Upgrades

1. Pull the new version and read `CHANGELOG.md`.
2. Run `scorebase validate <project>` with the new engine. Config format changes show up here.
3. Restart the engine API, then run `scorebase run <project>` so codegen rewrites the app schema.
4. Rebuild and restart the app, then zero-cache.

Postgres schema changes in `scorebase_auth` and `scorebase_meta` are applied by the app and the engine on start with `CREATE ... IF NOT EXISTS`; there is no migration tool to run.
