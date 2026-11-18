# Changelog

## v1.0.1 (in progress)

### Security
- Next.js 16.4.2 -> 16.4.6 (GHSA-mfr8-8qww-v76h, GHSA-vc7v-qv4w-wrv8: cache leaks across root params; the app uses
  neither `use cache` nor `unstable_cache`, but 16.4.2 also made `next build` stop on its first run with an upgrade
  notice). `npm audit --omit=dev`: 0. A dev-only picomatch advisory (via Tailwind CSS 3) remains; its only fix is a
  breaking Tailwind upgrade.
- Researchers can no longer read patients, notes or the record directly through Supabase (PostgREST) with their own
  token; they read only through the API. Migration `0013_researcher_no_direct_reads.sql` (apply in the Supabase SQL editor).
- Content security policy now uses a per-request nonce with `'strict-dynamic'` instead of `'unsafe-inline'` for
  scripts (N-41). Checked on a production build: every script carries the nonce, the nonce changes per request, no CSP
  violations on the landing page, roadmap, sign-in and 404. Rendering per request costs 5-13 ms locally; the live site's
  first byte was 0.34-0.67 s before the change (mostly network), re-measure after deploy. Turnstile (demo only, off)
  is allowed through `'strict-dynamic'` but was not exercised.

### Added
- F-02 installable app (ported from Aurel): web app manifest, Serwist service worker, offline page, update prompt.
  Stores only the app shell on the device; the API and Supabase are never stored (`src/lib/pwa/cache-policy.ts`,
  unit-tested with `npm test`, now in the pre-push gate). Stored pages are deleted on every sign-out. Records need a
  connection: offline, the app says so. The unused `public/sw.js` placeholder was removed.
- Extended extraction vocabulary (default; `EXTRACTION_VOCAB=core` turns it off): ~33,700 terms from ICD-10-CM (CMS)
  and RxNorm ingredients (NLM), built by `app.cli build-vocab` into `app/data/terminology.tsv`. Lenient recall on the
  40 Synthea notes 0.07 -> 0.42, precision 0.96 -> 0.88. Diseases matched this way get their ICD-10-CM code suggested.
- "Also in the patient's record" panel: the coded conditions, medications, procedures and allergies a note mentions by
  name (`GET /documents/{id}/record-links`). Linking, not AI extraction; coverage 91% on the labelled notes, circular on
  Synthea. Social and administrative findings Synthea codes as conditions (employment, stress, "medication review due",
  ...) are not shown; the labelling guideline excludes them too.
- Negation set: 25 notes written to exercise negation, uncertainty and family history (`eval/negation/`); 18 of 21
  negated or uncertain mentions and 7 of 7 family mentions handled.
- Label review aid: `app.cli eval-review` (side-by-side page) and `eval-mark-reviewed --by NAME`.
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
- Review 29 N-42: `app/data/terminology.tsv` was caught by the `data/` ignore rule (now `/data/`) and never tracked, so
  a clean deployment would have failed every extraction. It is now tracked; a missing file falls back to the core
  dictionary with a warning, and a test fails if it is missing or untracked. ICD-10-CM and RxNorm credited on the Data
  page (RxNorm's own names are public domain; NLM's acknowledgement and currency notice added).
- Review 29 N-43 to N-46: one statement about the scores everywhere (preliminary, synthetic notes, AI-drafted labels
  not yet reviewed by a person, no clinical accuracy claimed); "labelled by hand" corrected; strict scores shown next to
  lenient; search relevance stated as judged by fixed keyword patterns, not people. Landing page's "Not built yet" list
  no longer lists meaning search and the research view, which are built.
- Search: snippet highlighting matched inside words ("ear" in "year"); the "by meaning" label's explanation overstated
  it (it marks notes outside the top keyword results, not notes sharing no words).
- Evaluation scorer: punctuation next to a word ("(ethinyl estradiol", "nitrofurantoin,") hid lenient matches; parts of
  one combination product now count as one hit. Neither changed the original dictionary's published numbers.
- Evaluation and vocabulary commands no longer need (or touch) a database.
- `flag-demo` now prefers the smallest qualifying records after reviewed findings, instead of the largest.
- Roadmap: security hardening marked done; demo described as built but switched off; semantic search and accuracy
  evaluation marked next.
- README no longer lists "95 Tailwind classes render unstyled": a compiled-CSS check found every colour class used in
  the frontend produces a rule.

### Changed
- Version 1.0.1 in the API (`/`) and the frontend; a test keeps the two in step.

### Known
- N-38 (`tests/test_demo.py` flaky 1 in 12 for the reviewer): not reproduced in 35 SQLite runs plus Postgres runs; left open.
