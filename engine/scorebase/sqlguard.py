"""Validate SQL before it runs: one read-only SELECT, known tables only, row cap.

This is the first line. The second is the connection itself: the query API opens the
warehouse read-only with file and network access turned off (see warehouse.connect).
"""
import sqlglot
from sqlglot import exp

MAX_ROWS = 500
_WRITE = (exp.Insert, exp.Update, exp.Delete, exp.Create, exp.Drop, exp.Alter,
          exp.Merge, exp.Command, exp.TruncateTable, exp.Copy, exp.Into)
# Functions that reach outside the tables: files, settings, environment, other databases.
_DENY_FUNCS = {
    "read_text", "read_blob", "read_csv", "read_csv_auto", "read_parquet", "parquet_scan",
    "read_json", "read_json_auto", "read_ndjson", "glob", "getenv", "current_setting",
    "duckdb_settings", "duckdb_secrets", "duckdb_extensions", "sniff_csv", "query", "query_table",
    "postgres_query", "postgres_scan", "sqlite_scan", "iceberg_scan", "delta_scan",
    "system$get_privatelink_config", "get_presigned_url", "build_scoped_file_url",
}
_DEFAULT_SCHEMAS = {"", "main", "public"}


class UnsafeSQL(ValueError):
    pass


def _func_name(f: exp.Func) -> str:
    return (f.name if isinstance(f, exp.Anonymous) else f.sql_name()).lower()


def check(sql: str, allowed_tables: set[str], dialect: str = "duckdb", max_rows: int = MAX_ROWS) -> str:
    """Return the query with a LIMIT added if missing. Raise UnsafeSQL otherwise."""
    try:
        stmts = [s for s in sqlglot.parse(sql, read=dialect) if s is not None]
    except sqlglot.errors.ParseError as e:
        raise UnsafeSQL(f"could not parse SQL: {e}") from e
    if len(stmts) != 1:
        raise UnsafeSQL("exactly one statement allowed")
    tree = stmts[0]
    # The statement itself must be a query; a SELECT nested in COPY or INSERT is not enough.
    if not isinstance(tree, (exp.Select, exp.SetOperation)):
        raise UnsafeSQL("only SELECT queries are allowed")
    if any(tree.find(t) for t in _WRITE):
        raise UnsafeSQL("write statements are not allowed")

    denied = sorted({_func_name(f) for f in tree.find_all(exp.Func)} & _DENY_FUNCS)
    if denied:
        raise UnsafeSQL(f"functions not allowed: {denied}")

    ctes = {c.alias_or_name.lower() for c in tree.find_all(exp.CTE)}
    allowed = {t.lower() for t in allowed_tables}
    for t in tree.find_all(exp.Table):
        name = t.name.lower()
        if not name:
            raise UnsafeSQL("table functions are not allowed")
        if t.catalog or t.db.lower() not in _DEFAULT_SCHEMAS:
            raise UnsafeSQL(f"other databases and schemas are not allowed: {t.sql(dialect)}")
        if name not in allowed and name not in ctes:
            raise UnsafeSQL(f"unknown tables: ['{name}']")

    limit = tree.args.get("limit")
    n = limit.expression if limit else None
    if not (isinstance(n, exp.Literal) and n.is_int and int(n.this) <= max_rows):
        tree = tree.limit(max_rows)  # missing, too large, or not a plain number
    return tree.sql(dialect=dialect, pretty=True)


def format_sql(sql: str, dialect: str = "duckdb") -> str:
    """Pretty-print SQL without checking it. Unparseable input comes back unchanged."""
    try:
        return ";\n\n".join(s.sql(dialect=dialect, pretty=True) for s in sqlglot.parse(sql, read=dialect) if s)
    except sqlglot.errors.ParseError:
        return sql


def check_filter(where: str) -> None:
    """A segment filter must be a plain boolean expression, not a statement."""
    try:
        node = sqlglot.parse_one(f"SELECT 1 WHERE {where}")
    except sqlglot.errors.ParseError as e:
        raise UnsafeSQL(f"bad filter: {where}") from e
    if node.find(exp.Subquery) or ";" in where:
        raise UnsafeSQL(f"filter may not contain subqueries: {where}")
