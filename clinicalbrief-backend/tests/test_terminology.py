"""v1.0.1 round 2 (A): extraction vocabulary from ICD-10-CM and RxNorm, sources Synthea does not use."""
import pytest
from app.services.terminology import TermIndex, build_terms, normalise_icd


@pytest.mark.parametrize("desc,expected", [
    ("Otitis media, unspecified, unspecified ear", "otitis media"),
    ("Essential (primary) hypertension", "essential hypertension"),
    ("Acute pharyngitis, unspecified", "acute pharyngitis"),
    ("Other specified disorders of teeth", "specified disorders of teeth"),
    ("Unspecified asthma, uncomplicated", "asthma"),
    ("Other", None),                       # nothing specific left
    ("Disorder, unspecified", None),
    ("Flu", None),                          # too short to match safely
])
def test_normalise_icd(desc, expected):
    assert normalise_icd(desc) == expected


ICD = [  # (code, description) as in the CMS order file
    ("I10", "Essential (primary) hypertension"), ("J45909", "Unspecified asthma, uncomplicated"),
    ("J459", "Other and unspecified asthma"), ("R05", "Cough"), ("Z560", "Unemployment, unspecified"),
    ("W010", "Fall on same level from slipping"), ("S42001", "Fracture of unspecified part of right clavicle"),
]
RX = ["amoxicillin", "clavulanate", "insulin, regular, human", "3-methyl-2-(oxo)butanoate", "lisinopril"]


def test_build_terms_types_codes_and_exclusions():
    terms = {t: (typ, code) for t, typ, code, _src, _desc in build_terms(ICD, RX)}
    assert terms["essential hypertension"] == ("Disease", "I10")
    assert terms["asthma"] == ("Disease", "J45909")
    assert terms["cough"] == ("Symptom", "R05")                 # chapter R = symptoms and signs
    assert "unemployment" not in terms                            # chapter Z: social circumstances
    assert not any(t.startswith("fall") for t in terms)           # chapters V-Y: external causes
    assert terms["amoxicillin"] == ("Medication", None)
    assert "insulin" in terms and not any("butanoate" in t for t in terms)   # chemical names dropped


def test_index_finds_longest_terms_with_offsets():
    idx = TermIndex([("asthma", "Disease", "J45909", "icd10cm", ""), ("childhood asthma", "Disease", "J45", "icd10cm", ""),
                     ("amoxicillin", "Medication", None, "rxnorm", "")])
    text = "Childhood asthma; amoxicillin 500 mg. Asthmatic? no."
    hits = idx.find(text)
    assert [(text[s:e], t) for s, e, t, *_ in hits] == [("Childhood asthma", "childhood asthma"), ("amoxicillin", "amoxicillin")]


def test_a_term_listed_as_disease_and_symptom_is_a_symptom():
    idx = TermIndex([("pain", "Disease", "G89", "icd10cm", ""), ("pain", "Symptom", "R52", "icd10cm", "")])
    assert idx.find("Joint pain")[0][3:5] == ("Symptom", "R52")


def test_extended_extraction_finds_terminology_terms_with_icd_codes_and_keeps_negation():
    from app.services.ai_pipeline import AIPipelineOrchestrator
    o = AIPipelineOrchestrator(vocab="extended")
    found = {(e["entity_text"].lower(), e["entity_type"]) for e in o.extract_entities(
        "Patient presents with acute bronchitis. Started on doxycycline. Denies otitis media. Mother had gout.")}
    assert ("acute bronchitis", "Disease") in found and ("doxycycline", "Medication") in found
    assert not any(t in ("otitis media", "gout") for t, _ in found)          # negated / about a relative
    assert o.resolve_icd10("acute bronchitis", "Disease")["icd10_code"] == "J20"
    assert AIPipelineOrchestrator(vocab="core").resolve_icd10("acute bronchitis", "Disease") is None


def test_vocabulary_file_is_present_and_tracked_in_git():
    """Deployment is a clean checkout: an untracked or ignored terminology.tsv silently turns the vocabulary off."""
    import shutil, subprocess
    from app.services.terminology import TSV
    assert TSV.exists(), "run: py -3.12 -m app.cli build-vocab"
    if shutil.which("git") is None:
        pytest.skip("git not available")
    r = subprocess.run(["git", "ls-files", "--error-unmatch", str(TSV)], cwd=TSV.parent, capture_output=True)
    assert r.returncode == 0, f"{TSV.name} is not tracked: git add it (and check .gitignore)"


def test_missing_vocabulary_falls_back_to_core(monkeypatch, tmp_path):
    from app.services import terminology
    from app.services.ai_pipeline import AIPipelineOrchestrator
    monkeypatch.setattr(terminology, "TSV", tmp_path / "missing.tsv")
    monkeypatch.setattr(terminology, "_index", None)
    o = AIPipelineOrchestrator(vocab="extended")
    found = {e["entity_text"].lower() for e in o.extract_entities("History of hypertension and acute bronchitis.")}
    assert "hypertension" in found and "acute bronchitis" not in found      # core dictionary still works
    assert o.resolve_icd10("acute bronchitis", "Disease") is None
