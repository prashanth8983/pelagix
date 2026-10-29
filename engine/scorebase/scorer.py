"""Build one SQL statement that turns raw tables into a per-entity score table.

Scores come from scores.yaml. A score whose SQL mentions another score's name is
computed after it, so formulas can build on each other in any order. Scores with no
dependencies are aggregates: by default over the file's `from`, grouped by `key_expr`;
a score may bring its own `from`, `where` and `key_expr` to aggregate another table.
Base scores with the same source are grouped into one aggregate query; the groups are
joined on the entity key. Each later layer is a SELECT over the previous one.

When project.yaml names an `entity_table`, every entity in it gets a row, including
those with no rows in any source: their scores are the score's `default`, or NULL.
Its `attributes` are carried into the score table unchanged.
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
    """Each score with its layer, dependencies and source group, for the app's dependency view."""
    scores = project.scores["scores"]
    names = {s["name"] for s in scores}
    group = {s["name"]: i for i, g in enumerate(_groups(project, layers(scores)[0])) for s in g["scores"]}
    return [
        {"name": s["name"], "layer": i, "depends_on": sorted(_deps(s, names)), "group": group.get(s["name"])}
        for i, layer in enumerate(layers(scores)) for s in layer
    ]


def _groups(project, base: list[dict]) -> list[dict]:
    """Base scores grouped by (from, where, key_expr). The file's defaults come first."""
    cfg = project.scores
    default = (cfg["from"].strip(), (cfg.get("where") or "").strip(), cfg["key_expr"].strip())
    out: dict[tuple, dict] = {}
    for s in base:
        src = (s["from"].strip(), (s.get("where") or "").strip(), s["key_expr"].strip()) if s.get("from") else default
        out.setdefault(src, {"from": src[0], "where": src[1], "key_expr": src[2], "scores": []})["scores"].append(s)
    return sorted(out.values(), key=lambda g: (g["from"], g["where"], g["key_expr"]) != default)


def _defaulted(expr: str, s: dict) -> str:
    """A base score's `default` applies as soon as it is aggregated, so later layers see it too."""
    return expr if s.get("default") is None else f"COALESCE({expr}, {s['default']})"


def _aggregate(group: dict, key: str) -> str:
    where = f"\n  WHERE {group['where']}" if group["where"] else ""
    cols = ",\n    ".join(f"{_defaulted(s['sql'], s)} AS {s['name']}" for s in group["scores"])
    return (f"SELECT {group['key_expr']} AS {key},\n    {cols}\n"
            f"  FROM {group['from']}{where}\n  GROUP BY {group['key_expr']}")


def build_select(project) -> str:
    cfg = project.scores
    key = project.key
    ls = layers(cfg["scores"])

    base = ls[0]
    if any(s.get("window") for s in base):
        raise ValueError("window scores must depend on another score")
    groups = _groups(project, base)
    ctes = []
    if len(groups) == 1:
        ctes.append(f"l0 AS (\n  {_aggregate(groups[0], key)}\n)")
    else:
        for i, g in enumerate(groups):
            ctes.append(f"b{i} AS (\n  {_aggregate(g, key)}\n)")
        keys = ", ".join(f"b{i}.{key}" for i in range(len(groups)))
        cols = ", ".join(f"{_defaulted(f'b{i}.{s['name']}', s)} AS {s['name']}" for i, g in enumerate(groups) for s in g["scores"])
        joins = "".join(
            f"\n  FULL OUTER JOIN b{i} ON b{i}.{key} = COALESCE({', '.join(f'b{j}.{key}' for j in range(i))})"
            for i in range(1, len(groups))
        )
        ctes.append(f"l0 AS (\n  SELECT COALESCE({keys}) AS {key}, {cols}\n  FROM b0{joins}\n)")
    for i, layer in enumerate(ls[1:], start=1):
        cols = ",\n    ".join(f"{s['sql']} AS {s['name']}" for s in layer)
        ctes.append(f"l{i} AS (\n  SELECT *,\n    {cols}\n  FROM l{i - 1}\n)")

    last = f"l{len(ls) - 1}"
    ordered = [s for layer in ls for s in layer]
    et, ek = project.project.get("entity_table"), project.project.get("entity_key")
    if not et:
        cols = ", ".join([key] + [s["name"] for s in ordered])
        return "WITH " + ",\n".join(ctes) + f"\nSELECT {cols}, CURRENT_TIMESTAMP AS scored_at\nFROM {last}"

    def col(s):
        if s.get("default") is None:
            return f"s.{s['name']}"
        return f"COALESCE(s.{s['name']}, {s['default']}) AS {s['name']}"

    cols = ",\n  ".join([f"e.{ek} AS {key}"] + [f"e.{a}" for a in project.attributes] + [col(s) for s in ordered])
    return (
        "WITH " + ",\n".join(ctes)
        + f"\nSELECT\n  {cols},\n  CURRENT_TIMESTAMP AS scored_at\n"
        + f"FROM {et} e\nLEFT JOIN {last} s ON s.{key} = e.{ek}"
    )


def build_sql(project) -> str:
    """The DuckDB form of the scoring statement, for display. Warehouses build their own."""
    return f"CREATE OR REPLACE TABLE {project.score_table} AS\n" + build_select(project)


def _keep_history(project, wh) -> int:
    """Append this run's rows to <table>_history, adding columns the history lacks."""
    t, h = project.score_table, f"{project.score_table}_history"
    cols = wh.describe(t)
    if h not in wh.tables():
        wh.execute(f"CREATE TABLE {wh.quote(h)} AS SELECT * FROM {wh.quote(t)} WHERE 1 = 0")
    have = {c for c, _ in wh.describe(h)}
    for c, ty in cols:
        if c not in have:
            wh.execute(f"ALTER TABLE {wh.quote(h)} ADD COLUMN {wh.quote(c)} {ty}")
    names = ", ".join(wh.quote(c) for c, _ in cols)
    wh.execute(f"INSERT INTO {wh.quote(h)} ({names}) SELECT {names} FROM {wh.quote(t)}")
    _, rows = wh.query(f"SELECT COUNT(*) FROM {wh.quote(h)}")
    return rows[0][0]


def run(project, wh) -> dict:
    wh.create_table_as(project.score_table, build_select(project))
    _, rows = wh.query(f"SELECT COUNT(*) FROM {project.score_table}")
    out = {"rows": rows[0][0], "table": project.score_table}
    if project.history:
        out["history_rows"] = _keep_history(project, wh)
    return out
