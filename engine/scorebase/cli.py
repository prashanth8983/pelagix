"""scorebase CLI.

  python -m scorebase generate retail [--users N]   synthetic TheLook-shaped files
  python -m scorebase run retail [--no-publish]     load -> check -> score -> segments -> publish -> codegen
  python -m scorebase validate retail               check every config file and their references
  python -m scorebase sql retail "SELECT ..."       run a guarded read-only query
  python -m scorebase eval retail [--agent]         check every golden query; --agent measures the agent
  python -m scorebase show-sql retail               print the generated scoring SQL
  python -m scorebase codegen retail                write the app's schema for this project
"""
import argparse
import json
import sys
import time

from . import (codegen, config, evaluate, generate, ingest, publish, scorer, segments, sqlguard,
               warehouse)


def _step(label: str, fn, as_json: bool = False):
    t = time.perf_counter()
    if as_json:
        print(json.dumps({"step": label, "status": "running"}), flush=True)
    try:
        out = fn()
    except BaseException as e:
        if as_json:
            print(json.dumps({"step": label, "status": "failed", "seconds": round(time.perf_counter() - t, 2),
                              "error": str(e)}), flush=True)
        raise
    secs = round(time.perf_counter() - t, 2)
    if as_json:
        print(json.dumps({"step": label, "status": "ok", "seconds": secs, "result": out}, default=str), flush=True)
    else:
        print(f"  {label:<10} {secs:5.2f}s  {out}")
    return out


def _require_valid(p):
    errs = config.validate(p)
    if errs:
        sys.exit("config errors:\n  " + "\n  ".join(errs))


def cmd_generate(p, args):
    out = p.path(f"data/{p.name}")
    print(generate.generate(out, users=args.users, seed=args.seed))


def cmd_run(p, args):
    _require_valid(p)
    wh = warehouse.connect(p)
    j = args.json
    try:
        if not j:
            print(f"[{p.name}] warehouse={wh.dialect}")
        _step("load", lambda: ingest.run(p, wh), j)
        _step("check", lambda: ingest.check(p, wh), j)
        _step("score", lambda: f"{scorer.run(p, wh)} rows in {p.score_table}", j)
        segs = _step("segments", lambda: segments.run(p, wh), j)
        if not args.no_publish:
            _step("publish", lambda: publish.run(p, wh, segs), j)
            _step("codegen", lambda: "app schema updated" if codegen.write(p, wh) else "app schema unchanged", j)
    finally:
        wh.close()


def cmd_validate(p, args):
    errs = config.validate(p)
    for e in errs:
        print(f"  {e}")
    print(f"{len(errs)} problems" if errs else "config is valid")
    sys.exit(1 if errs else 0)


def cmd_sql(p, args):
    wh = warehouse.connect(p, read_only=True)
    try:
        q = sqlguard.check(args.query, evaluate.allowed_tables(p), wh.dialect)
        cols, rows = wh.query(q)
        print(" | ".join(cols))
        for r in rows[:50]:
            print(" | ".join(str(v) for v in r))
        if len(rows) > 50:
            print(f"... {len(rows)} rows")
    except sqlguard.UnsafeSQL as e:
        sys.exit(f"blocked: {e}")
    finally:
        wh.close()


def cmd_eval(p, args):
    wh = warehouse.connect(p, read_only=True)
    try:
        if args.agent:
            from . import agent_graph
            from .api import load_env_file

            load_env_file(config.ROOT / "app" / ".env")
            llm = agent_graph.default_llm()

            def make(project):
                graph = agent_graph.build(project, llm, lambda sql: _run(wh, project, sql))
                return lambda q: graph.invoke({"question": q})
            res = evaluate.run_agent(p, wh, make)
            for r in res:
                print(f"{'PASS' if r['ok'] else 'FAIL'}  {r['question']}\n      {r['reason']}")
            label = "agent answers match the verified result"
        else:
            res = evaluate.run(p, wh)
            for r in res:
                detail = f"{r['rows']} rows, first={r['first']}" if "rows" in r else r.get("error")
                print(f"{'PASS' if r['ok'] else 'FAIL'}  {r['question']}\n      {detail}")
            label = "golden queries pass"
    finally:
        wh.close()
    passed = sum(r["ok"] for r in res)
    print(f"{passed}/{len(res)} {label}")
    sys.exit(0 if passed == len(res) else 1)


def _run(wh, p, sql):
    cols, rows = wh.query(sqlguard.check(sql, evaluate.allowed_tables(p), wh.dialect))
    return {"columns": cols, "rows": [list(r) for r in rows]}


def cmd_show_sql(p, args):
    print(scorer.build_sql(p))


def cmd_codegen(p, args):
    wh = warehouse.connect(p, read_only=True)
    try:
        print(f"wrote {codegen.OUT}" if codegen.write(p, wh) else "app schema unchanged")
    finally:
        wh.close()


def main(argv=None):
    ap = argparse.ArgumentParser(prog="scorebase")
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate"); g.add_argument("project")
    g.add_argument("--users", type=int, default=20000); g.add_argument("--seed", type=int, default=7)
    r = sub.add_parser("run"); r.add_argument("project"); r.add_argument("--no-publish", action="store_true")
    r.add_argument("--json", action="store_true", help="one JSON line per step, for the app's run log")
    s = sub.add_parser("sql"); s.add_argument("project"); s.add_argument("query")
    e = sub.add_parser("eval"); e.add_argument("project"); e.add_argument("--agent", action="store_true")
    for name in ("validate", "show-sql", "codegen"):
        sub.add_parser(name).add_argument("project")
    args = ap.parse_args(argv)

    p = config.load(args.project)
    {"generate": cmd_generate, "run": cmd_run, "sql": cmd_sql, "eval": cmd_eval, "validate": cmd_validate,
     "show-sql": cmd_show_sql, "codegen": cmd_codegen}[args.cmd](p, args)


if __name__ == "__main__":
    main()
