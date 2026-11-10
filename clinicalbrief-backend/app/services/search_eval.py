"""v1.0.1 Part C (roadmap 8b): does embedding search beat the existing full-text search? Offline, decided in advance.

Relevance: each question in eval/search/questions.jsonl has a regex of concept terms, written before either method was
run. A note is relevant if its text matches it (so every note is judged, not only the ones a method returned).
Methods, top 10 notes each: keyword = the app's Postgres full-text note search (record_search, best match);
semantic = cosine similarity of local embeddings (Ollama `nomic-embed-text`); hybrid = reciprocal-rank fusion of both.
Questions with no relevant note in the corpus are reported but not scored.
Decision rule (fixed before the run): adopt semantic or hybrid only if its mean nDCG@10 beats keyword by >= 0.05 and the
95% bootstrap interval of the per-question difference excludes 0.
"""
import json
import math
import random
import re
from pathlib import Path

from app.services.embeddings import DIMS, EMBED_MODEL, LocalLLM, embed, rrf, shorten  # noqa: F401 (LocalLLM: tests)

MARGIN = 0.05
K = 10


def precision_at_k(ranked: list, relevant: set, k: int = K) -> float:
    return sum(1 for d in ranked[:k] if d in relevant) / k


def mrr(ranked: list, relevant: set) -> float:
    return next((1 / i for i, d in enumerate(ranked, 1) if d in relevant), 0.0)


def ndcg_at_k(ranked: list, relevant: set, k: int = K) -> float:
    dcg = sum(1 / math.log2(i + 1) for i, d in enumerate(ranked[:k], 1) if d in relevant)
    ideal = sum(1 / math.log2(i + 1) for i in range(1, min(k, len(relevant)) + 1))
    return dcg / ideal if ideal else 0.0


def relevant_ids(notes: dict, pattern: str) -> set:
    rx = re.compile(pattern, re.IGNORECASE)
    return {i for i, text in notes.items() if rx.search(text)}


def decide(diff: float, ci: tuple) -> str:
    return "SHIP" if diff >= MARGIN and ci[0] > 0 else "DON'T SHIP"


def _paired_ci(diffs: list[float], n: int = 2000, seed: int = 0) -> tuple[float, float]:
    rng = random.Random(seed)
    means = sorted(sum(rng.choice(diffs) for _ in diffs) / len(diffs) for _ in range(n))
    return means[int(0.025 * (n - 1))], means[int(0.975 * (n - 1))]


def run_search_eval(db, eval_dir, dims: int = DIMS) -> dict:
    """Needs `db` on Postgres holding the notes (see app.cli eval-search-db)."""
    import numpy as np
    from app.models.models import ClinicalNote
    from app.services.record_search import search_records

    eval_dir = Path(eval_dir) / "search"
    questions = [json.loads(line) for line in (eval_dir / "questions.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    notes = {n.document_id: n.original_text for n in db.query(ClinicalNote)}
    ids = sorted(notes)

    cache = eval_dir / "cache" / f"{EMBED_MODEL}-{len(ids)}.npz"
    if cache.exists() and list(np.load(cache)["ids"]) == ids:
        doc_vecs = np.load(cache)["vecs"]
    else:
        doc_vecs = np.asarray(embed([notes[i] for i in ids], "search_document"), dtype=np.float32)
        cache.parent.mkdir(exist_ok=True)
        np.savez(cache, ids=np.array(ids), vecs=doc_vecs)
    doc_vecs = shorten(doc_vecs, dims)
    q_vecs = np.asarray(embed([q["query"] for q in questions], "search_query"), dtype=np.float32)
    q_vecs = shorten(q_vecs, dims)

    per_q, scores = [], {m: {"ndcg": [], "p": [], "mrr": []} for m in ("keyword", "semantic", "hybrid")}
    for q, qv in zip(questions, q_vecs):
        rel = relevant_ids(notes, q["relevant"])
        res = search_records(db, None, q["query"], [], kinds={"note"}, per_kind=K, sort="relevance")
        ranked = {"keyword": [h["document_id"] for h in res.hits][:K],
                  "semantic": [ids[j] for j in np.argsort(-(doc_vecs @ qv))[:K]]}
        ranked["hybrid"] = rrf([ranked["keyword"], ranked["semantic"]])[:K]
        row = {"id": q["id"], "query": q["query"], "relevant_notes": len(rel), "keyword_matches": res.counts.get("note", 0)}
        per_q.append(row)
        if not rel:  # no relevant note in the corpus: every method scores 0 by definition, so it cannot rank them
            continue
        for m, r in ranked.items():
            row[m] = {"ndcg": ndcg_at_k(r, rel), "p": precision_at_k(r, rel), "mrr": mrr(r, rel)}
            for k_ in ("ndcg", "p", "mrr"):
                scores[m][k_].append(row[m][k_])

    mean = lambda xs: sum(xs) / len(xs)
    summary = {m: {k_: mean(v) for k_, v in s.items()} for m, s in scores.items()}
    decision = {}
    for m in ("semantic", "hybrid"):
        diffs = [a - b for a, b in zip(scores[m]["ndcg"], scores["keyword"]["ndcg"])]
        ci = _paired_ci(diffs)
        decision[m] = {"ndcg_diff": mean(diffs), "ci95": ci, "verdict": decide(mean(diffs), ci)}
    return {"dims": dims, "notes": len(ids), "questions": len(questions), "scored": len(scores["keyword"]["ndcg"]),
            "excluded_no_relevant": [q["id"] for q in per_q if not q["relevant_notes"]], "embed_model": EMBED_MODEL, "k": K,
            "summary": summary, "vs_keyword": decision,
            "outcome": "SHIP" if any(d["verdict"] == "SHIP" for d in decision.values()) else "DON'T SHIP",
            "per_question": per_q}
