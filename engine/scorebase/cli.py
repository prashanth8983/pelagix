"""scorebase CLI.

  python -m scorebase generate retail [--users N]   synthetic TheLook-shaped files
  python -m scorebase run retail [--no-publish]     load -> score -> segments -> publish
  python -m scorebase sql retail "SELECT ..."       run a guarded read-only query
  python -m scorebase eval retail                    check every golden query
  python -m scorebase show-sql retail                print the generated scoring SQL
"""
import argparse
import sys
import time

from . import config, evaluate, generate, ingest, publish, scorer, segments, sqlguard, warehouse


def _step(label: str, fn):
    t = time.perf_counter()
    out = fn()
    print(f"  {label:<10} {time.perf_counter() - t:5.2f}s  {out}")
    return out


def cmd_generate(p, args):
    out = p.path(f"data/{p.name}")
    print(generate.generate(out, users=args.users, seed=args.seed))


def cmd_run(p, args):
    wh = warehouse.connect(p)
    try:
        print(f"[{p.name}] warehouse={wh.dialect}")
        _step("load", lambda: ingest.run(p, wh))
        _step("score", lambda: f"{scorer.run(p, wh)} rows in {p.score_table}")
        segs = _step("segments", lambda: segments.run(p, wh))
        if not args.no_publish:
            _step("publish", lambda: publish.run(p, wh, segs))
    finally:
        wh.close()


def cmd_sql(p, args):
    wh = warehouse.connect(p)
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
    wh = warehouse.connect(p)
    try:
        res = evaluate.run(p, wh)
    finally:
        wh.close()
    for r in res:
        mark = "PASS" if r["ok"] else "FAIL"
        detail = f"{r['rows']} rows, first={r['first']}" if "rows" in r else r.get("error")
        print(f"{mark}  {r['question']}\n      {detail}")
    passed = sum(r["ok"] for r in res)
    print(f"{passed}/{len(res)} golden queries pass")
    sys.exit(0 if passed == len(res) else 1)


def cmd_show_sql(p, args):
    print(scorer.build_sql(p))


def main(argv=None):
    ap = argparse.ArgumentParser(prog="scorebase")
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate"); g.add_argument("project")
    g.add_argument("--users", type=int, default=20000); g.add_argument("--seed", type=int, default=7)
    r = sub.add_parser("run"); r.add_argument("project"); r.add_argument("--no-publish", action="store_true")
    s = sub.add_parser("sql"); s.add_argument("project"); s.add_argument("query")
    sub.add_parser("eval").add_argument("project")
    sub.add_parser("show-sql").add_argument("project")
    args = ap.parse_args(argv)

    p = config.load(args.project)
    {"generate": cmd_generate, "run": cmd_run, "sql": cmd_sql, "eval": cmd_eval,
     "show-sql": cmd_show_sql}[args.cmd](p, args)


if __name__ == "__main__":
    main()
