"""Phase 8a: persistent search across every note and the structured record, with structured filters.

- Postgres: full-text search (to_tsvector('english', ...) served by the migration 0010 GIN indexes), ranked
  with ts_rank, note snippets from ts_headline. SQLite (tests / local dev): case-insensitive substring match.
- Optional query expansion by the local LLM (the Copilot's expand_query): e.g. "diabetes medication" -> metformin,
  insulin... Expansion only widens the search; every hit is a real row. Without the model, search is literal.
- Medications are returned as dated events ("started" / "stopped"), so a date range shows medication changes.
- Scope: only patients the user may access. Researchers get no note text (it is not de-identified).
"""
import re
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from typing import Iterable, Optional

from sqlalchemy import and_, func, or_, literal, literal_column
from sqlalchemy.orm import Session

from app.core.database import is_sqlite
from app.models.models import Allergy, ClinicalNote, Diagnosis, Document, Medication, Observation, Patient, Procedure

KINDS = ("note", "condition", "medication", "procedure", "observation", "allergy")
MARK_START, MARK_END = "⟦", "⟧"  # snippet highlight markers (rendered as text, never as HTML)
_WORD = re.compile(r"[a-z0-9][a-z0-9'-]*", re.I)


@dataclass
class SearchResult:
    hits: list = field(default_factory=list)
    counts: dict = field(default_factory=dict)       # matches per kind (before the per-kind cap)
    terms: list = field(default_factory=list)        # what was actually searched for
    expanded: bool = False                           # True when the local model added terms


def _day_bounds(d_from: Optional[date], d_to: Optional[date]):
    lo = datetime.combine(d_from, time.min, tzinfo=timezone.utc) if d_from else None
    hi = datetime.combine(d_to, time.max, tzinfo=timezone.utc) if d_to else None
    return lo, hi


def _in_range(col, lo, hi):
    conds = []
    if lo is not None:
        conds.append(col >= lo)
    if hi is not None:
        conds.append(col <= hi)
    return conds


def _iso(v):
    return v.isoformat() if v else None


class RecordSearch:
    def __init__(self, db: Session, allowed_patient_ids: Optional[set], query: str, extra_terms: list[str]):
        self.db, self.allowed, self.query, self.extra = db, allowed_patient_ids, query, extra_terms
        # Words used for SQLite matching and snippet highlighting.
        self.terms = [w.lower() for w in _WORD.findall(query) if w.lower() not in {"or", "and", "not"}] + extra_terms

    # --- matching ------------------------------------------------------------------------------------
    def _tsquery(self):
        """The user's query with web-search rules (all words, "quoted phrases", or), OR any expansion phrase."""
        q = func.websearch_to_tsquery("english", self.query)
        for t in self.extra:
            q = q.op("||")(func.phraseto_tsquery("english", t))
        return q

    # Notes use the stored, database-generated vector (migration 0011); other tables the 0010 expression indexes.
    NOTE_VECTOR = literal_column("clinical_notes.search_vector")

    def _vector(self, column):
        return self.NOTE_VECTOR if column is ClinicalNote.original_text else func.to_tsvector("english", column)

    def _match(self, column):
        if is_sqlite:  # all query words, or any expansion term
            words = [w for w in self.terms[:len(self.terms) - len(self.extra)]]
            all_words = and_(*[func.lower(column).contains(w) for w in words]) if words else None
            any_extra = [func.lower(column).contains(t) for t in self.extra]
            return or_(*([all_words] if all_words is not None else []), *any_extra)
        return self._vector(column).op("@@")(self._tsquery())

    def _rank(self, column):
        return literal(0.0) if is_sqlite else func.ts_rank(self._vector(column), self._tsquery())

    def _scope(self, q, patient_col, patient_id):
        if patient_id:
            q = q.filter(patient_col == patient_id)
        if self.allowed is not None:
            q = q.filter(patient_col.in_(self.allowed))
        return q

    def _snippet(self, text: str) -> str:
        """SQLite fallback snippet: ~160 characters around the first match, marked like ts_headline."""
        low = text.lower()
        pos = min((low.find(t.lower()) for t in self.terms if low.find(t.lower()) >= 0), default=-1)
        if pos < 0:
            return text[:160]
        start = max(0, pos - 70)
        piece = text[start:pos + 90]
        for t in self.terms:
            piece = re.sub(re.escape(t), lambda m: f"{MARK_START}{m.group(0)}{MARK_END}", piece, flags=re.I)
        return ("..." if start else "") + piece + "..."

    # --- per kind --------------------------------------------------------------------------------------
    def notes(self, patient_id, lo, hi, cap):
        when = func.coalesce(Document.document_date, Document.upload_date)
        q = (self.db.query(ClinicalNote, Document)
             .join(Document, Document.document_id == ClinicalNote.document_id)
             .filter(self._match(ClinicalNote.original_text), *_in_range(when, lo, hi)))
        q = self._scope(q, Document.patient_id, patient_id)
        total = q.count()
        rank = self._rank(ClinicalNote.original_text)
        if is_sqlite:
            rows = [(n, d, self._snippet(n.original_text), 0.0) for n, d in q.order_by(when.desc()).limit(cap).all()]
        else:
            headline = func.ts_headline("english", ClinicalNote.original_text, self._tsquery(),
                                        f"StartSel={MARK_START}, StopSel={MARK_END}, MaxFragments=2, MinWords=6, MaxWords=24")
            rows = (self.db.query(ClinicalNote, Document, headline, rank)
                    .join(Document, Document.document_id == ClinicalNote.document_id)
                    .filter(self._match(ClinicalNote.original_text), *_in_range(when, lo, hi)))
            rows = self._scope(rows, Document.patient_id, patient_id).order_by(rank.desc(), when.desc()).limit(cap).all()
        hits = [{"kind": "note", "date": _iso(d.document_date or d.upload_date), "patient_id": d.patient_id,
                 "label": d.file_name, "detail": d.classification, "snippet": snip, "rank": float(r or 0),
                 "document_id": d.document_id, "source_system": d.source_system} for n, d, snip, r in rows]
        return total, hits

    def simple(self, kind, model, text_col, date_col, patient_id, lo, hi, cap, detail):
        q = self.db.query(model).filter(self._match(text_col), *_in_range(date_col, lo, hi))
        q = self._scope(q, model.patient_id, patient_id)
        total = q.count()
        rank = self._rank(text_col)
        rows = (self.db.query(model, rank).filter(self._match(text_col), *_in_range(date_col, lo, hi)))
        rows = self._scope(rows, model.patient_id, patient_id).order_by(rank.desc(), date_col.desc().nulls_last()).limit(cap).all()
        return total, [{"kind": kind, "date": _iso(getattr(r, date_col.key)), "patient_id": r.patient_id,
                        "label": getattr(r, text_col.key), "detail": detail(r), "snippet": None, "rank": float(rk or 0),
                        "source_system": r.source_system} for r, rk in rows]

    def medications(self, patient_id, lo, hi, cap):
        """Medication events: 'started' at start_at and 'stopped' at end_at, each inside the date range."""
        hits, total = [], 0
        for event, col in (("started", Medication.start_at), ("stopped", Medication.end_at)):
            q = self.db.query(Medication).filter(self._match(Medication.medication_name), col.isnot(None), *_in_range(col, lo, hi))
            q = self._scope(q, Medication.patient_id, patient_id)
            total += q.count()
            for m in q.order_by(col.desc()).limit(cap).all():
                dose = " ".join(x for x in (m.dose, m.route, m.frequency) if x)
                hits.append({"kind": "medication", "date": _iso(getattr(m, col.key)), "patient_id": m.patient_id,
                             "label": m.medication_name, "detail": f"{event}{f' - {dose}' if dose else ''}"
                             f"{f' (status {m.status})' if m.status else ''}", "event": event, "snippet": None,
                             "rank": 0.0, "source_system": m.source_system})
        hits.sort(key=lambda h: h["date"] or "", reverse=True)
        return total, hits[:cap]


def search_records(db: Session, allowed_patient_ids: Optional[set], query: str, extra_terms: Iterable[str] = (), *, patient_id=None,
                   kinds: Optional[set] = None, date_from: Optional[date] = None, date_to: Optional[date] = None,
                   include_notes: bool = True, per_kind: int = 25, sort: str = "relevance") -> SearchResult:
    query = (query or "").strip()[:200]
    extra = [t for t in dict.fromkeys(t.strip().lower() for t in extra_terms) if t and _WORD.search(t) and t != query.lower()][:15]
    result = SearchResult(terms=[query] + extra, expanded=bool(extra))
    if not _WORD.search(query):
        return result
    kinds = (set(kinds) & set(KINDS)) if kinds else set(KINDS)
    if not include_notes:
        kinds.discard("note")
    s = RecordSearch(db, allowed_patient_ids, query, extra)
    lo, hi = _day_bounds(date_from, date_to)
    runners = {
        "note": lambda: s.notes(patient_id, lo, hi, per_kind),
        "condition": lambda: s.simple("condition", Diagnosis, Diagnosis.display, Diagnosis.onset_at, patient_id, lo, hi, per_kind,
                                      lambda d: f"onset{f', {d.clinical_status}' if d.clinical_status else ''}"),
        "medication": lambda: s.medications(patient_id, lo, hi, per_kind),
        "procedure": lambda: s.simple("procedure", Procedure, Procedure.procedure_name, Procedure.performed_at, patient_id, lo, hi,
                                      per_kind, lambda p: "performed"),
        "observation": lambda: s.simple("observation", Observation, Observation.name, Observation.effective_at, patient_id, lo, hi,
                                        per_kind, lambda o: f"{o.value or 'no value'} {o.unit or ''}".strip()
                                        + (f" ({o.flag})" if o.flag else "")),
        "allergy": lambda: s.simple("allergy", Allergy, Allergy.allergen, Allergy.recorded_at, patient_id, lo, hi, per_kind,
                                    lambda a: ", ".join(x for x in (a.reaction, a.severity, a.criticality) if x) or "recorded"),
    }
    for kind in KINDS:
        if kind in kinds:
            result.counts[kind], hits = runners[kind]()
            result.hits.extend(hits)
    # Patient names for display (one query).
    ids = {h["patient_id"] for h in result.hits}
    names = {p.patient_id: (p.first_name, p.last_name) for p in db.query(Patient).filter(Patient.patient_id.in_(ids))} if ids else {}
    for h in result.hits:
        h["first_name"], h["last_name"] = names.get(h["patient_id"], ("", ""))
    if sort == "date":
        result.hits.sort(key=lambda h: h["date"] or "", reverse=True)
    else:
        result.hits.sort(key=lambda h: (h["rank"], h["date"] or ""), reverse=True)
    return result
