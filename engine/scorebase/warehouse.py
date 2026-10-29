"""Warehouse connections behind one small interface.

DuckDB runs locally with no account. Snowflake is the production target; switch with
`warehouse.kind: snowflake` in project.yaml and SNOWFLAKE_* environment variables.
"""
import json
import os
import re
import threading
from pathlib import Path

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_REMOTE = re.compile(r"^[a-z][a-z0-9+.-]*://", re.I)


def is_remote(path: str) -> bool:
    """s3://, gs://, https:// and globs are handed to the reader as-is."""
    return bool(_REMOTE.match(path)) or any(c in path for c in "*?[")


def lit(v) -> str:
    """A Python value as a SQL literal, for reader options."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, dict):
        return "{" + ", ".join(f"{lit(str(k))}: {lit(x)}" for k, x in v.items()) + "}"
    if isinstance(v, list):
        return "[" + ", ".join(lit(x) for x in v) + "]"
    return "'" + str(v).replace("'", "''") + "'"


def ident(name: str) -> str:
    """A validated, quoted identifier (column names like `at` or `order` are keywords)."""
    if not _IDENT.match(name):
        raise ValueError(f"bad identifier: {name!r}")
    return f'"{name}"'


def bare(name: str) -> str:
    """A validated, unquoted identifier: Snowflake upper-cases these, quoted ones are case-sensitive."""
    if not _IDENT.match(name):
        raise ValueError(f"bad identifier: {name!r}")
    return name


class Timeout(RuntimeError):
    pass


class Warehouse:
    dialect = "duckdb"

    def quote(self, name: str) -> str:
        return ident(name)

    def execute(self, sql: str) -> None:
        raise NotImplementedError

    def query(self, sql: str, max_rows: int | None = None, timeout: float | None = None):
        """Return (column names, rows)."""
        raise NotImplementedError

    def stream(self, sql: str, batch: int = 10_000):
        """Return (column names, iterator of rows) without holding the table in memory."""
        raise NotImplementedError

    def describe(self, table: str) -> list[tuple[str, str]]:
        """[(column, warehouse type)] for a table."""
        raise NotImplementedError

    def tables(self) -> list[str]:
        raise NotImplementedError

    def load_source(self, src: dict, location: str) -> dict:
        """Land one source as a raw table. Returns {rows, added}."""
        raise NotImplementedError

    def close(self) -> None:
        pass


class DuckDBWarehouse(Warehouse):
    dialect = "duckdb"
    READERS = {"csv": "read_csv_auto", "parquet": "read_parquet", "json": "read_json_auto"}

    def __init__(self, path: Path, read_only: bool = False):
        import duckdb

        if read_only:
            # Queries from the API and the agent can't touch files, the network or settings.
            cfg = {"enable_external_access": False, "lock_configuration": True}
            self.con = duckdb.connect(str(path), read_only=True, config=cfg)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            self.con = duckdb.connect(str(path))

    def execute(self, sql: str) -> None:
        self.con.execute(sql)

    def query(self, sql: str, max_rows: int | None = None, timeout: float | None = None):
        timer = None
        if timeout:
            timer = threading.Timer(timeout, self.con.interrupt)
            timer.start()
        try:
            cur = self.con.execute(sql)
            cols = [d[0] for d in cur.description]
            rows = cur.fetchmany(max_rows) if max_rows else cur.fetchall()
        except Exception as e:
            if timer and not timer.is_alive():
                raise Timeout(f"query took longer than {timeout:g}s") from e
            raise
        finally:
            if timer:
                timer.cancel()
        return cols, rows

    def stream(self, sql: str, batch: int = 10_000):
        cur = self.con.cursor().execute(sql)
        cols = [d[0] for d in cur.description]

        def rows():
            while chunk := cur.fetchmany(batch):
                yield from chunk
        return cols, rows()

    def describe(self, table: str):
        return [(r[0], r[1]) for r in self.con.execute(f"DESCRIBE {ident(table)}").fetchall()]

    def tables(self):
        return [r[0] for r in self.con.execute("SELECT table_name FROM duckdb_tables() ORDER BY 1").fetchall()]

    def reader(self, src: dict, location: str) -> str:
        """The FROM-clause expression that reads a source."""
        if src.get("connector") == "postgres":
            dsn = os.environ.get(src["dsn_env"])
            if not dsn:
                raise SystemExit(f"source '{src['name']}': set {src['dsn_env']} to a Postgres URL")
            self.con.execute("INSTALL postgres; LOAD postgres;")
            self.con.execute("DETACH DATABASE IF EXISTS sb_pg")
            self.con.execute(f"ATTACH {lit(dsn)} AS sb_pg (TYPE postgres, READ_ONLY)")
            if src.get("query"):
                return f"postgres_query('sb_pg', {lit(src['query'])})"
            parts = [ident(p) for p in src["table"].split(".")]
            return "sb_pg." + ".".join(parts if len(parts) > 1 else ["public", *parts])
        fn = self.READERS.get(src.get("connector", "csv"))
        if not fn:
            raise ValueError(f"duckdb warehouse can't load connector '{src.get('connector')}'")
        opts = "".join(f", {ident(k)} = {lit(v)}" for k, v in (src.get("options") or {}).items())
        return f"{fn}({lit(location)}{opts})"

    def load_source(self, src: dict, location: str) -> dict:
        t = ident(src["name"])
        reader = self.reader(src, location)
        try:
            exists = src["name"] in self.tables()
            if src.get("mode") == "incremental" and exists:
                c = ident(src["cursor"])
                before = self.con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                self.con.execute(
                    f"INSERT INTO {t} BY NAME SELECT * FROM {reader} "
                    f"WHERE {c} > (SELECT MAX({c}) FROM {t}) OR (SELECT MAX({c}) FROM {t}) IS NULL"
                )
                rows = self.con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                return {"rows": rows, "added": rows - before}
            self.con.execute(f"CREATE OR REPLACE TABLE {t} AS SELECT * FROM {reader}")
            rows = self.con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            return {"rows": rows, "added": rows}
        finally:
            if src.get("connector") == "postgres":
                self.con.execute("DETACH DATABASE IF EXISTS sb_pg")

    def preview(self, src: dict, location: str, limit: int = 20) -> dict:
        """Read a source without landing it: inferred columns and the first rows."""
        reader = self.reader(src, location)
        try:
            schema = self.con.execute(f"DESCRIBE SELECT * FROM {reader}").fetchall()
            cur = self.con.execute(f"SELECT * FROM {reader} LIMIT {int(limit)}")
            return {"columns": [{"name": r[0], "type": r[1]} for r in schema],
                    "rows": [list(r) for r in cur.fetchall()]}
        finally:
            if src.get("connector") == "postgres":
                self.con.execute("DETACH DATABASE IF EXISTS sb_pg")

    def close(self) -> None:
        self.con.close()


class SnowflakeWarehouse(Warehouse):
    """Untested against a live account yet: needs a Snowflake trial and credentials."""

    dialect = "snowflake"

    def quote(self, name: str) -> str:
        return bare(name)

    def __init__(self, cfg: dict):
        import snowflake.connector  # pip install snowflake-connector-python

        self.con = snowflake.connector.connect(
            account=os.environ["SNOWFLAKE_ACCOUNT"],
            user=os.environ["SNOWFLAKE_USER"],
            password=os.environ["SNOWFLAKE_PASSWORD"],
            role=os.environ.get("SNOWFLAKE_ROLE"),
            warehouse=cfg.get("compute", os.environ.get("SNOWFLAKE_WAREHOUSE")),
            database=cfg.get("database", os.environ.get("SNOWFLAKE_DATABASE")),
            schema=cfg.get("schema", os.environ.get("SNOWFLAKE_SCHEMA", "PUBLIC")),
        )

    def execute(self, sql: str) -> None:
        self.con.cursor().execute(sql)

    def query(self, sql: str, max_rows: int | None = None, timeout: float | None = None):
        cur = self.con.cursor()
        cur.execute(sql, timeout=int(timeout) if timeout else None)
        rows = cur.fetchmany(max_rows) if max_rows else cur.fetchall()
        return [d[0].lower() for d in cur.description], rows

    def stream(self, sql: str, batch: int = 10_000):
        cur = self.con.cursor()
        cur.execute(sql)
        cols = [d[0].lower() for d in cur.description]

        def rows():
            while chunk := cur.fetchmany(batch):
                yield from chunk
        return cols, rows()

    def describe(self, table: str):
        cur = self.con.cursor()
        cur.execute(f"DESCRIBE TABLE {bare(table)}")
        return [(r[0].lower(), r[1]) for r in cur.fetchall()]

    def tables(self):
        cur = self.con.cursor()
        cur.execute("SHOW TERSE TABLES")
        return sorted(r[1].lower() for r in cur.fetchall())

    def load_source(self, src: dict, location: str) -> dict:
        connector = src.get("connector", "csv")
        if connector not in ("csv", "parquet", "json") or src.get("mode") == "incremental" or is_remote(location):
            raise NotImplementedError("the Snowflake loader handles local csv/parquet/json files with mode: replace")
        t = bare(src["name"])
        fmt = {"csv": "TYPE = CSV PARSE_HEADER = TRUE", "parquet": "TYPE = PARQUET", "json": "TYPE = JSON"}[connector]
        cur = self.con.cursor()
        cur.execute(f"CREATE OR REPLACE TEMPORARY STAGE sb_{t}")
        cur.execute(f"PUT file://{location} @sb_{t} AUTO_COMPRESS=TRUE")
        cur.execute(f"CREATE OR REPLACE FILE FORMAT sb_fmt_{t} {fmt}")
        cur.execute(
            f"CREATE OR REPLACE TABLE {t} USING TEMPLATE (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) "
            f"FROM TABLE(INFER_SCHEMA(LOCATION=>'@sb_{t}', FILE_FORMAT=>'sb_fmt_{t}')))"
        )
        cur.execute(
            f"COPY INTO {t} FROM @sb_{t} FILE_FORMAT=(FORMAT_NAME='sb_fmt_{t}') "
            "MATCH_BY_COLUMN_NAME=CASE_INSENSITIVE"
        )
        cur.execute(f"SELECT COUNT(*) FROM {t}")
        n = cur.fetchone()[0]
        return {"rows": n, "added": n}

    def close(self) -> None:
        self.con.close()


def connect(project, read_only: bool = False) -> Warehouse:
    cfg = project.project.get("warehouse", {})
    kind = cfg.get("kind", "duckdb")
    if kind == "duckdb":
        return DuckDBWarehouse(project.path(cfg.get("path") or f"data/{project.name}.duckdb"), read_only)
    if kind == "snowflake":
        # Read-only on Snowflake is the role's job: point SNOWFLAKE_ROLE at one with SELECT only.
        return SnowflakeWarehouse(cfg)
    raise SystemExit(f"unknown warehouse kind: {kind}")


def jsonable(v):
    from datetime import date, datetime, time
    from decimal import Decimal

    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (bytes, bytearray)):
        return v.hex()
    if isinstance(v, (list, dict)):
        return json.loads(json.dumps(v, default=str))
    return v
