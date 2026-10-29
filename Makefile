# Local dev. Run `make setup` once, then `make data`, then `api`, `zero`, `app` in three terminals.
PY      := .venv/bin/python
PG_URL  := postgresql://scorebase:scorebase@localhost:5433/scorebase
PROJECT ?= retail

setup:
	python3.13 -m venv .venv && .venv/bin/pip install -q -e "engine[dev]"
	cd app && pnpm install
	docker compose up -d --wait

data:            ## generate demo data, score it, publish to Postgres
	$(PY) -m scorebase generate $(PROJECT)
	SCOREBASE_PG_URL=$(PG_URL) $(PY) -m scorebase run $(PROJECT)

score:           ## re-score and publish (only changed rows are written)
	SCOREBASE_PG_URL=$(PG_URL) $(PY) -m scorebase run $(PROJECT)

api:             ## read-only query API for the Ask box (port 8787)
	$(PY) -m scorebase.api $(PROJECT) --port 8787

zero:            ## Zero sync server (port 4848)
	cd app && ZERO_UPSTREAM_DB=$(PG_URL) ZERO_REPLICA_FILE=$$PWD/.zero/replica.db \
	  ZERO_QUERY_URL=http://localhost:3000/api/zero/query ZERO_ENABLE_CRUD_MUTATIONS=false \
	  pnpm exec zero-cache-dev

app:             ## web app (port 3000)
	cd app && pnpm dev

test:
	$(PY) -m pytest -q tests && $(PY) -m scorebase eval $(PROJECT)
	cd app && npx tsc --noEmit

.PHONY: setup data score api zero app test
