"""v1.0.1 Part B: scoring the note pipeline against hand-labelled notes.

The unit is what the pipeline outputs: per note, the set of (term, type) it reports as affirmed for the patient
(it de-duplicates per note and records no character offsets). Gold labels list every in-scope mention in the note
(see eval/GUIDELINE.md) with `negated` and `subject`; only affirmed mentions about the patient are targets.

- strict: same normalised term and same type.
- lenient: same type, and one term contains the other as whole words ("diabetes mellitus" ~ "type 2 diabetes mellitus").
Each gold target is matched at most once. A prediction that hits a negated or family-history gold mention is a false
positive and is also counted as a negation / subject error.
"""
import random
import re
from collections import defaultdict
from typing import Optional

_TAG = re.compile(r"\s*\((disorder|finding|situation|procedure|substance|product|morphologic abnormality)\)\s*$", re.I)


def mention_key(m: dict) -> tuple[str, str]:
    text = _TAG.sub("", m["text"]).lower()
    return " ".join(text.split()), m["type"]


def _contains(a: str, b: str) -> bool:
    return f" {a} " in f" {b} " or f" {b} " in f" {a} "


def _rates(tp: int, fp: int, fn: int) -> dict:
    p = tp / (tp + fp) if tp + fp else None
    r = tp / (tp + fn) if tp + fn else None
    f1 = None if p is None or r is None else (2 * p * r / (p + r) if p + r else 0.0)
    return {"tp": tp, "fp": fp, "fn": fn, "precision": p, "recall": r, "f1": f1}


def _note_counts(gold: list, pred: list, mode: str):
    """Per type (tp, fp, fn) plus negation / subject errors for one note."""
    targets = [mention_key(g) for g in gold if not g.get("negated") and g.get("subject", "patient") == "patient"]
    non_targets = [(mention_key(g), g) for g in gold if g.get("negated") or g.get("subject", "patient") != "patient"]
    used = [False] * len(targets)
    counts = defaultdict(lambda: [0, 0, 0])
    neg_err = subj_err = 0
    for key in dict.fromkeys(mention_key(p) for p in pred):  # the pipeline reports each term once per note
        hit = next((i for i, t in enumerate(targets) if not used[i] and t == key), None)
        if hit is None and mode == "lenient":
            hit = next((i for i, t in enumerate(targets) if not used[i] and t[1] == key[1] and _contains(t[0], key[0])), None)
        if hit is not None:
            used[hit] = True
            counts[key[1]][0] += 1
            continue
        counts[key[1]][1] += 1
        wrong = next((g for k, g in non_targets
                      if k[1] == key[1] and (k == key or (mode == "lenient" and _contains(k[0], key[0])))), None)
        if wrong is not None:
            neg_err += bool(wrong.get("negated"))
            subj_err += wrong.get("subject", "patient") != "patient" and not wrong.get("negated")
    for i, t in enumerate(targets):
        if not used[i]:
            counts[t[1]][2] += 1
    return counts, neg_err, subj_err


def score(gold: dict, pred: dict, mode: str = "strict", notes: Optional[list] = None) -> dict:
    """gold / pred: {note_id: [mention, ...]}. `notes` (optional, may repeat ids) chooses which notes count."""
    by_type = defaultdict(lambda: [0, 0, 0])
    neg = subj = 0
    for note in (gold if notes is None else notes):
        counts, n, s = _note_counts(gold[note], pred.get(note, []), mode)
        neg, subj = neg + n, subj + s
        for t, c in counts.items():
            by_type[t] = [a + b for a, b in zip(by_type[t], c)]
    total = [sum(c[i] for c in by_type.values()) for i in range(3)]
    return {"mode": mode, "notes": len(gold if notes is None else notes), "overall": _rates(*total),
            "by_type": {t: _rates(*c) for t, c in sorted(by_type.items())},
            "negation_errors": neg, "subject_errors": subj}


def bootstrap_ci(gold: dict, pred: dict, mode: str, metric: str, n: int = 1000, seed: int = 0,
                 type_: Optional[str] = None) -> tuple[Optional[float], Optional[float]]:
    """95% percentile interval, resampling whole notes (mentions within a note are not independent)."""
    rng, ids, values = random.Random(seed), list(gold), []
    for _ in range(n):
        r = score(gold, pred, mode, notes=[rng.choice(ids) for _ in ids])
        v = (r["by_type"].get(type_, {}) if type_ else r["overall"]).get(metric)
        if v is not None:
            values.append(v)
    if not values:
        return None, None
    values.sort()
    return values[int(0.025 * (len(values) - 1))], values[int(0.975 * (len(values) - 1))]


# --- the labelled set on disk -----------------------------------------------------------------------------------------
# eval/sample.json          note ids (committed)
# eval/notes/<id>.txt       note text, regenerated from the local Synthea import (gitignored, like all data)
# eval/gold/<id>.json       {"note_id", "labelled_by", "reviewed_by", "mentions": [{text, type, negated, subject}]}
# eval/results/*.json       outputs of `app.cli eval-extraction`

def pick_sample(db, count: int, seed: int) -> list[str]:
    """`count` Synthea notes with text, at most one per patient, chosen with a fixed seed."""
    from app.models.models import ClinicalNote, Patient
    rows = (db.query(ClinicalNote.document_id, ClinicalNote.patient_id)
            .join(Patient, Patient.patient_id == ClinicalNote.patient_id)
            .filter(Patient.source_system == "synthea").order_by(ClinicalNote.document_id).all())
    by_patient: dict[str, list[str]] = defaultdict(list)
    for doc, pid in rows:
        by_patient[pid].append(doc)
    rng = random.Random(seed)
    patients = sorted(by_patient)
    rng.shuffle(patients)
    return [rng.choice(by_patient[p]) for p in patients[:count]]


def _is_target(m: dict) -> bool:
    return not m.get("negated") and m.get("subject", "patient") == "patient"


def run_extraction_eval(eval_dir, n_boot: int = 1000) -> dict:
    """Runs the note pipeline on every labelled note and scores it (strict and lenient, with 95% CIs)."""
    import json
    from pathlib import Path
    from app.services.ai_pipeline import ai_orchestrator
    eval_dir = Path(eval_dir)
    ids = json.loads((eval_dir / "sample.json").read_text(encoding="utf-8"))["note_ids"]
    gold, pred, labelled, reviewed = {}, {}, set(), set()
    for i in ids:
        g = eval_dir / "gold" / f"{i}.json"
        if not g.exists():
            continue
        doc = json.loads(g.read_text(encoding="utf-8"))
        labelled.add(doc["labelled_by"])
        reviewed.add(str(doc.get("reviewed_by")))
        gold[i] = doc["mentions"]
        text = (eval_dir / "notes" / f"{i}.txt").read_text(encoding="utf-8")
        pred[i] = [{"text": e["entity_text"], "type": e["entity_type"]} for e in ai_orchestrator.extract_entities(text)]
    out = {"notes": len(gold), "gold_mentions": sum(len(v) for v in gold.values()),
           "targets": sum(_is_target(m) for v in gold.values() for m in v),
           "labelled_by": sorted(labelled), "reviewed_by": sorted(reviewed),
           "pipeline": "rule-based (USE_MOCK_MODELS=true)" if ai_orchestrator.use_mock else "transformer"}
    for mode in ("strict", "lenient"):
        r = score(gold, pred, mode)
        for m in ("precision", "recall", "f1"):
            r["overall"][f"{m}_ci95"] = bootstrap_ci(gold, pred, mode, m, n=n_boot)
        for t in r["by_type"]:
            for m in ("precision", "recall"):
                r["by_type"][t][f"{m}_ci95"] = bootstrap_ci(gold, pred, mode, m, n=n_boot, type_=t)
        out[mode] = r
    out["errors"] = _examples(gold, pred)
    return out


def _examples(gold: dict, pred: dict, limit: int = 15) -> dict:
    """Most frequent missed targets and false positives (strict), for the write-up."""
    from collections import Counter
    missed, wrong = Counter(), Counter()
    for note, mentions in gold.items():
        targets = {mention_key(g) for g in mentions if _is_target(g)}
        preds = {mention_key(p) for p in pred.get(note, [])}
        missed.update(targets - preds)
        wrong.update(preds - targets)
    fmt = lambda c: [{"text": k[0], "type": k[1], "notes": n} for k, n in c.most_common(limit)]
    return {"missed": fmt(missed), "false_positives": fmt(wrong)}
