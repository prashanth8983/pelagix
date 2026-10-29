"""Scoring from several sources, attributes, history, segment rules and the source path policy."""
import os

import pytest
import yaml

from scorebase import config, ingest, scorer, segments, warehouse


def _project(tmp_path, **overrides):
    (tmp_path / "customers.csv").write_text("id,plan,region\n1,pro,EU\n2,free,US\n3,pro,US\n")
    (tmp_path / "orders.csv").write_text("id,customer_id,amount\n1,1,10\n2,1,20\n3,3,5\n")
    (tmp_path / "tickets.csv").write_text("id,customer_id,hours\n1,2,4\n2,2,2\n")
    cfg = tmp_path / "cfg"
    cfg.mkdir(exist_ok=True)
    project = {"entity": "customer", "key": "customer_id", "entity_table": "customers", "entity_key": "id",
               "attributes": ["plan", "region"],
               "warehouse": {"kind": "duckdb", "path": str(tmp_path / "w.duckdb")},
               "publish": {"history": True}, **overrides}
    (cfg / "project.yaml").write_text(yaml.safe_dump(project))
    (cfg / "sources.yaml").write_text(yaml.safe_dump([
        {"name": "customers", "path": str(tmp_path / "customers.csv")},
        {"name": "orders", "path": str(tmp_path / "orders.csv")},
        {"name": "tickets", "path": str(tmp_path / "tickets.csv")},
    ]))
    (cfg / "scores.yaml").write_text(yaml.safe_dump({
        "from": "orders o", "key_expr": "o.customer_id",
        "scores": [
            {"name": "spend", "sql": "SUM(o.amount)", "default": 0},
            {"name": "orders", "sql": "COUNT(*)", "default": 0},
            {"name": "support_hours", "sql": "SUM(t.hours)", "default": 0,
             "from": "tickets t", "key_expr": "t.customer_id"},
            {"name": "cost_ratio", "sql": "support_hours / NULLIF(spend, 0)"},
        ],
    }))
    (cfg / "segments.yaml").write_text(yaml.safe_dump([
        {"name": "pro_us", "rules": [{"column": "plan", "op": "=", "value": "pro"}, {"column": "region", "op": "in", "value": ["US"]}]},
        {"name": "any", "match": "any", "rules": [{"column": "spend", "op": ">", "value": 25}, {"column": "support_hours", "op": ">", "value": 0}]},
        {"name": "no_ratio", "rules": [{"column": "cost_ratio", "op": "is_null"}]},
    ]))
    return config.load(str(cfg))


def test_scores_from_two_sources_with_attributes_and_history(tmp_path):
    p = _project(tmp_path)
    assert config.validate(p) == []
    plan = {s["name"]: s for s in scorer.plan(p)}
    assert plan["spend"]["group"] == 0 and plan["support_hours"]["group"] == 1
    assert plan["cost_ratio"]["layer"] == 1 and plan["cost_ratio"]["group"] is None
    sql = scorer.build_select(p)
    assert "FULL OUTER JOIN" in sql and "e.plan" in sql
    wh = warehouse.connect(p)
    try:
        ingest.run(p, wh)
        out = scorer.run(p, wh)
        assert out["rows"] == 3 and out["history_rows"] == 3
        _, rows = wh.query("SELECT customer_id, plan, region, spend, orders, support_hours FROM entity_scores ORDER BY 1")
        assert rows == [(1, "pro", "EU", 10 + 20, 2, 0), (2, "free", "US", 0, 0, 6), (3, "pro", "US", 5, 1, 0)]
        sizes = {s["name"]: s["size"] for s in segments.run(p, wh)}
        assert sizes == {"pro_us": 1, "any": 2, "no_ratio": 1}
        assert scorer.run(p, wh)["history_rows"] == 6, "each run appends every entity to the history table"
    finally:
        wh.close()


def test_history_table_gains_new_score_columns(tmp_path):
    p = _project(tmp_path)
    wh = warehouse.connect(p)
    try:
        ingest.run(p, wh)
        scorer.run(p, wh)
        p.scores["scores"].append({"name": "big", "sql": "spend > 10"})
        scorer.run(p, wh)
        cols = [c for c, _ in wh.describe("entity_scores_history")]
        assert "big" in cols
    finally:
        wh.close()


def test_validation_of_new_shapes():
    from scorebase import schema

    assert not schema.errors("segments", [{"name": "a", "match": "any", "rules": [{"column": "x", "op": "is_null"}]}])
    assert schema.errors("segments", [{"name": "a", "rules": [{"column": "x", "op": "is_null", "value": 1}]}])
    assert schema.errors("segments", [{"name": "a", "rules": [{"column": "x", "op": "in", "value": "a"}]}])
    assert schema.errors("segments", [{"name": "a", "rules": [{"column": "x", "op": ">", "value": [1]}]}])
    assert schema.errors("segments", [{"name": "a", "rules": [{"column": "x", "op": ">", "value": True}]}])
    assert schema.errors("scores", {"from": "t", "key_expr": "k", "scores": [{"name": "a", "sql": "1", "from": "u"}]})
    assert schema.errors("scores", {"from": "t", "key_expr": "k", "scores": [{"name": "a", "sql": "1", "where": "x"}]})
    assert schema.errors("project", {"key": "k", "attributes": ["bad name"]})
    assert schema.errors("sources", [{"name": "x", "connector": "postgres", "dsn_env": "SECRET", "table": "t"}])
    p = config.load("retail")
    p.project = {**p.project, "attributes": ["ltv"]}
    assert any("also a score" in e for e in config.validate(p))


def test_segment_sql_forms():
    cols = {"a", "s"}
    assert segments.to_sql([], cols) == "TRUE"
    assert segments.to_sql([{"column": "s", "op": "=", "value": "O'Neil"}], cols) == "s = 'O''Neil'"
    assert segments.to_sql([{"column": "a", "op": ">", "value": 1}, {"column": "s", "op": "not_in", "value": ["x", "y"]}], cols, "any") \
        == "(a > 1) OR (s NOT IN ('x', 'y'))"
    assert segments.to_sql([{"column": "a", "op": "is_not_null"}], cols) == "a IS NOT NULL"
    with pytest.raises(ValueError):
        segments.to_sql([{"column": "zzz", "op": "=", "value": 1}], cols)
    with pytest.raises(ValueError):
        segments.to_sql([{"column": "a", "op": "=", "value": None}], cols)


def test_source_paths_are_confined(tmp_path, monkeypatch):
    p = _project(tmp_path)
    monkeypatch.setenv("SCOREBASE_SOURCE_DIRS", str(tmp_path / "elsewhere"))
    with pytest.raises(ingest.SourceNotAllowed):
        ingest.location(p, {"name": "x", "path": str(tmp_path / "customers.csv")})
    with pytest.raises(ingest.SourceNotAllowed):
        ingest.location(p, {"name": "x", "path": "data/../../etc/passwd"})
    with pytest.raises(ingest.SourceNotAllowed):
        ingest.location(p, {"name": "x", "path": "https://example.com/x.csv"})
    monkeypatch.setenv("SCOREBASE_REMOTE_SOURCES", "s3://my-bucket/, https://example.com/")
    assert ingest.location(p, {"name": "x", "path": "https://example.com/x.csv"}) == "https://example.com/x.csv"
    monkeypatch.setenv("SCOREBASE_SOURCE_DIRS", str(tmp_path))
    assert ingest.location(p, {"name": "x", "path": str(tmp_path / "customers.csv")}).endswith("customers.csv")
    assert ingest.location(p, {"name": "x", "path": str(tmp_path / "*.csv")}).endswith("*.csv")


def test_init_scaffolds_a_valid_project(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ROOT", tmp_path)
    d = config.init("demo")
    assert d == tmp_path / "configs" / "demo"
    assert config.validate(config.load(str(d))) == []
    with pytest.raises(SystemExit):
        config.init("demo")


def test_agent_prompt_keeps_the_closest_examples():
    from scorebase import agent_graph

    p = config.load("retail")
    p.golden = [{"question": f"Question number {i} about {w}", "sql": "SELECT 1"} for i, w in enumerate(["apples"] * 10 + ["churn"])]
    text = agent_graph.describe_model(p, "what is the churn situation?")
    assert "about churn" in text and text.count("Q: ") == agent_graph.MAX_EXAMPLES


# ---------- Postgres warehouse ----------

PG = os.environ.get("SCOREBASE_TEST_PG_URL")


@pytest.mark.skipif(not PG, reason="set SCOREBASE_TEST_PG_URL to test the Postgres warehouse")
def test_postgres_warehouse_end_to_end(tmp_path, monkeypatch):
    monkeypatch.setenv("SCOREBASE_WAREHOUSE_URL", PG)
    p = _project(tmp_path, warehouse={"kind": "postgres", "schema": "sb_test_wh"})
    wh = warehouse.connect(p)
    try:
        wh.execute("DROP SCHEMA IF EXISTS sb_test_wh CASCADE; CREATE SCHEMA sb_test_wh")
        assert ingest.run(p, wh) == {"customers": 3, "orders": 3, "tickets": 2}
        ingest.check(p, wh)
        assert dict(wh.describe("orders"))["amount"] in ("integer", "bigint", "numeric")
        out = scorer.run(p, wh)
        assert out["rows"] == 3
        cols, rows = wh.query("SELECT customer_id, plan, spend, support_hours FROM entity_scores ORDER BY 1")
        assert [tuple(float(x) if i in (2, 3) else x for i, x in enumerate(r)) for r in rows] \
            == [(1, "pro", 30.0, 0.0), (2, "free", 0.0, 6.0), (3, "pro", 5.0, 0.0)]
        sizes = {s["name"]: s["size"] for s in segments.run(p, wh)}
        assert sizes == {"pro_us": 1, "any": 2, "no_ratio": 1}
        # incremental load appends only rows past the cursor
        (tmp_path / "orders.csv").write_text("id,customer_id,amount\n1,1,10\n2,1,20\n3,3,5\n4,2,7\n")
        src = {"name": "orders", "path": str(tmp_path / "orders.csv"), "mode": "incremental", "cursor": "id"}
        assert wh.load_source(src, src["path"]) == {"rows": 4, "added": 1}
        with pytest.raises(warehouse.Timeout):
            wh.query("SELECT pg_sleep(2)", timeout=0.2)
        ro = warehouse.connect(p, read_only=True)
        try:
            with pytest.raises(Exception, match="read-only"):
                ro.query("CREATE TABLE sb_test_wh.x AS SELECT 1")
        finally:
            ro.close()
    finally:
        wh.execute("DROP SCHEMA IF EXISTS sb_test_wh CASCADE")
        wh.close()
