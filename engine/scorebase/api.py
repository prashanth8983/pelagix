"""Read-only query API the app's agent calls.

  GET  /context            semantic model + golden queries (what the agent may know)
  POST /query {sql}        guarded, read-only SQL against the warehouse
  POST /match {question}   closest golden question, for answering without an LLM

    python -m scorebase.api retail --port 8787
"""
import argparse
import json
import re
from datetime import date, datetime
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import config, evaluate, sqlguard

STOP = {"a", "an", "the", "of", "in", "my", "me", "show", "who", "what", "which", "are", "is",
        "how", "many", "do", "does", "have", "has", "to", "for", "with", "by", "and", "i"}


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP}


def best_golden(project, question: str) -> dict | None:
    q = _words(question)
    best, score = None, 0.0
    for g in project.golden:
        gw = _words(g["question"])
        s = len(q & gw) / len(q | gw) if q | gw else 0
        if s > score:
            best, score = g, s
    return {**best, "score": round(score, 2)} if best else None


def _jsonable(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    return v


def run_query(project, sql: str) -> dict:
    import duckdb

    wh_cfg = project.project.get("warehouse", {})
    if wh_cfg.get("kind", "duckdb") != "duckdb":
        raise NotImplementedError("the query API currently serves the local DuckDB warehouse")
    safe = sqlguard.check(sql, evaluate.allowed_tables(project), "duckdb")
    con = duckdb.connect(str(project.path(wh_cfg["path"])), read_only=True)
    try:
        cur = con.execute(safe)
        cols = [d[0] for d in cur.description]
        rows = [[_jsonable(v) for v in r] for r in cur.fetchall()]
    finally:
        con.close()
    return {"sql": safe, "columns": cols, "rows": rows}


def make_handler(project):
    context = {
        "entity": project.project.get("entity"),
        "key": project.key,
        "score_table": project.score_table,
        "model": project.model,
        "golden": project.golden,
    }

    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, body: dict):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/context":
                return self._send(200, context)
            if self.path == "/health":
                return self._send(200, {"ok": True})
            self._send(404, {"error": "not found"})

        def do_POST(self):
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                if self.path == "/query":
                    return self._send(200, run_query(project, body["sql"]))
                if self.path == "/match":
                    return self._send(200, best_golden(project, body["question"]) or {})
                self._send(404, {"error": "not found"})
            except sqlguard.UnsafeSQL as e:
                self._send(400, {"error": f"blocked: {e}"})
            except Exception as e:
                self._send(400, {"error": str(e)})

        def log_message(self, fmt, *args):  # keep the console quiet
            pass

    return Handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--port", type=int, default=8787)
    a = ap.parse_args()
    p = config.load(a.project)
    print(f"scorebase api for '{p.name}' on http://localhost:{a.port}")
    ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(p)).serve_forever()


if __name__ == "__main__":
    main()
