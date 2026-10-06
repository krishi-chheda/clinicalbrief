// Looping scenes for the landing page's capability sections. Each acts out what the feature does,
// in the same order the product does it, and rotates through several examples. All data is synthetic
// and labelled "example".
// Motion (Premium/Corporate): one cycle per example (8-9 s), signature curve cubic-bezier(0.4,0,0.2,1),
// staggers under 600 ms. Elements are timed by animation-delay on shared keyframes (globals.css, "cv-").
// Examples take turns through slots (cv-slot2/3/4): example k is shown during the k-th slot of the cycle.
// With reduced motion every element shows its resting, fully visible state and only the first example shows.
import React from "react";
import { Check, Search, X } from "lucide-react";

const d = (s: number) => ({ animationDelay: `${s}s` }) as React.CSSProperties;
const Tag = ({ children, className = "" }: { children: React.ReactNode; className?: string }) =>
  <span className={`lp-mono text-[10px] uppercase tracking-[0.12em] ${className}`}>{children}</span>;

// Example k of n, each shown for `seconds`: negative delays phase it into the k-th slot of the shared cycle.
export function slotStyle(k: number, n: number, seconds: number, kind: "slot" | "dot" = "slot"): React.CSSProperties {
  const cycle = n * seconds;
  return { animationName: `cv-${kind}${n}`, animationDuration: `${cycle}s`, animationDelay: `${-((cycle - k * seconds) % cycle)}s` };
}

export function SlotDots({ n, seconds, dark = false }: { n: number; seconds: number; dark?: boolean }) {
  return (
    <span className="flex gap-1.5" aria-hidden="true" style={dark ? { "--dot-on": "#B2EB76" } as React.CSSProperties : undefined}>
      {Array.from({ length: n }, (_, k) => <span key={k} className="cv-a cv-dot h-1.5 w-4 rounded-full" style={slotStyle(k, n, seconds, "dot")} />)}
    </span>
  );
}

// --- 1. Review: decks of findings; each is decided by a key press, stamped, and leaves ----------------------
type Card = { finding: string; meta: string; evidence: string; key: string; stamp: string; cls: string; log: string };
const STAMP = { approved: "bg-[#B2EB76] text-[#18280E]", edited: "bg-[#EBE46A] text-[#333109]", rejected: "bg-[#F2C7A0] text-[#331B09]" };
const DECKS: Card[][] = [
  [
    { finding: "Type 2 diabetes mellitus", meta: "Condition · E11.9", evidence: "History of type 2 diabetes and hypertension.", key: "A", stamp: "approved", cls: STAMP.approved, log: "approve  type 2 diabetes" },
    { finding: "Hypertension → Essential hypertension", meta: "Condition · I10", evidence: "History of type 2 diabetes and hypertension.", key: "E", stamp: "edited", cls: STAMP.edited, log: "edit     hypertension" },
    { finding: "Stroke", meta: "Condition · dictionary match", evidence: "Heat stroke risk discussed before travel.", key: "R", stamp: "rejected", cls: STAMP.rejected, log: "reject   stroke" },
  ],
  [
    { finding: "Asthma", meta: "Condition · J45.909", evidence: "Asthma since childhood, uses albuterol as needed.", key: "A", stamp: "approved", cls: STAMP.approved, log: "approve  asthma" },
    { finding: "Albuterol → Albuterol 90 MCG inhaler", meta: "Medication", evidence: "Asthma since childhood, uses albuterol as needed.", key: "E", stamp: "edited", cls: STAMP.edited, log: "edit     albuterol" },
    { finding: "Dialysis", meta: "Procedure · dictionary match", evidence: "Dialysis was discussed as a future option only.", key: "R", stamp: "rejected", cls: STAMP.rejected, log: "reject   dialysis" },
  ],
];
const DECK_SECONDS = 9;

export function ReviewScene() {
  return (
    <div className="lp-grid rounded-2xl border border-[#B3C5A0]/60 p-5 md:p-8">
      <div className="flex items-center justify-between">
        <Tag className="text-[#4A5B38]">review queue</Tag>
        <div className="flex items-center gap-3"><SlotDots n={DECKS.length} seconds={DECK_SECONDS} /><Tag className="text-[#4A5B38]/70">example</Tag></div>
      </div>
      <div className="grid">
        {DECKS.map((deck, k) => (
          <div key={k} className="cv-a cv-slot [grid-area:1/1]" style={slotStyle(k, DECKS.length, DECK_SECONDS)}>
            <div className="relative h-[190px] mt-4">
              {deck.map((c, i) => (
                // Delays 0 / -3 / -6 s put the three cards at back / middle / front of the same 9 s cycle.
                <div key={c.finding} className="cv-a cv-dcard absolute inset-x-0 top-12" style={{ animationDelay: `${-3 * i}s`, ...[{ transform: "translateY(-36px) scale(.88)", opacity: .4 }, { transform: "translateY(-18px) scale(.94)", opacity: .75 }, {}][i] }}>
                  <div className="relative rounded-xl bg-white border border-[#B3C5A0]/80 shadow-[0_10px_30px_-14px_rgba(9,15,5,.35)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-[#090F05] truncate">{c.finding}</div>
                        <Tag className="text-[#4A5B38]">{c.meta}</Tag>
                      </div>
                      <span className="cv-a cv-key lp-mono text-xs rounded border border-[#B3C5A0] px-2 py-0.5 text-[#18280E] shrink-0" style={{ animationDelay: `${-3 * i}s` }}>{c.key}</span>
                    </div>
                    <p className="mt-3 text-sm text-[#4A5B38] border-l-2 border-[#B2EB76] pl-3">&ldquo;{c.evidence}&rdquo;</p>
                    <span className={`cv-a cv-stamp absolute right-4 bottom-3 lp-mono text-[11px] uppercase tracking-[0.14em] px-2.5 py-1 rounded ${c.cls}`} style={{ animationDelay: `${-3 * i}s` }}>{c.stamp}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 rounded-lg bg-[#18280E] p-3 space-y-1">
              <Tag className="text-[#B3C5A0]">audit_log</Tag>
              {deck.map((c, i) => (
                // A log line lights up when its card is stamped (same cycle offset as the card).
                <div key={c.log} className="cv-a cv-log lp-mono text-[11px] text-[#B2EB76] whitespace-pre" style={{ animationDelay: `${-3 * i}s` }}>
                  {`${10 + k}:4${1 + i}:0${2 + i * 3}  ${c.log}`}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-[#4A5B38]">Every decision writes the review history and an audit row. Keys: A approve, E edit, R reject, U undo.</p>
    </div>
  );
}

// --- 2. Search: three example searches take turns (8 s each). In each one the query types, the local model may
//     widen it, hits rise in with the match marked, and a filter range sweeps the timeline. All data synthetic.
type Hit = { kind: string; pre: string; mark: string; post: string; date: string };
const SEARCHES: { query: string; chips: string[]; chipNote: string; hits: Hit[]; range: [number, number]; rangeLabel: string;
  events: { x: number; on: boolean }[]; axis: [string, string] }[] = [
  {
    query: "diabetes medication", chips: ["metformin", "insulin", "glipizide"], chipNote: "related terms · local model",
    hits: [
      { kind: "medication", pre: "", mark: "Metformin", post: " 500 MG oral tablet · started", date: "2024-03-01" },
      { kind: "note", pre: "...continue ", mark: "metformin", post: " 500 mg twice daily...", date: "2024-03-01" },
      { kind: "medication", pre: "", mark: "Insulin", post: " glargine · stopped", date: "2023-11-20" },
    ],
    range: [56, 100], rangeLabel: "medications · last 12 months", axis: ["2019", "2024"],
    events: [{ x: 8, on: true }, { x: 22, on: false }, { x: 37, on: true }, { x: 61, on: true }, { x: 74, on: false }, { x: 88, on: true }],
  },
  {
    query: "\"chest pain\"", chips: [], chipNote: "exact phrase · in quotes",
    hits: [
      { kind: "condition", pre: "", mark: "Chest pain", post: " (finding) · onset", date: "2023-08-14" },
      { kind: "note", pre: "...presents with ", mark: "chest pain", post: " on exertion, relieved by rest...", date: "2023-08-14" },
      { kind: "note", pre: "...follow-up: no further ", mark: "chest pain", post: " since last visit...", date: "2023-10-02" },
    ],
    range: [30, 62], rangeLabel: "one patient · 2023", axis: ["2021", "2025"],
    events: [{ x: 12, on: false }, { x: 38, on: true }, { x: 47, on: true }, { x: 55, on: true }, { x: 80, on: false }],
  },
  {
    query: "asthma or wheeze", chips: ["albuterol", "inhaler"], chipNote: "either word · plus related terms",
    hits: [
      { kind: "condition", pre: "", mark: "Asthma", post: " (disorder) · onset", date: "2016-05-02" },
      { kind: "medication", pre: "", mark: "Albuterol", post: " 90 MCG inhaler · started", date: "2016-05-02" },
      { kind: "note", pre: "...expiratory ", mark: "wheeze", post: " heard on auscultation...", date: "2022-01-10" },
    ],
    range: [0, 100], rangeLabel: "all dates · timeline order", axis: ["2015", "2024"],
    events: [{ x: 9, on: true }, { x: 26, on: true }, { x: 44, on: false }, { x: 63, on: true }, { x: 82, on: true }],
  },
];
const SLOT = 8; // seconds per example

export function SearchScene() {
  const n = SEARCHES.length;
  return (
    <div className="rounded-2xl bg-black/25 border border-white/10 p-5 md:p-6">
      <div className="flex items-center justify-between">
        <Tag className="text-[#B3C5A0]">search records</Tag>
        <div className="flex items-center gap-3">
          <SlotDots n={n} seconds={SLOT} dark />
          <Tag className="text-[#B3C5A0]/60">example</Tag>
        </div>
      </div>
      <div className="grid">
        {SEARCHES.map((s, k) => (
          <div key={s.query} className="cv-a cv-slot [grid-area:1/1]" style={slotStyle(k, n, SLOT)}>
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-white px-3 py-2.5">
              <Search className="h-4 w-4 text-[#4A5B38] shrink-0" />
              <span className="cv-a cv-type lp-mono text-sm text-[#090F05]"
                style={{ "--w": `${s.query.length}ch`, animationTimingFunction: `steps(${s.query.length}, end)` } as React.CSSProperties}>{s.query}</span>
              <span className="cv-a cv-caret h-4 w-[2px] bg-[#3F7308]" />
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5 min-h-[22px]">
              {s.chips.map((t, i) => (
                <span key={t} className="cv-a cv-chip lp-mono text-[10px] uppercase tracking-[0.1em] text-[#B2EB76] border border-[#B2EB76]/50 rounded px-2 py-0.5" style={d(i * 0.12)}>+ {t}</span>
              ))}
              <span className="cv-a cv-chip lp-mono text-[10px] uppercase tracking-[0.1em] text-[#B3C5A0] self-center" style={d(0.4)}>{s.chipNote}</span>
            </div>
            <ul className="mt-3 space-y-1.5">
              {s.hits.map((h, i) => (
                <li key={i} className="cv-a cv-hit flex items-center gap-3 rounded-md bg-white/5 px-3 py-2" style={d(i * 0.1)}>
                  <span className={`lp-mono text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded shrink-0 ${h.kind === "note" ? "bg-white/10 text-white" : "bg-[#B2EB76] text-[#18280E]"}`}>{h.kind}</span>
                  <span className="text-[13px] text-white truncate">{h.pre}<mark className="bg-[#EBE46A] text-[#18280E] rounded px-0.5">{h.mark}</mark>{h.post}</span>
                  <span className="ml-auto lp-mono text-[10px] text-[#B3C5A0] shrink-0">{h.date}</span>
                </li>
              ))}
            </ul>
            {/* Timeline: the filter range sweeps in and the events inside it light up */}
            <div className="mt-5">
              <div className="relative h-8">
                <div className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
                <div className="cv-a cv-range absolute top-0 bottom-0 rounded bg-[#B2EB76]/12 border-x border-[#B2EB76]/60"
                  style={{ left: `${s.range[0]}%`, right: `${100 - s.range[1]}%` }} />
                {s.events.map((e, i) => {
                  const inside = e.x >= s.range[0] && e.x <= s.range[1];
                  return (
                    <span key={i} className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-2.5 w-2.5 rounded-full ${e.on ? "bg-[#B2EB76]" : "border border-[#B2EB76] bg-[#18280E]"} ${inside ? "cv-a cv-event" : "opacity-40"}`}
                      style={{ left: `${e.x}%`, ...(inside ? d(i * 0.06) : {}) }} />
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between lp-mono text-[10px] text-[#B3C5A0]"><span>{s.axis[0]}</span><span>{s.rangeLabel}</span><span>{s.axis[1]}</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- 3. Copilot: four answers, each showing one rule of grounded_copilot.py ------------------------------------
//   grounded: every sentence cites a record | removed: a sentence with no source is never shown (N-29) |
//   withheld: a draft with treatment advice is withheld whole; the matching records are shown instead (N-26) |
//   no evidence: the exact refusal text when nothing in the record answers the question.
const COPILOT_SECONDS = 9;
const Cite = ({ id, ping = false }: { id: string; ping?: boolean }) =>
  <span className={`${ping ? "cv-a cv-ping " : ""}inline-block lp-mono text-[11px] px-1 rounded bg-[#B2EB76] text-[#18280E]`}>{id}</span>;
const Words = ({ text, from = 0 }: { text: string; from?: number }) =>
  <>{text.split(" ").map((w, i) => <span key={i} className="cv-a cv-word" style={d(from + i * 0.06)}>{w} </span>)}</>;
const Badge = ({ children, tone }: { children: React.ReactNode; tone: string }) =>
  <span className={`cv-a cv-badge lp-mono text-[10px] uppercase tracking-[0.12em] px-2 py-1 rounded ${tone}`}>{children}</span>;
const LOCAL = <span className="cv-a cv-badge lp-mono text-[10px] uppercase tracking-[0.12em] text-[#4A5B38]" style={d(0.15)}>runs on this machine</span>;
const Source = ({ id, meta, text }: { id: string; meta: string; text: string }) => (
  <div className="cv-a cv-src mt-3 rounded-lg border border-[#B3C5A0] bg-[#F7F9F4] px-3 py-2">
    <Tag className="text-[#3F7308]">{id} · {meta}</Tag>
    <div className="mt-0.5 text-[13px] text-[#18280E]">{text}</div>
  </div>
);
const Question = ({ children }: { children: React.ReactNode }) =>
  <p className="mt-3 ml-auto w-fit max-w-[85%] rounded-lg bg-[#EEF2E9] px-3 py-2 text-[#18280E]">{children}</p>;

const COPILOT_EXAMPLES: React.ReactNode[] = [
  // 1. Grounded
  <>
    <Question>What was the most recent HbA1c?</Question>
    <p className="mt-3 text-[#18280E] leading-relaxed"><Words text="The most recent HbA1c was 6.8 % on 2024-03-01" /><Cite id="E1" ping /></p>
    <Source id="E1" meta="observation · 2024-03-01" text="Hemoglobin A1c/Hemoglobin.total in Blood: 6.8 %" />
    <div className="mt-3 flex flex-wrap items-center gap-2"><Badge tone="bg-[#B2EB76] text-[#18280E]">grounded in sources</Badge>{LOCAL}</div>
  </>,
  // 2. Uncited sentence removed
  <>
    <Question>What allergies does the patient have?</Question>
    <p className="mt-3 text-[#18280E] leading-relaxed">
      <Words text="Penicillin allergy, reaction: rash" /><Cite id="E1" ping />
      <span className="cv-a cv-claim inline"> <span className="cv-a cv-draft relative inline-block">She also reacts to sulfa drugs.</span></span>
    </p>
    <Tag className="block mt-1 text-[#A1441B]"><span className="cv-a cv-label">1 statement removed: no source</span></Tag>
    <Source id="E1" meta="allergy · recorded 2018-06-11" text="Penicillin allergy - rash, moderate" />
    <div className="mt-3 flex flex-wrap items-center gap-2"><Badge tone="bg-[#EBE46A] text-[#333109]">partly grounded</Badge>{LOCAL}</div>
  </>,
  // 3. Treatment advice: whole draft withheld, matching records shown
  <>
    <Question>What conditions does the patient have, and should insulin start?</Question>
    <div className="cv-a cv-draft relative mt-3 rounded-lg border border-dashed border-[#B3C5A0] px-3 py-2">
      <Tag className="text-[#4A5B38]/80">model draft · checked first</Tag>
      <p className="mt-1 text-[#18280E] leading-relaxed">
        <Words text="Type 2 diabetes mellitus is on the condition list" /><Cite id="E1" ping />
        <span className="cv-a cv-claim inline"> Start insulin 10 units at night.</span>
      </p>
    </div>
    <Tag className="block mt-2 text-[#A1441B]"><span className="cv-a cv-label">withheld · the draft gave treatment advice</span></Tag>
    <div className="cv-a cv-src mt-3 rounded-lg border border-[#B3C5A0] bg-[#F7F9F4] px-3 py-2.5">
      <p className="text-[13px] text-[#18280E]">No generated answer could be verified. These matching records are in the patient&apos;s file:</p>
      <p className="mt-1.5 text-[13px] text-[#18280E]">&bull; Diabetes mellitus type 2 (disorder), clinical status: active (2019-03-01) <Cite id="E1" /></p>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2"><Badge tone="bg-[#EBE46A] text-[#333109]">matching records shown</Badge>{LOCAL}</div>
  </>,
  // 4. No evidence: the exact refusal
  <>
    <Question>What is the patient&apos;s blood type?</Question>
    <p className="mt-3 text-[#18280E] leading-relaxed"><Words text="I couldn't find evidence for this in the available records." /></p>
    <p className="cv-a cv-src mt-3 text-[13px] text-[#4A5B38]">No record mentions a blood type, so nothing is guessed.</p>
    <div className="mt-3 flex flex-wrap items-center gap-2"><Badge tone="bg-[#EEF2E9] text-[#4A5B38]">no evidence in record</Badge>{LOCAL}</div>
  </>,
];

export function CopilotScene() {
  const n = COPILOT_EXAMPLES.length;
  return (
    <div className="rounded-2xl bg-[#F4FAED] p-5 md:p-7">
      <div className="rounded-xl bg-white border border-[#B3C5A0]/70 p-5 text-sm">
        <div className="flex items-center justify-between">
          <Tag className="text-[#4A5B38]">copilot · local model</Tag>
          <div className="flex items-center gap-3"><SlotDots n={n} seconds={COPILOT_SECONDS} /><Tag className="text-[#4A5B38]/70">example</Tag></div>
        </div>
        <div className="grid">
          {COPILOT_EXAMPLES.map((ex, k) => (
            <div key={k} className="cv-a cv-slot [grid-area:1/1]" style={slotStyle(k, n, COPILOT_SECONDS)}>{ex}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- 4. FHIR: resources fly into a bundle, checks run, download unlocks only if every check passes -----------
const CHECKS = ["Every resource parses as FHIR R4", "Every reference resolves inside the bundle", "Invariants hold (e.g. con-4)"];
const BUNDLES: { label: string; resources: string[]; fail?: number; result: string }[] = [
  { label: "bundle · transaction · passed", result: "download enabled",
    resources: ["Patient", "Encounter", "Encounter", "Condition", "Condition", "Condition", "MedicationStatement", "MedicationStatement",
      "Observation", "Observation", "Observation", "Procedure", "AllergyIntolerance", "Encounter"] },
  { label: "bundle · transaction · failed", fail: 1, result: "download blocked · 1 check failed",
    resources: ["Patient", "Encounter", "Condition", "Condition", "MedicationStatement", "Observation", "Observation", "Procedure"] },
];
const FHIR_SECONDS = 9;

export function FhirScene() {
  const n = BUNDLES.length;
  return (
    <div className="rounded-2xl bg-black/25 border border-white/10 p-5 md:p-6">
      <div className="flex items-center justify-between">
        <Tag className="text-[#B3C5A0]">fhir r4 export</Tag>
        <div className="flex items-center gap-3"><SlotDots n={n} seconds={FHIR_SECONDS} dark /><Tag className="text-[#B3C5A0]/60">example</Tag></div>
      </div>
      <div className="grid">
        {BUNDLES.map((b, k) => (
          <div key={k} className="cv-a cv-slot [grid-area:1/1]" style={slotStyle(k, n, FHIR_SECONDS)}>
            <Tag className="block mt-3 text-[#B3C5A0]/80">{b.label}</Tag>
            <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-1.5 rounded-lg border border-dashed border-[#B2EB76]/40 p-2.5 min-h-[92px] content-start">
              {b.resources.map((r, i) => (
                <span key={i} className="cv-a cv-fly lp-mono text-[9px] uppercase tracking-[0.06em] text-[#18280E] bg-[#B2EB76] rounded px-1.5 py-1 truncate"
                  style={{ ...d(i * 0.04), "--dx": `${((i * 47) % 160) - 80}px`, "--dy": `${((i * 31) % 90) - 120}px` } as React.CSSProperties}>{r}</span>
              ))}
            </div>
            <ul className="mt-4 space-y-2">
              {CHECKS.map((c, i) => {
                const failed = b.fail === i;
                return (
                  <li key={c} className="flex items-center gap-2.5 text-sm text-[#B3C5A0]">
                    <span className={`cv-a ${failed ? "cv-fail" : "cv-check"} h-5 w-5 rounded-full border ${failed ? "border-[#F2C7A0]/70" : "border-[#B2EB76]/60"} flex items-center justify-center`} style={d(i * 0.45)}>
                      {failed ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                    </span>
                    {c}{failed && <span className="lp-mono text-[10px] uppercase tracking-[0.08em] text-[#F2C7A0]">· a reference points outside the bundle</span>}
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex items-center gap-3">
              <span className={`${b.fail === undefined ? "cv-a cv-unlock" : "bg-white/10 text-white/40"} lp-mono text-[12px] px-3 py-2 rounded-md`}>Download bundle</span>
              <Tag className={b.fail === undefined ? "text-[#B3C5A0]" : "text-[#F2C7A0]"}>{b.result}</Tag>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-[#B3C5A0]/80">One real export from the demo data: 573 entries, 436 KB, validation passed.</p>
    </div>
  );
}
