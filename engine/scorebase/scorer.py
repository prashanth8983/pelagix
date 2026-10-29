"""Build one SQL statement that turns raw tables into a per-entity score table.

Scores come from scores.yaml. A score whose SQL mentions another score's name is
computed after it, so formulas can build on each other in any order. Scores with no
dependencies are aggregates over `from`, grouped by `key_expr`; each later layer is a
SELECT over the previous one.

When project.yaml names an `entity_table`, every entity in it gets a row, including
those with no rows in `from`: their scores are the score's `default`, or NULL.
"""
import re

_STRINGS = re.compile(r"'(?:[^']|'')*'")


def _deps(score: dict, names: set[str]) -> set[str]:
    # Ignore string literals and qualified columns: 'status' and oi.status aren't scores.
    sql = _STRINGS.sub("''", score["sql"])
    return {
        n for n in names
        if n != score["name"] and re.search(rf"(?<![.\w]){re.escape(n)}\b", sql)
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


def plan(project) -> list[dict]:
    """Each score with its layer and dependencies, for the app's dependency view."""
    scores = project.scores["scores"]
    names = {s["name"] for s in scores}
    return [
        {"name": s["name"], "layer": i, "depends_on": sorted(_deps(s, names))}
        for i, layer in enumerate(layers(scores)) for s in layer
    ]


def build_select(project) -> str:
    cfg = project.scores
    key = project.key
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

    last = f"l{len(ls) - 1}"
    ordered = [s for layer in ls for s in layer]
    et, ek = project.project.get("entity_table"), project.project.get("entity_key")
    if not et:
        cols = ", ".join([key] + [s["name"] for s in ordered])
        return f"WITH " + ",\n".join(ctes) + f"\nSELECT {cols}, CURRENT_TIMESTAMP AS scored_at\nFROM {last}"

    def col(s):
        if s.get("default") is None:
            return f"s.{s['name']}"
        return f"COALESCE(s.{s['name']}, {s['default']}) AS {s['name']}"

    cols = ",\n  ".join([f"e.{ek} AS {key}"] + [col(s) for s in ordered])
    return (
        "WITH " + ",\n".join(ctes)
        + f"\nSELECT\n  {cols},\n  CURRENT_TIMESTAMP AS scored_at\n"
        + f"FROM {et} e\nLEFT JOIN {last} s ON s.{key} = e.{ek}"
    )


def build_sql(project) -> str:
    return f"CREATE OR REPLACE TABLE {project.score_table} AS\n" + build_select(project)


def run(project, wh) -> int:
    wh.execute(build_sql(project))
    _, rows = wh.query(f"SELECT COUNT(*) FROM {project.score_table}")
    return rows[0][0]
