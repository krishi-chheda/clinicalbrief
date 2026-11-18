"""v1.0.1 round 2 (A): an extraction vocabulary from public terminologies that Synthea does not use.

- ICD-10-CM (CMS, public domain): diseases, and symptoms (chapter R). Chapters V-Y (external causes) and Z (factors
  such as employment or housing) are left out: the labelling guideline excludes them.
- RxNorm ingredients (NLM RxNav, tty=IN): medications. Chemical-style names (digits, brackets, > 4 words) are left out.
Descriptions are normalised to the words a note would use: the part before the first comma, without bracketed text
or leading "other / unspecified". The rules were fixed before the vocabulary was scored (eval/results).
Built by `app.cli build-vocab` into app/data/terminology.tsv (tracked in git, so deployment needs no download; if it is missing, extraction
falls back to the core dictionary with a warning).
"""
import re
from pathlib import Path
from typing import Iterable, Optional

TOKEN = re.compile(r"[a-z0-9]+(?:['-][a-z0-9]+)*")
_GENERIC = {"other", "unspecified", "and", "disease", "diseases", "disorder", "disorders", "condition", "conditions",
            "abnormal", "abnormality", "findings", "complication", "complications", "injury", "effects", "encounter",
            "specified", "type", "nos"}
_LEAD = {"other", "unspecified", "and"}
MAX_WORDS = 10
TSV = Path(__file__).resolve().parents[1] / "data" / "terminology.tsv"


def _clean(text: str) -> list[str]:
    text = re.sub(r"\([^)]*\)", " ", text.lower()).split(",")[0]
    return TOKEN.findall(text)


def _usable(words: list[str]) -> bool:
    if not words or all(w in _GENERIC for w in words) or len(words) > MAX_WORDS:
        return False
    return len(words) > 1 or len(words[0]) >= 4


def normalise_icd(description: str) -> Optional[str]:
    words = _clean(description)
    while words and words[0] in _LEAD:
        words = words[1:]
    return " ".join(words) if _usable(words) else None


def normalise_rx(name: str) -> Optional[str]:
    if re.search(r"[\d()\[\]]", name) or len(name.split()) > 4:
        return None
    words = _clean(name)
    return " ".join(words) if _usable(words) else None


def build_terms(icd: Iterable[tuple[str, str]], rx_names: Iterable[str]) -> list[tuple]:
    """(term, type, code, source, description), first code wins per (term, type)."""
    out, seen = [], set()
    for code, desc in icd:
        if code[0] in "VWXYZ":
            continue
        term = normalise_icd(desc)
        typ = "Symptom" if code[0] == "R" else "Disease"
        if term and (term, typ) not in seen:
            seen.add((term, typ))
            out.append((term, typ, code, "icd10cm", desc))
    for name in rx_names:
        term = normalise_rx(name)
        if term and (term, "Medication") not in seen:
            seen.add((term, "Medication"))
            out.append((term, "Medication", None, "rxnorm", name))
    return out


class TermIndex:
    """Longest-match lookup of multi-word terms by token n-grams (fast for tens of thousands of terms)."""

    def __init__(self, terms: Iterable[tuple]):
        self.terms = {}
        for term, typ, code, source, desc in terms:
            # One type per term. ICD-10-CM lists some terms twice ("pain": G89 disease, R52 symptom); in a note they are
            # the symptom, so Symptom wins (decided before scoring).
            if term not in self.terms or typ == "Symptom":
                self.terms[term] = (typ, code, source, desc)
        self.max_len = max((len(t.split()) for t in self.terms), default=1)

    def find(self, text: str) -> list[tuple]:
        """[(start, end, term, type, code, source, description)], left to right, longest match, no overlaps."""
        toks = [(m.group(0), m.start(), m.end()) for m in TOKEN.finditer(text.lower())]
        hits, i = [], 0
        while i < len(toks):
            for n in range(min(self.max_len, len(toks) - i), 0, -1):
                term = " ".join(t for t, _, _ in toks[i:i + n])
                if term in self.terms:
                    hits.append((toks[i][1], toks[i + n - 1][2], term, *self.terms[term]))
                    i += n
                    break
            else:
                i += 1
        return hits


_index: Optional[TermIndex] = None


def index() -> TermIndex:
    """The committed vocabulary, loaded once."""
    global _index
    if _index is None:
        if not TSV.exists():  # never break note processing over a missing file: behave like EXTRACTION_VOCAB=core
            import logging
            logging.getLogger("clinicalbrief.terminology").warning(
                "%s is missing: extended vocabulary off, core dictionary only (run app.cli build-vocab)", TSV)
            _index = TermIndex([])
            return _index
        rows = [line.split("\t") for line in TSV.read_text(encoding="utf-8").splitlines()[1:] if line]
        _index = TermIndex((t, typ, code or None, src, desc) for t, typ, code, src, desc in rows)
    return _index
