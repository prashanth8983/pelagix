"""Warehouse connections behind one small interface.

DuckDB runs locally with no account. Snowflake is the production target; switch with
`warehouse.kind: snowflake` in project.yaml and SNOWFLAKE_* environment variables.
"""
import os
from pathlib import Path


class Warehouse:
    dialect = "duckdb"

    def execute(self, sql: str) -> None:
        raise NotImplementedError

    def query(self, sql: str) -> tuple[list[str], list[tuple]]:
        """Return (column names, rows)."""
        raise NotImplementedError

    def load_file(self, table: str, path: Path, connector: str) -> int:
        raise NotImplementedError

    def close(self) -> None:
        pass


class DuckDBWarehouse(Warehouse):
    dialect = "duckdb"

    def __init__(self, path: Path):
        import duckdb

        path.parent.mkdir(parents=True, exist_ok=True)
        self.con = duckdb.connect(str(path))

    def execute(self, sql: str) -> None:
        self.con.execute(sql)

    def query(self, sql: str):
        cur = self.con.execute(sql)
        cols = [d[0] for d in cur.description]
        return cols, cur.fetchall()

    def load_file(self, table: str, path: Path, connector: str) -> int:
        readers = {"csv": "read_csv_auto", "parquet": "read_parquet"}
        if connector not in readers:
            raise ValueError(f"duckdb warehouse can't load connector '{connector}'")
        self.con.execute(
            f"CREATE OR REPLACE TABLE {table} AS SELECT * FROM {readers[connector]}(?)",
            [str(path)],
        )
        return self.con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    def close(self) -> None:
        self.con.close()


class SnowflakeWarehouse(Warehouse):
    """Untested against a live account yet: needs a Snowflake trial and credentials."""

    dialect = "snowflake"

    def __init__(self, cfg: dict):
        import snowflake.connector  # pip install snowflake-connector-python

        self.con = snowflake.connector.connect(
            account=os.environ["SNOWFLAKE_ACCOUNT"],
            user=os.environ["SNOWFLAKE_USER"],
            password=os.environ["SNOWFLAKE_PASSWORD"],
            warehouse=cfg.get("compute", os.environ.get("SNOWFLAKE_WAREHOUSE")),
            database=cfg.get("database", os.environ.get("SNOWFLAKE_DATABASE")),
            schema=cfg.get("schema", os.environ.get("SNOWFLAKE_SCHEMA", "PUBLIC")),
        )

    def execute(self, sql: str) -> None:
        self.con.cursor().execute(sql)

    def query(self, sql: str):
        cur = self.con.cursor()
        cur.execute(sql)
        return [d[0].lower() for d in cur.description], cur.fetchall()

    def load_file(self, table: str, path: Path, connector: str) -> int:
        fmt = {"csv": "TYPE = CSV PARSE_HEADER = TRUE", "parquet": "TYPE = PARQUET"}[connector]
        cur = self.con.cursor()
        cur.execute(f"CREATE OR REPLACE TEMPORARY STAGE sb_{table}")
        cur.execute(f"PUT file://{path} @sb_{table} AUTO_COMPRESS=TRUE")
        cur.execute(f"CREATE OR REPLACE FILE FORMAT sb_fmt_{table} {fmt}")
        cur.execute(
            f"CREATE OR REPLACE TABLE {table} USING TEMPLATE (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) "
            f"FROM TABLE(INFER_SCHEMA(LOCATION=>'@sb_{table}', FILE_FORMAT=>'sb_fmt_{table}')))"
        )
        cur.execute(
            f"COPY INTO {table} FROM @sb_{table} FILE_FORMAT=(FORMAT_NAME='sb_fmt_{table}') "
            "MATCH_BY_COLUMN_NAME=CASE_INSENSITIVE"
        )
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        return cur.fetchone()[0]

    def close(self) -> None:
        self.con.close()


def connect(project) -> Warehouse:
    cfg = project.project.get("warehouse", {})
    kind = cfg.get("kind", "duckdb")
    if kind == "duckdb":
        return DuckDBWarehouse(project.path(cfg.get("path", f"data/{project.name}.duckdb")))
    if kind == "snowflake":
        return SnowflakeWarehouse(cfg)
    raise SystemExit(f"unknown warehouse kind: {kind}")
