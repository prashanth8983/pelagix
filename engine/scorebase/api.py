"""Query and configuration API the app calls (server side only).

  GET  /context                     semantic model, scores, golden queries (what the agent may know)
  POST /query {sql}                 guarded, read-only SQL against the warehouse
  POST /format {sql}                the same SQL, pretty-printed
  POST /match {question}            closest golden question, and whether it may answer
  POST /ask {question}              LangGraph text-to-SQL agent (needs a model key)

  GET  /config                      every config section, plus validation problems
  PUT  /config/<section> {data}     validate and save one section (old file kept in .history/)
  POST /config/<section>/validate   problems a draft would have, without saving
  GET  /config/<section>/history    previous versions of a section

  POST /preview/source {source}     read a source without landing it: columns + first rows
  POST /preview/scores {scores?}    generated SQL, dependency layers, sample rows and stats
  POST /preview/segment {rules}     how many entities a draft segment holds
  GET  /warehouse/tables            every warehouse table with its columns
  POST /eval                        run every golden query
  GET  /runs, POST /runs, GET /runs/<id>   pipeline runs

    python -m scorebase.api retail --port 8787 [--env-file app/.env]

Set SCOREBASE_API_TOKEN to require `Authorization: Bearer <token>` on every request.
"""
import argparse
import copy
import hmac
import json
import os
import sys
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import config, evaluate, golden, runs, scorer, schema, segments, sqlguard, warehouse

MAX_BODY = 1_000_000
QUERY_TIMEOUT = 20.0


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
        "display": p.project.get("display", {}),
    }


def _with(p, section: str, data):
    draft = copy.copy(p)
    setattr(draft, section, data)
    return draft


def preview_source(p, src: dict) -> dict:
    errs = schema.errors("sources", [src])
    if errs:
        raise ValueError("; ".join(errs))
    from . import ingest

    wh = warehouse.DuckDBWarehouse(Path(":memory:"))
    try:
        return wh.preview(src, ingest.location(p, src))
    finally:
        wh.close()


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
        cols, rows = wh.query(f"SELECT * FROM ({select}) LIMIT 20", timeout=QUERY_TIMEOUT)
        out["columns"], out["rows"] = cols, [[warehouse.jsonable(v) for v in r] for r in rows]
        scols, srows = wh.query(f"SUMMARIZE {select}", timeout=QUERY_TIMEOUT)
        out["stats"] = [dict(zip(scols, (warehouse.jsonable(v) for v in r))) for r in srows]
    except Exception as e:
        out["error"] = str(e)
    finally:
        wh.close()
    return out


def preview_segment(p, rules: list) -> dict:
    errs = schema.errors("segments", [{"name": "draft", "rules": rules}])
    if errs:
        return {"errors": errs}
    wh = _open_read_only(p)
    try:
        cols = {c for c, _ in wh.describe(p.score_table)}
        where = segments.to_sql(rules, cols)
        _, ((size, total),) = wh.query(
            f"SELECT COUNT(*) FILTER (WHERE {where}), COUNT(*) FROM {p.score_table}", timeout=QUERY_TIMEOUT)
    finally:
        wh.close()
    return {"where": where, "size": size, "total": total}


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


def make_handler(name: str):
    graphs: dict = {}
    token = os.environ.get("SCOREBASE_API_TOKEN")

    def project():
        return config.load(name)

    def ask(p, question: str) -> dict:
        from . import agent_graph

        stamp = tuple((f.name, f.stat().st_mtime) for f in sorted(p.dir.glob("*.yaml")))
        if stamp not in graphs:  # rebuild when the config changes
            graphs.clear()
            graphs[stamp] = agent_graph.build(p, agent_graph.default_llm(), lambda sql: run_query(p, sql))
        out = graphs[stamp].invoke({"question": question})
        return {"answer": out.get("answer", ""), "sql": out.get("sql"), "columns": out.get("columns"),
                "rows": out.get("rows"), "attempts": out.get("attempts"), "trace": out.get("trace", [])}

    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, body):
            data = json.dumps(body, default=str).encode()
            self._status = code
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Request-Id", self._rid)
            self.end_headers()
            self.wfile.write(data)

        def _authorized(self) -> bool:
            if not token:
                return True
            got = self.headers.get("Authorization", "").removeprefix("Bearer ")
            return hmac.compare_digest(got.encode(), token.encode())

        def _body(self) -> dict:
            n = int(self.headers.get("Content-Length", 0))
            if n > MAX_BODY:
                raise ValueError("request too large")
            return json.loads(self.rfile.read(n) or b"{}")

        def _route(self, method: str):
            # One JSON line per request: what ran, for whom, how it ended and how long it took.
            self._rid = self.headers.get("X-Request-Id") or uuid.uuid4().hex
            self._status, started = 500, time.perf_counter()
            try:
                self._handle(method)
            finally:
                print(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "id": self._rid, "method": method,
                                  "path": self.path.split("?")[0], "status": self._status,
                                  "ms": round((time.perf_counter() - started) * 1000)}), file=sys.stderr, flush=True)

        def _handle(self, method: str):
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            parts = [x for x in self.path.split("?")[0].split("/") if x]
            try:
                body = self._body() if method in ("POST", "PUT") else {}
                p = project()
                res = self._dispatch(method, parts, body, p)
                if res is None:
                    return self._send(404, {"error": "not found"})
                code, payload = res if isinstance(res, tuple) else (200, res)
                self._send(code, payload)
            except sqlguard.UnsafeSQL as e:
                self._send(400, {"error": f"blocked: {e}"})
            except warehouse.Timeout as e:
                self._send(408, {"error": str(e)})
            except (Exception, SystemExit) as e:
                self._send(400, {"error": str(e)})

        def _dispatch(self, method, parts, body, p):
            match method, parts:
                case "GET", ["health"]:
                    return {"ok": True, "project": p.name}
                case "GET", ["ready"]:  # the config loads and the warehouse opens
                    errs = config.validate(p)
                    _open_read_only(p, attempts=4).close()
                    return (503, {"ok": False, "config_errors": len(errs)}) if errs else {"ok": True}
                case "GET", ["context"]:
                    return context(p)
                case "POST", ["query"]:
                    return run_query(p, body["sql"])
                case "POST", ["format"]:
                    return {"sql": sqlguard.format_sql(body["sql"], p.project.get("warehouse", {}).get("kind", "duckdb"))}
                case "POST", ["match"]:
                    return best_golden(p, body["question"]) or {}
                case "POST", ["ask"]:
                    return ask(p, body["question"])
                case "GET", ["config"]:
                    return {**{s: p.section(s) for s in schema.SECTIONS}, "errors": config.validate(p)}
                case "PUT", ["config", section] if section in schema.SECTIONS:
                    errs = config.validate(_with(p, section, body["data"]))
                    if errs:
                        return 422, {"errors": errs}
                    config.save(p, section, body["data"])
                    return {"errors": [], "saved": section}
                case "POST", ["config", section, "validate"] if section in schema.SECTIONS:
                    return {"errors": config.validate(_with(p, section, body["data"]))}
                case "GET", ["config", section, "history"] if section in schema.SECTIONS:
                    return config.history(p, section)
                case "POST", ["preview", "source"]:
                    return preview_source(p, body["source"])
                case "POST", ["preview", "scores"]:
                    return preview_scores(p, body.get("scores"))
                case "POST", ["preview", "segment"]:
                    return preview_segment(p, body.get("rules", []))
                case "GET", ["warehouse", "tables"]:
                    return warehouse_tables(p)
                case "POST", ["eval"]:
                    wh = _open_read_only(p)
                    try:
                        return evaluate.run(p, wh)
                    finally:
                        wh.close()
                case "GET", ["runs"]:
                    return runs.history(p.name)
                case "POST", ["runs"]:
                    errs = config.validate(p)
                    if errs:
                        return 422, {"errors": errs}
                    return runs.start(p.name, publish=body.get("publish", True))
                case "GET", ["runs", run_id]:
                    return runs.get(p.name, run_id)
            return None

        def do_GET(self):
            self._route("GET")

        def do_POST(self):
            self._route("POST")

        def do_PUT(self):
            self._route("PUT")

        def log_message(self, fmt, *args):  # keep the console quiet
            pass

    return Handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--env-file", default=str(config.ROOT / "app" / ".env"))
    a = ap.parse_args()
    load_env_file(Path(a.env_file))
    p = config.load(a.project)
    print(f"scorebase api for '{p.name}' on http://{a.host}:{a.port}")
    ThreadingHTTPServer((a.host, a.port), make_handler(a.project)).serve_forever()


if __name__ == "__main__":
    main()
