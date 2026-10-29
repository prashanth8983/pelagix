"""Load a project's config directory (configs/<name>/*.yaml) into one object, and save it back."""
import time
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from . import schema

ROOT = Path(__file__).resolve().parents[2]

HEADERS = {
    "project": "What each score row describes, where the warehouse is, and how the app lists entities.",
    "sources": "Where raw data comes from. Each source lands as one raw table in the warehouse.",
    "scores": "Per-entity scores. Each `sql` is an expression over `from`, grouped by `key_expr`.\n"
              "A score may use other scores by name; the scorer orders them by dependency.",
    "segments": "Saved segments over the score table, as structured rules (all rules must hold).",
    "model": "Semantic model: what the agent is allowed to know about the data.",
    "golden": "Verified question -> SQL pairs. Answered without a model, shown to the agent as examples,\n"
              "and used by `scorebase eval` to measure the agent.",
}


@dataclass
class Project:
    name: str
    dir: Path
    project: dict
    sources: list
    scores: dict
    segments: list = field(default_factory=list)
    model: dict = field(default_factory=dict)
    golden: list = field(default_factory=list)

    @property
    def key(self) -> str:
        return self.project["key"]

    @property
    def score_table(self) -> str:
        return self.project.get("publish", {}).get("table", "entity_scores")

    @property
    def score_names(self) -> list[str]:
        return [s["name"] for s in self.scores.get("scores", [])]

    def path(self, rel: str) -> Path:
        """Resolve a path from config relative to the repo root."""
        p = Path(rel)
        return p if p.is_absolute() else ROOT / p

    def section(self, name: str):
        return getattr(self, name)


def _read(path: Path, default):
    if not path.exists():
        return default
    with open(path) as f:
        return yaml.safe_load(f) or default


def find(name: str) -> Path:
    d = Path(name) if Path(name).is_dir() else ROOT / "configs" / name
    if not d.is_dir():
        raise SystemExit(f"no config directory: {d}")
    return d


def load(name: str) -> Project:
    """`name` is a folder under configs/, or a path to any config directory."""
    d = find(name)
    return Project(
        name=d.name,
        dir=d,
        project=_read(d / "project.yaml", {}),
        sources=_read(d / "sources.yaml", []),
        scores=_read(d / "scores.yaml", {}),
        segments=_read(d / "segments.yaml", []),
        model=_read(d / "model.yaml", {}),
        golden=_read(d / "golden.yaml", []),
    )


def validate(p: Project) -> list[str]:
    """Every section's shape, then the references between sections."""
    errs = [e for s in schema.SECTIONS for e in schema.errors(s, p.section(s))]
    if errs:
        return errs
    names = set(p.score_names)
    display = p.project.get("display", {})
    for k in ("highlight", "default_sort"):
        if display.get(k) and display[k] not in names:
            errs.append(f"project.display.{k}: '{display[k]}' is not a score")
    errs += [f"project.display.columns: '{c}' is not a score" for c in display.get("columns", []) if c not in names]
    for seg in p.segments:
        errs += [f"segments.{seg['name']}: '{r['column']}' is not a score"
                 for r in seg.get("rules", []) if r["column"] not in names]
    src = {s["name"] for s in p.sources}
    et = p.project.get("entity_table")
    if et and et not in src:
        errs.append(f"project.entity_table: '{et}' is not a source")
    if p.key in names:
        errs.append(f"project.key: '{p.key}' is also a score name")
    return errs


class _Dumper(yaml.SafeDumper):
    """Multi-line strings (SQL, mostly) as readable `|` blocks."""


def _str(dumper, s: str):
    if "\n" in s:
        s = "\n".join(line.rstrip() for line in s.splitlines()) + "\n"
        return dumper.represent_scalar("tag:yaml.org,2002:str", s, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", s)


_Dumper.add_representer(str, _str)


def dump(data) -> str:
    return yaml.dump(data, Dumper=_Dumper, sort_keys=False, allow_unicode=True, width=100)


def save(p: Project, section: str, data) -> list[str]:
    """Validate and write one section. The previous file is kept under .history/."""
    errs = schema.errors(section, data)
    if errs:
        return errs
    fname, _ = schema.SECTIONS[section]
    path = p.dir / fname
    if path.exists():
        hist = p.dir / ".history"
        hist.mkdir(exist_ok=True)
        (hist / f"{time.strftime('%Y%m%d-%H%M%S')}-{fname}").write_text(path.read_text())
    header = "".join(f"# {line}\n" for line in HEADERS[section].splitlines())
    path.write_text(header + dump(data))
    setattr(p, section, data)
    return []


def history(p: Project, section: str) -> list[dict]:
    fname, _ = schema.SECTIONS[section]
    hist = p.dir / ".history"
    files = sorted(hist.glob(f"*-{fname}"), reverse=True) if hist.exists() else []
    return [{"id": f.name, "saved_at": f.name[:15], "text": f.read_text()} for f in files[:20]]
