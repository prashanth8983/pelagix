"""Load a project's config directory (configs/<name>/*.yaml) into one object."""
from dataclasses import dataclass, field
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


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

    def path(self, rel: str) -> Path:
        """Resolve a path from config relative to the repo root."""
        p = Path(rel)
        return p if p.is_absolute() else ROOT / p


def _read(path: Path, default):
    if not path.exists():
        return default
    with open(path) as f:
        return yaml.safe_load(f) or default


def load(name: str) -> Project:
    """`name` is a folder under configs/, or a path to any config directory."""
    d = Path(name) if Path(name).is_dir() else ROOT / "configs" / name
    if not d.is_dir():
        raise SystemExit(f"no config directory: {d}")
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
