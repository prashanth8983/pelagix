"""Run every golden query through the SQL guard and the warehouse.

Today this proves the verified queries are valid and return rows. When the agent is
added, the same file will compare the agent's answer to each golden result.
"""
from . import sqlguard


def allowed_tables(project) -> set[str]:
    return set(project.model.get("tables", {})) | {project.score_table}


def run(project, wh) -> list[dict]:
    results = []
    tables = allowed_tables(project)
    for g in project.golden:
        try:
            sql = sqlguard.check(g["sql"], tables, wh.dialect)
            cols, rows = wh.query(sql)
            results.append({"question": g["question"], "ok": bool(rows), "rows": len(rows),
                            "columns": cols, "first": rows[0] if rows else None})
        except Exception as e:  # report every failure, don't stop at the first
            results.append({"question": g["question"], "ok": False, "error": str(e)})
    return results
