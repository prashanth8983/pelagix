# Local development. `make setup` once, `make data` once, then `make dev` (or `api`, `zero`
# and `app` in three terminals). `make stack` runs everything in Docker instead.
PY      := .venv/bin/python
PG_URL  := postgresql://scorebase:scorebase@localhost:5433/scorebase
PROJECT ?= retail

setup:           ## venv, pnpm install, app/.env, Postgres in Docker
	python3 -m venv .venv && .venv/bin/pip install -q -e "engine[dev]"
	cd app && pnpm install
	$(MAKE) env
	docker compose up -d --wait

env:             ## create app/.env, adding the Postgres URL and a fresh API token if missing
	@test -f app/.env || cp app/.env.example app/.env
	@grep -q '^SCOREBASE_PG_URL=.' app/.env || echo 'SCOREBASE_PG_URL=$(PG_URL)' >> app/.env
	@grep -q '^SCOREBASE_API_TOKEN=.' app/.env || echo "SCOREBASE_API_TOKEN=$$(openssl rand -hex 24)" >> app/.env
	@echo "app/.env ready"

data:            ## generate demo data, score it, publish to Postgres, update the app schema
	$(PY) -m scorebase generate $(PROJECT)
	SCOREBASE_PG_URL=$(PG_URL) $(PY) -m scorebase run $(PROJECT)

score:           ## re-score and publish (only changed rows are written)
	SCOREBASE_PG_URL=$(PG_URL) $(PY) -m scorebase run $(PROJECT)

dev:             ## engine API, zero-cache and the web app in one terminal
	PY=$(PY) PROJECT=$(PROJECT) SCOREBASE_PG_URL=$(PG_URL) scripts/dev.sh

api:             ## engine API for the app (port 8787); reads app/.env, including the shared token
	SCOREBASE_PG_URL=$(PG_URL) $(PY) -m scorebase.api $(PROJECT) --port 8787

zero:            ## Zero sync server (port 4848); forwards the session cookie to the query endpoint
	cd app && ZERO_UPSTREAM_DB=$(PG_URL) ZERO_REPLICA_FILE=$$PWD/.zero/replica.db \
	  ZERO_QUERY_URL=http://localhost:3000/api/zero/query ZERO_QUERY_FORWARD_COOKIES=true \
	  ZERO_ENABLE_CRUD_MUTATIONS=false pnpm exec zero-cache-dev

app:             ## web app (port 3000)
	cd app && pnpm dev

stack:           ## the whole stack in Docker (needs SCOREBASE_API_TOKEN in the environment)
	docker compose --profile stack up --build

test:            ## engine and API tests, config validation, golden queries, app typecheck
	SCOREBASE_TEST_PG_URL=$(PG_URL) $(PY) -m pytest -q tests && $(PY) -m scorebase validate $(PROJECT) && $(PY) -m scorebase eval $(PROJECT)
	cd app && npx tsc --noEmit

e2e:             ## browser tests against the running stack (needs: pip install playwright && playwright install chromium)
	E2E_BASE_URL=$${E2E_BASE_URL:-http://localhost:3000} $(PY) -m pytest -q tests/e2e

.PHONY: setup env data score dev api zero app stack test e2e
