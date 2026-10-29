"""Copy the score table and segment counts from the warehouse into Postgres.

Postgres is the app database the UI syncs from (via Zero). The score table is kept
stable and only rows whose values changed are written, so the sync layer streams a
small diff instead of the whole table after every scoring run. All of it happens in
one transaction, so readers never see a half-applied run.
"""
import os
from datetime import date, datetime
from decimal import Decimal

PG_TYPES = [(bool, "boolean"), (int, "bigint"), (float, "double precision"),
            (Decimal, "numeric"), (datetime, "timestamptz"), (date, "date"), (str, "text")]


def _pg_type(values) -> str:
    sample = next((v for v in values if v is not None), None)
    for py, pg in PG_TYPES:
        if isinstance(sample, py):
            return pg
    return "text"


def _q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def run(project, wh, segments: list[dict]) -> dict:
    import psycopg
    from psycopg.types.json import Jsonb

    env = project.project.get("publish", {}).get("postgres_url_env", "SCOREBASE_PG_URL")
    url = os.environ.get(env)
    if not url:
        raise SystemExit(f"set {env} to a Postgres URL (see docker-compose.yml)")

    table, key = project.score_table, project.key
    cols, rows = wh.query(f"SELECT * FROM {table}")
    types = [_pg_type(r[i] for r in rows[:500]) for i in range(len(cols))]
    value_cols = [c for c in cols if c not in (key, "scored_at")]
    T, K = _q(table), _q(key)

    with psycopg.connect(url) as con, con.cursor() as cur:
        col_defs = ", ".join(f"{_q(c)} {t}" for c, t in zip(cols, types))
        cur.execute(f"CREATE TABLE IF NOT EXISTS {T} ({col_defs}, PRIMARY KEY ({K}))")
        for c, t in zip(cols, types):  # new scores added to the config become new columns
            cur.execute(f"ALTER TABLE {T} ADD COLUMN IF NOT EXISTS {_q(c)} {t}")

        cur.execute(f"CREATE TEMP TABLE incoming (LIKE {T} INCLUDING DEFAULTS) ON COMMIT DROP")
        with cur.copy(f"COPY incoming ({', '.join(map(_q, cols))}) FROM STDIN") as cp:
            for r in rows:
                cp.write_row(r)

        changed = " OR ".join(f"t.{_q(c)} IS DISTINCT FROM i.{_q(c)}" for c in value_cols)
        sets = ", ".join(f"{_q(c)} = EXCLUDED.{_q(c)}" for c in cols if c != key)
        cur.execute(
            f"""INSERT INTO {T} ({', '.join(map(_q, cols))})
                SELECT i.* FROM incoming i
                LEFT JOIN {T} t ON t.{K} = i.{K}
                WHERE t.{K} IS NULL OR {changed}
                ON CONFLICT ({K}) DO UPDATE SET {sets}"""
        )
        upserted = cur.rowcount
        cur.execute(f"DELETE FROM {T} t WHERE NOT EXISTS (SELECT 1 FROM incoming i WHERE i.{K} = t.{K})")
        deleted = cur.rowcount

        cur.execute("""CREATE TABLE IF NOT EXISTS segments (
            name text PRIMARY KEY, label text, filter text, size bigint, updated_at timestamptz)""")
        cur.execute("ALTER TABLE segments ADD COLUMN IF NOT EXISTS rules jsonb")
        cur.execute("ALTER TABLE segments ADD COLUMN IF NOT EXISTS position int")
        for i, s in enumerate(segments):
            cur.execute(
                """INSERT INTO segments (name, label, filter, rules, position, size, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, now())
                   ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label, filter = EXCLUDED.filter,
                     rules = EXCLUDED.rules, position = EXCLUDED.position,
                     size = EXCLUDED.size, updated_at = now()""",
                (s["name"], s.get("label", s["name"]), s["where"], Jsonb(s.get("rules", [])), i, s["size"]),
            )
        cur.execute("DELETE FROM segments WHERE NOT (name = ANY(%s))", ([s["name"] for s in segments],))
        con.commit()
    return {"rows": len(rows), "written": upserted, "deleted": deleted}
