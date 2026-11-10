# Changelog

## v1.0.1 (in progress)

### Security
- Researchers can no longer read patients, notes or the record directly through Supabase (PostgREST) with their own
  token; they read only through the API. Migration `0013_researcher_no_direct_reads.sql` (apply in the Supabase SQL editor).
- Content security policy now uses a per-request nonce with `'strict-dynamic'` instead of `'unsafe-inline'` for
  scripts (N-41). Checked on a production build: every script carries the nonce, the nonce changes per request, no CSP
  violations on the landing page, roadmap, sign-in and 404. Rendering per request costs 5-13 ms locally; the live site's
  first byte was 0.34-0.67 s before the change (mostly network), re-measure after deploy. Turnstile (demo only, off)
  is allowed through `'strict-dynamic'` but was not exercised.

### Added
- Research view: researchers see a pseudonym instead of the patient's name, the birth year instead of the date of birth,
  no date of death, and the patient's names and birth date replaced with `[NAME]` in all text (notes, summaries,
  evidence, search results, Copilot answers, citations and streamed steps). Enforced server side on 16 endpoints and
  tested (the test fails when the protection is switched off). Labelled in the app as not a validated de-identification.
- Accuracy evaluation of the note pipeline (`clinicalbrief-backend/eval/`, `app.cli eval-sample` / `eval-extraction`):
  40 Synthea notes, 352 labelled mentions, written guideline. Lenient precision 0.96 (0.88-1.00), recall 0.07
  (0.04-0.09). Labels AI-drafted, not yet reviewed by a person. Published on the Data page and in the README.
- Match meaning in record search (roadmap 8b): local embeddings fused with the keyword ranking, opt-in on the Search
  page. Adopted by a rule fixed before the comparison (nDCG@10 +0.05 with the CI above 0): measured +0.36 (95% CI
  +0.21 to +0.52) on 5,635 notes and 29 questions. Migration `0014_note_embeddings.sql`; fill with `app.cli embed-notes`.
  Falls back to keyword ranking, with a message, without the local model or embeddings.
- Removed a hard-coded list of example names ("John Smith"...) from the redaction engine that matched nothing real.

### Fixed
- `flag-demo` now prefers the smallest qualifying records after reviewed findings, instead of the largest.
- Roadmap: security hardening marked done; demo described as built but switched off; semantic search and accuracy
  evaluation marked next.
- README no longer lists "95 Tailwind classes render unstyled": a compiled-CSS check found every colour class used in
  the frontend produces a rule.

### Changed
- Version 1.0.1 in the API (`/`) and the frontend; a test keeps the two in step.

### Known
- N-38 (`tests/test_demo.py` flaky 1 in 12 for the reviewer): not reproduced in 35 SQLite runs plus Postgres runs; left open.
