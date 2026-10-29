# Scorebase

Raw customer data in, precomputed scores out, served to an app that answers plain-English questions.
Everything domain-specific lives in YAML under `configs/<name>/`. The engine never mentions customers or orders.

```
 configs/retail/*.yaml            ← sources, scores, segments, semantic model, golden queries
 ═══════════════ engine (generic) ═══════════════
 load      sources.yaml   → raw tables in the warehouse (DuckDB locally, Snowflake in prod)
 score     scores.yaml    → one entity_scores table, scores ordered by dependency
 segments  segments.yaml  → live segment sizes
 publish   warehouse      → Postgres, writing only rows that changed (the diff Zero syncs)
 eval      golden.yaml    → every verified question→SQL pair runs through the SQL guard
```

## Run it

```bash
python3.13 -m venv .venv && .venv/bin/pip install -e "engine[dev]"
docker compose up -d --wait                      # Postgres with wal_level=logical (for Zero)
export SCOREBASE_PG_URL=postgresql://scorebase:scorebase@localhost:5433/scorebase

.venv/bin/python -m scorebase generate retail    # synthetic TheLook-shaped data, 20K users
.venv/bin/python -m scorebase run retail         # load → score → segments → publish
.venv/bin/python -m scorebase eval retail        # 5/5 golden queries
.venv/bin/python -m scorebase sql retail "SELECT ltv_decile, COUNT(*) FROM entity_scores GROUP BY 1"
.venv/bin/python -m pytest -q tests
```

## Notes

- **Data:** `generate` writes files with TheLook's table and column names. To use the real
  BigQuery `thelook_ecommerce` export, point the paths in `configs/retail/sources.yaml` at it.
- **Snowflake:** set `warehouse.kind: snowflake` and `SNOWFLAKE_ACCOUNT/USER/PASSWORD/WAREHOUSE/DATABASE`.
  The Snowflake path is written but not yet run against a live account.
- **Generic:** `tests/test_engine.py::test_engine_is_generic` scores countries from labor statistics
  with the same engine and only a different config.

## Status

| Part | State |
|---|---|
| Engine: load, score, segments, publish, eval, SQL guard | Done, tested |
| App: Zero sync, Steep-style UI, Ask box (Mastra + Claude) | Next |
