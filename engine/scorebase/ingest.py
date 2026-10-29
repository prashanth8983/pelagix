"""Load each source in sources.yaml into a raw warehouse table of the same name, then
run its checks. A failed check stops the run before anything is scored or published.

Where a source may read from is a policy, not the editor's choice: local paths must
live under the data directory (SCOREBASE_HOME/data, plus any SCOREBASE_SOURCE_DIRS),
and remote URLs must start with a prefix listed in SCOREBASE_REMOTE_SOURCES. Config is
editable from the app, so without this an editor could point a source at any file on
the engine host or make it fetch any URL.
"""
import os
from pathlib import Path

from . import config
from .warehouse import is_remote

GLOB_CHARS = "*?["


class CheckFailed(SystemExit):
    pass


class SourceNotAllowed(ValueError):
    pass


def allowed_dirs() -> list[Path]:
    extra = [Path(p).expanduser().resolve() for p in os.environ.get("SCOREBASE_SOURCE_DIRS", "").split(os.pathsep) if p.strip()]
    return [(config.ROOT / "data").resolve(), *extra]


def allowed_remote_prefixes() -> list[str]:
    return [p.strip() for p in os.environ.get("SCOREBASE_REMOTE_SOURCES", "").split(",") if p.strip()]


def _fixed_prefix(path: Path) -> Path:
    """The part of a glob before its first wildcard component."""
    parts = []
    for part in path.parts:
        if any(c in part for c in GLOB_CHARS):
            break
        parts.append(part)
    return Path(*parts) if parts else Path(".")


def location(project, src: dict) -> str:
    """Where a source reads from, after the policy above. Raises SourceNotAllowed."""
    if src.get("connector") == "postgres":
        return ""
    raw = src["path"]
    if is_remote(raw) and "://" in raw:
        prefixes = allowed_remote_prefixes()
        if not any(raw.startswith(p) for p in prefixes):
            raise SourceNotAllowed(
                f"source '{src['name']}': remote URLs must start with one of SCOREBASE_REMOTE_SOURCES "
                f"({', '.join(prefixes) or 'none set'})")
        return raw
    path = project.path(raw)
    fixed = _fixed_prefix(path).resolve()
    if not any(fixed == d or d in fixed.parents for d in allowed_dirs()):
        roots = ", ".join(str(d) for d in allowed_dirs())
        raise SourceNotAllowed(f"source '{src['name']}': local paths must be under {roots}")
    if not is_remote(raw) and not path.exists():
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
