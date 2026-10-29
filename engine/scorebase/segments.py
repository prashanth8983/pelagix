"""Count each saved segment from segments.yaml against the score table."""
from .sqlguard import check_filter


def run(project, wh) -> list[dict]:
    out = []
    for seg in project.segments:
        check_filter(seg["where"])
        _, rows = wh.query(f"SELECT COUNT(*) FROM {project.score_table} WHERE {seg['where']}")
        out.append({**seg, "size": rows[0][0]})
    return out
