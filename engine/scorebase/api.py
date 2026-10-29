"""Query and configuration API the app calls (server side only). FastAPI; docs at /docs.

  GET  /health                      process is up
  GET  /ready                       config loads and the warehouse opens (503 otherwise)
  GET  /context                     semantic model, scores, golden queries (what the agent may know)
  POST /query {sql}                 guarded, read-only SQL against the warehouse
  POST /format {sql}                the same SQL, pretty-printed
  POST /match {question}            closest golden question, and whether it may answer
  POST /ask {question}              LangGraph text-to-SQL agent (needs a model key)
  POST /distribution {column}       histogram of one score, for the overview chart

  GET  /config                      every config section, plus validation problems
  PUT  /config/{section} {data}     validate and save one section (old file kept in .history/)
  POST /config/{section}/validate   problems a draft would have, without saving
  GET  /config/{section}/history    previous versions of a section

  POST /preview/source {source}     read a source without landing it: columns + first rows
  POST /preview/scores {scores?}    generated SQL, dependency layers, sample rows and stats
  POST /preview/segment {rules, match}   how many entities a draft segment holds
  GET  /warehouse/tables            every warehouse table with its columns
  POST /eval                        run every golden query
  GET  /runs, POST /runs, GET /runs/{id}   pipeline runs

    python -m scorebase.api retail --port 8787 [--host 0.0.0.0] [--env-file app/.env]

SCOREBASE_API_TOKEN is required on every request as `Authorization: Bearer <token>`.
Without it set the API is open, which is only acceptable on a developer's machine.
"""
import argparse
import copy
import hmac
import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import config, evaluate, golden, ingest, runs, schema, scorer, segments, sqlguard, warehouse

MAX_BODY = 1_000_000
QUERY_TIMEOUT = 20.0
Section = Literal["project", "sources", "scores", "segments", "model", "golden"]


# ---------------------------------------------------------------- engine functions (no HTTP)

def best_golden(project, question: str) -> dict | None:
    return golden.match(project.golden, question)


def _open_read_only(project, attempts: int = 20):
    """A pipeline run holds the DuckDB writer lock for a few seconds; wait it out."""
    for i in range(attempts):
        try:
            return warehouse.connect(project, read_only=True)
        except Exception as e:
            if "lock" not in str(e).lower() or i == attempts - 1:
                raise
            time.sleep(0.25)


def run_query(project, sql: str, max_rows: int = sqlguard.MAX_ROWS) -> dict:
    wh = _open_read_only(project)
    try:
        safe = sqlguard.check(sql, evaluate.allowed_tables(project), wh.dialect, max_rows)
        cols, rows = wh.query(safe, max_rows=max_rows, timeout=QUERY_TIMEOUT)
    finally:
        wh.close()
    return {"sql": safe, "columns": cols, "rows": [[warehouse.jsonable(v) for v in r] for r in rows]}


def load_env_file(path: Path) -> None:
    """KEY=VALUE lines from path override the shell, like the app's .env loader."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.removeprefix("export ").strip(), v.strip().strip("'\"")
        if v:
            os.environ[k] = v


def context(p) -> dict:
    return {
        "name": p.name,
        "entity": p.project.get("entity"),
        "key": p.key,
        "score_table": p.score_table,
        "dialect": p.project.get("warehouse", {}).get("kind", "duckdb"),
        "model": p.model,
        "golden": p.golden,
        "scores": [{k: s.get(k) for k in ("name", "label", "description", "format")} for s in p.scores.get("scores", [])],
        "attributes": p.attributes,
        "display": p.project.get("display", {}),
        "agent": bool(os.environ.get("OPENROUTER_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")),
    }


def _with(p, section: str, data):
    draft = copy.copy(p)
    setattr(draft, section, data)
    return draft


def preview_source(p, src: dict) -> dict:
    errs = schema.errors("sources", [src])
    if errs:
        raise ValueError("; ".join(errs))
    wh = warehouse.DuckDBWarehouse(Path(":memory:"))
    try:
        return wh.preview(src, ingest.location(p, src))
    finally:
        wh.close()


_NUMERIC_FORMATS = {"number", "money", "count", "ratio", "percent", "days"}


def _stats_sql(select: str, scores: list[dict]) -> tuple[str, list[dict]]:
    """One aggregate query over the scoring SELECT: min, avg, max and null share per score."""
    parts, plan = ["COUNT(*)"], []
    for s in scores:
        c = s["name"]
        avg = f"AVG({c})" if s.get("format", "number") in _NUMERIC_FORMATS else "NULL"
        parts += [f"MIN({c})", avg, f"MAX({c})", f"COUNT({c})"]
        plan.append(s)
    return f"SELECT {', '.join(parts)} FROM ({select}) s", plan


def preview_scores(p, scores: dict | None) -> dict:
    if scores is not None:
        errs = schema.errors("scores", scores)
        if errs:
            return {"errors": errs}
        p = _with(p, "scores", scores)
    out = {"sql": scorer.build_sql(p), "plan": scorer.plan(p)}
    wh = _open_read_only(p)
    try:
        select = scorer.build_select(p)
        cols, rows = wh.query(f"SELECT * FROM ({select}) s LIMIT 20", timeout=QUERY_TIMEOUT)
        out["columns"], out["rows"] = cols, [[warehouse.jsonable(v) for v in r] for r in rows]
        sql, plan = _stats_sql(select, p.scores["scores"])
        _, (row,) = wh.query(sql, timeout=QUERY_TIMEOUT)
        n, vals = row[0], row[1:]
        out["stats"] = [
            {"column_name": s["name"], "min": warehouse.jsonable(vals[i * 4]), "avg": warehouse.jsonable(vals[i * 4 + 1]),
             "max": warehouse.jsonable(vals[i * 4 + 2]),
             "null_percentage": round(100.0 * (n - vals[i * 4 + 3]) / n, 1) if n else 0.0}
            for i, s in enumerate(plan)
        ]
    except Exception as e:
        out["error"] = str(e)
    finally:
        wh.close()
    return out


def preview_segment(p, rules: list, match: str = "all") -> dict:
    errs = schema.errors("segments", [{"name": "draft", "match": match, "rules": rules}])
    if errs:
        return {"errors": errs}
    wh = _open_read_only(p)
    try:
        cols = {c for c, _ in wh.describe(p.score_table)}
        where = segments.to_sql(rules, cols, match)
        _, ((size, total),) = wh.query(
            f"SELECT SUM(CASE WHEN {where} THEN 1 ELSE 0 END), COUNT(*) FROM {p.score_table}", timeout=QUERY_TIMEOUT)
    finally:
        wh.close()
    return {"where": where, "size": int(size or 0), "total": total}


def warehouse_tables(p) -> list[dict]:
    wh = _open_read_only(p)
    try:
        out = []
        for t in wh.tables():
            _, ((n,),) = wh.query(f"SELECT COUNT(*) FROM {wh.quote(t)}")
            out.append({"name": t, "rows": n, "columns": [{"name": c, "type": ty} for c, ty in wh.describe(t)]})
        return out
    finally:
        wh.close()


_P99 = {
    "duckdb": "QUANTILE_CONT(x, 0.99)",
    "postgres": "PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY x)",
    "snowflake": "PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY x)",
}
_DOUBLE = {"duckdb": "DOUBLE", "postgres": "DOUBLE PRECISION", "snowflake": "DOUBLE"}


def distribution(p, column: str, bins: int = 20) -> dict:
    """Equal-width bins of one numeric score up to its 99th percentile; the tail goes in the last bin."""
    if column not in p.score_names:
        raise ValueError(f"not a score: {column}")
    dialect = p.project.get("warehouse", {}).get("kind", "duckdb")
    bins = max(2, min(int(bins), 100))
    sql = (
        f"WITH v AS (SELECT CAST({column} AS {_DOUBLE[dialect]}) AS x FROM {p.score_table} WHERE {column} IS NOT NULL),\n"
        f"  b AS (SELECT MIN(x) AS lo, {_P99[dialect]} AS hi FROM v)\n"
        f"SELECT LEAST(CAST(FLOOR((x - lo) / NULLIF((hi - lo) / {bins}, 0)) AS INTEGER), {bins - 1}) AS bin,\n"
        f"       MIN(x) AS lo, MAX(x) AS hi, COUNT(*) AS n\n"
        f"FROM v, b GROUP BY 1 ORDER BY 1"
    )
    return run_query(p, sql)


# ---------------------------------------------------------------- HTTP

class QueryBody(BaseModel):
    sql: str


class QuestionBody(BaseModel):
    question: str


class DataBody(BaseModel):
    data: Any


class SourceBody(BaseModel):
    source: dict


class ScoresBody(BaseModel):
    scores: dict | None = None


class SegmentBody(BaseModel):
    rules: list[dict] = []
    match: Literal["all", "any"] = "all"


class DistributionBody(BaseModel):
    column: str
    bins: int = 20


class RunBody(BaseModel):
    publish: bool = True


def error_response(e: BaseException) -> JSONResponse:
    """Engine errors as JSON. ValueError and SystemExit are how the engine reports bad input;
    anything else is a bug and gets a 500 with its message (the API is internal)."""
    if isinstance(e, sqlguard.UnsafeSQL):
        return JSONResponse({"error": f"blocked: {e}"}, status_code=400)
    if isinstance(e, warehouse.Timeout):
        return JSONResponse({"error": str(e)}, status_code=408)
    if isinstance(e, ingest.SourceNotAllowed):
        return JSONResponse({"error": str(e)}, status_code=403)
    if isinstance(e, (ValueError, KeyError, SystemExit, NotImplementedError)):
        return JSONResponse({"error": str(e) or e.__class__.__name__}, status_code=400)
    return JSONResponse({"error": str(e) or e.__class__.__name__}, status_code=500)


def create_app(name: str) -> FastAPI:
    """The API for one project. `name` is a folder under configs/ or a config directory path."""
    graphs: dict = {}
    token = os.environ.get("SCOREBASE_API_TOKEN")
    app = FastAPI(title="Scorebase engine", version="0.2.0", docs_url="/docs", redoc_url=None)

    def project():
        return config.load(name)

    async def authorized(request: Request):
        if not token:
            return
        got = request.headers.get("Authorization", "").removeprefix("Bearer ")
        if not hmac.compare_digest(got.encode(), token.encode()):
            raise HTTPException(401, "unauthorized")

    def ask(p, question: str) -> dict:
        from . import agent_graph

        stamp = tuple((f.name, f.stat().st_mtime) for f in sorted(p.dir.glob("*.yaml")))
        if stamp not in graphs:  # rebuild when the config changes
            graphs.clear()
            graphs[stamp] = agent_graph.build(p, agent_graph.default_llm(), lambda sql: run_query(p, sql))
        out = graphs[stamp].invoke({"question": question})
        return {"answer": out.get("answer", ""), "sql": out.get("sql"), "columns": out.get("columns"),
                "rows": out.get("rows"), "attempts": out.get("attempts"), "trace": out.get("trace", [])}

    # One JSON line per request on stderr: id, method, path, status, duration. Bodies are capped.
    @app.middleware("http")
    async def request_log(request: Request, call_next):
        rid = request.headers.get("X-Request-Id") or uuid.uuid4().hex
        request.state.rid = rid
        started = time.perf_counter()
        if int(request.headers.get("content-length") or 0) > MAX_BODY:
            response = JSONResponse({"error": "request too large"}, status_code=413)
        else:
            try:
                response = await call_next(request)
            except (Exception, SystemExit) as e:  # SystemExit is how the engine reports a missing file or env var
                response = error_response(e)
        response.headers["X-Request-Id"] = rid
        print(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "id": rid, "method": request.method,
                          "path": request.url.path, "status": response.status_code,
                          "ms": round((time.perf_counter() - started) * 1000)}), file=sys.stderr, flush=True)
        return response

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, e: HTTPException):
        return JSONResponse({"error": e.detail}, status_code=e.status_code)

    @app.exception_handler(RequestValidationError)
    async def body_error(request: Request, e: RequestValidationError):
        errs = [f"{'.'.join(str(x) for x in err['loc'] if x != 'body')}: {err['msg']}" for err in e.errors()]
        return JSONResponse({"error": "; ".join(errs), "errors": errs}, status_code=422)

    for cls in (sqlguard.UnsafeSQL, warehouse.Timeout, ingest.SourceNotAllowed, ValueError, KeyError, NotImplementedError):
        app.add_exception_handler(cls, lambda request, e: error_response(e))

    dep = [Depends(authorized)]

    @app.get("/health", dependencies=dep)
    def health():
        return {"ok": True, "project": project().name}

    @app.get("/ready", dependencies=dep)
    def ready():
        p = project()
        errs = config.validate(p)
        _open_read_only(p, attempts=4).close()
        if errs:
            return JSONResponse({"ok": False, "config_errors": len(errs)}, status_code=503)
        return {"ok": True}

    @app.get("/context", dependencies=dep)
    def get_context():
        return context(project())

    @app.post("/query", dependencies=dep)
    def post_query(body: QueryBody):
        return run_query(project(), body.sql)

    @app.post("/format", dependencies=dep)
    def post_format(body: QueryBody):
        p = project()
        return {"sql": sqlguard.format_sql(body.sql, p.project.get("warehouse", {}).get("kind", "duckdb"))}

    @app.post("/match", dependencies=dep)
    def post_match(body: QuestionBody):
        return best_golden(project(), body.question) or {}

    @app.post("/ask", dependencies=dep)
    def post_ask(body: QuestionBody):
        return ask(project(), body.question)

    @app.post("/distribution", dependencies=dep)
    def post_distribution(body: DistributionBody):
        return distribution(project(), body.column, body.bins)

    @app.get("/config", dependencies=dep)
    def get_config():
        p = project()
        return {**{s: p.section(s) for s in schema.SECTIONS}, "errors": config.validate(p)}

    @app.put("/config/{section}", dependencies=dep)
    def put_config(section: Section, body: DataBody):
        p = project()
        errs = config.validate(_with(p, section, body.data))
        if errs:
            return JSONResponse({"errors": errs}, status_code=422)
        config.save(p, section, body.data)
        return {"errors": [], "saved": section}

    @app.post("/config/{section}/validate", dependencies=dep)
    def validate_config(section: Section, body: DataBody):
        return {"errors": config.validate(_with(project(), section, body.data))}

    @app.get("/config/{section}/history", dependencies=dep)
    def config_history(section: Section):
        return config.history(project(), section)

    @app.post("/preview/source", dependencies=dep)
    def post_preview_source(body: SourceBody):
        return preview_source(project(), body.source)

    @app.post("/preview/scores", dependencies=dep)
    def post_preview_scores(body: ScoresBody):
        return preview_scores(project(), body.scores)

    @app.post("/preview/segment", dependencies=dep)
    def post_preview_segment(body: SegmentBody):
        return preview_segment(project(), body.rules, body.match)

    @app.get("/warehouse/tables", dependencies=dep)
    def get_tables():
        return warehouse_tables(project())

    @app.post("/eval", dependencies=dep)
    def post_eval():
        p = project()
        wh = _open_read_only(p)
        try:
            return evaluate.run(p, wh)
        finally:
            wh.close()

    @app.get("/runs", dependencies=dep)
    def list_runs():
        return runs.history(project().name)

    @app.post("/runs", dependencies=dep)
    def start_run(body: RunBody):
        p = project()
        errs = config.validate(p)
        if errs:
            return JSONResponse({"errors": errs}, status_code=422)
        return runs.start(p.name, publish=body.publish)

    @app.get("/runs/{run_id}", dependencies=dep)
    def get_run(run_id: str):
        r = runs.get(project().name, run_id)
        if r is None:
            raise HTTPException(404, "no such run")
        return r

    return app


def main():
    import uvicorn

    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--env-file", default=str(config.ROOT / "app" / ".env"))
    a = ap.parse_args()
    load_env_file(Path(a.env_file))
    p = config.load(a.project)
    if not os.environ.get("SCOREBASE_API_TOKEN"):
        print("warning: SCOREBASE_API_TOKEN is not set; the API accepts any caller", file=sys.stderr)
    print(f"scorebase api for '{p.name}' on http://{a.host}:{a.port} (docs at /docs)", file=sys.stderr)
    uvicorn.run(create_app(a.project), host=a.host, port=a.port, access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
