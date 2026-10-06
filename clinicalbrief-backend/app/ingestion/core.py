"""Shared ingestion machinery: deterministic ids, validation errors, idempotent upserts, run logging.

Every adapter produces plain row dicts per canonical table. Primary keys are derived from
(source_system, table, source_id), so re-importing the same source updates rows in place instead
of duplicating them, and references between records resolve without database lookups.
"""
import datetime
import json
import uuid
from collections import Counter, defaultdict

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models.models import ImportRun, ImportErrorRecord, Document

# Columns that ClinicalBrief owns after the first import; a re-import must not reset them
# (e.g. a processed document must not flip back to 'pending').
KEEP_ON_REIMPORT = {Document: {"status"}}

_NAMESPACE = uuid.UUID("5b1c1c1e-6c7a-4f7e-9d2a-0c1b2e3f4a5b")  # fixed: changing it re-keys every import


def det_id(source_system: str, table: str, source_id: str) -> str:
    return str(uuid.uuid5(_NAMESPACE, f"{source_system}|{table}|{source_id}"))


class Reject(Exception):
    """Raised by a mapper when a source record fails validation. The record is skipped and logged."""


def parse_dt(value) -> datetime.datetime | None:
    """ISO-8601 / 'YYYY-MM-DD HH:MM:SS' -> aware datetime (naive source times are taken as UTC)."""
    if not value:
        return None
    try:
        dt = datetime.datetime.fromisoformat(str(value).strip())
    except ValueError:
        raise Reject(f"unparseable datetime {value!r}")
    return dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)


def parse_date(value) -> datetime.date | None:
    dt = parse_dt(value)
    return dt.date() if dt else None


class Batch:
    """Collects mapped rows (deduplicated by primary key) and rejected records for one import."""

    def __init__(self, source_system: str):
        self.source_system = source_system
        self.rows: dict[type, dict[str, dict]] = defaultdict(dict)
        self.errors: list[dict] = []
        self.counts: Counter = Counter()

    def add(self, model, row: dict):
        pk = model.__table__.primary_key.columns.values()[0].name
        table = model.__tablename__
        self.counts[f"{table}.read"] += 1
        if row[pk] in self.rows[model]:
            self.counts[f"{table}.duplicate"] += 1
        if hasattr(model, "source_system"):
            row.setdefault("source_system", self.source_system)
            row.setdefault("provenance", "imported")
        self.rows[model][row[pk]] = row

    def reject(self, table: str, source_file: str, record_ref, reason: str, raw=None):
        self.counts[f"{table}.rejected"] += 1
        self.errors.append({
            "source_file": source_file, "record_ref": str(record_ref)[:255], "reason": reason,
            "raw": (json.dumps(raw, default=str) if not isinstance(raw, str) else raw)[:2000] if raw is not None else None,
        })

    def has(self, model, pk: str) -> bool:
        return pk in self.rows[model]


def upsert(db: Session, model, rows: list[dict], chunk_size: int = 500) -> int:
    """INSERT ... ON CONFLICT (pk) DO UPDATE, portable across Postgres and SQLite."""
    if not rows:
        return 0
    insert = pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
    pk = model.__table__.primary_key.columns.values()[0].name
    columns = sorted({k for r in rows for k in r})
    for i in range(0, len(rows), chunk_size):
        chunk = [{c: r.get(c) for c in columns} for r in rows[i:i + chunk_size]]
        stmt = insert(model).values(chunk)
        keep = KEEP_ON_REIMPORT.get(model, set()) | {pk}
        stmt = stmt.on_conflict_do_update(index_elements=[pk], set_={c: stmt.excluded[c] for c in columns if c not in keep})
        db.execute(stmt)
    return len(rows)


def run_import(db: Session, source_system: str, source_path: str, build, write_order, dry_run=False) -> ImportRun:
    """Runs one import: build() fills a Batch, then rows are upserted in FK order in one transaction.

    Invalid records are skipped and logged to import_errors; any unexpected failure rolls back all
    data writes and marks the run 'failed' with the reason.
    """
    run = ImportRun(source_system=source_system, source_path=source_path, status="running", dry_run=dry_run)
    db.add(run)
    db.commit()
    run_id = run.run_id
    batch = Batch(source_system)
    try:
        build(batch)
        if not dry_run:
            for model in write_order:
                n = upsert(db, model, list(batch.rows[model].values()))
                batch.counts[f"{model.__tablename__}.written"] += n
        for err in batch.errors:
            db.add(ImportErrorRecord(run_id=run_id, **err))
        run.status = "completed"
        run.message = "Dry run: validated only, nothing written." if dry_run else None
    except Exception as e:
        db.rollback()
        run = db.get(ImportRun, run_id)
        run.status = "failed"
        run.message = f"{type(e).__name__}: {e}"[:2000]
    run.counts = dict(sorted(batch.counts.items()))
    run.error_count = len(batch.errors)
    run.finished_at = datetime.datetime.now(datetime.timezone.utc)
    db.commit()
    return run
