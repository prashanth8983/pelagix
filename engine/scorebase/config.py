"""Load a project's config directory (configs/<name>/*.yaml) into one object, and save it back.

The engine's home directory holds `configs/` and `data/`. It is, in order:
SCOREBASE_HOME if set, the nearest ancestor of the working directory that has a
`configs/` folder, or the repository this package was installed from in editable mode.
"""
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from . import schema


def _home() -> Path:
    env = os.environ.get("SCOREBASE_HOME")
    if env:
        return Path(env).expanduser().resolve()
    cwd = Path.cwd()
    for d in (cwd, *cwd.parents):
        if (d / "configs").is_dir():
            return d
    return Path(__file__).resolve().parents[2]


ROOT = _home()

HEADERS = {
    "project": "What each score row describes, where the warehouse is, and how the app lists entities.",
    "sources": "Where raw data comes from. Each source lands as one raw table in the warehouse.",
    "scores": "Per-entity scores. Each `sql` is an expression over `from`, grouped by `key_expr`.\n"
              "A score may use other scores by name; the scorer orders them by dependency.\n"
              "A score may also set its own `from`, `where` and `key_expr` to aggregate another table.",
    "segments": "Saved segments over the score table, as structured rules (`match: all` or `any`).",
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

    @property
    def attributes(self) -> list[str]:
        """Columns of the entity table carried into the score table as-is."""
        return list(self.project.get("attributes") or [])

    @property
    def columns(self) -> list[str]:
        """Every filterable column of the score table: attributes, then scores."""
        return self.attributes + self.score_names

    @property
    def history(self) -> bool:
        return bool(self.project.get("publish", {}).get("history"))

    def path(self, rel: str) -> Path:
        """Resolve a path from config relative to the engine home."""
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
    columns = set(p.columns)
    display = p.project.get("display", {})
    for k in ("highlight", "default_sort"):
        if display.get(k) and display[k] not in names:
            errs.append(f"project.display.{k}: '{display[k]}' is not a score")
    errs += [f"project.display.columns: '{c}' is not a score or attribute" for c in display.get("columns", []) if c not in columns]
    for seg in p.segments:
        errs += [f"segments.{seg['name']}: '{r['column']}' is not a score or attribute"
                 for r in seg.get("rules", []) if r["column"] not in columns]
    src = {s["name"] for s in p.sources}
    et = p.project.get("entity_table")
    if et and et not in src:
        errs.append(f"project.entity_table: '{et}' is not a source")
    if p.attributes and not et:
        errs.append("project.attributes: needs an entity_table to read them from")
    errs += [f"project.attributes: '{a}' is also a score name" for a in p.attributes if a in names]
    if p.key in names or p.key in p.attributes:
        errs.append(f"project.key: '{p.key}' is also a score or attribute name")
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


TEMPLATE = {
    "project.yaml": """# What each score row describes, where the warehouse is, and how the app lists entities.
name: {name}
entity: customer          # singular: what each score row describes
key: customer_id          # column that identifies the entity in the score table
entity_table: customers   # every row here gets scores, even entities with no activity
entity_key: id
attributes: []            # columns of the entity table to carry into the score table

warehouse:
  kind: duckdb            # duckdb (local file) | postgres | snowflake (untested)
  path: data/{name}.duckdb

publish:
  postgres_url_env: SCOREBASE_PG_URL
  table: entity_scores
  history: false          # keep entity_scores_history with one row per entity per run

display:
  entity_label: Customers
  columns: [order_count]
  default_sort: order_count
  sort_dir: desc
""",
    "sources.yaml": """# Where raw data comes from. Each source lands as one raw table in the warehouse.
# Local paths must live under data/. Remote URLs need SCOREBASE_REMOTE_SOURCES.
- name: customers
  connector: csv
  path: data/{name}/customers.csv
  checks: {{not_null: [id], unique: [id], min_rows: 1}}
- name: orders
  connector: csv
  path: data/{name}/orders.csv
  checks: {{not_null: [id, customer_id]}}
""",
    "scores.yaml": """# Per-entity scores. Each `sql` is an expression over `from`, grouped by `key_expr`.
from: orders o
key_expr: o.customer_id

scores:
  - name: order_count
    sql: COUNT(*)
    label: Orders
    format: count
    default: 0
""",
    "segments.yaml": """# Saved segments over the score table, as structured rules.
- name: all
  label: Customers
  rules: []
- name: repeat
  label: Repeat buyers
  rules:
    - {{column: order_count, op: ">=", value: 2}}
""",
    "model.yaml": """# Semantic model: what the agent and the SQL workspace may know about the data.
tables:
  entity_scores:
    description: One row per customer with precomputed scores
    columns:
      customer_id: Customer id
      order_count: Number of orders
joins: []
synonyms: {{}}
""",
    "golden.yaml": """# Verified question -> SQL pairs. Answered without a model and shown to the agent as examples.
- question: How many customers have ordered more than once?
  sql: SELECT COUNT(*) AS repeat_customers FROM entity_scores WHERE order_count >= 2
""",
}


def init(name: str) -> Path:
    """Create configs/<name>/ with a minimal, valid project."""
    if not schema.IDENT_RE.match(name):
        raise SystemExit(f"project name must be an identifier: {name!r}")
    d = ROOT / "configs" / name
    if d.exists():
        raise SystemExit(f"already exists: {d}")
    d.mkdir(parents=True)
    for fname, text in TEMPLATE.items():
        (d / fname).write_text(text.format(name=name))
    return d
