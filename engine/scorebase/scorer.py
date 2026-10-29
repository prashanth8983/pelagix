"""Build one SQL statement that turns raw tables into a per-entity score table.

Scores come from scores.yaml. A score whose SQL mentions another score's name is
computed after it, so formulas can build on each other in any order. Scores with no
dependencies are aggregates over `from`, grouped by `key_expr`; each later layer is a
SELECT over the previous one.
"""
import re


def _deps(score: dict, names: set[str]) -> set[str]:
    return {
        n for n in names
        if n != score["name"] and re.search(rf"\b{re.escape(n)}\b", score["sql"])
    }


def layers(scores: list[dict]) -> list[list[dict]]:
    """Group scores into dependency layers (topological order). Raises on cycles."""
    names = {s["name"] for s in scores}
    deps = {s["name"]: _deps(s, names) for s in scores}
    done: set[str] = set()
    out = []
    remaining = list(scores)
    while remaining:
        ready = [s for s in remaining if deps[s["name"]] <= done]
        if not ready:
            raise ValueError(f"score cycle among: {[s['name'] for s in remaining]}")
        out.append(ready)
        done |= {s["name"] for s in ready}
        remaining = [s for s in remaining if s["name"] not in done]
    return out


def build_sql(project) -> str:
    cfg = project.scores
    key = project.key
    table = project.score_table
    ls = layers(cfg["scores"])

    base = ls[0]
    if any(s.get("window") for s in base):
        raise ValueError("window scores must depend on another score")
    where = f"\n  WHERE {cfg['where']}" if cfg.get("where") else ""
    cols = ",\n    ".join(f"{s['sql']} AS {s['name']}" for s in base)
    ctes = [
        f"l0 AS (\n  SELECT {cfg['key_expr']} AS {key},\n    {cols}\n"
        f"  FROM {cfg['from'].strip()}{where}\n  GROUP BY {cfg['key_expr']}\n)"
    ]
    for i, layer in enumerate(ls[1:], start=1):
        cols = ",\n    ".join(f"{s['sql']} AS {s['name']}" for s in layer)
        ctes.append(f"l{i} AS (\n  SELECT *,\n    {cols}\n  FROM l{i - 1}\n)")

    last = len(ls) - 1
    order = [key] + [s["name"] for layer in ls for s in layer]
    return (
        f"CREATE OR REPLACE TABLE {table} AS\nWITH "
        + ",\n".join(ctes)
        + f"\nSELECT {', '.join(order)}, CURRENT_TIMESTAMP AS scored_at\nFROM l{last}"
    )


def run(project, wh) -> int:
    wh.execute(build_sql(project))
    _, rows = wh.query(f"SELECT COUNT(*) FROM {project.score_table}")
    return rows[0][0]
