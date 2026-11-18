"""v1.0.1 Part B: the scorer behind the published accuracy figures. Known-answer tests, computed by hand."""
import pytest
from app.services.evaluation import bootstrap_ci, mention_key, score

G = lambda text, type_, negated=False, subject="patient": {"text": text, "type": type_, "negated": negated, "subject": subject}
P = lambda text, type_: {"text": text, "type": type_}


def test_mention_key_normalises_case_space_and_synthea_tags():
    assert mention_key(G("  Hypertension (disorder) ", "Disease")) == ("hypertension", "Disease")
    assert mention_key(P("Lisinopril", "Medication")) == ("lisinopril", "Medication")


def test_strict_counts_by_hand():
    gold = {"n1": [G("hypertension", "Disease"), G("asthma", "Disease"), G("fever", "Symptom", negated=True)],
            "n2": [G("lisinopril", "Medication")]}
    pred = {"n1": [P("Hypertension", "Disease"), P("fever", "Symptom"), P("cough", "Symptom")],
            "n2": [P("lisinopril", "Disease")]}  # right word, wrong type: FP + FN
    r = score(gold, pred, "strict")
    o = r["overall"]
    assert (o["tp"], o["fp"], o["fn"]) == (1, 3, 2)
    assert o["precision"] == pytest.approx(1 / 4) and o["recall"] == pytest.approx(1 / 3)
    assert o["f1"] == pytest.approx(2 * (1 / 4) * (1 / 3) / (1 / 4 + 1 / 3))
    assert r["negation_errors"] == 1          # "fever" output although the note negates it
    assert r["by_type"]["Disease"]["tp"] == 1 and r["by_type"]["Disease"]["fn"] == 1


def test_family_history_mention_is_not_a_target():
    gold = {"n": [G("diabetes", "Disease", subject="family")]}
    r = score(gold, {"n": [P("diabetes", "Disease")]}, "strict")
    assert r["overall"]["fp"] == 1 and r["overall"]["fn"] == 0 and r["subject_errors"] == 1


def test_lenient_matches_a_shorter_or_longer_term_of_the_same_type():
    gold = {"n": [G("type 2 diabetes mellitus", "Disease"), G("chest pain", "Symptom")]}
    pred = {"n": [P("diabetes mellitus", "Disease"), P("pain", "Procedure")]}
    assert score(gold, pred, "strict")["overall"]["tp"] == 0
    r = score(gold, pred, "lenient")["overall"]
    assert (r["tp"], r["fp"], r["fn"]) == (1, 1, 1)


def test_undefined_rates_are_none_not_zero_division():
    r = score({"n": []}, {"n": []}, "strict")["overall"]
    assert (r["precision"], r["recall"], r["f1"]) == (None, None, None)
    assert score({"n": [G("asthma", "Disease")]}, {"n": []}, "strict")["overall"]["precision"] is None


def test_a_note_missing_from_predictions_counts_as_no_output():
    r = score({"n": [G("asthma", "Disease")]}, {}, "strict")["overall"]
    assert (r["tp"], r["fn"]) == (0, 1)


def test_bootstrap_ci_brackets_the_point_estimate_and_is_reproducible():
    gold = {f"n{i}": [G("asthma", "Disease"), G("fever", "Symptom")] for i in range(20)}
    pred = {f"n{i}": [P("asthma", "Disease")] + ([P("fever", "Symptom")] if i % 2 else []) for i in range(20)}
    lo, hi = bootstrap_ci(gold, pred, "strict", "recall", n=500, seed=1)
    assert lo <= 0.75 <= hi and 0.5 < lo and hi < 1
    assert (lo, hi) == bootstrap_ci(gold, pred, "strict", "recall", n=500, seed=1)


def test_lenient_parts_of_one_labelled_mention_count_once_not_as_false_positives():
    """Round 2 rule, fixed before the vocabulary run: a combination product yields one prediction per ingredient."""
    gold = {"n": [G("amoxicillin 250 mg / clavulanate 125 mg oral tablet", "Medication")]}
    pred = {"n": [P("amoxicillin", "Medication"), P("clavulanate", "Medication")]}
    o = score(gold, pred, "lenient")["overall"]
    assert (o["tp"], o["fp"], o["fn"]) == (1, 0, 0)
    assert score(gold, pred, "strict")["overall"]["fp"] == 2   # strict is unchanged


def test_containment_looks_at_words_not_punctuation():
    """Fix found in round 2: brackets and commas next to a word hid a match ("(ethinyl estradiol", "nitrofurantoin,")."""
    gold = {"n": [G("{21 (ethinyl estradiol 0.03 mg / levonorgestrel 0.15 mg oral tablet) } pack [levora]", "Medication"),
                  G("nitrofurantoin, macrocrystals 25 mg oral capsule", "Medication")]}
    pred = {"n": [P("ethinyl estradiol", "Medication"), P("nitrofurantoin", "Medication")]}
    o = score(gold, pred, "lenient")["overall"]
    assert (o["tp"], o["fp"], o["fn"]) == (2, 0, 0)
