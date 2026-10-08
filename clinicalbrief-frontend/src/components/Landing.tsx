// Public landing page. Visual language: pale-green hero card with ruler edges, large grotesque headline,
// monospace labels, dark-green statement bands, graph-paper sections. Every claim and number is real
// (README status table, deps.py role sets and measured values); nothing here is a testimonial or an invented metric.
//
// Scrolling: GSAP ScrollSmoother (smooth wheel scrolling, native scrollbar) and ScrollTrigger for every
// scroll effect: section reveals, the statement's word-by-word reveal, fragment parallax, the access matrix
// and the CTA heartbeat. All of it is skipped under prefers-reduced-motion, where content is simply shown.
import React, { useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollSmoother } from "gsap/ScrollSmoother";
import { useGSAP } from "@gsap/react";
import HealthScene, { StatementFragments } from "./HealthScene";
import TryDemoButton from "./public/TryDemoButton";
import { Eyebrow, Mono, SiteFooter, SiteHeader } from "./public/kit";
import { CopilotScene, FhirScene, ReviewScene, SearchScene, SlotDots, slotStyle } from "./CapabilityScenes";
import { ArrowRight, Check, CheckCircle2, Database, FileText, Minus, Search, Sparkles } from "lucide-react";

gsap.registerPlugin(useGSAP, ScrollTrigger, ScrollSmoother);

// Three synthetic notes for the How it works demo. Only terms in the extractor's dictionary are tagged, and
// only codes from its ICD-10 dictionary are shown (app/services/ai_pipeline.py).
type NotePart = { text: string; tag?: "c" | "m" | "n" | "f" };
const NOTES: { file: string; parts: NotePart[]; findings: { label: string; meta: string; status: string }[] }[] = [
  {
    file: "clinical_note_01.txt",
    parts: [{ text: "54 y/o female. History of " }, { text: "type 2 diabetes", tag: "c" }, { text: " and " }, { text: "hypertension", tag: "c" },
      { text: ". Denies " }, { text: "chest pain", tag: "n" }, { text: ". Mother had " }, { text: "breast cancer", tag: "f" },
      { text: ". Continue " }, { text: "metformin 500 mg", tag: "m" }, { text: " twice daily." }],
    findings: [
      { label: "Type 2 diabetes mellitus", meta: "Condition · E11.9", status: "approved" },
      { label: "Hypertension", meta: "Condition · I10", status: "approved" },
      { label: "Metformin 500 mg", meta: "Medication · twice daily", status: "pending" },
      { label: "Chest pain", meta: "Negated · not recorded as a finding", status: "excluded" },
      { label: "Breast cancer", meta: "Family history · not the patient", status: "excluded" },
    ],
  },
  {
    file: "clinical_note_02.txt",
    parts: [{ text: "62 y/o male. Admitted with " }, { text: "pneumonia", tag: "c" }, { text: ". No " }, { text: "fever", tag: "n" },
      { text: " today. Father has " }, { text: "asthma", tag: "f" }, { text: ". Started " }, { text: "amoxicillin", tag: "m" },
      { text: " 500 mg three times daily." }],
    findings: [
      { label: "Pneumonia", meta: "Condition · J18.9", status: "approved" },
      { label: "Amoxicillin", meta: "Medication · three times daily", status: "pending" },
      { label: "Fever", meta: "Negated · not recorded as a finding", status: "excluded" },
      { label: "Asthma", meta: "Family history · not the patient", status: "excluded" },
    ],
  },
  {
    file: "clinical_note_03.txt",
    parts: [{ text: "71 y/o female. Known " }, { text: "atrial fibrillation", tag: "c" }, { text: " and " },
      { text: "chronic kidney disease", tag: "c" }, { text: ". On " }, { text: "warfarin", tag: "m" }, { text: " 5 mg daily. Denies " },
      { text: "dizziness", tag: "n" }, { text: ". Sister had a " }, { text: "myocardial infarction", tag: "f" }, { text: "." }],
    findings: [
      { label: "Atrial fibrillation", meta: "Condition · I48.91", status: "approved" },
      { label: "Chronic kidney disease", meta: "Condition · N18.9", status: "pending" },
      { label: "Warfarin", meta: "Medication · 5 mg daily", status: "pending" },
      { label: "Dizziness", meta: "Negated · not recorded as a finding", status: "excluded" },
      { label: "Myocardial infarction", meta: "Family history · not the patient", status: "excluded" },
    ],
  },
];
const NOTE_SECONDS = 10;

const STATUS_STYLE: Record<string, string> = {
  approved: "bg-[#B2EB76] text-[#18280E]",
  pending: "bg-[#EBE46A] text-[#333109]",
  excluded: "bg-white text-[#4A5B38] border border-[#B3C5A0]",
};

// Access matrix, taken from the role sets in clinicalbrief-backend/app/api/v1/deps.py and fhir.py.
// 2 = yes, 1 = limited (see note), 0 = no.
const ROLE_COLS = [
  { id: "clinician", text: "Sees only the patients assigned to them; uploads notes and decides on AI findings." },
  { id: "consultant", text: "Sees every patient; uploads notes and decides on AI findings." },
  { id: "coder", text: "Sees every patient; reviews and corrects findings and their codes. Cannot upload." },
  { id: "auditor", text: "Read-only. Reads the audit log, governance figures and import history." },
  { id: "researcher", text: "Read-only. Searches the structured record; note text is withheld from the role." },
  { id: "admin", text: "Everything. Role changes and imports are done from the command line, not the browser." },
];
const ROLE_ROWS: { label: string; cells: number[]; note?: string }[] = [
  { label: "See patients", cells: [1, 2, 2, 2, 2, 2], note: "clinicians: assigned patients only" },
  { label: "Read note text", cells: [2, 2, 2, 2, 1, 2], note: "researchers: regex-redacted text only" },
  { label: "Upload notes, add patients", cells: [2, 2, 0, 0, 0, 2] },
  { label: "Decide on AI findings", cells: [2, 2, 2, 0, 0, 2] },
  { label: "Search records", cells: [2, 2, 2, 2, 1, 2], note: "researchers: structured record only" },
  { label: "Export FHIR", cells: [2, 2, 2, 0, 0, 2] },
  { label: "Audit log and governance", cells: [0, 0, 0, 2, 0, 2] },
];

const BOARD: { title: string; tone: string; items: [string, string][] }[] = [
  { title: "Implemented", tone: "bg-[#B2EB76] text-[#18280E]", items: [
    ["Human review and audit trail", "Review queue, undo, conflict checks, governance page"],
    ["Record search", "Postgres full-text search over every note and the structured record"],
    ["FHIR R4 export", "Transaction bundle from the record, structurally validated"],
    ["Roles and row-level security", "Six roles in the API, mirrored in Postgres RLS"],
    ["Synthea import", "Dry run, per-record validation, rejected-record log, idempotent re-import"],
  ] },
  { title: "Prototype", tone: "bg-[#EBE46A] text-[#333109]", items: [
    ["Grounded Copilot", "Local model only; cites sources, flags unsupported claims"],
    ["Entity extraction", "Rule-based dictionary with negation and family-history checks"],
    ["ICD-10 suggestions", "Exact match against a small dictionary; the rest stays unmapped"],
    ["Knowledge graph", "From the record plus reviewed findings only"],
    ["PHI redaction", "Regex patterns; not a validated de-identification method"],
  ] },
  { title: "Not built yet", tone: "bg-white text-[#4A5B38] border border-[#B3C5A0]", items: [
    ["Accuracy evaluation", "No accuracy figure is shown until measured on a labelled set"],
    ["Semantic search", "Embeddings, kept only if they beat full-text search on a fixed question set"],
    ["De-identified research view", "Researchers get no note text until one exists"],
  ] },
];

// Spade-style reveal: the words brighten one after another as the statement band scrolls by (ScrollTrigger scrub).
function RevealWords({ parts }: { parts: [string, boolean][] }) {
  const words = parts.flatMap(([text, accent]) => text.split(" ").map(w => [w, accent] as const));
  return <>{words.map(([w, accent], i) => (
    <span key={i} className={`lp-word ${accent ? "text-[#B2EB76]" : ""}`}>{w}{" "}</span>
  ))}</>;
}

function AccessMatrix() {
  const [role, setRole] = useState(0);
  return (
    <div className="lp-reveal">
      {/* Phones: tap a role, see its permissions as a list (no hover on touch, and six columns don't fit) */}
      <div className="md:hidden">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Roles">
          {ROLE_COLS.map((c, i) => (
            <button key={c.id} role="tab" aria-selected={role === i} onClick={() => setRole(i)}
              className={`lp-mono text-[12px] rounded-md px-3 py-2 ${role === i ? "bg-[#18280E] text-white" : "bg-[#F1F3EE] text-[#4A5B38]"}`}>
              {c.id}
            </button>
          ))}
        </div>
        <ul className="mt-4 rounded-xl border border-[#B3C5A0]/60 divide-y divide-[#B3C5A0]/40">
          {ROLE_ROWS.map(r => {
            const v = r.cells[role];
            return (
              <li key={r.label} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-sm">
                  {r.label}
                  {v === 1 && r.note && <span className="block lp-mono text-[10px] uppercase tracking-[0.08em] text-[#4A5B38] mt-0.5">{r.note}</span>}
                </span>
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full" aria-label={["no", "limited", "yes"][v]}
                  style={{ background: v === 2 ? "#B2EB76" : v === 1 ? "#EBE46A" : "#F1F3EE", color: v ? "#18280E" : "#95A386" }}>
                  {v === 0 ? <Minus className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="hidden md:block overflow-x-auto -mx-4 px-4">
        <table className="rm-grid w-full min-w-[640px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="w-[30%]" />
              {ROLE_COLS.map((c, i) => (
                <th key={c.id} className="p-0">
                  <button onMouseEnter={() => setRole(i)} onFocus={() => setRole(i)} onClick={() => setRole(i)} aria-pressed={role === i}
                    className={`rm-col w-full rounded-t-lg px-2 pt-3 pb-2 lp-mono text-[11px] lowercase tracking-[0.06em] ${role === i ? "is-on" : "text-[#4A5B38] hover:text-[#090F05]"}`}>
                    [{c.id}]
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLE_ROWS.map((r, ri) => (
              <tr key={r.label}>
                <th scope="row" className="text-left font-medium py-3 pr-4 border-t border-[#B3C5A0]/40">
                  {r.label}
                  {r.note && <span className="block lp-mono text-[10px] uppercase tracking-[0.08em] text-[#4A5B38] font-normal mt-0.5">{r.note}</span>}
                </th>
                {r.cells.map((v, ci) => (
                  <td key={ci} onMouseEnter={() => setRole(ci)}
                    className={`rm-col text-center border-t ${role === ci ? "is-on border-white/10" : "border-[#B3C5A0]/40"} ${ri === ROLE_ROWS.length - 1 && role === ci ? "rounded-b-lg" : ""}`}>
                    <span className="rm-cell inline-flex h-7 w-7 items-center justify-center rounded-full"
                      aria-label={["no", "limited", "yes"][v]}
                      style={{ background: v === 2 ? "#B2EB76" : v === 1 ? "#EBE46A" : "transparent", color: v ? "#18280E" : role === ci ? "#B3C5A0" : "#B3C5A0" }}>
                      {v === 0 ? <Minus className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-6 grid md:grid-cols-[auto_1fr] gap-x-6 gap-y-2 items-baseline">
        <Mono className="text-[#3F7308]">[{ROLE_COLS[role].id}]</Mono>
        <p className="text-[17px] text-[#18280E]">{ROLE_COLS[role].text}</p>
      </div>
      <p className="mt-3 text-sm text-[#4A5B38]">
        Enforced in the API and mirrored in Postgres row-level security. New accounts start as <span className="lp-mono">pending</span>, with no
        access, until an admin grants a role. Reads of clinical data are audited.
      </p>
    </div>
  );
}

export default function Landing({ onSignIn, onTryDemo }: { onSignIn: () => void; onTryDemo: (captchaToken?: string) => Promise<string | null> }) {
  const button = "lp-mono text-[13px] px-4 py-2.5 rounded-md transition-colors";
  const root = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const smoother = useRef<ScrollSmoother | null>(null);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      smoother.current = ScrollSmoother.create({ wrapper: wrapper.current!, content: content.current!, smooth: 1.1, effects: true, smoothTouch: 0.1 });

      // Section reveals: rise and fade in, batched so neighbours stagger (Premium: power3.out, 0.8 s, no overshoot).
      gsap.set(".lp-reveal", { autoAlpha: 0, y: 32 });
      ScrollTrigger.batch(".lp-reveal", {
        start: "top 88%", once: true,
        onEnter: batch => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.8, ease: "power3.out", stagger: 0.08, overwrite: true }),
      });

      // The note demo starts highlighting when it is on screen, not on page load.
      ScrollTrigger.create({ trigger: ".lp-demo", start: "top 75%", once: true, toggleClass: { targets: ".lp-demo", className: "lp-play" } });

      // Statement: words brighten one by one, tied to scroll.
      gsap.fromTo(".lp-word", { opacity: 0.16 }, {
        opacity: 1, ease: "none", stagger: 0.1,
        scrollTrigger: { trigger: ".lp-words", start: "top 70%", end: "center 45%", scrub: 0.6 },
      });
      // Statement fragments: deeper layers travel less (parallax), scrubbed to the band's pass through the viewport.
      gsap.utils.toArray<HTMLElement>(".sf-par").forEach(el => {
        const travel = Number(el.dataset.travel || 60);
        gsap.fromTo(el, { y: travel / 2 }, { y: -travel / 2, ease: "none", scrollTrigger: { trigger: ".lp-words", start: "top bottom", end: "bottom top", scrub: true } });
      });

      // Access matrix: cells pop in row by row.
      gsap.fromTo(".rm-cell", { scale: 0.4, autoAlpha: 0 }, {
        scale: 1, autoAlpha: 1, duration: 0.45, ease: "power2.out", stagger: { each: 0.025, from: "start" },
        scrollTrigger: { trigger: ".rm-grid", start: "top 80%", once: true },
      });

      // Closing CTA: a heartbeat line draws across as the band scrolls in.
      gsap.to(".cta-ecg", { strokeDashoffset: 0, ease: "none", scrollTrigger: { trigger: ".cta-band", start: "top 85%", end: "center 45%", scrub: 0.5 } });

      // Web fonts change line heights after load; re-measure every trigger once they are in.
      document.fonts?.ready.then(() => ScrollTrigger.refresh());
      return () => { smoother.current?.kill(); smoother.current = null; };
    });
  }, { scope: root });

  // In-page links go through the smoother (instant jump with reduced motion), clearing the fixed header.
  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    if (smoother.current) smoother.current.scrollTo(el, true, "top 64px");
    else window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64 });
  };
  const toTop = () => (smoother.current ? smoother.current.scrollTo(0, true) : window.scrollTo({ top: 0 }));

  return (
    <div ref={root} className="lp bg-white text-[#090F05]">
      <SiteHeader onLogoClick={toTop} />

      <div ref={wrapper} id="smooth-wrapper">
        <div ref={content} id="smooth-content">
          <main className="pt-16">
            {/* Hero */}
            <section className="lp-ruler px-4 md:px-8 pt-2 pb-10">
              <div className="max-w-[1280px] mx-auto rounded-2xl bg-[#F4FAED] px-5 md:px-12 pt-16 md:pt-24 pb-12 md:pb-16 text-center">
                <Mono className="text-[#4A5B38]">Research prototype · synthetic data only · not for clinical use</Mono>
                <h1 className="lp-display mt-6 text-[44px] leading-[1.02] md:text-[72px] tracking-[-0.02em] max-w-4xl mx-auto">
                  The reviewed record for clinical notes
                </h1>
                <div data-speed="0.92"><HealthScene /></div>
                <p className="mt-4 text-[17px] leading-relaxed text-[#18280E] max-w-xl mx-auto">
                  ClinicalBrief turns note text into structured findings, puts every one in front of a clinician before it
                  counts, and links each back to the sentence it came from.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <TryDemoButton onStart={onTryDemo} className={`${button} bg-[#B2EB76] text-[#18280E] hover:bg-[#c3f290]`}>Try the demo</TryDemoButton>
                  <button onClick={onSignIn} className={`${button} bg-[#090F05] text-white hover:bg-[#18280E]`}>Sign in to the workspace</button>
                  <a href="#how" onClick={go("how")} className={`${button} bg-white border border-[#B3C5A0] hover:bg-[#F1F3EE]`}>How it works</a>
                </div>
              </div>
            </section>

            {/* Statement: words light up and record fragments drift by as it scrolls through */}
            <section className="lp-words px-4 md:px-8 py-10">
              <div className="relative max-w-[1280px] mx-auto rounded-2xl bg-[#18280E] px-6 py-32 md:py-48 text-center overflow-hidden">
                <StatementFragments />
                <p className="relative z-10 lp-display text-white text-3xl md:text-[52px] leading-[1.06] tracking-[-0.025em] max-w-2xl mx-auto">
                  <RevealWords parts={[["Clinicians write notes all day,", false], ["but what is in them is hard to search, check or share.", true]]} />
                </p>
              </div>
            </section>

            {/* How it works, on graph paper */}
            <section id="how" className="lp-grid px-4 md:px-8 py-24 md:py-32">
              <div className="max-w-[1100px] mx-auto">
                <p className="lp-reveal lp-display text-center text-3xl md:text-[44px] leading-[1.12] tracking-[-0.015em] max-w-3xl mx-auto">
                  Every AI output stays pending until a person decides, and every decision is written down.
                </p>
                {/* Note -> structured findings: three synthetic notes take turns, starting when scrolled into view */}
                <div className="lp-demo lp-reveal mt-14 max-w-5xl mx-auto">
                  <div className="flex justify-end mb-2"><SlotDots n={NOTES.length} seconds={NOTE_SECONDS} /></div>
                  <div className="grid">
                    {NOTES.map((note, k) => (
                      <div key={note.file} className="cv-a cv-slot [grid-area:1/1] grid md:grid-cols-[1fr_auto_1fr] gap-4 md:gap-6 items-stretch text-left"
                        style={slotStyle(k, NOTES.length, NOTE_SECONDS)}>
                        <div className="min-w-0 rounded-xl bg-white border border-[#B3C5A0]/70 shadow-sm p-5">
                          <div className="flex items-center justify-between"><Mono className="text-[#4A5B38]">{note.file}</Mono><Mono className="text-[#4A5B38]/70">synthetic</Mono></div>
                          <p className="mt-4 text-[15px] leading-7 text-[#18280E]">
                            {note.parts.map((p, i) => p.tag
                              ? <mark key={i} className={`cv-a cv-hl lp-hl-${p.tag} rounded px-0.5`} style={{ animationDelay: `${i * 0.06}s` }}>{p.text}</mark>
                              : <React.Fragment key={i}>{p.text}</React.Fragment>)}
                          </p>
                          <div className="mt-4 flex flex-wrap gap-3 lp-mono text-[10px] uppercase tracking-wider text-[#4A5B38]">
                            <span><i className="lp-dot bg-[#B2EB76]" /> condition</span><span><i className="lp-dot bg-[#EBE46A]" /> medication</span>
                            <span><i className="lp-dot bg-[#F2DFAC]" /> negated</span><span><i className="lp-dot bg-[#B3C5A0]" /> family history</span>
                          </div>
                        </div>
                        <div className="hidden md:flex items-center"><ArrowRight className="h-6 w-6 text-[#3F7308]" /></div>
                        <div className="min-w-0 rounded-xl bg-[#18280E] text-white p-5 shadow-sm">
                          <div className="flex items-center justify-between"><Mono className="text-[#B3C5A0]">structured findings</Mono><Mono className="text-[#B3C5A0]/70">example</Mono></div>
                          <ul className="mt-4 space-y-2">
                            {note.findings.map((f, i) => (
                              <li key={f.label} className="cv-a cv-rise10 flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2" style={{ animationDelay: `${i * 0.12}s` }}>
                                <div className="min-w-0">
                                  <div className="text-sm font-medium truncate">{f.label}</div>
                                  <div className="lp-mono text-[10px] uppercase tracking-wider text-[#B3C5A0] truncate">{f.meta}</div>
                                </div>
                                <span className={`lp-mono text-[10px] uppercase tracking-wider px-2 py-1 rounded shrink-0 ${STATUS_STYLE[f.status]}`}>{f.status}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <ol className="lp-steps mt-16 grid md:grid-cols-5 gap-3">
                  {[
                    ["01", "Import", "Synthea notes and structured records, with provenance on every row."],
                    ["02", "Extract", "Rule-based findings; negated and family-history mentions are excluded."],
                    ["03", "Review", "Approve, edit or reject each finding, with its source sentence."],
                    ["04", "Code", "ICD-10 suggestions by dictionary match; the rest stays unmapped."],
                    ["05", "Use", "Search, Copilot and FHIR export read reviewed findings only."],
                  ].map(([n, title, text], i) => (
                    <li key={n} className={`lp-reveal lp-step rounded-xl p-5 ${i === 2 ? "is-active" : ""}`}>
                      <Mono className="lp-step-n">{n}</Mono>
                      <h3 className="lp-display mt-6 text-xl">{title}</h3>
                      <p className="lp-step-p mt-2 text-sm leading-relaxed">{text}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </section>

            {/* Capabilities */}
            <section id="capabilities" className="px-4 md:px-8 py-16 space-y-10 max-w-[1280px] mx-auto">
              <div className="lp-reveal grid md:grid-cols-2 gap-10 items-center py-10">
                <div>
                  <Eyebrow icon={CheckCircle2}>Human review &amp; audit</Eyebrow>
                  <h2 className="lp-display mt-6 text-4xl md:text-5xl leading-[1.05] tracking-[-0.02em]">Nothing counts as fact until a person says so</h2>
                  <p className="mt-5 text-[17px] text-[#4A5B38] leading-relaxed max-w-lg">
                    A cross-patient review queue with keyboard shortcuts, bulk approval per note and undo. Conflicting edits are
                    refused, and the graph, Copilot, FHIR export and risk score use reviewed findings only.
                  </p>
                </div>
                <ReviewScene />
              </div>

              <div className="lp-reveal rounded-2xl bg-[#18280E] text-white grid md:grid-cols-2 gap-10 p-8 md:p-14 items-center">
                <div>
                  <Eyebrow icon={Search} dark>Record search</Eyebrow>
                  <h2 className="lp-display mt-6 text-4xl md:text-5xl leading-[1.05] tracking-[-0.02em]">Search every note, not just the analysed ones</h2>
                  <p className="mt-5 text-[17px] text-[#B3C5A0] leading-relaxed max-w-lg">
                    Postgres full-text search across notes, conditions, medications, procedures, observations and allergies,
                    with date filters and medication start and stop events. The local model may widen the terms; results are always real records.
                  </p>
                  <button onClick={onSignIn} className={`${button} mt-8 border border-white/20 hover:bg-white/10`}>Try it</button>
                </div>
                <div>
                  <SearchScene />
                  <p className="mt-3 lp-mono text-[11px] uppercase tracking-[0.1em] text-[#B3C5A0]">35,103 synthetic notes searchable · keyword full-text search, not a semantic model</p>
                </div>
              </div>

              <div className="lp-reveal grid md:grid-cols-2 gap-10 items-center py-10">
                <div className="order-2 md:order-1"><CopilotScene /></div>
                <div className="order-1 md:order-2">
                  <Eyebrow icon={Sparkles}>Grounded Copilot · prototype</Eyebrow>
                  <h2 className="lp-display mt-6 text-4xl md:text-5xl leading-[1.05] tracking-[-0.02em]">Answers that cite the record, from a model that stays local</h2>
                  <p className="mt-5 text-[17px] text-[#4A5B38] leading-relaxed max-w-lg">
                    Questions are answered from one patient&apos;s record by a model running on the same machine. Every claim
                    links to its source and unsupported numbers are flagged. If a draft gives treatment advice, the whole answer is
                    withheld and only the matching records are shown.
                  </p>
                </div>
              </div>

              <div className="lp-reveal rounded-2xl bg-[#18280E] text-white grid md:grid-cols-2 gap-10 p-8 md:p-14 items-center">
                <div>
                  <Eyebrow icon={Database} dark>Interoperability</Eyebrow>
                  <h2 className="lp-display mt-6 text-4xl md:text-5xl leading-[1.05] tracking-[-0.02em]">A FHIR R4 bundle, validated before it leaves</h2>
                  <p className="mt-5 text-[17px] text-[#B3C5A0] leading-relaxed max-w-lg">
                    Patient, encounters, conditions, medications, allergies, procedures and observations from the record, checked
                    against R4 models and reference rules. A bundle that fails validation cannot be downloaded.
                  </p>
                </div>
                <FhirScene />
              </div>
            </section>

            {/* Access: who can do what, from the real role sets */}
            <section id="access" className="px-4 md:px-8 py-24 max-w-[1100px] mx-auto">
              <Mono className="lp-reveal block text-center text-[#4A5B38]">six roles · enforced twice</Mono>
              <h2 className="lp-reveal lp-display mt-4 text-center text-4xl md:text-5xl leading-[1.05] tracking-[-0.02em] max-w-2xl mx-auto">Built for everyone who touches the record</h2>
              <p className="lp-reveal mt-4 text-center text-[17px] text-[#4A5B38] max-w-xl mx-auto">Each role sees exactly what it needs. Hover or tap a role to see what it can do.</p>
              <div className="mt-14"><AccessMatrix /></div>
            </section>

            {/* Status board */}
            <section id="status" className="bg-[#F4FAED] px-4 md:px-8 py-24">
              <div className="max-w-[1180px] mx-auto">
                <div className="grid md:grid-cols-[1fr_auto] gap-6 items-end">
                  <div>
                    <h2 className="lp-reveal lp-display text-4xl md:text-5xl leading-[1.05] tracking-[-0.02em]">Honest about what is built</h2>
                    <p className="lp-reveal mt-4 text-[17px] text-[#4A5B38] max-w-2xl">
                      Implemented means built and tested. Prototype means working but simplified. Not built yet means not built yet.
                    </p>
                  </div>
                  <div className="lp-reveal flex gap-2 lp-mono text-[11px] uppercase tracking-[0.1em]">
                    {BOARD.map(c => <span key={c.title} className={`rounded px-2 py-1 ${c.tone}`}>{c.items.length} {c.title.toLowerCase()}</span>)}
                  </div>
                </div>
                <div className="mt-12 grid md:grid-cols-3 gap-5">
                  {BOARD.map(col => (
                    <div key={col.title}>
                      <div className="lp-reveal flex items-center justify-between border-b-2 border-[#18280E] pb-2">
                        <span className="lp-display text-lg">{col.title}</span>
                        <span className={`lp-mono text-[10px] uppercase tracking-[0.1em] rounded px-2 py-0.5 ${col.tone}`}>{col.items.length}</span>
                      </div>
                      <ul className="mt-4 space-y-3">
                        {col.items.map(([name, note]) => (
                          <li key={name} className="lp-reveal rounded-xl bg-white border border-[#B3C5A0]/70 p-4 hover:border-[#18280E] transition-colors">
                            <div className="font-medium">{name}</div>
                            <div className="mt-1 text-sm text-[#4A5B38] leading-snug">{note}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Closing call to action, with a heartbeat drawn by scroll */}
            <section className="px-4 md:px-8 py-10">
              <div className="cta-band relative max-w-[1280px] mx-auto rounded-2xl bg-[#18280E] px-6 py-24 text-center overflow-hidden">
                <svg viewBox="0 0 1200 200" preserveAspectRatio="none" className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full h-40 opacity-30" aria-hidden="true">
                  <path className="cta-ecg" pathLength={1} fill="none" stroke="#B2EB76" strokeWidth="2.5" strokeLinejoin="round"
                    d="M0 100 H420 l18 -18 l14 18 h20 l18 -86 l22 170 l18 -110 h26 l14 -20 l14 20 H1200" />
                </svg>
                <div className="relative">
                  <h2 className="lp-display text-white text-4xl md:text-6xl leading-[1.03] tracking-[-0.025em]">See it on 409 synthetic patients</h2>
                  <p className="mt-4 text-[#B3C5A0]">Synthea sample data and the Synthea Coherent Data Set (CC BY 4.0). No real patient data.</p>
                  <div className="mt-8 flex flex-wrap justify-center gap-3">
                    <TryDemoButton onStart={onTryDemo} className={`${button} bg-[#B2EB76] text-[#18280E] hover:bg-[#c3f290]`}>Try the demo</TryDemoButton>
                    <button onClick={onSignIn} className={`${button} border border-white/20 text-white hover:bg-white/10`}>Sign in to the workspace</button>
                    <a href="#how" onClick={go("how")} className={`${button} border border-white/20 text-white hover:bg-white/10`}>How it works</a>
                  </div>
                </div>
              </div>
            </section>
          </main>

          <SiteFooter onTop={toTop} />
        </div>
      </div>
    </div>
  );
}
