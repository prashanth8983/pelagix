"""Match a question to a verified (golden) query.

A verified answer is shown as exact, so a near miss is worse than no match: "customers
NOT at risk" must not get the at-risk count, and "VIPs in Texas" must not get every VIP.
A question is answered from a golden query only if every word it uses appears in that
golden question (nothing the user asked for is ignored), negations agree, and it covers
more than half of the golden question.
"""
import re

STOP = {"a", "an", "the", "of", "in", "on", "at", "my", "me", "our", "we", "us", "i", "you", "show",
        "who", "what", "which", "are", "is", "be", "there", "how", "many", "do", "does", "have", "has",
        "to", "for", "with", "by", "and", "list", "give", "get", "find", "tell", "please", "can", "all"}
NEGATIONS = {"not", "no", "never", "without", "except", "excluding", "non", "havent", "hasnt",
             "dont", "doesnt", "didnt", "isnt", "arent", "wont", "neither", "nor"}
MIN_COVERAGE = 0.6


def _stem(w: str) -> str:
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    if len(w) > 5 and w.endswith("ed"):
        return w[:-2]
    return w


def words(text: str) -> set[str]:
    text = re.sub(r"['’]", "", text.lower())
    return {_stem(w) for w in re.findall(r"[a-z0-9]+", text) if w not in STOP}


def match(golden: list[dict], question: str) -> dict | None:
    """Best golden query by word overlap, with `verified` saying whether it may answer."""
    q = words(question)
    best, best_score = None, 0.0
    for g in golden:
        gw = words(g["question"])
        s = len(q & gw) / len(q | gw) if q | gw else 0
        if s > best_score:
            best, best_score = g, s
    if not best:
        return None
    gw = words(best["question"])
    extra = sorted(q - gw)
    verified = (not extra and (q & NEGATIONS) == (gw & NEGATIONS)
                and len(q & gw) / max(len(gw), 1) >= MIN_COVERAGE)
    return {**best, "score": round(best_score, 2), "verified": verified, "unmatched": extra}
