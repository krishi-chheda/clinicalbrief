"use client";
// /docs: developer documentation. Commands are copied verbatim from README.md and .githooks/; the route table
// comes from clinicalbrief-backend/app/api/v1/*.py (router prefixes + decorators) and the role sets in deps.py.
// Environment variables are listed by name only (from the two .env.example files), never values.
import React, { useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { PublicPage, Mono } from "./kit";

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText);

// --- Command block ---------------------------------------------------------------------------------------------
function Cmd({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked (insecure origin or permission): the text is still selectable */ }
  };
  return (
    <div className="dc-cmd relative mt-4 rounded-2xl bg-[#18280E]">
      <button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy command"}
        className="absolute top-2.5 right-2.5 inline-flex items-center gap-1.5 rounded-md bg-white/10 hover:bg-white/20 px-2.5 py-1.5 lp-mono text-[11px] uppercase tracking-[0.12em] text-[#B3C5A0] transition-colors">
        {copied ? <Check className="h-3.5 w-3.5 text-[#B2EB76]" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="sr-only" aria-live="polite">{copied ? "Command copied to clipboard" : ""}</span>
      <pre className="overflow-x-auto p-5 pr-24 lp-mono text-[13px] leading-relaxed text-[#B2EB76]">
        <code>{children.split("\n").map((l, i) => <span key={i} className="dc-line block">{l || " "}</span>)}</code>
      </pre>
    </div>
  );
}

const C = ({ children }: { children: React.ReactNode }) => (
  <code className="lp-mono text-[0.85em] rounded bg-[#F4FAED] border border-[#B3C5A0]/60 px-1.5 py-0.5 break-words">{children}</code>
);

function DocSection({ id, label, title, children }: { id: string; label: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 py-10 border-t border-[#B3C5A0]/50 first:border-t-0 first:pt-0">
      <Mono className="text-[#4A5B38]">{label}</Mono>
      <h2 className="lp-display mt-3 text-3xl md:text-[40px] leading-[1.06] tracking-[-0.02em]">{title}</h2>
      <div className="mt-6 space-y-4 text-[#18280E] leading-relaxed">{children}</div>
    </section>
  );
}

// --- Data ------------------------------------------------------------------------------------------------------
const TOC = [
  ["overview", "Overview"], ["run", "Run it locally"], ["import", "Import CLI"], ["api", "API overview"],
  ["roles", "Roles"], ["tests", "Tests and quality gates"], ["conventions", "Conventions"], ["gaps", "Known gaps"],
] as const;

const ANY = "Any active role, patient-scoped";
const WRITE = "admin, clinician, consultant";
const REVIEW = "admin, clinician, consultant, coder";
const GOV = "admin, auditor";

// Paths are under /api/v1 (settings.API_V1_STR). "Any active role" = any signed-in user with a role; `pending`
// accounts get 403 everywhere. Patient-scoped = clinicians see only patients assigned to them; others see 404.
const ROUTES: [string, string, string, string][] = [
  ["GET", "/auth/me", "Current user's profile and role", "Any signed-in user with a role"],
  ["GET", "/patients", "List accessible patients", ANY],
  ["POST", "/patients", "Create a patient", WRITE],
  ["GET", "/patients/{id}", "Patient summary", ANY],
  ["GET", "/patients/{id}/record", "Full structured record (audited read)", ANY],
  ["GET", "/patients/{id}/risk", "Heuristic risk score, not clinically validated", ANY],
  ["GET", "/patients/{id}/graph", "Patient-centred knowledge graph", ANY],
  ["GET", "/patients/governance/stats", "Governance counts", GOV],
  ["POST", "/documents/upload", "Upload a UTF-8 .txt note (max 5 MB)", WRITE],
  ["GET", "/documents/patient/{id}", "A patient's notes", ANY],
  ["POST", "/documents/{id}/process", "Run the AI pipeline on a note", WRITE],
  ["GET", "/documents/{id}/status", "Pipeline progress", ANY],
  ["GET", "/documents/{id}/insights", "AI output and evidence sentences (audited read)", ANY],
  ["GET", "/documents/{id}/redacted", "Note text with regex redaction; researchers get redacted text only", ANY],
  ["GET", "/documents/compare/{id}", "Earliest vs latest note, reviewed entities only", ANY],
  ["POST", "/documents/entities/{id}/review", "Approve, reject or edit one AI finding", REVIEW],
  ["GET", "/review/queue", "Cross-patient review queue", REVIEW],
  ["POST", "/review/bulk", "Bulk review decisions", REVIEW],
  ["GET", "/review/history", "Review history", "admin, clinician, consultant, coder, auditor"],
  ["GET", "/review/stats", "Review statistics for governance", GOV],
  ["GET", "/ops/health", "Live checks: database, local LLM, search index", GOV],
  ["GET", "/ops/metrics", "Request counts, error rates and latency per route template (?window= seconds)", GOV],
  ["POST", "/search/records", "Postgres full-text search over notes and the structured record", ANY],
  ["POST", "/search/query", "In-memory note search (prototype)", ANY],
  ["POST", "/search/qa", "Question answering over one document (prototype)", ANY],
  ["GET", "/copilot/conversations/{patient_id}", "List Copilot sessions", ANY],
  ["POST", "/copilot/conversations/{patient_id}", "Start a Copilot session", ANY],
  ["DELETE", "/copilot/conversations/{id}", "Hard-delete a session (owner only)", ANY],
  ["POST", "/copilot/chat/{conversation_id}", "Ask a grounded question (audited)", ANY],
  ["GET", "/fhir/export/{patient_id}", "FHIR R4 transaction bundle (audited)", REVIEW],
  ["GET", "/audit/logs", "Audit log, paged", GOV],
  ["GET", "/imports", "Import run history", GOV],
  ["GET", "/imports/{run_id}/errors", "Rejected records for one run", GOV],
  ["GET", "/dashboard/layout", "Load the user's dashboard layout", "Any signed-in user with a role"],
  ["POST", "/dashboard/layout", "Save the user's dashboard layout", "Any signed-in user with a role"],
];

const ROLES: [string, string, string][] = [
  ["admin", "all", "everything; role changes and imports are done via the CLI"],
  ["clinician", "only patients assigned to them", "create patients, upload notes, review AI output"],
  ["consultant", "all", "create patients, upload notes, review AI output"],
  ["coder", "all", "review/edit AI output (codes)"],
  ["auditor", "all (read-only)", "nothing; can read audit log, governance and import history"],
  ["researcher", "all (read-only)", "nothing (a de-identified view is planned)"],
];

// --- Motion ----------------------------------------------------------------------------------------------------
// Everything lives in a no-preference media query and uses gsap.from, so with reduced motion (or no JS) the page
// is fully visible and static. Headings reveal by line, command lines slide in once, API rows stagger in.
function useDocsMotion(root: React.RefObject<HTMLDivElement | null>) {
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const once = (trigger: Element, start = "top 85%") => ({ trigger, start, once: true });

      gsap.utils.toArray<HTMLElement>(".dc-body h2").forEach(h => {
        SplitText.create(h, {
          type: "lines", mask: "lines", autoSplit: true,
          onSplit: self => gsap.from(self.lines, { yPercent: 100, duration: 0.8, ease: "expo.out", stagger: 0.08, scrollTrigger: once(h) }),
        });
      });

      gsap.utils.toArray<HTMLElement>(".dc-cmd").forEach(block => {
        const lines = block.querySelectorAll(".dc-line");
        gsap.from(lines, { x: -12, opacity: 0, duration: 0.5, ease: "power3.out", stagger: Math.min(0.06, 0.4 / lines.length), scrollTrigger: once(block) });
      });

      const rows = gsap.utils.toArray<HTMLElement>(".dc-row");
      if (rows.length) gsap.from(rows, { y: 10, opacity: 0, duration: 0.5, ease: "power3.out", stagger: 0.4 / rows.length, scrollTrigger: once(rows[0]) });
    });
  }, { scope: root });
}

// --- Page ------------------------------------------------------------------------------------------------------
const th = "text-left font-normal py-3 pr-4 lp-mono text-[11px] uppercase tracking-[0.12em] text-[#4A5B38] whitespace-nowrap";
const td = "py-3 pr-4 align-top";
const methodColour: Record<string, string> = { GET: "text-[#3F7308]", POST: "text-[#18280E]", DELETE: "text-[#8a2b1a]" };

export default function DocsPage() {
  const root = useRef<HTMLDivElement>(null);
  useDocsMotion(root);
  return (
    <div ref={root}>
      <PublicPage
        eyebrow="Developer docs"
        title="Run it, read it, test it."
        intro={<p>How to run ClinicalBrief locally, what the API exposes, and the checks every change has to pass. Commands are copied from the project README.</p>}
      >
        <div className="px-4 md:px-8 py-8 md:py-10">
          <div className="max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-8 lg:gap-14">
            <nav aria-label="On this page" className="lg:sticky lg:top-24 self-start rounded-2xl bg-[#F4FAED] p-5">
              <Mono className="text-[#4A5B38]">On this page</Mono>
              <ol className="mt-3 grid grid-cols-2 lg:grid-cols-1 gap-x-4 gap-y-1 text-sm">
                {TOC.map(([id, label]) => (
                  <li key={id}><a href={`#${id}`} className="inline-block py-1 hover:underline underline-offset-4">{label}</a></li>
                ))}
              </ol>
            </nav>

            <div className="dc-body min-w-0">
              <DocSection id="overview" label="Overview" title="Two apps, one repository.">
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <li className="rounded-2xl border border-[#B3C5A0]/60 p-5">
                    <Mono className="text-[#3F7308]">clinicalbrief-backend</Mono>
                    <p className="mt-2">FastAPI on <strong>Python 3.12 only</strong>. Ingestion adapters, the AI pipeline, search, FHIR export, the REST API with role and patient checks, and the SQL migrations (schema and row-level security, the source of truth for Postgres).</p>
                  </li>
                  <li className="rounded-2xl border border-[#B3C5A0]/60 p-5">
                    <Mono className="text-[#3F7308]">clinicalbrief-frontend</Mono>
                    <p className="mt-2">Next.js 15 with Supabase Auth. It reads clinical data <strong>only through the API</strong>, sending the session token as a Bearer header.</p>
                  </li>
                </ul>
                <p>Local development can use SQLite (<C>clinicalbrief_dev.db</C>), created from the ORM. It has no migration path: after model changes, delete it and re-import. For the architecture story, see <Link href="/about" className="underline underline-offset-4">About ClinicalBrief</Link>.</p>
              </DocSection>

              <DocSection id="run" label="Run it locally" title="From clone to a running app.">
                <h3 className="lp-display text-xl font-semibold">Prerequisites</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Python 3.12 (commands use <C>py -3.12</C>)</li>
                  <li>Node.js with npm</li>
                  <li>A Supabase project, for sign-in and the Postgres database</li>
                  <li>Optional: <a href="https://ollama.com" className="underline underline-offset-4" rel="noreferrer" target="_blank">Ollama</a> with <C>qwen3.5</C>, for the Copilot</li>
                </ul>

                <h3 className="lp-display text-xl font-semibold pt-4">1. Database</h3>
                <p>In the Supabase SQL editor, run every file in <C>clinicalbrief-backend/migrations/</C> in order. There is no <C>0006</C>.</p>

                <h3 className="lp-display text-xl font-semibold pt-4">2. Environment</h3>
                <p>Copy <C>clinicalbrief-backend/.env.example</C> to <C>.env</C> and <C>clinicalbrief-frontend/.env.example</C> to <C>.env.local</C>, then fill them in. Never put a service-role or secret key in the frontend.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-[#B3C5A0]/60 p-5">
                    <Mono className="text-[#4A5B38]">Backend .env</Mono>
                    <ul className="mt-2 space-y-1 lp-mono text-[13px] break-all">
                      {["DATABASE_URL", "SUPABASE_URL", "JWT_SECRET", "CORS_ORIGINS", "USE_MOCK_MODELS", "LLM_BASE_URL", "LLM_MODEL"].map(v => <li key={v}>{v}</li>)}
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-[#B3C5A0]/60 p-5">
                    <Mono className="text-[#4A5B38]">Frontend .env.local</Mono>
                    <ul className="mt-2 space-y-1 lp-mono text-[13px] break-all">
                      {["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_API_URL"].map(v => <li key={v}>{v}</li>)}
                    </ul>
                  </div>
                </div>

                <h3 className="lp-display text-xl font-semibold pt-4">3. Remote database opt-in</h3>
                <p>When <C>DATABASE_URL</C> points at Supabase, the backend and CLI refuse to start unless <C>CLINICALBRIEF_ALLOW_REMOTE_DB=1</C> is set <strong>for that process</strong>. Keep it out of <C>.env</C>, so scripts and tests can never write to live data by default. CLI write commands print the target database first.</p>
                <Cmd>{`$env:CLINICALBRIEF_ALLOW_REMOTE_DB="1"   # PowerShell, current process only`}</Cmd>

                <h3 className="lp-display text-xl font-semibold pt-4">4. Backend</h3>
                <Cmd>{`cd clinicalbrief-backend
py -3.12 -m pip install -r requirements-dev.txt
py -3.12 -m app.cli import synthea ../data/raw/synthea-fhir
py -3.12 -m uvicorn app.main:app --reload --no-access-log`}</Cmd>
                <p><C>--no-access-log</C> is deliberate: uvicorn&apos;s access log prints full URLs, which contain patient ids. The app records route templates, timing and a request id per call instead (System health).</p>
                <p>FastAPI&apos;s interactive API docs are enabled at <C>/docs</C> on the backend port (the root endpoint also reports <C>docs_url</C>). <C>requirements-ml.txt</C> adds the transformer stack (several GB) for <C>USE_MOCK_MODELS=false</C>; that mode exists but is untested.</p>

                <h3 className="lp-display text-xl font-semibold pt-4">5. Frontend</h3>
                <Cmd>{`cd clinicalbrief-frontend
npm install
npm run dev`}</Cmd>

                <h3 className="lp-display text-xl font-semibold pt-4">6. First user</h3>
                <p>Create a user in Supabase Auth. New accounts start as <C>pending</C> with no access (every endpoint answers 403). Grant a role from the CLI:</p>
                <Cmd>{`py -3.12 -m app.cli set-role you@example.com admin`}</Cmd>

                <h3 className="lp-display text-xl font-semibold pt-4">7. Copilot (optional)</h3>
                <p>Install Ollama, pull the model, and set <C>LLM_MODEL</C> / <C>LLM_BASE_URL</C> in <C>.env</C> if needed. Only loopback model URLs and locally run models are accepted. Without the model, the Copilot falls back to labelled rule-based answers.</p>
                <Cmd>{`ollama pull qwen3.5
py -3.12 -m app.cli ask <patient_id> "<question>"`}</Cmd>
              </DocSection>

              <DocSection id="import" label="Data" title="The import CLI.">
                <p>Data comes from Synthea (synthetic, FHIR R4). <C>data/raw/</C> is git-ignored.</p>
                <Cmd>{`py -3.12 -m app.cli discover <path>                         # what's in a folder, what will be imported or skipped
py -3.12 -m app.cli import synthea <path>         [--dry-run] [--limit N]
py -3.12 -m app.cli runs                                    # import history with counts and rejected records
py -3.12 -m app.cli process-notes --limit N                 # run the AI pipeline on unprocessed notes
py -3.12 -m app.cli set-role <email> <role>`}</Cmd>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Record ids are derived from <C>(source_system, table, source_id)</C>, so re-importing updates rows instead of duplicating them.</li>
                  <li>Invalid source records are skipped and written to <C>import_errors</C> with a reason; the rest continues.</li>
                  <li>An unexpected failure rolls back every data write and marks the run <C>failed</C>.</li>
                  <li>Source values are never invented: unknown birth dates, statuses and codes stay <C>NULL</C>.</li>
                </ul>
              </DocSection>

              <DocSection id="api" label="API overview" title="Main routes.">
                <p>All paths are under <C>/api/v1</C> and need a Supabase Bearer token. &ldquo;Patient-scoped&rdquo; means clinicians reach only patients assigned to them; &ldquo;not yours&rdquo; and &ldquo;doesn&apos;t exist&rdquo; both return 404, so ids can&apos;t be probed. Roles come from <C>require_roles(...)</C> in <C>app/api/v1/deps.py</C>.</p>
                <div className="overflow-x-auto rounded-2xl border border-[#B3C5A0]/60">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-[#F4FAED]">
                      <tr><th scope="col" className={`${th} pl-4`}>Method</th><th scope="col" className={th}>Path</th><th scope="col" className={th}>Purpose</th><th scope="col" className={th}>Roles</th></tr>
                    </thead>
                    <tbody>
                      {ROUTES.map(([m, p, purpose, roles]) => (
                        <tr key={m + p} className="dc-row border-t border-[#B3C5A0]/40">
                          <td className={`${td} pl-4 lp-mono text-[12px] font-semibold ${methodColour[m]}`}>{m}</td>
                          <td className={`${td} lp-mono text-[12px] whitespace-nowrap`}>{p}</td>
                          <td className={td}>{purpose}</td>
                          <td className={`${td} text-[#4A5B38]`}>{roles}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-sm text-[#4A5B38]">Responses may carry <C>X-Total-Count</C> (full size of a limited list), <C>X-Pending-Entities</C> (AI findings awaiting review) and <C>X-FHIR-Validation</C> (the export check result).</p>
              </DocSection>

              <DocSection id="roles" label="Security model" title="Six roles, enforced twice.">
                <p>The API enforces roles, and Postgres row-level security mirrors them for anything a browser could call directly with the publishable key: clinical tables are read-only to clients, users cannot change their own role, and clients cannot write audit entries. All writes go through the API. Roles are never taken from signup metadata.</p>
                <div className="overflow-x-auto rounded-2xl border border-[#B3C5A0]/60">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="bg-[#F4FAED]">
                      <tr><th scope="col" className={`${th} pl-4`}>Role</th><th scope="col" className={th}>Patients visible</th><th scope="col" className={th}>Can write</th></tr>
                    </thead>
                    <tbody>
                      {ROLES.map(([r, v, w]) => (
                        <tr key={r} className="border-t border-[#B3C5A0]/40">
                          <td className={`${td} pl-4 lp-mono text-[12px]`}>{r}</td><td className={td}>{v}</td><td className={td}>{w}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DocSection>

              <DocSection id="tests" label="Quality gates" title="Tests and hooks.">
                <p>The backend suite runs on SQLite, and again on a local Postgres (pgserver) with the real migrations and RLS applied, testing as the <C>authenticated</C> and <C>anon</C> roles. Tests use a fake model and never call Ollama.</p>
                <Cmd>{`cd clinicalbrief-backend
py -3.12 -m pytest tests               # SQLite
TEST_PG=1 py -3.12 -m pytest tests     # local Postgres (pgserver) with the real migrations and RLS applied`}</Cmd>
                <p>Frontend checks:</p>
                <Cmd>{`npx tsc --noEmit
npm run build
npm audit --omit=dev`}</Cmd>
                <p>Git hooks: <C>pre-commit</C> and <C>pre-push</C> run a secret scan (database URLs with a real password, Supabase secret keys, private keys). <C>pre-push</C> then runs the Postgres suite, failing if any test is skipped so the RLS and schema-drift guards always run, and the frontend type check. Enable them once per clone:</p>
                <Cmd>{`git config core.hooksPath .githooks`}</Cmd>
                <p className="text-sm text-[#4A5B38]">No linter is configured yet, for the backend or the frontend.</p>
              </DocSection>

              <DocSection id="conventions" label="Conventions" title="How the project is kept honest.">
                <ul className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    ["Honesty labels", "Every feature is marked Implemented, Prototype or Not built in the README."],
                    ["No fabricated metrics", "No accuracy figure is shown anywhere until it is measured on a labelled set. Rates on the governance page are shares of human decisions, not accuracy."],
                    ["Human review first", "AI output is never treated as fact until a person approves or edits it. The graph, FHIR export, Copilot structured answers and risk score use reviewed entities only."],
                  ].map(([t, d]) => (
                    <li key={t} className="rounded-2xl border border-[#B3C5A0]/60 p-5">
                      <h3 className="lp-display text-lg font-semibold">{t}</h3>
                      <p className="mt-2 text-sm text-[#4A5B38] leading-relaxed">{d}</p>
                    </li>
                  ))}
                </ul>
                <p>The schema in <C>migrations/*.sql</C> is the source of truth; the ORM must match it, and a test fails on any drift.</p>
              </DocSection>

              <DocSection id="gaps" label="Known gaps" title="What is not done yet.">
                <p>Known gaps and planned work are tracked in one place each, so they are not repeated here.</p>
                <div className="flex flex-wrap gap-3">
                  <Link href="/roadmap" className="inline-flex items-center lp-mono text-[13px] px-4 py-2.5 rounded-md bg-[#18280E] text-white hover:bg-[#090F05] transition-colors">Read the roadmap</Link>
                  <Link href="/security" className="inline-flex items-center lp-mono text-[13px] px-4 py-2.5 rounded-md bg-[#B2EB76] text-[#18280E] hover:bg-[#a3dc66] transition-colors">Security and privacy</Link>
                </div>
              </DocSection>
            </div>
          </div>
        </div>
      </PublicPage>
    </div>
  );
}
