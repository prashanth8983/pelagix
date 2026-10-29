"""Text-to-SQL as an explicit LangGraph graph.

    write_sql ──► check ──fail──► write_sql (with the error, up to MAX_ATTEMPTS)
                    │ pass
                    ▼
                 execute ──error──► write_sql
                    │ rows
                    ▼
                 summarize ──► END

Every step is a node, so a failure is visible: which SQL was tried, why the guard or
the warehouse rejected it, and how many attempts it took.
"""
import os
import re
from typing import Any, Callable, TypedDict

from langgraph.graph import END, START, StateGraph

from . import evaluate, sqlguard

MAX_ATTEMPTS = 3


class State(TypedDict, total=False):
    question: str
    sql: str
    error: str
    attempts: int
    columns: list[str]
    rows: list[list[Any]]
    answer: str
    trace: list[str]


def describe_model(project) -> str:
    """The semantic layer as prompt text (same content the Mastra agent gets)."""
    m = project.model
    tables = "\n".join(
        f"  {name} -- {t.get('description', '')}\n"
        + "\n".join(f"    {c}: {d}" for c, d in t.get("columns", {}).items())
        for name, t in m.get("tables", {}).items()
    )
    joins = "\n".join(f"  {j}" for j in m.get("joins", []))
    terms = "\n".join(f'  "{k}" means {v}' for k, v in m.get("synonyms", {}).items())
    examples = "\n\n".join(f"Q: {g['question']}\nSQL:\n{g['sql'].strip()}" for g in project.golden)
    return f"TABLES\n{tables}\n\nJOINS\n{joins}\n\nBUSINESS TERMS\n{terms}\n\nVERIFIED EXAMPLES\n{examples}"


def _extract_sql(text: str) -> str:
    m = re.search(r"```(?:sql)?\s*(.+?)```", text, re.S | re.I)
    return (m.group(1) if m else text).strip().rstrip(";")


def build(project, llm, run_query: Callable[[str], dict]):
    """llm: any LangChain chat model. run_query(sql) -> {columns, rows} or raises."""
    context = describe_model(project)
    tables = evaluate.allowed_tables(project)
    entity = project.project.get("entity", "entity")

    def write_sql(s: State) -> State:
        retry = ""
        if s.get("error"):
            retry = f"\n\nYour previous SQL:\n{s['sql']}\nfailed with: {s['error']}\nFix it."
        prompt = (
            f"Write one DuckDB SELECT that answers a marketer's question about {entity}s.\n"
            f"Prefer the precomputed {project.score_table} table. Use business terms exactly as defined. "
            "Never invent tables or columns. Reply with only the SQL in a ```sql block.\n\n"
            f"{context}\n\nQUESTION: {s['question']}{retry}"
        )
        sql = _extract_sql(llm.invoke(prompt).content)
        n = s.get("attempts", 0) + 1
        return {"sql": sql, "attempts": n, "error": "", "trace": s.get("trace", []) + [f"write_sql #{n}"]}

    def check(s: State) -> State:
        try:
            return {"sql": sqlguard.check(s["sql"], tables, "duckdb"), "trace": s["trace"] + ["check: ok"]}
        except sqlguard.UnsafeSQL as e:
            return {"error": f"blocked: {e}", "trace": s["trace"] + [f"check: {e}"]}

    def execute(s: State) -> State:
        try:
            r = run_query(s["sql"])
            return {"columns": r["columns"], "rows": r["rows"], "trace": s["trace"] + [f"execute: {len(r['rows'])} rows"]}
        except Exception as e:  # warehouse errors go back to the model as feedback
            return {"error": str(e), "trace": s["trace"] + [f"execute: {e}"]}

    def summarize(s: State) -> State:
        sample = "\n".join(" | ".join(map(str, r)) for r in s["rows"][:20])
        prompt = (
            "Answer the question in plain text, no markdown, two sentences at most, quoting the key numbers.\n"
            "Read the SQL's WHERE clause: if it filtered to a subset, say so, and never present a subset's "
            "total as the overall total.\n"
            f"QUESTION: {s['question']}\nSQL: {s['sql']}\n"
            f"COLUMNS: {' | '.join(s['columns'])}\nROWS ({len(s['rows'])} total):\n{sample}"
        )
        return {"answer": llm.invoke(prompt).content.strip(), "trace": s["trace"] + ["summarize"]}

    def give_up(s: State) -> State:
        return {"answer": f"Couldn't write a working query after {s['attempts']} attempts: {s['error']}",
                "trace": s["trace"] + ["give_up"]}

    def after(next_node: str):
        def route(s: State) -> str:
            if not s.get("error"):
                return next_node
            return "write_sql" if s["attempts"] < MAX_ATTEMPTS else "give_up"
        return route

    g = StateGraph(State)
    for name, fn in [("write_sql", write_sql), ("check", check), ("execute", execute),
                     ("summarize", summarize), ("give_up", give_up)]:
        g.add_node(name, fn)
    g.add_edge(START, "write_sql")
    g.add_edge("write_sql", "check")
    g.add_conditional_edges("check", after("execute"), ["execute", "write_sql", "give_up"])
    g.add_conditional_edges("execute", after("summarize"), ["summarize", "write_sql", "give_up"])
    g.add_edge("summarize", END)
    g.add_edge("give_up", END)
    return g.compile()


def default_llm():
    """OpenRouter if OPENROUTER_API_KEY is set, else Anthropic. SCOREBASE_MODEL overrides."""
    from langchain_openai import ChatOpenAI

    if os.environ.get("OPENROUTER_API_KEY"):
        return ChatOpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=os.environ["OPENROUTER_API_KEY"],
            model=os.environ.get("SCOREBASE_MODEL", "anthropic/claude-sonnet-4-6").removeprefix("openrouter/"),
            max_tokens=1500,
            temperature=0,
        )
    if os.environ.get("ANTHROPIC_API_KEY"):
        from langchain_anthropic import ChatAnthropic  # pip install langchain-anthropic

        return ChatAnthropic(model=os.environ.get("SCOREBASE_MODEL", "claude-sonnet-5-5"), max_tokens=1500, temperature=0)
    raise RuntimeError("set OPENROUTER_API_KEY or ANTHROPIC_API_KEY")
