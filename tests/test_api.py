"""The engine API over real HTTP, against a throwaway copy of the retail project."""
import json
import shutil
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest
import yaml

from scorebase import api, config, ingest, scorer, warehouse
from scorebase.generate import generate

TOKEN = "test-token-123"


@pytest.fixture(scope="module")
def server(tmp_path_factory, monkeypatch_module):
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
    srv = ThreadingHTTPServer(("127.0.0.1", 0), api.make_handler(str(d)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}", d
    srv.shutdown()


@pytest.fixture(scope="module")
def monkeypatch_module():
    mp = pytest.MonkeyPatch()
    yield mp
    mp.undo()


def call(base, path, body=None, method=None, token=TOKEN, headers=None):
    req = urllib.request.Request(base + path, method=method or ("POST" if body is not None else "GET"),
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **(headers or {}),
                                          **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read()), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read()), dict(e.headers)


def test_token_is_required(server):
    base, _ = server
    assert call(base, "/health", token=None)[0] == 401
    assert call(base, "/health", token="wrong")[0] == 401
    assert call(base, "/health")[0] == 200


def test_request_id_is_echoed_or_made(server):
    base, _ = server
    assert call(base, "/health", headers={"X-Request-Id": "abc123"})[2]["X-Request-Id"] == "abc123"
    assert len(call(base, "/health")[2]["X-Request-Id"]) == 32


def test_ready_opens_the_warehouse(server):
    base, _ = server
    assert call(base, "/ready")[:2] == (200, {"ok": True})


def test_query_is_guarded(server):
    base, _ = server
    code, body, _ = call(base, "/query", {"sql": "COPY (SELECT 1) TO '/tmp/x.csv'"})
    assert code == 400 and body["error"].startswith("blocked")
    code, body, _ = call(base, "/query", {"sql": "SELECT COUNT(*) AS n FROM entity_scores"})
    assert code == 200 and body["rows"] == [[300]]


def test_save_validates_then_keeps_history(server):
    base, d = server
    code, body, _ = call(base, "/config/segments", {"data": [{"name": "x", "rules": [{"column": "nope", "op": ">", "value": 1}]}]}, "PUT")
    assert code == 422 and any("nope" in e for e in body["errors"])
    _, cfg, _ = call(base, "/config")
    segs = cfg["segments"] + [{"name": "big", "label": "Big", "rules": [{"column": "ltv", "op": ">", "value": 1000}]}]
    assert call(base, "/config/segments", {"data": segs}, "PUT")[0] == 200
    assert call(base, "/config")[1]["segments"][-1]["name"] == "big"
    assert len(call(base, "/config/segments/history")[1]) == 1
