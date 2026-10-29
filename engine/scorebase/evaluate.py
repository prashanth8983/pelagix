"""Check the golden queries, and measure the agent against them.

`run` proves every verified query passes the guard and returns rows. `run_agent` asks
the agent each golden question with that question's own example removed from its prompt
(so it can't copy the answer), runs both queries, and compares the results.
"""
import copy
import math

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


def _norm(v):
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float)) or hasattr(v, "as_integer_ratio"):
        f = float(v)
        return None if math.isnan(f) else round(f, 2)
    return str(v)


def same_result(expected: tuple[list, list], actual: tuple[list, list]) -> tuple[bool, str]:
    """Every expected column must appear among the actual columns with the same values.

    Column names and order don't matter, extra columns are fine, row order is ignored.
    """
    (ecols, erows), (acols, arows) = expected, actual
    if len(erows) != len(arows):
        return False, f"expected {len(erows)} rows, got {len(arows)}"
    actual_cols = [sorted((_norm(r[i]) for r in arows), key=repr) for i in range(len(acols))]
    for i, name in enumerate(ecols):
        want = sorted((_norm(r[i]) for r in erows), key=repr)
        if want not in actual_cols:
            return False, f"no column matches expected '{name}'"
    return True, "match"


def run_agent(project, wh, make_agent) -> list[dict]:
    """make_agent(project) -> callable(question) -> {sql, ...}. One project copy per question."""
    tables = allowed_tables(project)
    results = []
    for i, g in enumerate(project.golden):
        held_out = copy.copy(project)
        held_out.golden = project.golden[:i] + project.golden[i + 1:]
        r = {"question": g["question"], "expected_sql": g["sql"].strip()}
        try:
            expected = wh.query(sqlguard.check(g["sql"], tables, wh.dialect))
            out = make_agent(held_out)(g["question"])
            r["sql"] = out.get("sql")
            if not out.get("sql") or out.get("error"):
                r.update(ok=False, reason=out.get("answer") or "no SQL")
            else:
                actual = wh.query(sqlguard.check(out["sql"], tables, wh.dialect))
                ok, why = same_result(expected, actual)
                r.update(ok=ok, reason=why)
        except Exception as e:
            r.update(ok=False, reason=str(e))
        results.append(r)
    return results
