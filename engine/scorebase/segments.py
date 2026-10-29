"""Saved segments: structured rules -> SQL filter -> live size.

A rule is {column, op, value}; all rules in a segment must hold. Rules (not raw SQL)
are the stored form so the same segment can run in the warehouse here and as a Zero
query in the browser.
"""
import re

OPS = {">", ">=", "<", "<=", "=", "!="}
_IDENT = re.compile(r"^[a-z_][a-z0-9_]*$")


def to_sql(rules: list[dict], columns: set[str]) -> str:
    parts = []
    for r in rules:
        col, op, val = r["column"], r["op"], r["value"]
        if not _IDENT.match(col) or col not in columns:
            raise ValueError(f"unknown column in segment rule: {col}")
        if op not in OPS:
            raise ValueError(f"bad operator in segment rule: {op}")
        if not isinstance(val, (int, float)) or isinstance(val, bool):
            raise ValueError(f"segment rule values must be numbers: {val!r}")
        parts.append(f"{col} {op} {val}")
    return " AND ".join(parts) or "TRUE"


def run(project, wh) -> list[dict]:
    cols, _ = wh.query(f"SELECT * FROM {project.score_table} LIMIT 0")
    out = []
    for seg in project.segments:
        where = to_sql(seg.get("rules", []), set(cols))
        _, rows = wh.query(f"SELECT COUNT(*) FROM {project.score_table} WHERE {where}")
        out.append({**seg, "where": where, "size": rows[0][0]})
    return out
