"""Validate SQL before it runs: one read-only SELECT, known tables only, row cap."""
import sqlglot
from sqlglot import exp

MAX_ROWS = 500
_WRITE = (exp.Insert, exp.Update, exp.Delete, exp.Create, exp.Drop, exp.Alter,
          exp.Merge, exp.Command, exp.TruncateTable)


class UnsafeSQL(ValueError):
    pass


def check(sql: str, allowed_tables: set[str], dialect: str = "duckdb") -> str:
    """Return the query with a LIMIT added if missing. Raise UnsafeSQL otherwise."""
    try:
        stmts = [s for s in sqlglot.parse(sql, read=dialect) if s is not None]
    except sqlglot.errors.ParseError as e:
        raise UnsafeSQL(f"could not parse SQL: {e}") from e
    if len(stmts) != 1:
        raise UnsafeSQL("exactly one statement allowed")
    tree = stmts[0]
    if not isinstance(tree, (exp.Select, exp.Union, exp.With)) and not tree.find(exp.Select):
        raise UnsafeSQL("only SELECT queries are allowed")
    if any(tree.find(t) for t in _WRITE):
        raise UnsafeSQL("write statements are not allowed")

    ctes = {c.alias_or_name.lower() for c in tree.find_all(exp.CTE)}
    used = {t.name.lower() for t in tree.find_all(exp.Table)} - ctes
    unknown = used - {t.lower() for t in allowed_tables}
    if unknown:
        raise UnsafeSQL(f"unknown tables: {sorted(unknown)}")

    if isinstance(tree, exp.Select) and not tree.args.get("limit"):
        tree = tree.limit(MAX_ROWS)
    return tree.sql(dialect=dialect)


def check_filter(where: str) -> None:
    """A segment filter must be a plain boolean expression, not a statement."""
    try:
        node = sqlglot.parse_one(f"SELECT 1 WHERE {where}")
    except sqlglot.errors.ParseError as e:
        raise UnsafeSQL(f"bad filter: {where}") from e
    if node.find(exp.Subquery) or ";" in where:
        raise UnsafeSQL(f"filter may not contain subqueries: {where}")
