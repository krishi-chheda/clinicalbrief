"""ClinicalBrief admin CLI.

    py -3.12 -m app.cli discover ../data/raw/synthea-fhir
    py -3.12 -m app.cli import synthea ../data/raw/synthea-fhir [--dry-run] [--limit 10]
    py -3.12 -m app.cli runs
    py -3.12 -m app.cli process-notes --limit 20
    py -3.12 -m app.cli process-notes --per-patient 3     # each patient's newest 3 unprocessed notes
    py -3.12 -m app.cli set-role someone@example.com consultant
    py -3.12 -m app.cli ask <patient_id> "What medications is the patient on?"
    py -3.12 -m app.cli flag-demo [--count 10] [--apply]     # choose the public demo patients (dry run by default)
    py -3.12 -m app.cli eval-sample                          # write eval/notes/*.txt for the labelled set (reads only)
    py -3.12 -m app.cli eval-extraction                      # score the note pipeline against eval/gold
    py -3.12 -m app.cli eval-search-db / eval-search         # keyword vs meaning search comparison (see eval/)
    py -3.12 -m app.cli embed-notes [--limit 1000]           # local embeddings for "match meaning" search (writes)
"""
import argparse
import json
import os
import sys

# Commands that only read and write files never need a database: give them a throwaway in-memory one, so they run
# without DATABASE_URL and can never touch the live database configured in .env.
_NO_DB = {"build-vocab", "eval-review", "eval-mark-reviewed", "eval-extraction"}
if len(sys.argv) > 1 and sys.argv[1] in _NO_DB:
    os.environ["DATABASE_URL"] = "sqlite://"
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


def demo_rank(stats: dict):
    """Sort key: most reviewed AI findings first (they make the demo show something), then the smallest record
    (notes + lab results), so the hosted API stays quick."""
    return (-stats["reviewed"], stats["notes"] + stats["labs"])


def pick_demo_patients(db, count: int):
    """The `count` Synthea patients best suited to the public demo: at least two analysed notes (so Compare works),
    some conditions, medications and lab results, not oversized. Ranked by demo_rank (reviewed AI findings, then
    smallest record). Returns [(patient, stats)]."""
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
    picked.sort(key=lambda ps: demo_rank(ps[1]))
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


EVAL_DIR = Path(__file__).resolve().parents[1] / "eval"


def eval_sample(db, count: int, seed: int, resample: bool):
    """Read-only: chooses the notes once (eval/sample.json, committed), then writes their text to eval/notes."""
    from app.models.models import ClinicalNote
    from app.services.evaluation import pick_sample
    sample = EVAL_DIR / "sample.json"
    if resample or not sample.exists():
        sample.parent.mkdir(parents=True, exist_ok=True)
        sample.write_text(json.dumps({"seed": seed, "count": count, "note_ids": pick_sample(db, count, seed)}, indent=1),
                          encoding="utf-8")
    ids = json.loads(sample.read_text(encoding="utf-8"))["note_ids"]
    (EVAL_DIR / "notes").mkdir(exist_ok=True)
    found = {n.document_id: n.original_text for n in db.query(ClinicalNote).filter(ClinicalNote.document_id.in_(ids))}
    for i in ids:
        if i in found:
            (EVAL_DIR / "notes" / f"{i}.txt").write_text(found[i], encoding="utf-8")
    missing = [i for i in ids if i not in found]
    print(f"{len(ids) - len(missing)} of {len(ids)} notes written to {EVAL_DIR / 'notes'}")
    if missing:
        sys.exit(f"{len(missing)} notes are not in this database (import the Synthea sample first), e.g. {missing[0]}")


def eval_extraction(set_name: str = "synthea40", vocab: str = None):
    from datetime import date
    from app.core.config import settings
    from app.services.evaluation import run_extraction_eval
    vocab = vocab or settings.EXTRACTION_VOCAB
    r = run_extraction_eval(EVAL_DIR if set_name == "synthea40" else EVAL_DIR / set_name, vocab=vocab)
    f = lambda v: "  -  " if v is None else f"{v:.2f}"
    ci = lambda c: "" if c[0] is None else f" [{c[0]:.2f}-{c[1]:.2f}]"
    print(f"{r['notes']} notes, {r['targets']} target mentions ({r['gold_mentions']} labelled); pipeline: {r['pipeline']}; "
          f"labelled by: {', '.join(r['labelled_by'])}; reviewed by: {', '.join(r['reviewed_by'])}")
    for mode in ("strict", "lenient"):
        o = r[mode]["overall"]
        print(f"\n{mode}: precision {f(o['precision'])}{ci(o['precision_ci95'])}  recall {f(o['recall'])}{ci(o['recall_ci95'])}"
              f"  F1 {f(o['f1'])}{ci(o['f1_ci95'])}  (tp {o['tp']}, fp {o['fp']}, fn {o['fn']}; "
              f"negation errors {r[mode]['negation_errors']}, family-history errors {r[mode]['subject_errors']})")
        for t, v in r[mode]["by_type"].items():
            print(f"  {t:11} P {f(v['precision'])}{ci(v['precision_ci95'])}  R {f(v['recall'])}{ci(v['recall_ci95'])}"
                  f"  (tp {v['tp']}, fp {v['fp']}, fn {v['fn']})")
    out = EVAL_DIR / "results" / f"extraction-{set_name}-{vocab}-{date.today().isoformat()}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(r, indent=1), encoding="utf-8")
    print(f"\nwritten {out}")


def eval_search_db(source: Path):
    """Builds a throwaway local Postgres (pgserver, eval/search/pg) with the real migrations and copies the Synthea
    patients, documents and notes from a local SQLite import into it. Prints its URL. Never touches DATABASE_URL."""
    import sqlite3
    import pgserver, psycopg
    tests = Path(__file__).resolve().parents[1] / "tests"
    uri = pgserver.get_server(EVAL_DIR / "search" / "pg", cleanup_mode=None).get_uri()
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row
    with psycopg.connect(uri, autocommit=True) as pg:
        pg.execute("DROP SCHEMA IF EXISTS private, extensions CASCADE")  # rebuilt from scratch (the stub resets the rest)
        pg.execute((tests / "supabase_stub.sql").read_text())
        for m in sorted((tests.parent / "migrations").glob("*.sql")):
            pg.execute(m.read_text())
        queries = {
            "patients": "SELECT * FROM patients WHERE source_system = 'synthea'",
            "documents": "SELECT d.* FROM documents d JOIN patients p USING (patient_id) WHERE p.source_system = 'synthea'",
            "clinical_notes": "SELECT n.* FROM clinical_notes n JOIN patients p USING (patient_id) WHERE p.source_system = 'synthea'",
        }
        for table, sql in queries.items():
            cols = {r[0]: r[1] for r in pg.execute(
                "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' "
                "AND table_name = %s AND is_generated = 'NEVER'", (table,))}
            rows = src.execute(sql).fetchall()
            keep = [c for c in rows[0].keys() if c in cols]
            nulls = {"encounter_id", "uploaded_by", "assigned_clinician_id"}  # rows those point to are not copied
            fix = lambda c, v: None if c in nulls else (bool(v) if cols[c] == "boolean" and v is not None else v)
            with pg.cursor() as cur:
                cur.executemany(f"INSERT INTO {table} ({', '.join(keep)}) VALUES ({', '.join(['%s'] * len(keep))})",
                                [[fix(c, r[c]) for c in keep] for r in rows])
            print(f"  {table:15} {len(rows):>6}")
    print(f"\nRun the comparison against it:\n  DATABASE_URL={uri} py -3.12 -m app.cli eval-search")


def build_vocab(source: Path):
    """Writes app/data/terminology.tsv from the CMS ICD-10-CM order file (zip) and the RxNav ingredient list (JSON)."""
    import zipfile
    from app.services.terminology import TSV, build_terms
    zf = zipfile.ZipFile(source / "icd10cm.zip")
    order = next(n for n in zf.namelist() if n.endswith(".txt") and "order" in n and "addenda" not in n)
    icd = [(line[6:14].strip(), line[77:].strip()) for line in zf.read(order).decode("latin-1").splitlines() if len(line) > 77]
    rx = [c["name"] for c in json.loads((source / "rxnorm_in.json").read_text(encoding="utf-8"))["minConceptGroup"]["minConcept"]]
    terms = build_terms(icd, rx)
    TSV.parent.mkdir(exist_ok=True)
    TSV.write_text("term\ttype\tcode\tsource\tdescription\n" + "".join(
        f"{t}\t{typ}\t{code or ''}\t{src}\t{desc}\n" for t, typ, code, src, desc in terms), encoding="utf-8")
    by = Counter(typ for _, typ, *_ in terms)
    print(f"{len(icd)} ICD-10-CM entries ({order}), {len(rx)} RxNorm ingredients -> {len(terms)} terms {dict(by)}")
    print(f"written {TSV} ({TSV.stat().st_size // 1024} KB)")


def eval_review(set_name: str):
    """Writes eval/review-<set>.html: each note beside its labels, for the author's review (gitignored: note text)."""
    import html
    base = EVAL_DIR if set_name == "synthea40" else EVAL_DIR / set_name
    rows = []
    for g in sorted((base / "gold").glob("*.json")):
        doc = json.loads(g.read_text(encoding="utf-8"))
        note = (base / "notes" / f"{doc['note_id']}.txt").read_text(encoding="utf-8")
        labels = "".join(
            f"<tr><td>{html.escape(m['text'])}</td><td>{m['type']}</td><td>{'negated' if m.get('negated') else ''}"
            f"{' family' if m.get('subject', 'patient') != 'patient' else ''}</td></tr>" for m in doc["mentions"]) \
            or "<tr><td colspan=3><i>no labels</i></td></tr>"
        rows.append(f"<section><h2>{doc['note_id']} <small>{html.escape(str(g.relative_to(EVAL_DIR.parent)))}</small></h2>"
                    f"<div class=g><pre>{html.escape(note)}</pre><table><tr><th>Label</th><th>Type</th><th></th></tr>{labels}"
                    f"</table></div></section>")
    out = EVAL_DIR / f"review-{set_name}.html"
    out.write_text(f"""<!doctype html><meta charset=utf-8><title>Label review: {set_name}</title><style>
body{{font:14px system-ui;margin:24px;max-width:1200px}} .g{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}
pre{{white-space:pre-wrap;background:#f6f6f2;padding:12px;border-radius:8px}} td,th{{padding:3px 8px;border-bottom:1px solid #ddd;text-align:left}}
section{{border-top:2px solid #18280E;padding-top:8px;margin-top:24px}} small{{color:#666;font-weight:normal}}</style>
<h1>Label review: {set_name} ({len(rows)} notes)</h1>
<p>Check each note against <code>eval/GUIDELINE.md</code>. To change a label, edit the JSON file named under the note.
When every note is checked, run <code>py -3.12 -m app.cli eval-mark-reviewed --set {set_name} --by "Your Name"</code>.</p>
{''.join(rows)}""", encoding="utf-8")
    print(f"written {out}")


def eval_mark_reviewed(set_name: str, by: str):
    base = EVAL_DIR if set_name == "synthea40" else EVAL_DIR / set_name
    files = sorted((base / "gold").glob("*.json"))
    for g in files:
        doc = json.loads(g.read_text(encoding="utf-8"))
        doc["reviewed_by"] = by
        g.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    print(f"{len(files)} gold files marked reviewed by {by!r}; re-run eval-extraction --set {set_name} to publish it")


def embed_notes(db, limit=None):
    """Embeds, with the local model, every note that has no embedding yet (resumable: run it again to continue)."""
    from sqlalchemy import text
    from app.core.database import is_sqlite
    from app.services.embeddings import EMBED_MODEL, embed, shorten, to_pg
    if is_sqlite:
        sys.exit("Note embeddings live in Postgres (migration 0014).")
    sql = ("SELECT n.document_id, n.original_text FROM clinical_notes n "
           "LEFT JOIN note_embeddings e ON e.document_id = n.document_id WHERE e.document_id IS NULL ORDER BY n.document_id")
    todo = db.execute(text(sql + (f" LIMIT {int(limit)}" if limit else ""))).all()
    print(f"{len(todo)} notes to embed with {EMBED_MODEL} (local)")
    for i in range(0, len(todo), 64):
        batch = todo[i:i + 64]
        vecs = shorten(embed([t for _, t in batch], "search_document"))
        db.execute(text("INSERT INTO note_embeddings (document_id, model, embedding) "
                        "VALUES (:d, :m, CAST(:v AS extensions.vector)) ON CONFLICT (document_id) DO NOTHING"),
                   [{"d": d, "m": EMBED_MODEL, "v": to_pg(v)} for (d, _), v in zip(batch, vecs)])
        db.commit()  # per batch, so an interrupted run keeps its progress
        print(f"  {min(i + 64, len(todo))}/{len(todo)}", end=chr(13))
    print()


def eval_search(db):
    from datetime import date
    from app.core.database import is_sqlite
    from app.services.search_eval import run_search_eval
    if is_sqlite:
        sys.exit("The keyword baseline is Postgres full-text search: point DATABASE_URL at the eval-search-db database.")
    r = run_search_eval(db, EVAL_DIR)
    print(f"{r['notes']} notes, {r['scored']} of {r['questions']} questions scored (no relevant note: "
          f"{', '.join(r['excluded_no_relevant']) or 'none'}), top {r['k']}, embeddings: {r['embed_model']} (local)\n")
    print(f"{'method':9} {'nDCG@10':>8} {'P@10':>6} {'MRR':>6}")
    for m, s in r["summary"].items():
        print(f"{m:9} {s['ndcg']:8.3f} {s['p']:6.3f} {s['mrr']:6.3f}")
    for m, d in r["vs_keyword"].items():
        print(f"\n{m} - keyword: nDCG@10 {d['ndcg_diff']:+.3f}, 95% CI [{d['ci95'][0]:+.3f}, {d['ci95'][1]:+.3f}] -> {d['verdict']}")
    print(f"\nOutcome: {r['outcome']}")
    out = EVAL_DIR / "results" / f"search-{date.today().isoformat()}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(r, indent=1), encoding="utf-8")
    print(f"written {out}")


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
    p = sub.add_parser("eval-sample", help="write the labelled set's note texts to eval/notes (reads the database only)")
    p.add_argument("--count", type=int, default=40); p.add_argument("--seed", type=int, default=101)
    p.add_argument("--resample", action="store_true", help="choose new notes (replaces eval/sample.json)")
    p = sub.add_parser("eval-extraction", help="score the note pipeline against a labelled set, write eval/results")
    p.add_argument("--set", dest="set_name", default="synthea40", choices=["synthea40", "negation"])
    p.add_argument("--vocab", choices=["core", "extended"], help="default: EXTRACTION_VOCAB")
    p = sub.add_parser("eval-search-db", help="local Postgres copy of the Synthea notes for eval-search")
    p.add_argument("--from", dest="source", type=Path, default=Path(__file__).resolve().parents[1] / "clinicalbrief_dev.db")
    sub.add_parser("eval-search", help="keyword vs semantic vs hybrid note search on eval/search/questions.jsonl")
    sub.add_parser("eval-linking", help="record-linking coverage on the labelled set (needs the notes' patients)")
    p = sub.add_parser("embed-notes", help="store local embeddings for notes that have none (migration 0014)")
    p.add_argument("--limit", type=int, help="at most this many notes")
    p = sub.add_parser("build-vocab", help="extraction vocabulary from ICD-10-CM and RxNorm downloads (see DEPLOY/README)")
    p.add_argument("--from", dest="source", type=Path,
                   default=Path(__file__).resolve().parents[2] / "data" / "raw" / "terminology")
    p = sub.add_parser("eval-review", help="side-by-side page of notes and labels for the author's review")
    p.add_argument("--set", dest="set_name", default="synthea40", choices=["synthea40", "negation"])
    p = sub.add_parser("eval-mark-reviewed", help="record who reviewed a labelled set")
    p.add_argument("--set", dest="set_name", default="synthea40", choices=["synthea40", "negation"])
    p.add_argument("--by", required=True)
    args = parser.parse_args(argv)
    if args.cmd == "eval-review":
        return eval_review(args.set_name)            # files only
    if args.cmd == "eval-mark-reviewed":
        return eval_mark_reviewed(args.set_name, args.by)
    if args.cmd == "build-vocab":
        return build_vocab(args.source)  # files only, no database
    if args.cmd == "eval-search-db":
        return eval_search_db(args.source)  # works on its own throwaway database, not DATABASE_URL
    if (args.cmd in ("import", "process-notes", "set-role", "ask", "embed-notes") and not getattr(args, "dry_run", False)) or             (args.cmd == "flag-demo" and args.apply):
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
        elif args.cmd == "eval-sample":
            eval_sample(db, args.count, args.seed, args.resample)
        elif args.cmd == "eval-extraction":
            eval_extraction(args.set_name, args.vocab)
        elif args.cmd == "eval-search":
            eval_search(db)
        elif args.cmd == "eval-linking":
            from app.services.evaluation import linking_coverage
            r = linking_coverage(db, EVAL_DIR)
            print(json.dumps(r, indent=1))
            (EVAL_DIR / "results" / "linking-synthea40.json").write_text(json.dumps(r, indent=1), encoding="utf-8")
        elif args.cmd == "embed-notes":
            embed_notes(db, args.limit)
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
