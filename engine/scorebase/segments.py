"""Saved segments: structured rules -> SQL filter -> live size.

A rule is {column, op, value}. A segment holds entities for which all rules hold
(`match: all`) or at least one does (`match: any`). Rules, not raw SQL, are the stored
form so the same segment runs in the warehouse here and as a Zero query in the browser.
"""
import re

from .schema import OPS

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def literal(v) -> str:
    if isinstance(v, bool) or v is None:
        raise ValueError(f"segment rule values must be numbers or text: {v!r}")
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return "'" + v.replace("'", "''") + "'"
    raise ValueError(f"segment rule values must be numbers or text: {v!r}")


def rule_sql(r: dict, columns: set[str]) -> str:
    col, op, val = r["column"], r["op"], r.get("value")
    if not _IDENT.match(col) or col not in columns:
        raise ValueError(f"unknown column in segment rule: {col}")
    if op not in OPS:
        raise ValueError(f"bad operator in segment rule: {op}")
    if op == "is_null":
        return f"{col} IS NULL"
    if op == "is_not_null":
        return f"{col} IS NOT NULL"
    if op in ("in", "not_in"):
        if not isinstance(val, list) or not val:
            raise ValueError(f"'{op}' needs a list of values")
        return f"{col} {'IN' if op == 'in' else 'NOT IN'} ({', '.join(literal(v) for v in val)})"
    if isinstance(val, list):
        raise ValueError(f"'{op}' needs one value")
    return f"{col} {op} {literal(val)}"


def to_sql(rules: list[dict], columns: set[str], match: str = "all") -> str:
    if match not in ("all", "any"):
        raise ValueError(f"match must be 'all' or 'any': {match!r}")
    parts = [rule_sql(r, columns) for r in rules]
    if not parts:
        return "TRUE"
    if len(parts) == 1:
        return parts[0]
    return f" {'AND' if match == 'all' else 'OR'} ".join(f"({p})" for p in parts)


def run(project, wh) -> list[dict]:
    cols = {c for c, _ in wh.describe(project.score_table)}
    out = []
    for seg in project.segments:
        where = to_sql(seg.get("rules", []), cols, seg.get("match", "all"))
        _, rows = wh.query(f"SELECT COUNT(*) FROM {project.score_table} WHERE {where}")
        out.append({**seg, "match": seg.get("match", "all"), "where": where, "size": rows[0][0]})
    return out
