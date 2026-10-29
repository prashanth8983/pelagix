"""Copy the score table and segment counts from the warehouse into Postgres.

Postgres is the app database the UI syncs from (via Zero). The score table is kept
stable and only rows whose values changed are written, so the sync layer streams a
small diff instead of the whole table after every scoring run. All of it happens in
one transaction, so readers never see a half-applied run.

Column types come from the warehouse schema. A score added to the config becomes a new
column, a score whose type changed is converted, and a removed score's column is dropped.
"""
import os
import re

# Warehouse type (DuckDB or Snowflake name, upper-cased) -> Postgres type. First match wins.
PG_TYPES = [
    (r"^BOOL", "boolean"),
    (r"^(TINYINT|SMALLINT|INTEGER|INT|BIGINT|UTINYINT|USMALLINT|UINTEGER)\b", "bigint"),
    (r"^NUMBER\(\d+,\s*0\)$", "bigint"),
    (r"^(HUGEINT|UBIGINT|UHUGEINT|DECIMAL|NUMERIC|NUMBER)", "numeric"),
    (r"^(DOUBLE|FLOAT|REAL)", "double precision"),
    (r"^DATE$", "date"),
    (r"^TIMESTAMP", "timestamptz"),
    (r"^TIME", "time"),
    (r"^(JSON|STRUCT|MAP|VARIANT|OBJECT|ARRAY)|\[\]$", "jsonb"),
]


def pg_type(warehouse_type: str) -> str:
    t = warehouse_type.upper().strip()
    return next((pg for pat, pg in PG_TYPES if re.search(pat, t)), "text")


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
    schema = wh.describe(table)
    cols = [c for c, _ in schema]
    types = {c: pg_type(t) for c, t in schema}
    value_cols = [c for c in cols if c not in (key, "scored_at")]
    T, K = _q(table), _q(key)

    with psycopg.connect(url) as con, con.cursor() as cur:
        col_defs = ", ".join(f"{_q(c)} {types[c]}" for c in cols)
        cur.execute(f"CREATE TABLE IF NOT EXISTS {T} ({col_defs}, PRIMARY KEY ({K}))")
        cur.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = current_schema() AND table_name = %s", (table,))
        existing = dict(cur.fetchall())
        for c in cols:
            if c not in existing:  # new scores added to the config become new columns
                cur.execute(f"ALTER TABLE {T} ADD COLUMN {_q(c)} {types[c]}")
            elif existing[c] != types[c] and c != key:
                cur.execute(f"ALTER TABLE {T} ALTER COLUMN {_q(c)} TYPE {types[c]} USING {_q(c)}::{types[c]}")
        dropped = [c for c in existing if c not in cols]
        for c in dropped:
            cur.execute(f"ALTER TABLE {T} DROP COLUMN {_q(c)}")

        cur.execute(f"CREATE TEMP TABLE incoming (LIKE {T} INCLUDING DEFAULTS) ON COMMIT DROP")
        _, rows = wh.stream(f"SELECT {', '.join(cols)} FROM {table}")
        n = 0
        with cur.copy(f"COPY incoming ({', '.join(map(_q, cols))}) FROM STDIN") as cp:
            for r in rows:
                cp.write_row(r)
                n += 1

        changed = " OR ".join(f"t.{_q(c)} IS DISTINCT FROM i.{_q(c)}" for c in value_cols) or "FALSE"
        sets = ", ".join(f"{_q(c)} = EXCLUDED.{_q(c)}" for c in cols if c != key)
        cur.execute(
            f"""INSERT INTO {T} ({', '.join(map(_q, cols))})
                SELECT {', '.join('i.' + _q(c) for c in cols)} FROM incoming i
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
        cur.execute("ALTER TABLE segments ADD COLUMN IF NOT EXISTS description text")
        for i, s in enumerate(segments):
            cur.execute(
                """INSERT INTO segments (name, label, description, filter, rules, position, size, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, now())
                   ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description,
                     filter = EXCLUDED.filter, rules = EXCLUDED.rules, position = EXCLUDED.position,
                     size = EXCLUDED.size, updated_at = now()""",
                (s["name"], s.get("label") or s["name"], s.get("description"), s["where"],
                 Jsonb(s.get("rules", [])), i, s["size"]),
            )
        cur.execute("DELETE FROM segments WHERE NOT (name = ANY(%s))", ([s["name"] for s in segments],))
        con.commit()
    out = {"rows": n, "written": upserted, "deleted": deleted}
    if dropped:
        out["dropped_columns"] = dropped
    return out
