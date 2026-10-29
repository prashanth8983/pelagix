"""Load each source in sources.yaml into a raw warehouse table of the same name."""


def run(project, wh) -> dict[str, int]:
    counts = {}
    for src in project.sources:
        path = project.path(src["path"])
        if not path.exists():
            raise SystemExit(f"source '{src['name']}' missing file {path} (run `generate` first?)")
        counts[src["name"]] = wh.load_file(src["name"], path, src.get("connector", "csv"))
    return counts
