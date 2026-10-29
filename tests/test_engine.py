from pathlib import Path

import pytest
import yaml

from scorebase import api, codegen, config, evaluate, golden, ingest, publish, scorer, segments, sqlguard, warehouse
from scorebase.generate import generate


# ---------- scorer ----------

def test_layers_follow_dependencies_in_any_order():
    scores = [
        {"name": "c", "sql": "a + b"},
        {"name": "a", "sql": "SUM(x)"},
        {"name": "b", "sql": "COUNT(*)"},
        {"name": "d", "sql": "c * 2"},
    ]
    names = [[s["name"] for s in layer] for layer in scorer.layers(scores)]
    assert names == [["a", "b"], ["c"], ["d"]]


def test_layers_reject_cycles():
    with pytest.raises(ValueError, match="cycle"):
        scorer.layers([{"name": "a", "sql": "b + 1"}, {"name": "b", "sql": "a + 1"}])


def test_name_match_is_whole_word():
    # "order_count" must not be read as depending on a score called "order"
    scores = [{"name": "order", "sql": "COUNT(*)"}, {"name": "order_count", "sql": "COUNT(DISTINCT id)"}]
    assert len(scorer.layers(scores)) == 1


def test_literals_and_qualified_columns_are_not_dependencies():
    scores = [{"name": "status", "sql": "MAX(o.status)"},
              {"name": "returns", "sql": "COUNT(*) FILTER (WHERE o.status = 'status')"}]
    assert len(scorer.layers(scores)) == 1


# ---------- sql guard ----------

TABLES = {"entity_scores", "users"}


def test_guard_adds_limit():
    out = sqlguard.check("SELECT user_id FROM entity_scores", TABLES)
    assert "LIMIT 500" in out


@pytest.mark.parametrize("sql", [
    "DELETE FROM entity_scores",
    "DROP TABLE users",
    "SELECT 1; DROP TABLE users",
    "UPDATE users SET age = 1",
    "SELECT * FROM secrets",
    "COPY (SELECT * FROM users) TO '/tmp/out.csv'",
    "INSERT INTO users SELECT * FROM users",
    "SELECT * INTO copy_of_users FROM users",
    "SELECT * FROM read_csv('/etc/passwd')",
    "SELECT * FROM read_text('/etc/passwd')",
    "SELECT * FROM '/etc/passwd'",
    "SELECT current_setting('home_directory')",
    "SELECT * FROM other_db.main.users",
    "SELECT * FROM information_schema.tables",
])
def test_guard_blocks(sql):
    with pytest.raises(sqlguard.UnsafeSQL):
        sqlguard.check(sql, TABLES)


@pytest.mark.parametrize("sql", [
    "SELECT user_id FROM entity_scores UNION ALL SELECT id FROM users",
    "SELECT user_id FROM entity_scores LIMIT 100000",
])
def test_guard_caps_rows_everywhere(sql):
    assert sqlguard.check(sql, TABLES).endswith("LIMIT 500")


def test_guard_returns_readable_sql():
    out = sqlguard.check("select user_id, ltv from entity_scores where ltv > 1 order by ltv desc", TABLES)
    assert out.splitlines() == ["SELECT", "  user_id,", "  ltv", "FROM entity_scores", "WHERE", "  ltv > 1",
                                "ORDER BY", "  ltv DESC", "LIMIT 500"]


def test_format_leaves_broken_sql_alone():
    assert sqlguard.format_sql("SELECT FROM WHERE (") == "SELECT FROM WHERE ("


def test_guard_keeps_a_smaller_limit():
    assert sqlguard.check("SELECT * FROM users LIMIT 10", TABLES).endswith("LIMIT 10")


def test_guard_allows_ctes_and_joins():
    sql = """WITH v AS (SELECT user_id FROM entity_scores WHERE ltv_decile >= 9)
             SELECT u.state, COUNT(*) FROM v JOIN users u ON u.id = v.user_id GROUP BY 1"""
    sqlguard.check(sql, TABLES)


# ---------- golden matching ----------

GOLDEN = config.load("retail").golden


@pytest.mark.parametrize("q", [
    "Who are my VIP customers?",
    "how many customers are at risk",
    "Which traffic source brings the highest lifetime value?",
    "Show high-value customers who haven’t ordered in 60 days",
])
def test_golden_answers_rephrasings(q):
    assert golden.match(GOLDEN, q)["verified"]


@pytest.mark.parametrize("q", [
    "How many customers are not at risk of leaving?",   # negation
    "How many VIP customers are in Texas?",            # extra filter
    "Who are my worst customers?",                     # different meaning
    "customers",                                       # too vague
])
def test_golden_refuses_near_misses(q):
    m = golden.match(GOLDEN, q)
    assert m is None or not m["verified"]


# ---------- config ----------

def test_retail_config_is_valid():
    assert config.validate(config.load("retail")) == []


def test_validation_catches_bad_references():
    p = config.load("retail")
    p.segments = [{"name": "x", "rules": [{"column": "nope", "op": ">", "value": 1}]}]
    p.project = {**p.project, "display": {"highlight": "missing"}}
    errs = config.validate(p)
    assert any("nope" in e for e in errs) and any("missing" in e for e in errs)


def test_validation_catches_bad_shapes():
    from scorebase import schema

    assert schema.errors("sources", [{"name": "x", "connector": "postgres"}])
    assert schema.errors("sources", [{"name": "x", "path": "a.csv", "mode": "incremental"}])
    assert schema.errors("segments", [{"name": "x", "rules": [{"column": "a", "op": "LIKE", "value": 1}]}])
    assert schema.errors("scores", {"from": "t", "key_expr": "k", "scores": [{"name": "a", "sql": "1"}] * 2})


def test_save_keeps_history_and_sql_blocks(tmp_path):
    import shutil

    d = tmp_path / "retail"
    shutil.copytree(config.find("retail"), d)
    p = config.load(str(d))
    p.golden.append({"question": "How many orders?", "sql": "SELECT COUNT(*)\nFROM orders"})
    assert config.save(p, "golden", p.golden) == []
    assert "|" in (d / "golden.yaml").read_text()
    assert config.load(str(d)).golden[-1]["sql"].startswith("SELECT COUNT(*)\nFROM orders")
    assert len(config.history(p, "golden")) == 1
    assert config.save(p, "golden", [{"question": "x"}])  # invalid: nothing written
    assert len(config.load(str(d)).golden) == len(p.golden)


# ---------- eval ----------

def test_same_result_ignores_names_order_and_extra_columns():
    expected = (["n", "src"], [(3, "a"), (5, "b")])
    assert evaluate.same_result(expected, (["source", "count", "x"], [("b", 5.0, 1), ("a", 3, 1)]))[0]
    assert not evaluate.same_result(expected, (["src", "n"], [("a", 3), ("b", 6)]))[0]
    assert not evaluate.same_result(expected, (["src", "n"], [("a", 3)]))[0]


def test_publish_types_come_from_the_warehouse():
    assert publish.pg_type("BIGINT") == "bigint"
    assert publish.pg_type("DECIMAL(18,2)") == "numeric"
    assert publish.pg_type("NUMBER(38,0)") == "bigint"
    assert publish.pg_type("TIMESTAMP WITH TIME ZONE") == "timestamptz"
    assert publish.pg_type("VARCHAR") == "text"


# ---------- end to end, retail ----------

@pytest.fixture(scope="module")
def retail(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("retail")
    src = config.load("retail")
    generate(tmp / "data", users=800, seed=1)
    src.project["warehouse"] = {"kind": "duckdb", "path": str(tmp / "wh.duckdb")}
    src.sources = [{**s, "path": str(tmp / "data" / Path(s["path"]).name)} for s in src.sources]
    wh = warehouse.connect(src)
    yield src, wh
    wh.close()


def test_retail_pipeline(retail):
    p, wh = retail
    counts = ingest.run(p, wh)
    assert counts["users"] == 800
    ingest.check(p, wh)
    n = scorer.run(p, wh)
    assert n == 800, "every user gets a row, buyers or not"
    _, rows = wh.query("SELECT COUNT(*) FROM entity_scores WHERE order_count = 0 AND total_spend = 0 AND ltv = 0")
    assert rows[0][0] > 0, "non-buyers get their scores' defaults"
    _, rows = wh.query("SELECT MIN(churn_risk), MAX(churn_risk), MIN(ltv_decile), MAX(ltv_decile) FROM entity_scores")
    lo, hi, dmin, dmax = rows[0]
    assert 0 <= lo <= hi <= 1
    assert (dmin, dmax) == (1, 10)
    _, rows = wh.query("SELECT COUNT(*) FROM entity_scores WHERE ltv < total_spend")
    assert rows[0][0] == 0, "ltv can never be below what was already spent"


def test_retail_segments_and_golden(retail):
    p, wh = retail
    segs = segments.run(p, wh)
    sizes = {s["name"]: s["size"] for s in segs}
    assert sizes["vip_lapsing"] <= sizes["vip"]
    assert sizes["all"] == 800
    assert all(r["ok"] for r in evaluate.run(p, wh))


def test_codegen_matches_the_score_table(retail):
    p, wh = retail
    ts = codegen.render(p, wh)
    assert 'table("entity_scores")' in ts and 'primaryKey("user_id")' in ts
    assert "churn_risk: number().optional()," in ts
    assert '"highlight": "churn_risk"' in ts


# The two tests below need the writer closed, so they run last among the retail tests.
def test_read_only_connection_cannot_touch_files(retail, tmp_path):
    p, wh = retail
    wh.close()
    ro = warehouse.connect(p, read_only=True)
    try:
        with pytest.raises(Exception, match="disabled"):
            ro.query(f"COPY (SELECT 1) TO '{tmp_path / 'x.csv'}'")
        with pytest.raises(Exception):
            ro.query("CREATE TABLE x AS SELECT 1")
    finally:
        ro.close()


def test_api_query_blocks_and_caps(retail):
    p, _ = retail
    with pytest.raises(sqlguard.UnsafeSQL):
        api.run_query(p, "COPY (SELECT 1) TO '/tmp/x.csv'")
    out = api.run_query(p, "SELECT user_id FROM entity_scores UNION ALL SELECT user_id FROM entity_scores")
    assert len(out["rows"]) == 500


# ---------- the same engine on a different domain ----------

def test_engine_is_generic(tmp_path):
    """Score countries from labor statistics with no engine changes, only config."""
    (tmp_path / "observations.csv").write_text(
        "country,indicator,period,value\n"
        "US,unemployment_rate,2026-01-01,4.1\nUS,unemployment_rate,2026-02-01,4.3\n"
        "UK,unemployment_rate,2026-01-01,4.4\nUK,unemployment_rate,2026-02-01,4.2\n"
        "US,avg_wage,2026-02-01,35.1\nUK,avg_wage,2026-02-01,22.9\n"
    )
    cfg = tmp_path / "labor"
    cfg.mkdir()
    (cfg / "project.yaml").write_text(yaml.safe_dump({
        "entity": "country", "key": "country",
        "warehouse": {"kind": "duckdb", "path": str(tmp_path / "labor.duckdb")},
        "publish": {"table": "entity_scores"},
    }))
    (cfg / "sources.yaml").write_text(yaml.safe_dump([
        {"name": "observations", "connector": "csv", "path": str(tmp_path / "observations.csv")}]))
    (cfg / "scores.yaml").write_text(yaml.safe_dump({
        "from": "observations", "key_expr": "country",
        "scores": [
            {"name": "latest_unemployment",
             "sql": "ARG_MAX(value, period) FILTER (WHERE indicator = 'unemployment_rate')"},
            {"name": "first_unemployment",
             "sql": "ARG_MIN(value, period) FILTER (WHERE indicator = 'unemployment_rate')"},
            {"name": "unemployment_change", "sql": "ROUND(latest_unemployment - first_unemployment, 2)"},
        ],
    }))
    p = config.load(str(cfg))
    assert config.validate(p) == []
    wh = warehouse.connect(p)
    try:
        ingest.run(p, wh)
        assert scorer.run(p, wh) == 2
        _, rows = wh.query("SELECT country, unemployment_change FROM entity_scores ORDER BY country")
        assert rows == [("UK", -0.2), ("US", 0.2)]
    finally:
        wh.close()


# ---------- sources ----------

def _source_project(tmp_path, sources):
    cfg = tmp_path / "cfg"
    cfg.mkdir(exist_ok=True)
    (cfg / "project.yaml").write_text(yaml.safe_dump({
        "key": "k", "warehouse": {"kind": "duckdb", "path": str(tmp_path / "w.duckdb")}}))
    (cfg / "sources.yaml").write_text(yaml.safe_dump(sources))
    return config.load(str(cfg))


def test_globs_reader_options_and_incremental(tmp_path):
    (tmp_path / "a_1.csv").write_text("id;at\n1;2026-01-01\n2;2026-01-02\n")
    (tmp_path / "a_2.csv").write_text("id;at\n3;2026-01-03\n")
    src = {"name": "events", "connector": "csv", "path": str(tmp_path / "a_*.csv"),
           "options": {"delim": ";", "header": True}, "mode": "incremental", "cursor": "at"}
    p = _source_project(tmp_path, [src])
    wh = warehouse.connect(p)
    try:
        assert ingest.run(p, wh) == {"events": 3}
        (tmp_path / "a_3.csv").write_text("id;at\n4;2026-01-04\n")
        assert wh.load_source(src, src["path"]) == {"rows": 4, "added": 1}
        assert wh.load_source(src, src["path"]) == {"rows": 4, "added": 0}
    finally:
        wh.close()


def test_checks_stop_the_run(tmp_path):
    (tmp_path / "u.csv").write_text("id,email\n1,a\n1,\n")
    p = _source_project(tmp_path, [{"name": "u", "path": str(tmp_path / "u.csv"),
                                    "checks": {"columns": ["id", "plan"], "not_null": ["email"],
                                               "unique": ["id"], "min_rows": 5}}])
    wh = warehouse.connect(p)
    try:
        ingest.run(p, wh)
        with pytest.raises(ingest.CheckFailed) as e:
            ingest.check(p, wh)
        msg = str(e.value)
        assert all(s in msg for s in ["missing column plan", "1 nulls", "1 duplicate", "at least 5"])
    finally:
        wh.close()
