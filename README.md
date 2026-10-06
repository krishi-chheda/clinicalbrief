# ClinicalBrief

A clinical intelligence platform prototype: it ingests clinical records, structures them into one
canonical model with provenance, runs an AI pipeline over clinical notes, and keeps humans in control
of every AI output.

> **Status: research prototype.** It runs on synthetic (Synthea) data only.
> No clinical validation, accuracy evaluation or regulatory compliance is claimed.

## What is implemented, and how real it is

| Area | Status | Notes |
|---|---|---|
| Canonical clinical model | **Implemented** | Patients, encounters, notes, diagnoses, medications, allergies, procedures, observations. Every record carries `source_system`, `source_id`, `provenance`. |
| Data ingestion | **Implemented** | Synthea FHIR R4 adapter; dry run, per-record validation, rejected-record log, idempotent re-import, run history. |
| Auth | **Implemented** | Supabase Auth; backend verifies tokens (JWKS or legacy HS256, audience + expiry). |
| Authorization | **Implemented** | Six roles enforced in the API and mirrored in Postgres row-level security (see below). |
| Human review + audit | **Implemented** | Cross-patient **review queue** (`/review`): AI findings with their evidence sentence, approve / reject / edit, bulk approve per note, undo, keyboard shortcuts. Decisions are all-or-nothing, refused (409) if someone else changed the finding meanwhile, and each writes `review_history` plus an audit row. AI output is never treated as fact until a person approves or edits it: the graph, FHIR export, Copilot structured answers and the risk score use **reviewed entities only** and report how many are pending. **Governance** page (`/governance`, admin and auditor): pending count and age, decisions by type, extraction method and reviewer, latest decisions. All live counts; rates are shares of human decisions, not accuracy. |
| AI note pipeline | **Prototype** | Default mode (`USE_MOCK_MODELS=true`) is rule-based: whole-word dictionary matching (~60 terms) with NegEx-style negation ("no history of", "denies", "ruled out", scoped by "but"/";" and ended by affirmations such as "positive for", "reports"), a family-history check ("family history of", "mother had …" are not attributed to the patient), "allergic to X" treated as an allergy, and an **extractive** summary (sentences copied from the note). It has no calibrated confidence, so confidence is **null**, not a number. Re-processing is idempotent (one transaction; stale runs retryable). Transformer mode exists but is untested. |
| ICD-10 suggestions | **Prototype** | Exact match against a 17-entry dictionary; anything else stays **unmapped** (no default code). Suggestions only, for human review. |
| Copilot | **Prototype** | **Local LLM** (Ollama, default `qwen3.5`), grounded in one patient's record. Patient data never leaves the machine: only loopback LLM URLs and locally-run models are accepted (Ollama cloud models are refused). See [Copilot](#copilot-local-llm-grounded) below. Falls back to labelled rule-based answers if the model is unavailable. |
| Search | **Prototype** | In-memory index rebuilt at startup (term frequency in prototype mode). Patient / document scope is applied before ranking. |
| Risk score | **Prototype** | Hand-written heuristic over reviewed entities only; labelled "not clinically validated" in the UI. Read-only (viewing does not store anything). |
| PHI redaction | **Prototype** | Regex patterns only (dates, US and Australian phone numbers, emails, record and insurance numbers); not a validated de-identification method. Medicare numbers, names and addresses are not detected. The note-text view gives researchers the redacted text only; other endpoints (entity evidence sentences, Copilot citations, patient demographics) are **not** de-identified yet. |
| FHIR export | **Implemented (structural R4 only)** | Transaction bundle built from the **canonical record**: Patient (source identifier), Encounter, Condition (SNOMED, clinical status from the data), MedicationStatement (RxNorm, status from the data; not MedicationRequest, whose required `intent` was never captured), AllergyIntolerance, Procedure, Observation (LOINC, numeric values as Quantity). FHIR-required elements the source never provided are `unknown`, never guessed (Procedure/Observation status; Encounter status unless an end time exists). Human-reviewed AI findings are added as Condition `unconfirmed` / MedicationStatement `unknown`, tagged AI-extracted; every resource is tagged with its source. References resolve inside the bundle. Every export is checked and the result returned in `X-FHIR-Validation`: R4 types and cardinality (`fhir.resources` R4B models, which do not check invariants), every reference resolving in the bundle, and Condition invariant con-4. Other invariants and terminology are not checked; a failing bundle cannot be downloaded from the UI. **Not** validated against AU Base / AU Core profiles or terminology (the HL7 validator needs Java 11+; this machine has Java 8), and synthetic patients lack AU identifiers such as an IHI. Multi-part observations (blood pressure) are exported as text, not components. Size: 0.4 MB / 573 resources for a typical patient, 10.6 MB / 12,871 for the largest (4.7 s). On demand from the Record tab; each export is audited. |
| Knowledge graph | **Prototype** | Patient-centred: current conditions, findings, medications and allergies from the structured record, plus AI-extracted findings only after human review (drawn with a dashed outline; pending ones are counted, not drawn). At most 15 nodes per type. AI disease-medication links are labelled "mentioned in same note" (co-occurrence, not clinical fact). |
| Record search | **Implemented** | `/search` page and `POST /api/v1/search/records`: Postgres full-text search over **every** note (35,103) and the structured record (conditions, medications, procedures, observations, allergies), persistent in the database (migrations `0010`, `0011`: a stored, database-generated note vector plus GIN indexes, ~9 MB of indexes at first, the stored vector adds more). Patient / type / date filters; best-match (`ts_rank`) or timeline order; medications as started / stopped events, so a date range shows medication changes. Optional related terms from the local LLM (e.g. drug names for "diabetes medication"); without the model the search is literal and the page says so. Scoped to accessible patients; researchers get no note text; the query text is never logged. Measured on the live data, database query only and warm cache: a query matching 15,021 notes ranks in ~70 ms, timeline order ~0.2 s. Cold queries are much slower (an independent check measured 2.2 s cold, ~150 ms warm for an 18,343-match query), and end to end the request also searches five record types, builds snippets and may call the local model. Keyword-based, not semantic (embeddings are Phase 8b). |
| Observability | **Implemented (in-process)** | `/ops` page (admin, auditor) and `GET /api/v1/ops/health`, `/ops/metrics`: live checks of the database round trip, the local LLM and the in-memory search index; per-route request counts, 4xx/5xx and p50/p95/max latency, requests per minute, recent server errors. Every response carries `X-Request-ID`, also logged for 5xx and slow (>2 s) requests. Only route templates are recorded (never patient ids, queries or bodies). Kept in memory per process (last 20,000 requests), so it resets on restart and is not a metrics service. |
| Evaluation / accuracy metrics | **Not built** | No accuracy figure is shown anywhere until measured on a labelled set. |

## Architecture

```
Next.js 15 (clinicalbrief-frontend)  --Bearer token-->  FastAPI (clinicalbrief-backend)  -->  Postgres (Supabase) / SQLite (dev)
      |  Supabase Auth (supabase-js session, auto-refresh)       |
      |                                                          +-- app/ingestion   source adapters -> canonical model
      |                                                          +-- app/services    AI pipeline, search, FHIR, risk
      |                                                          +-- app/api/v1      REST API, role + patient checks
      +-- reads ONLY through the API                             migrations/        SQL schema + RLS (source of truth)
```

- **Schema:** `clinicalbrief-backend/migrations/*.sql` is the source of truth for Postgres. The ORM
  (`app/models/models.py`) must match it; a test fails on any drift.
- **Local development** uses SQLite (`clinicalbrief_dev.db`) created from the ORM. It has no migration
  path: after model changes, delete it and re-import.

## Quick start (Python 3.12)

Deploying (Vercel + Render + Supabase): see [DEPLOY.md](DEPLOY.md).

```bash
cd clinicalbrief-backend
py -3.12 -m pip install -r requirements-dev.txt   # runtime + test tools (requirements.txt is runtime only)
py -3.12 -m app.cli import synthea ../data/raw/synthea-fhir
py -3.12 -m uvicorn app.main:app --reload --no-access-log
```

`--no-access-log` is deliberate: uvicorn's access log prints full URLs, which contain patient ids and query
strings. Request timing, status and a request id per call are recorded by the app instead (route templates only;
see Observability), and 5xx or slow (> 2 s) requests are logged with their request id.

```bash
cd clinicalbrief-frontend
npm install
npm run dev
```

Signing in needs a Supabase project:

1. Create a project; in the SQL editor run every file in `migrations/` in order (`0001` … `0011`; there is no `0006`).
2. Copy `clinicalbrief-backend/.env.example` to `.env` and `clinicalbrief-frontend/.env.example` to `.env.local`, and fill them in.
   Never put a service-role / secret key in the frontend.
3. Create a user in Supabase Auth. New accounts start as `pending` with no access. Grant a role:
   `py -3.12 -m app.cli set-role you@example.com admin`
4. A remote database is **opt-in per process**: with `DATABASE_URL` pointing at Supabase, the backend and CLI refuse to
   start unless `CLINICALBRIEF_ALLOW_REMOTE_DB=1` is set for that process (PowerShell: `$env:CLINICALBRIEF_ALLOW_REMOTE_DB="1"`).
   Keep it out of `.env`, so scripts and tests can never write to live data by default. CLI write commands print the
   target database first.

`requirements-ml.txt` adds the transformer stack (several GB) for `USE_MOCK_MODELS=false`.

## Copilot (local LLM, grounded)

Each question runs through four steps (`app/services/grounded_copilot.py`):

1. **Expand.** The local model lists terms the record might use (e.g. "anticoagulants" becomes heparin, warfarin,
   apixaban). These terms only steer retrieval, and they are shown to the user.
2. **Retrieve.** Numbered evidence `E1…En` is built from this patient only: the structured record (diagnoses,
   medications, allergies, observations, encounters), human-reviewed AI entities, and the most relevant passages of
   the patient's own notes. Equally relevant items are ordered newest first, and identical records are collapsed.
3. **Generate.** The model is told to use only the evidence, cite `[E#]` on every factual sentence, and otherwise
   reply exactly "I couldn't find evidence for this in the available records." (temperature 0).
4. **Verify.** A guard checks each sentence:
   - it removes citations to sources that were never provided;
   - it removes cited sources that don't support the sentence (no shared distinctive term, or no matching value);
   - it **removes** sentences with no source (never shown, counted in a warning), and flags numbers that don't
     appear in the sources they cite;
   - it **withholds** the whole answer if the model's draft gave treatment or dosing advice anywhere, even in a
     sentence it removed;
   - it **withholds** any answer left with no valid citation.

   Every answer is labelled `grounded`, `partial`, `records-only`, `no-evidence` or `withheld`, with its warnings
   and sources.
5. **Note text is untrusted.** Evidence is sent inside `<evidence>…</evidence>` (tags inside notes are stripped) and
   the system prompt says it is data, never instructions. Enforced in code regardless of the model: answers with
   treatment or dosing advice are withheld, and an answer citing a record that contains instruction-like text
   ("ignore the rules above…") is never labelled `grounded`.

Setup: install [Ollama](https://ollama.com), run `ollama pull qwen3.5`, and set `LLM_MODEL` / `LLM_BASE_URL` in
`.env` if needed. Debug from the CLI with `py -3.12 -m app.cli ask <patient_id> "<question>"`. Automated tests use a
fake model; they never call Ollama.

**Live check (manual, not an evaluation).** llama3.1 8B on an RTX 5070 laptop GPU, one Synthea patient and one
MIMIC-IV patient (a dataset since removed from the project), 11 questions. The iterations found and fixed six defects, each now covered by a regression test:
- wrong citation format;
- citation spam, where one statement cited 14 unrelated items;
- a drug-class miss ("anticoagulants" did not match heparin);
- a "most recent" answer taken from an older lab result;
- runaway generation that hit the 120 s timeout (all model calls are now output-capped);
- a refusal that hid an allergy record when the record and a note disagreed. When the question names a record type,
  a refusal now shows the matching records verbatim, labelled `records-only`.

Final run on the final code:
- 6 answers were grounded and correct against the database: diagnoses, most recent creatinine, anticoagulants (heparin),
  kidney problems, medications, and the allergy record via `records-only`;
- 5 questions were correctly refused: 2 blood-type questions, chemotherapy, a heparin-dose recommendation, and
  hypertension for a patient who doesn't have it.

The medications answer was `grounded` in one run and `partial` (one uncited bullet, now removed rather than shown) in another. Output is not
perfectly reproducible between runs, even at temperature 0. Answers take 10-15 s (two model calls).

**Model comparison (same 11 questions, same retrieval and guard).**

| | llama3.1 8B | qwen3.5 9.7B (default) |
|---|---|---|
| Unanswerable questions refused | 5/5 | 4/5 fully; the 5th listed normal blood-pressure readings, then refused (flagged `partial`) |
| Allergy record vs "No Known Allergies" note | refused → `records-only` fallback | reported both sources with dates |
| Recall | heparin only; 4 of 6 medications | heparin **and** enoxaparin; all 6 medications; also found a glomerulonephritis diagnosis |
| Meaning errors found by manual check | labelled normal results "(abnormal)" | "heparin every 24 hours", where the source says 3 doses per 24h |
| Average time per question | ~16 s | ~19 s |

Both models make subtle errors. After this comparison the guard also flags clinical qualifiers (abnormal, high, low…)
that don't appear in the cited source, which catches llama's error. A *dropped* number, as in qwen's heparin
frequency, is still not detectable. qwen3.5 is the default for its recall and conflict handling. It is a "thinking"
model, so the gateway disables thinking; left on, it spent the whole output budget reasoning and returned nothing.

Limits:
- A statement can drop a detail from its source (a dose frequency, a date) and still pass the guard.
- The guard proves that a statement is *supported by the source it cites*, not that the reasoning is right.
  For example, "most recent" depends on retrieval ordering, which is why that ordering is tested.
- There is no labelled question set yet, so no accuracy figure is claimed.
- Each question is answered on its own; the conversation history is not used.

## Data

`data/raw/` is git-ignored. Sources:

| Dataset | Licence | Contents | Caveats |
|---|---|---|---|
| [Synthea sample, FHIR R4](https://synthetichealth.github.io/synthea-sample-data/) | Synthetic | 109 patients, 5,635 encounters with clinical notes | Notes are templated, so NLP results will look better than on real notes. |
| [Synthea Coherent Data Set](https://synthea.mitre.org/downloads) (FHIR part only) | CC BY 4.0 | 1,278 synthetic patients; 300 imported so far (`--limit 300`) to stay within the Supabase free-tier 500 MB | Same templated notes as above. DICOM, DNA and ECG data are not downloaded or imported. |

The Coherent Data Set is used under CC BY 4.0. Citation: Walonoski J, et al. The "Coherent Data Set": Combining
Patient Data and Imaging in a Comprehensive, Synthetic Health Record. *Electronics*. 2022;11(8):1199.
https://doi.org/10.3390/electronics11081199. Only the `fhir/` folder is fetched (about 370 MB via HTTP range
requests from the official 9 GB zip); imaging, genomics and claims are skipped.

MIMIC-IV demo was imported earlier and removed: it publishes no names, birth dates or notes, and its dates are
shifted into the 2100s, which did not suit a patient-centred workspace (migration `0007` drops its columns).

### Import CLI

```bash
py -3.12 -m app.cli discover <path>                         # what's in a folder, what will be imported or skipped
py -3.12 -m app.cli import synthea <path>         [--dry-run] [--limit N]
py -3.12 -m app.cli runs                                    # import history with counts and rejected records
py -3.12 -m app.cli process-notes --limit N                 # run the AI pipeline on unprocessed notes
py -3.12 -m app.cli set-role <email> <role>
```

- Record ids are derived from `(source_system, table, source_id)`, so re-importing updates rows instead of duplicating them.
- Invalid source records are skipped and written to `import_errors` with a reason; the rest continues.
- An unexpected failure rolls back every data write and marks the run `failed`.
- Source values are never invented: unknown birth dates, statuses and codes stay `NULL`.
- Not yet imported: Synthea immunizations, diagnostic reports, care plans and claims. Skipped resource types are counted by name in each run report.

## Roles and security model

| Role | Patients visible | Can write |
|---|---|---|
| admin | all | everything; role changes and imports are done via the CLI |
| clinician | only patients assigned to them | create patients, upload notes, review AI output |
| consultant | all | create patients, upload notes, review AI output |
| coder | all | review/edit AI output (codes) |
| auditor | all (read-only) | nothing; can read audit log, governance and import history |
| researcher | all (read-only) | nothing (a de-identified view is planned) |

FHIR export is limited to admin, clinician, consultant and coder.

- The API enforces this (`app/api/v1/deps.py`). "Not yours" and "doesn't exist" both return 404, so ids can't be probed.
- Postgres RLS mirrors it for anything a browser could call directly with the publishable key: clinical tables are
  **read-only** to clients, users cannot change their own role, and audit entries cannot be written by clients.
  All writes go through the API.
- Roles are never taken from signup metadata; new accounts get `pending`, which has no access (every endpoint answers 403) until an admin runs `set-role` (migration `0009`).
- Reads of clinical data are audited: viewing a patient's record (`view_record`), note text (`view_note_text`), note AI output and its evidence sentences (`view_note_insights`) and Copilot questions (`copilot_query`, `copilot_query_cli`) log who and which id, never the content. The audit log is served in pages (`limit` ≤ 500, `X-Total-Count`).
- Uploads: UTF-8 `.txt` only, max 5 MB, stored under a server-generated name (the client filename is display-only).
- Storage buckets are private. CORS is restricted to configured origins.

## Tests

```bash
cd clinicalbrief-backend
py -3.12 -m pytest tests               # SQLite
TEST_PG=1 py -3.12 -m pytest tests     # local Postgres (pgserver) with the real migrations and RLS applied
```

Coverage: token verification (including ES256/JWKS), per-role and per-patient authorization, RLS as the
`authenticated` / `anon` roles, upload safety, review rules, Copilot "no evidence" behaviour, both import
adapters, rejected-record logging, idempotency, dry run, rollback, ICD formatting, ORM/migration drift
(column names and NULL-ability), pipeline negation and word boundaries, reviewed-only consumers, FHIR bundle
validation, retrieval scoping, pipeline failure and retry.

**Git hooks.** `.githooks/pre-commit` and `.githooks/pre-push` run a secret scan (`.githooks/check-secrets`:
database URLs with a real password, Supabase secret keys, private keys; placeholders such as `<db-password>` are
allowed). `pre-push` then runs the Postgres suite (failing if any test is skipped, so the RLS and drift guards
always run) and the frontend type check. Enable them once per clone:

```bash
git config core.hooksPath .githooks
```

Frontend: `npx tsc --noEmit`, `npm run build`, `npm audit --omit=dev`. No linter is configured yet (backend or frontend).

## Known gaps

- The rule-based extractor's vocabulary is small (~60 terms), and on Synthea's templated notes the extractive
  summary often consists of list items. Neither has been evaluated against labelled data.
- Negation continues across commas ("denies chest pain, fever or nausea") until an affirmation ("positive for",
  "reports", "has", "with"…). A finding listed after a negation without such a word may still be missed.
- The family-history check is a word list (relatives, "family history of"); a patient subject ("patient", "he", "she")
  ends its scope and "lives with / accompanied by" a relative is ignored. It is not a full ConText implementation.
- Copilot withholds treatment or dosing advice ("should / must / recommend ...", sentences that start with a treatment
  verb such as "Start insulin ...", and doses stated without a citation) unless the exact phrase is quoted from a cited
  record that does not look like an injection; the whole answer is withheld, never one sentence; quoted plans are labelled as documented, not recommended.
- Deleting a Copilot session is a **hard delete** (owner only, after a confirmation): the transcript is gone and what
  the AI told the clinician cannot be reconstructed. The audit log keeps who deleted a session for which patient, never
  the content. A clinical deployment would need retention instead (soft delete, governance-only access).
- The document comparison only reports what is mentioned in the earliest vs latest note ("only in earlier note"),
  from reviewed entities; absence from a note does not mean a condition resolved.
- `next build` warns that supabase-js references a Node API in the Edge middleware (upstream library; the build and
  middleware work).

- The frontend is still one large component; views are URL-routed (`/patients/:id`, `/patients/:id/notes/:docId`).
- A patient's note picker lists the newest 100 notes, newest first (`X-Total-Count` gives the full number, and a
  linked note is always included). Older notes are reachable through Search records.
- Latency is dominated by database round trips: the Supabase project is in Sydney (`ap-southeast-2`, ~24 ms per trip
  from Australia; the earlier Tokyo project was ~260 ms). Migration `0008` adds the lookup indexes the API relies on.
  Note processing is almost entirely database waiting (~2 ms of compute per note). Bulk runs
  (`process-notes`) skip the per-stage progress commits the UI polls for, halving round trips per note. After
  heavy imports the Supabase free tier throttles disk I/O, so round trips can temporarily rise from ~24 ms to
  50-120 ms.
- 95 Tailwind classes use colour shades that don't exist and render unstyled.
#   c l i n i c a l b r i e f  
 