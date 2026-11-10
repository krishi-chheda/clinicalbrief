"""v1.0.1 Part C: the metrics behind the keyword-vs-semantic comparison. Known answers computed by hand."""
import math
import pytest
from app.services.search_eval import decide, mrr, ndcg_at_k, precision_at_k, relevant_ids, rrf


def test_precision_and_mrr():
    ranked, rel = ["a", "b", "c", "d"], {"b", "d", "z"}
    assert precision_at_k(ranked, rel, 4) == 0.5
    assert precision_at_k(ranked, rel, 10) == 0.2          # missing results count as misses, out of k
    assert mrr(ranked, rel) == 0.5 and mrr(["x"], rel) == 0.0


def test_ndcg_binary():
    rel = {"b", "d"}
    dcg = 1 / math.log2(3) + 1 / math.log2(5)
    ideal = 1 / math.log2(2) + 1 / math.log2(3)
    assert ndcg_at_k(["a", "b", "c", "d"], rel, 10) == pytest.approx(dcg / ideal)
    assert ndcg_at_k(["b", "d"], rel, 10) == pytest.approx(1.0)
    assert ndcg_at_k([], rel, 10) == 0.0


def test_rrf_rewards_agreement():
    # "b" is 2nd in both lists: 2/(60+2) beats "a" (1/61 alone) and "x" (1/61 alone)
    assert rrf([["a", "b", "c"], ["x", "b", "y"]])[0] == "b"
    assert set(rrf([["a"], ["x"]])) == {"a", "x"}


def test_relevant_ids_is_a_case_insensitive_regex_over_the_text():
    notes = {"n1": "History of Otitis media (disorder).", "n2": "No complaints.", "n3": "chronic otitis MEDIA"}
    assert relevant_ids(notes, "otitis media|ear infection") == {"n1", "n3"}


def test_decision_rule_needs_both_margin_and_a_ci_above_zero():
    assert decide(0.06, (0.01, 0.11)) == "SHIP"
    assert decide(0.06, (-0.01, 0.12)) == "DON'T SHIP"   # CI includes 0
    assert decide(0.03, (0.01, 0.05)) == "DON'T SHIP"    # below the +0.05 margin


def test_embeddings_need_the_local_model(monkeypatch):
    from app.services import search_eval
    from app.services.llm import LLMUnavailable

    def missing(self):
        raise LLMUnavailable("Model 'nomic-embed-text' is not installed (run: ollama pull nomic-embed-text)")
    monkeypatch.setattr(search_eval.LocalLLM, "check", missing)  # the same class embeddings.embed uses
    with pytest.raises(LLMUnavailable, match="ollama pull nomic-embed-text"):
        search_eval.embed(["text"], "search_document")
