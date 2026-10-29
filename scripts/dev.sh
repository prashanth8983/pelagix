#!/usr/bin/env bash
# Run the engine API, zero-cache and the web app in one terminal. Ctrl-C stops all three.
# Each line of output is prefixed with the process that wrote it.
set -euo pipefail
set -m

cd "$(dirname "$0")/.."
PY=${PY:-.venv/bin/python}
PG_URL=${SCOREBASE_PG_URL:-postgresql://scorebase:scorebase@localhost:5433/scorebase}
PROJECT=${PROJECT:-retail}

prefix() { sed -u "s/^/[$1] /"; }

export SCOREBASE_PG_URL="$PG_URL"
"$PY" -m scorebase.api "$PROJECT" --port 8787 2>&1 | prefix api &
(
  cd app && ZERO_UPSTREAM_DB="$PG_URL" ZERO_REPLICA_FILE="$PWD/.zero/replica.db" \
    ZERO_QUERY_URL=http://localhost:3000/api/zero/query ZERO_QUERY_FORWARD_COOKIES=true \
    ZERO_ENABLE_CRUD_MUTATIONS=false pnpm exec zero-cache-dev 2>&1 | prefix zero
) &
(cd app && pnpm dev 2>&1 | prefix app) &

trap 'echo; echo "stopping"; kill -- -$$ 2>/dev/null' INT TERM EXIT
wait
