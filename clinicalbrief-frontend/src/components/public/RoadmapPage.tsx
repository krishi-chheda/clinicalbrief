"use client";
// Public roadmap: the project's phases with honest status chips. Done-phase detail follows README.md
// ("What is implemented, and how real it is"); planned phases state intent only, with no dates.
import React, { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { PublicPage, Section, Mono } from "./kit";

gsap.registerPlugin(useGSAP, ScrollTrigger);

type Status = "done" | "next" | "planned";
type Phase = { id: string; title: string; status: Status; prototype?: boolean; text: string };

const PHASES: Phase[] = [
  { id: "0", title: "Audit", status: "done",
    text: "A full review of the starting codebase: what worked, what was claimed but not real, and what had to be rebuilt before anything else." },
  { id: "1", title: "Data", status: "done",
    text: "Synthea FHIR R4 import into one canonical model (patients, encounters, notes, diagnoses, medications, allergies, procedures, observations). Dry run, per-record validation, rejected-record log and idempotent re-import; every record keeps its source and provenance." },
  { id: "2", title: "AI note pipeline", status: "done", prototype: true,
    text: "Rule-based extraction: dictionary matching with negation and family-history handling, plus an extractive summary copied from the note. There is no calibrated confidence, so confidence is shown as empty rather than as a number." },
  { id: "3", title: "Knowledge layer", status: "done", prototype: true,
    text: "A patient-centred graph of conditions, findings, medications and allergies. AI findings appear only after human review, and links between them are labelled as co-occurrence, not clinical fact." },
  { id: "4", title: "Grounded Copilot", status: "done", prototype: true,
    text: "Questions answered by a local model grounded in one patient's record. Patient data never leaves the machine; if the model is unavailable, labelled rule-based answers are used instead." },
  { id: "5", title: "FHIR R4 export with validation", status: "done",
    text: "A transaction bundle built from the canonical record, checked on every export for R4 types, cardinality and resolving references. Structural R4 only: not validated against Australian profiles or terminology." },
  { id: "6", title: "Human review and governance", status: "done",
    text: "A review queue where people approve, reject or edit each AI finding against its evidence sentence, with every decision audited. A governance page shows pending work and decisions; nothing AI-extracted is used as fact until a person has reviewed it." },
  { id: "7", title: "Clinical workspace", status: "done",
    text: "The patient record, notes and layouts that tie the pieces together in one place to work from." },
  { id: "8a", title: "Record search", status: "done",
    text: "Postgres full-text search over every note and the structured record, with patient, type and date filters. Keyword-based, not semantic, and scoped to the patients a user may access." },
  { id: "8b", title: "Semantic search", status: "planned",
    text: "Embedding-based search, kept only if it beats full-text search on a fixed set of questions." },
  { id: "9", title: "Observability", status: "done",
    text: "A System health page for admins and auditors: live checks of the database, local model and search index, plus request timing, error rates and request ids. Kept in memory per backend process, so history resets on restart." },
  { id: "10", title: "Security hardening", status: "next",
    text: "A focused pass over authentication, access rules and data handling to close remaining gaps." },
  { id: "11", title: "Demo", status: "planned",
    text: "A guided way to see the product working end to end on synthetic data." },
  { id: "12", title: "Industry readiness", status: "planned",
    text: "Documentation a technical reviewer would expect: how it is built, how to run it, and what its limits are." },
  { id: "13", title: "Portfolio", status: "planned",
    text: "Presenting the project and what was learned building it." },
];

const CHIP = "lp-mono text-[10px] uppercase tracking-wider px-2 py-1 rounded shrink-0";
const STATUS_STYLE: Record<Status, string> = {
  done: "bg-[#B2EB76] text-[#18280E]",
  next: "bg-[#18280E] text-[#B2EB76]",
  planned: "bg-white text-[#18280E] border border-[#B3C5A0]",
};
// Dot = outlined ring plus an inner fill (lime for done, forest for next) that GSAP can grow in.
const DOT_STYLE: Record<Status, string> = {
  done: "border-[#18280E]",
  next: "border-[#18280E]",
  planned: "border-[#B3C5A0]",
};
const FILL_STYLE: Partial<Record<Status, string>> = { done: "bg-[#B2EB76]", next: "bg-[#18280E]" };

// Scroll motion. Everything is a from/fromTo inside a no-preference media query, so with reduced motion
// (or no JS) the page is static and fully visible. Premium personality: power3.out, no overshoot.
function useRoadmapMotion(root: React.RefObject<HTMLDivElement | null>) {
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const ease = "power3.out";

      // Count tiles rise in, numbers count up from zero.
      gsap.from(".rm-tile", { y: 16, opacity: 0, duration: 0.5, ease, stagger: 0.08, scrollTrigger: { trigger: ".rm-tiles", start: "top 85%" } });
      gsap.utils.toArray<HTMLElement>(".rm-count").forEach(el => {
        gsap.from(el, { textContent: 0, snap: { textContent: 1 }, duration: 1, ease: "power2.out", scrollTrigger: { trigger: el, start: "top 85%" } });
      });

      gsap.utils.toArray<HTMLElement>(".rm-phase").forEach(li => {
        // Progress line: each connector segment draws down, scrubbed to scroll, reaching the next dot at 60% viewport.
        const fill = li.querySelector(".rm-line");
        if (fill) gsap.fromTo(fill, { scaleY: 0 }, { scaleY: 1, ease: "none", scrollTrigger: { trigger: li, start: "top 60%", end: "bottom 60%", scrub: 0.6 } });

        // Card slides in from the left (small distance, stays inside the item's gutter).
        gsap.from(li.querySelectorAll(".rm-card > *"), { x: -24, opacity: 0, duration: 0.5, ease, stagger: 0.06, scrollTrigger: { trigger: li, start: "top 85%" } });

        // Dot activates as the line reaches it: ring settles, then the fill grows in.
        const tl = gsap.timeline({ scrollTrigger: { trigger: li, start: "top 60%", toggleActions: "play none none reverse" } });
        tl.from(li.querySelector(".rm-dot"), { scale: 0.6, opacity: 0.4, duration: 0.4, ease });
        const dotFill = li.querySelector(".rm-dot-fill");
        if (dotFill) tl.from(dotFill, { scale: 0, duration: 0.4, ease }, "-=0.2");
      });

      // The "next" phase breathes: a soft ring expands and fades, on a slow loop.
      gsap.fromTo(".rm-ring", { scale: 1, opacity: 0.5 }, { scale: 2.2, opacity: 0, duration: 1.8, ease: "sine.out", repeat: -1, repeatDelay: 0.4 });

      gsap.from(".rm-nb", { y: 12, opacity: 0, duration: 0.45, ease, stagger: 0.08, scrollTrigger: { trigger: ".rm-nb-list", start: "top 85%" } });
    });
  }, { scope: root });
}

const NOT_BUILT = [
  "Accuracy evaluation on a labelled set. No accuracy figure is shown anywhere until it is measured.",
  "Semantic search (Phase 8b).",
  "A de-identified research view.",
];

export default function RoadmapPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  useRoadmapMotion(rootRef);
  const count = (s: Status) => PHASES.filter(p => p.status === s).length;
  const summary: { s: Status; label: string }[] = [
    { s: "done", label: "Done" }, { s: "next", label: "Next" }, { s: "planned", label: "Planned" },
  ];
  return (
    <PublicPage
      eyebrow="Roadmap"
      title="Roadmap"
      intro={<p>Where ClinicalBrief stands, phase by phase. Statuses are honest: “prototype” means it works but is deliberately simple. Planned phases carry no dates.</p>}
    >
      <div ref={rootRef}>
      <Section label="Progress" title="Phases at a glance">
        <ul className="rm-tiles grid grid-cols-3 gap-3 md:gap-4 max-w-xl">
          {summary.map(({ s, label }) => (
            <li key={s} className="rm-tile rounded-xl border border-[#B3C5A0]/60 p-4">
              <span className="rm-count lp-display block text-4xl md:text-5xl">{count(s)}</span>
              <span className={`${CHIP} inline-block mt-3 ${STATUS_STYLE[s]}`}>{label}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-[#4A5B38]">Every phase is independently code-reviewed before it counts as done.</p>
      </Section>

      <Section tone="pale" label="Timeline" title="Phase 0 to Phase 13">
        <ol className="relative">
          {PHASES.map((p, i) => (
            <li key={p.id} className="rm-phase relative pl-10 md:pl-14 pb-8 last:pb-0">
              {i < PHASES.length - 1 && (
                <span aria-hidden="true" className="absolute left-[11px] md:left-[15px] top-6 bottom-0 w-[2px] bg-[#B3C5A0]/60">
                  <span className="rm-line absolute inset-0 origin-top bg-[#3F7308]" />
                </span>
              )}
              <span aria-hidden="true" className="absolute left-0 md:left-1 top-1 h-6 w-6">
                {p.status === "next" && <span className="rm-ring absolute inset-0 rounded-full border-2 border-[#18280E] opacity-0" />}
                <span className={`rm-dot absolute inset-0 rounded-full border-2 bg-white overflow-hidden ${DOT_STYLE[p.status]}`}>
                  {FILL_STYLE[p.status] && <span className={`rm-dot-fill absolute inset-0 rounded-full ${FILL_STYLE[p.status]}`} />}
                </span>
              </span>
              <div className="rm-card">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Mono className="text-[#4A5B38]">Phase {p.id}</Mono>
                <span className={`${CHIP} ${STATUS_STYLE[p.status]}`}>{p.status}</span>
                {p.prototype && <span className={`${CHIP} bg-[#EBE46A] text-[#18280E]`}>prototype</span>}
              </div>
              <h3 className="lp-display mt-2 text-xl md:text-2xl tracking-[-0.01em]">{p.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[#18280E] max-w-2xl">{p.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section tone="dark" label="Not built yet" title="Deliberately missing">
        <ul className="rm-nb-list space-y-3 max-w-2xl">
          {NOT_BUILT.map(t => (
            <li key={t} className="rm-nb flex gap-3 text-[15px] leading-relaxed">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 rounded-full bg-[#B2EB76] shrink-0" />
              {t}
            </li>
          ))}
        </ul>
      </Section>
      </div>
    </PublicPage>
  );
}
