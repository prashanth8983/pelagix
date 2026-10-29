"""The engine API over HTTP (FastAPI test client), against a throwaway copy of the retail project."""
import shutil

import pytest
import yaml
from fastapi.testclient import TestClient

from scorebase import api, config, ingest, scorer, warehouse
from scorebase.generate import generate

TOKEN = "test-token-123"


@pytest.fixture(scope="module")
def monkeypatch_module():
    mp = pytest.MonkeyPatch()
    yield mp
    mp.undo()


@pytest.fixture(scope="module")
def client(tmp_path_factory, monkeypatch_module):
    tmp = tmp_path_factory.mktemp("api")
    d = tmp / "retail"
    shutil.copytree(config.find("retail"), d, ignore=shutil.ignore_patterns(".history"))
    generate(tmp / "data", users=300, seed=2)
    proj = yaml.safe_load((d / "project.yaml").read_text())
    proj["warehouse"]["path"] = str(tmp / "wh.duckdb")
    (d / "project.yaml").write_text(yaml.safe_dump(proj))
    sources = yaml.safe_load((d / "sources.yaml").read_text())
    for s in sources:
        s["path"] = str(tmp / "data" / s["path"].split("/")[-1])
    (d / "sources.yaml").write_text(yaml.safe_dump(sources))

    p = config.load(str(d))
    wh = warehouse.connect(p)
    ingest.run(p, wh)
    scorer.run(p, wh)
    wh.close()

    monkeypatch_module.setenv("SCOREBASE_API_TOKEN", TOKEN)
    monkeypatch_module.delenv("SCOREBASE_PG_URL", raising=False)
    with TestClient(api.create_app(str(d)), raise_server_exceptions=False) as c:
        c.headers["Authorization"] = f"Bearer {TOKEN}"
        yield c, d


def test_token_is_required(client):
    c, _ = client
    assert c.get("/health", headers={"Authorization": ""}).status_code == 401
    assert c.get("/health", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert c.get("/health").status_code == 200


def test_request_id_is_echoed_or_made(client):
    c, _ = client
    assert c.get("/health", headers={"X-Request-Id": "abc123"}).headers["X-Request-Id"] == "abc123"
    assert len(c.get("/health").headers["X-Request-Id"]) == 32


def test_ready_opens_the_warehouse(client):
    c, _ = client
    r = c.get("/ready")
    assert (r.status_code, r.json()) == (200, {"ok": True})


def test_openapi_is_served(client):
    c, _ = client
    paths = c.get("/openapi.json").json()["paths"]
    assert "/query" in paths and "/config/{section}" in paths


def test_query_is_guarded(client):
    c, _ = client
    r = c.post("/query", json={"sql": "COPY (SELECT 1) TO '/tmp/x.csv'"})
    assert r.status_code == 400 and r.json()["error"].startswith("blocked")
    r = c.post("/query", json={"sql": "SELECT COUNT(*) AS n FROM entity_scores"})
    assert r.status_code == 200 and r.json()["rows"] == [[300]]
    assert c.post("/query", json={}).status_code == 422
    assert c.get("/runs/nope").status_code == 404


def test_save_validates_then_keeps_history(client):
    c, d = client
    r = c.put("/config/segments", json={"data": [{"name": "x", "rules": [{"column": "nope", "op": ">", "value": 1}]}]})
    assert r.status_code == 422 and any("nope" in e for e in r.json()["errors"])
    segs = c.get("/config").json()["segments"]
    segs.append({"name": "big", "label": "Big", "match": "any",
                 "rules": [{"column": "ltv", "op": ">", "value": 1000}, {"column": "state", "op": "in", "value": ["Texas"]}]})
    assert c.put("/config/segments", json={"data": segs}).status_code == 200
    assert c.get("/config").json()["segments"][-1]["name"] == "big"
    assert len(c.get("/config/segments/history").json()) == 1


def test_segment_preview_counts(client):
    c, _ = client
    r = c.post("/preview/segment", json={"rules": [{"column": "state", "op": "=", "value": "Texas"}]}).json()
    assert 0 < r["size"] < r["total"] and r["where"] == "state = 'Texas'"
    r = c.post("/preview/segment", json={"match": "any", "rules": [
        {"column": "state", "op": "=", "value": "Texas"}, {"column": "state", "op": "=", "value": "Florida"}]}).json()
    assert "OR" in r["where"]
    assert c.post("/preview/segment", json={"rules": [{"column": "state", "op": "in", "value": 3}]}).json()["errors"]


def test_distribution_bins(client):
    c, _ = client
    r = c.post("/distribution", json={"column": "ltv", "bins": 10})
    assert r.status_code == 200
    bins = [row[0] for row in r.json()["rows"]]
    assert bins == sorted(bins) and max(bins) <= 9
    assert c.post("/distribution", json={"column": "state"}).status_code == 400


def test_source_preview_refuses_paths_outside_data(client):
    c, _ = client
    r = c.post("/preview/source", json={"source": {"name": "x", "connector": "csv", "path": "/etc/passwd"}})
    assert r.status_code == 403 and "must be under" in r.json()["error"]
    r = c.post("/preview/source", json={"source": {"name": "x", "connector": "csv", "path": "https://example.com/a.csv"}})
    assert r.status_code == 403 and "SCOREBASE_REMOTE_SOURCES" in r.json()["error"]


def test_scores_preview_has_stats(client):
    c, _ = client
    r = c.post("/preview/scores", json={}).json()
    assert "error" not in r and len(r["rows"]) == 20
    by = {s["column_name"]: s for s in r["stats"]}
    assert 0 <= by["churn_risk"]["min"] <= by["churn_risk"]["max"] <= 1
    assert by["last_order_at"]["avg"] is None, "dates have no average"
    assert any(p["group"] == 1 for p in r["plan"]), "the events score comes from a second source group"
