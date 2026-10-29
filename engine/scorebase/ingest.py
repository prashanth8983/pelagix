"""Load each source in sources.yaml into a raw warehouse table of the same name, then
run its checks. A failed check stops the run before anything is scored or published."""
from .warehouse import is_remote


class CheckFailed(SystemExit):
    pass


def location(project, src: dict) -> str:
    if src.get("connector") == "postgres":
        return ""
    raw = src["path"]
    if is_remote(raw):
        return raw
    path = project.path(raw)
    if not path.exists():
        raise SystemExit(f"source '{src['name']}' missing file {path} (run `generate` first?)")
    return str(path)


def run(project, wh) -> dict[str, int]:
    counts = {}
    for src in project.sources:
        counts[src["name"]] = wh.load_source(src, location(project, src))["rows"]
    return counts


def check(project, wh) -> dict[str, str]:
    """Run every source's checks; raise CheckFailed listing all failures."""
    failures, out = [], {}
    for src in project.sources:
        c = src.get("checks") or {}
        if not c:
            continue
        name, t = src["name"], wh.quote(src["name"])
        have = {col for col, _ in wh.describe(name)}
        missing = [col for col in c.get("columns", []) if col not in have]
        failures += [f"{name}: missing column {col}" for col in missing]
        _, ((n,),) = wh.query(f"SELECT COUNT(*) FROM {t}")
        if c.get("min_rows") is not None and n < c["min_rows"]:
            failures.append(f"{name}: {n} rows, expected at least {c['min_rows']}")
        for col in c.get("not_null", []):
            if col in missing:
                continue
            _, ((nulls,),) = wh.query(f"SELECT COUNT(*) FROM {t} WHERE {wh.quote(col)} IS NULL")
            if nulls:
                failures.append(f"{name}.{col}: {nulls} nulls")
        for col in c.get("unique", []):
            if col in missing:
                continue
            _, ((dupes,),) = wh.query(f"SELECT COUNT(*) - COUNT(DISTINCT {wh.quote(col)}) FROM {t}")
            if dupes:
                failures.append(f"{name}.{col}: {dupes} duplicate values")
        out[name] = "ok"
    if failures:
        raise CheckFailed("data checks failed:\n  " + "\n  ".join(failures))
    return out
