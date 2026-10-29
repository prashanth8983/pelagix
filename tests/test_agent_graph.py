"""The LangGraph agent's control flow, with a scripted fake model (no network, no key)."""
from langchain_core.language_models.fake_chat_models import FakeListChatModel

from scorebase import agent_graph, config


def _project():
    p = config.load("retail")
    return p


def test_retries_after_guard_rejects_unsafe_sql():
    llm = FakeListChatModel(responses=[
        "```sql\nDELETE FROM entity_scores\n```",                      # attempt 1: blocked by the guard
        "```sql\nSELECT COUNT(*) AS n FROM entity_scores\n```",        # attempt 2: fine
        "There are 42 customers.",                                    # summary
    ])
    seen = []
    graph = agent_graph.build(_project(), llm, lambda sql: seen.append(sql) or {"columns": ["n"], "rows": [[42]]})
    out = graph.invoke({"question": "how many customers?"})
    assert out["attempts"] == 2
    assert out["rows"] == [[42]]
    assert out["answer"] == "There are 42 customers."
    assert len(seen) == 1 and "LIMIT" in seen[0], "only the guarded query reaches the warehouse"
    assert out["trace"][:3] == ["write_sql #1", "check: only SELECT queries are allowed", "write_sql #2"]


def test_feeds_warehouse_errors_back_then_gives_up():
    llm = FakeListChatModel(responses=["SELECT nope FROM entity_scores"] * 3)

    def broken(sql):
        raise RuntimeError('column "nope" not found')

    out = agent_graph.build(_project(), llm, broken).invoke({"question": "x"})
    assert out["attempts"] == agent_graph.MAX_ATTEMPTS
    assert out["trace"][-1] == "give_up"
    assert "nope" in out["answer"]
