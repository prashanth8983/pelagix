from pathlib import Path

import pytest
import yaml

from scorebase import config, evaluate, ingest, scorer, segments, sqlguard, warehouse
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
])
def test_guard_blocks(sql):
    with pytest.raises(sqlguard.UnsafeSQL):
        sqlguard.check(sql, TABLES)


def test_guard_allows_ctes_and_joins():
    sql = """WITH v AS (SELECT user_id FROM entity_scores WHERE ltv_decile >= 9)
             SELECT u.state, COUNT(*) FROM v JOIN users u ON u.id = v.user_id GROUP BY 1"""
    sqlguard.check(sql, TABLES)


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
    n = scorer.run(p, wh)
    assert 0 < n <= 800
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
    assert all(r["ok"] for r in evaluate.run(p, wh))


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
    wh = warehouse.connect(p)
    try:
        ingest.run(p, wh)
        assert scorer.run(p, wh) == 2
        _, rows = wh.query("SELECT country, unemployment_change FROM entity_scores ORDER BY country")
        assert rows == [("UK", -0.2), ("US", 0.2)]
    finally:
        wh.close()
