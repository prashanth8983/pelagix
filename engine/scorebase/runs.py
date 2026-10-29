"""Pipeline runs started from the app.

Each run is `python -m scorebase run <project> --json` in a subprocess: the warehouse
writer lock lives there, not in the API, and a crash can't take the API down. Steps are
read from its JSON lines as they happen. Finished runs are appended to
data/runs/<project>.jsonl, newest last.
"""
import json
import subprocess
import sys
import threading
import time
import uuid

from . import config

_lock = threading.Lock()
_active: dict[str, dict] = {}   # project -> run in progress


def _log(project: str):
    d = config.ROOT / "data" / "runs"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{project}.jsonl"


def history(project: str, limit: int = 30) -> list[dict]:
    path = _log(project)
    done = [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []
    active = [_active[project]] if project in _active else []
    return (active + done[::-1])[:limit]


def get(project: str, run_id: str) -> dict | None:
    return next((r for r in history(project, 500) if r["id"] == run_id), None)


def start(project: str, publish: bool = True) -> dict:
    with _lock:
        if project in _active:
            return _active[project]
        run = {"id": uuid.uuid4().hex[:10], "project": project, "status": "running",
               "started_at": time.time(), "finished_at": None, "steps": [], "log": []}
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
            with open(_log(run["project"]), "a") as f:
                f.write(json.dumps(run, default=str) + "\n")
            _active.pop(run["project"], None)
