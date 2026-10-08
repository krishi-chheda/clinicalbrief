"""ClinicalBrief admin CLI.

    py -3.12 -m app.cli discover ../data/raw/synthea-fhir
    py -3.12 -m app.cli import synthea ../data/raw/synthea-fhir [--dry-run] [--limit 10]
    py -3.12 -m app.cli runs
    py -3.12 -m app.cli process-notes --limit 20
    py -3.12 -m app.cli process-notes --per-patient 3     # each patient's newest 3 unprocessed notes
    py -3.12 -m app.cli set-role someone@example.com consultant
    py -3.12 -m app.cli ask <patient_id> "What medications is the patient on?"
    py -3.12 -m app.cli flag-demo [--count 10] [--apply]     # choose the public demo patients (dry run by default)
"""
import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from app.core.database import Base, SessionLocal, engine, is_sqlite
from app.ingestion import synthea
from app.ingestion.core import run_import
from app.models.models import AuditLog, Document, ImportRun, ImportErrorRecord, User

ADAPTERS = {"synthea": synthea}


def discover(path: Path):
    """Reports what a directory contains before anything is imported."""
    files = synthea.bundle_files(path)
    if not files:
        print(f"No recognised source under {path} (expected FHIR bundle *.json)")
        return
    types, bundle_types = Counter(), Counter()
    for f in files:
        b = json.loads(f.read_text(encoding="utf-8"))
        bundle_types[b.get("type")] += 1
        types.update(e["resource"]["resourceType"] for e in b.get("entry", []) if "resource" in e)
    print(f"Detected: FHIR bundles ({len(files)} files, bundle types {dict(bundle_types)})")
    for t, n in types.most_common():
        mapped = "import" if t in synthea.MAPPERS or t == "Patient" else "via MedicationRequest" if t == "Medication" else "skip"
        print(f"  {t:28} {n:>8}  [{mapped}]")


def print_run(db, run: ImportRun):
    print(f"\nRun {run.run_id}  {run.source_system}  status={run.status}{' (dry run)' if run.dry_run else ''}"
          f"  errors={run.error_count}  {run.started_at:%Y-%m-%d %H:%M:%S} -> {run.finished_at:%H:%M:%S}")
    if run.message:
        print(f"  {run.message}")
    for key, n in (run.counts or {}).items():
        print(f"  {key:40} {n:>8}")
    for err in db.query(ImportErrorRecord).filter_by(run_id=run.run_id).limit(10):
        print(f"  ! {err.source_file} {err.record_ref}: {err.reason}")


# ponytail: fixed thresholds; tune if the dataset changes. The cap keeps each demo record light enough for the free
# hosted API (the largest synthetic records have tens of thousands of observations).
DEMO_MIN_NOTES, DEMO_MAX_LABS = 2, 3000


def pick_demo_patients(db, count: int):
    """The `count` Synthea patients best suited to the public demo: at least two analysed notes (so Compare works),
    some conditions, medications and lab results, not oversized. Ranked by reviewed AI findings, then analysed
    notes, then conditions + medications. Returns [(patient, stats)]."""
    from sqlalchemy import func
    from app.models.models import Diagnosis, Entity, Medication, Observation, Patient
    from app.services.entities import REVIEWED_STATUSES

    def per_patient(q):
        return dict(q.all())
    notes = per_patient(db.query(Document.patient_id, func.count()).filter(Document.status == "completed").group_by(Document.patient_id))
    conds = per_patient(db.query(Diagnosis.patient_id, func.count()).group_by(Diagnosis.patient_id))
    meds = per_patient(db.query(Medication.patient_id, func.count()).group_by(Medication.patient_id))
    labs = per_patient(db.query(Observation.patient_id, func.count()).group_by(Observation.patient_id))
    reviewed = per_patient(db.query(Document.patient_id, func.count(Entity.entity_id))
                           .join(Entity, Entity.document_id == Document.document_id)
                           .filter(Entity.review_status.in_(REVIEWED_STATUSES)).group_by(Document.patient_id))
    picked = []
    for patient in db.query(Patient).filter(Patient.source_system == synthea.SOURCE):
        pid = patient.patient_id
        stats = {"notes": notes.get(pid, 0), "reviewed": reviewed.get(pid, 0), "conditions": conds.get(pid, 0),
                 "medications": meds.get(pid, 0), "labs": labs.get(pid, 0)}
        if (stats["notes"] >= DEMO_MIN_NOTES and stats["conditions"] and stats["medications"]
                and 0 < stats["labs"] <= DEMO_MAX_LABS):
            picked.append((patient, stats))
    picked.sort(key=lambda ps: (ps[1]["reviewed"], ps[1]["notes"], ps[1]["conditions"] + ps[1]["medications"]), reverse=True)
    return picked[:count]


def flag_demo(db, count: int, apply: bool):
    from app.models.models import Patient
    chosen = pick_demo_patients(db, count)
    if not chosen:
        sys.exit("No Synthea patient qualifies (needs >= 2 analysed notes, conditions, medications and lab results).")
    print(f"{'patient_id':38} {'name':28} {'notes':>5} {'reviewed':>8} {'conds':>5} {'meds':>5} {'labs':>5}")
    for p, st in chosen:
        print(f"{p.patient_id:38} {(p.first_name + ' ' + p.last_name)[:28]:28} {st['notes']:>5} {st['reviewed']:>8} "
              f"{st['conditions']:>5} {st['medications']:>5} {st['labs']:>5}")
    if len(chosen) < count:
        print(f"Only {len(chosen)} patients qualify (asked for {count}).")
    if not apply:
        print("Dry run: nothing changed. Re-run with --apply to make exactly these the demo patients.")
        return
    db.query(Patient).filter(Patient.is_demo.is_(True)).update({Patient.is_demo: False}, synchronize_session=False)
    db.query(Patient).filter(Patient.patient_id.in_([p.patient_id for p, _ in chosen])).update(
        {Patient.is_demo: True}, synchronize_session=False)
    db.add(AuditLog(user_id=None, action_type="demo_patients_flagged", extraction_source=f"{len(chosen)} patients"))
    db.commit()
    print(f"Flagged {len(chosen)} demo patients; every other patient is now is_demo = false.")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="app.cli", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("discover"); p.add_argument("path", type=Path)
    p = sub.add_parser("import"); p.add_argument("source", choices=ADAPTERS); p.add_argument("path", type=Path)
    p.add_argument("--dry-run", action="store_true"); p.add_argument("--limit", type=int, help="max patients")
    sub.add_parser("runs")
    p = sub.add_parser("process-notes"); p.add_argument("--limit", type=int, default=10)
    p.add_argument("--per-patient", type=int, help="process each patient's newest N unprocessed notes (ignores --limit)")
    p = sub.add_parser("set-role"); p.add_argument("email"); p.add_argument("role")
    p = sub.add_parser("ask", help="grounded Copilot answer from the local LLM (no auth; local admin tool)")
    p.add_argument("patient_id"); p.add_argument("question")
    p = sub.add_parser("flag-demo", help="choose the patients the public demo can see (dry run unless --apply)")
    p.add_argument("--count", type=int, default=10); p.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    if (args.cmd in ("import", "process-notes", "set-role", "ask") and not getattr(args, "dry_run", False)) or             (args.cmd == "flag-demo" and args.apply):
        from app.core.database import db_host, is_remote  # is_sqlite is the module-level import
        target = "local SQLite" if is_sqlite else f"{'REMOTE' if is_remote else 'local'} Postgres at {db_host}"
        print(f"Target database: {target}", file=sys.stderr)

    if is_sqlite:
        Base.metadata.create_all(bind=engine)  # Postgres schema comes from migrations/
    db = SessionLocal()
    try:
        if args.cmd == "discover":
            discover(args.path)
        elif args.cmd == "import":
            if not args.path.exists():
                sys.exit(f"Path not found: {args.path}")
            adapter = ADAPTERS[args.source]
            run = run_import(db, adapter.SOURCE, str(args.path.resolve()), adapter.build(args.path, args.limit),
                             adapter.WRITE_ORDER, dry_run=args.dry_run)
            print_run(db, run)
            if run.status == "failed":
                sys.exit(1)
        elif args.cmd == "runs":
            for run in db.query(ImportRun).order_by(ImportRun.started_at.desc()).limit(20):
                print_run(db, run)
        elif args.cmd == "process-notes":
            from app.api.v1.documents import run_ingestion_pipeline
            q = (db.query(Document).filter(Document.status == "pending", Document.clinical_note.has())
                 .order_by(Document.document_date.desc()))
            if args.per_patient:
                taken = Counter()
                docs = [d for d in q.all() if (taken.update([d.patient_id]) or taken[d.patient_id] <= args.per_patient)]
            else:
                docs = q.limit(args.limit).all()
            print(f"Processing {len(docs)} notes")
            for d in docs:
                run_ingestion_pipeline(d.document_id, SessionLocal, report_progress=False)
                db.refresh(d)
                print(f"  {d.status:10} {d.document_id}  {d.file_name}")
        elif args.cmd == "ask":
            import time
            from app.services.grounded_copilot import grounded_answer
            t = time.time()
            r = grounded_answer(db, args.patient_id, args.question)
            db.add(AuditLog(user_id=None, action_type="copilot_query_cli", model_used=r["mode"][:100],
                            extraction_source=f"Patient ID: {args.patient_id}; grounding: {r['grounding']}"))
            db.commit()
            print(f"[{r['mode']} | grounding={r['grounding']} | {r['evidence_count']} evidence items | {time.time() - t:.1f}s]")
            print(f"  searched for: {', '.join(r.get('search_terms') or []) or '(question words only)'}")
            print(r["answer"])
            for c in r["citations"]:
                print(f"  {c['id']} [{c['kind']} | {c['source_system']} | {c['date']}] {c['text'][:120]}")
            for w in r["warnings"]:
                print(f"  ! {w}")
        elif args.cmd == "flag-demo":
            flag_demo(db, args.count, args.apply)
        elif args.cmd == "set-role":
            from app.api.v1.deps import ROLES
            if args.role not in ROLES:
                sys.exit(f"Unknown role {args.role!r}. Valid: {', '.join(sorted(ROLES))}")
            user = db.query(User).filter(User.email == args.email).first()
            if not user:
                sys.exit(f"No profile for {args.email}. The user must sign up (Supabase Auth) first.")
            user.role = args.role
            db.commit()
            print(f"{args.email} -> {args.role}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
