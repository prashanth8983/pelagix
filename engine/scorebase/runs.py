"""Pipeline runs started from the app.

Each run is `python -m scorebase run <project> --json` in a subprocess: the warehouse
writer lock lives there, not in the API, and a crash can't take the API down. Steps are
read from its JSON lines as they happen.

Run state is stored in Postgres (schema scorebase_meta) when SCOREBASE_PG_URL is set,
so every API replica and the app see the same history and the same "a run is going"
flag. Without Postgres, runs are kept in memory and appended to data/runs/<project>.jsonl.
"""
import json
import os
import subprocess
import sys
import threading
import time
import uuid

from . import config

STALE_AFTER = 600  # seconds without a step update before a "running" run is treated as dead

_lock = threading.Lock()
_active: dict[str, dict] = {}   # project -> run in progress (memory store only)


# ---------------------------------------------------------------- storage

def _pg_url() -> str | None:
    return os.environ.get("SCOREBASE_PG_URL")


_DDL = """
CREATE SCHEMA IF NOT EXISTS scorebase_meta;
CREATE TABLE IF NOT EXISTS scorebase_meta.runs (
  id text PRIMARY KEY,
  project text NOT NULL,
  status text NOT NULL,
  started_at double precision NOT NULL,
  finished_at double precision,
  updated_at double precision NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]',
  log jsonb NOT NULL DEFAULT '[]',
  error text
);
CREATE INDEX IF NOT EXISTS runs_project_started ON scorebase_meta.runs (project, started_at DESC);
"""
_ready = False


def _pg():
    """A short-lived connection with the schema in place, or None without Postgres."""
    global _ready
    url = _pg_url()
    if not url:
        return None
    import psycopg

    con = psycopg.connect(url, autocommit=True)
    if not _ready:
        con.execute(_DDL)
        _ready = True
    return con


def _row(r) -> dict:
    return {"id": r[0], "project": r[1], "status": r[2], "started_at": r[3], "finished_at": r[4],
            "steps": r[5], "log": r[6], "error": r[7]}


_COLS = "id, project, status, started_at, finished_at, steps, log, error"


def _save(run: dict) -> None:
    con = _pg()
    if con is None:
        return
    from psycopg.types.json import Jsonb

    with con:
        con.execute(
            f"""INSERT INTO scorebase_meta.runs ({_COLS}, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, finished_at = EXCLUDED.finished_at,
                  steps = EXCLUDED.steps, log = EXCLUDED.log, error = EXCLUDED.error, updated_at = EXCLUDED.updated_at""",
            (run["id"], run["project"], run["status"], run["started_at"], run["finished_at"],
             Jsonb(run["steps"]), Jsonb(run["log"]), run.get("error"), time.time()),
        )


def _log(project: str):
    d = config.ROOT / "data" / "runs"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{project}.jsonl"


# ---------------------------------------------------------------- reads

def history(project: str, limit: int = 30) -> list[dict]:
    con = _pg()
    if con is not None:
        with con:
            rows = con.execute(
                f"SELECT {_COLS} FROM scorebase_meta.runs WHERE project = %s ORDER BY started_at DESC LIMIT %s",
                (project, limit)).fetchall()
        return [_row(r) for r in rows]
    path = _log(project)
    done = [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []
    active = [_active[project]] if project in _active else []
    return (active + done[::-1])[:limit]


def get(project: str, run_id: str) -> dict | None:
    return next((r for r in history(project, 500) if r["id"] == run_id), None)


def active(project: str) -> dict | None:
    """The run in progress, if any. A run whose process stopped reporting is marked failed."""
    con = _pg()
    if con is None:
        return _active.get(project)
    with con:
        r = con.execute(
            f"SELECT {_COLS}, updated_at FROM scorebase_meta.runs WHERE project = %s AND status = 'running' "
            "ORDER BY started_at DESC LIMIT 1", (project,)).fetchone()
        if not r:
            return None
        if time.time() - r[8] > STALE_AFTER:
            con.execute("UPDATE scorebase_meta.runs SET status = 'failed', error = %s, finished_at = %s WHERE id = %s",
                        ("the run stopped reporting (API restarted or process killed)", time.time(), r[0]))
            return None
        return _row(r)


# ---------------------------------------------------------------- start and watch

def start(project: str, publish: bool = True) -> dict:
    with _lock:
        current = active(project)
        if current:
            return current
        run = {"id": uuid.uuid4().hex[:10], "project": project, "status": "running",
               "started_at": time.time(), "finished_at": None, "steps": [], "log": []}
        if _pg_url():
            _save(run)
        else:
            _active[project] = run
    cmd = [sys.executable, "-m", "scorebase", "run", project, "--json"] + ([] if publish else ["--no-publish"])
    threading.Thread(target=_watch, args=(run, cmd), daemon=True).start()
    return run


def _watch(run: dict, cmd: list[str]):
    try:
        proc = subprocess.Popen(cmd, cwd=config.ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in proc.stdout:
            line = line.rstrip()
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                if line:
                    run["log"] = (run["log"] + [line])[-200:]
                continue
            steps = [s for s in run["steps"] if s["step"] != ev["step"]]
            run["steps"] = steps + [ev]
            _save(run)
        code = proc.wait()
        run["status"] = "ok" if code == 0 else "failed"
        if code and not any(s["status"] == "failed" for s in run["steps"]):
            run["error"] = "\n".join(run["log"][-5:]) or f"exited with {code}"
        else:
            run["error"] = next((s.get("error") for s in run["steps"] if s["status"] == "failed"), None)
    except Exception as e:
        run.update(status="failed", error=str(e))
    finally:
        run["finished_at"] = time.time()
        with _lock:
            if _pg_url():
                _save(run)
            else:
                with open(_log(run["project"]), "a") as f:
                    f.write(json.dumps(run, default=str) + "\n")
                _active.pop(run["project"], None)
