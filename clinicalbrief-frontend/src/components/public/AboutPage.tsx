// /about: what ClinicalBrief is, how it works, architecture, principles, who built it.
// Every claim matches README.md ("What is implemented", "Architecture", "Copilot", "Roles and security model",
// "Known gaps"). No metrics, users or accuracy figures: none have been measured.
"use client";
import React, { useRef } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { CONTACT, PublicPage, Section, Mono } from "./kit";

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText, DrawSVGPlugin, ScrambleTextPlugin);

const STEPS = [
  { n: "01", t: "Import", d: "Synthea FHIR R4 records are validated record by record and mapped into one canonical model with provenance. Invalid records are logged, not dropped silently." },
  { n: "02", t: "Extraction", d: "A rule-based pipeline finds conditions, medications and allergies in notes, handles negation and family history, and copies an extractive summary." },
  { n: "03", t: "Human review", d: "Every AI finding waits in a review queue with its evidence sentence. A person approves, rejects or edits it; each decision is audited." },
  { n: "04", t: "ICD-10 suggestions", d: "Exact matches against a small dictionary are suggested for review. Anything else stays unmapped; no default code is guessed." },
  { n: "05", t: "Use the record", d: "Search every note and the structured record, ask the Copilot grounded questions, or export a FHIR R4 bundle." },
];

const PRINCIPLES = [
  { t: "Honesty over polish", d: "Each feature is labelled Implemented, Prototype or Not built. No accuracy figure is shown until one is measured on a labelled set." },
  { t: "Human review first", d: "AI output is never treated as fact until a person approves or edits it. The graph, FHIR export, Copilot structured answers and risk score use reviewed findings only." },
  { t: "Data stays on the machine", d: "The Copilot only accepts a locally run model on a loopback address. Patient data is never sent to a cloud AI model." },
  { t: "Audited", d: "Review decisions, exports, and reads of clinical data (records, note text, AI output, Copilot questions) are logged: who and which record, never the content." },
];

const STACK = [
  ["Frontend", "Next.js 15, React, TypeScript, Tailwind CSS, GSAP"],
  ["Backend", "FastAPI, Python 3.12"],
  ["Database", "PostgreSQL on Supabase with row-level security; SQLite for local development"],
  ["Auth", "Supabase Auth, tokens verified by the backend"],
  ["AI", "Ollama with qwen3.5 (local); rule-based extraction pipeline"],
  ["Data", "Synthea synthetic patients, FHIR R4"],
];

function Box({ title, sub, dark = false }: { title: string; sub: string; dark?: boolean }) {
  return (
    <div className={`ab-box rounded-2xl px-5 py-4 border ${dark ? "bg-[#18280E] text-white border-[#18280E]" : "bg-white border-[#B3C5A0]"}`}>
      <div className="lp-display text-lg font-semibold">{title}</div>
      <div className={`mt-1 text-sm leading-snug ${dark ? "text-[#B3C5A0]" : "text-[#4A5B38]"}`}>{sub}</div>
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="ab-arrow flex md:flex-col items-center justify-center gap-2 py-2 md:py-0 md:px-2 text-[#3F7308]">
      {/* Points down on mobile, right on desktop (rotated). Drawn in by DrawSVG when motion is allowed. */}
      <svg viewBox="0 0 28 28" className="h-7 w-7 md:-rotate-90" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path className="ab-line" d="M14 3 V24" />
        <path className="ab-line" d="M8 18 L14 24 L20 18" />
      </svg>
      <Mono className="text-[10px] text-[#4A5B38]">{label}</Mono>
    </div>
  );
}

function Diagram() {
  return (
    <div className="ab-diagram lp-grid rounded-2xl border border-[#B3C5A0]/60 p-4 md:p-8" aria-hidden="true">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] items-center">
        <Box title="Next.js frontend" sub="Reads only through the API" />
        <Arrow label="Bearer token" />
        <Box title="FastAPI backend" sub="Role + patient checks, AI pipeline, search, FHIR" dark />
        <Arrow label="SQL" />
        <Box title="PostgreSQL" sub="Supabase, Sydney region, row-level security" />
      </div>
      <div className="ab-row2 mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 md:w-[60%] md:mx-auto">
        <Box title="Ollama · qwen3.5" sub="Local model on the same machine, Copilot only" />
        <Box title="Synthea FHIR import" sub="Validated into the canonical model" />
      </div>
    </div>
  );
}

const cta = "inline-flex items-center gap-2 lp-mono text-[13px] px-4 py-2.5 rounded-md transition-colors";

// Motion (all inside a no-preference media query, so reduced motion sees the static page; every hidden state is
// set by gsap.from, so nothing depends on JS to be visible): h2 line reveals, the architecture diagram building
// itself, the five steps lighting up in order, principle cards staggering in, one scrambled mono label.
function useAboutMotion(root: React.RefObject<HTMLDivElement | null>) {
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const ease = "power3.out";
      const onView = (trigger: Element, start = "top 80%") => ({ trigger, start, once: true });

      gsap.utils.toArray<HTMLElement>("main h2").forEach(h => {
        SplitText.create(h, {
          type: "lines", mask: "lines", autoSplit: true,
          onSplit: self => gsap.from(self.lines, { yPercent: 100, duration: 0.8, ease: "expo.out", stagger: 0.08, scrollTrigger: onView(h, "top 85%") }),
        });
      });

      const diagram = root.current?.querySelector(".ab-diagram");
      if (diagram) {
        gsap.timeline({ scrollTrigger: onView(diagram, "top 75%"), defaults: { ease } })
          .from(".ab-diagram .ab-box", { y: 16, opacity: 0, duration: 0.6, stagger: 0.08 })
          .from(".ab-diagram .ab-line", { drawSVG: 0, duration: 0.5, ease: "power2.inOut", stagger: 0.06 }, "-=0.2")
          .from(".ab-diagram .ab-arrow .lp-mono", { opacity: 0, x: -6, duration: 0.4, stagger: 0.1 }, "<0.2");
      }

      const steps = gsap.utils.toArray<HTMLElement>(".ab-step");
      if (steps.length) {
        gsap.timeline({ scrollTrigger: onView(steps[0]), defaults: { ease } })
          .from(steps, { y: 24, opacity: 0, duration: 0.7, stagger: 0.08 })
          // the highlight bar fills step by step, like a record moving through the pipeline
          .from(".ab-step-bar", { scaleX: 0, duration: 0.45, stagger: 0.09, ease: "power2.inOut" }, "-=0.3");
      }

      const cards = gsap.utils.toArray<HTMLElement>(".ab-principle");
      if (cards.length) gsap.from(cards, { y: 20, opacity: 0, duration: 0.7, ease, stagger: 0.1, scrollTrigger: onView(cards[0]) });

      const who = root.current?.querySelector<HTMLElement>("#who .lp-mono");
      if (who) gsap.from(who, { scrambleText: { text: "", chars: "░▒▓█01", speed: 0.4 }, duration: 0.9, scrollTrigger: onView(who, "top 85%") });
    });
  }, { scope: root });
}

export default function AboutPage() {
  const root = useRef<HTMLDivElement>(null);
  useAboutMotion(root);
  return (
    <div ref={root}>
    <PublicPage
      eyebrow="About ClinicalBrief"
      title="Clinical notes, turned into a record people can check."
      intro={<p>ClinicalBrief is a research prototype that reads clinical notes, suggests what they contain, and keeps a person in charge of what counts as fact. It runs on synthetic data only.</p>}
    >
      <Section label="The problem" title="Notes hold the detail, but they are hard to use.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            ["Hard to search", "Diagnoses, medications and allergies are buried in free text spread across many encounters."],
            ["Hard to check", "Anything pulled out of a note, by a person or a model, needs to point back to the sentence it came from."],
            ["Hard to share", "Other systems expect structured, standard data such as FHIR, not paragraphs."],
          ].map(([t, d]) => (
            <div key={t} className="premium-card rounded-2xl border border-[#B3C5A0]/60 p-6">
              <h3 className="lp-display text-xl font-semibold">{t}</h3>
              <p className="mt-2 text-[#4A5B38] leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section label="How it works" title="From import to a reviewed record." tone="pale">
        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {STEPS.map(s => (
            <li key={s.n} className="ab-step relative overflow-hidden rounded-2xl bg-white border border-[#B3C5A0]/60 p-5">
              <span className="ab-step-bar absolute inset-x-0 top-0 h-1 bg-[#B2EB76] origin-left" aria-hidden="true" />
              <Mono className="text-[#3F7308]">{s.n}</Mono>
              <h3 className="lp-display mt-2 text-lg font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm text-[#4A5B38] leading-relaxed">{s.d}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section label="Architecture" title="Three tiers, one local model.">
        <Diagram />
        <p className="mt-6 max-w-3xl text-[#18280E] leading-relaxed">
          The browser never reads clinical tables directly: it calls the FastAPI backend with a Supabase token, and the
          API checks the role and the patient on every request. Postgres row-level security mirrors those rules, so
          clinical tables stay read-only to clients. The Copilot talks to an Ollama model on the same machine; cloud
          models are refused.
        </p>
      </Section>

      <Section label="Principles" title="What the project will not compromise on." tone="dark">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PRINCIPLES.map(p => (
            <div key={p.t} className="ab-principle rounded-2xl border border-white/10 bg-white/5 p-6">
              <h3 className="lp-display text-xl font-semibold text-[#B2EB76]">{p.t}</h3>
              <p className="mt-2 text-[#B3C5A0] leading-relaxed">{p.d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section label="Tech stack" title="Built with.">
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 border-t border-[#B3C5A0]/60">
          {STACK.map(([k, v]) => (
            <div key={k} className="flex flex-col sm:flex-row gap-1 sm:gap-6 py-4 border-b border-[#B3C5A0]/60">
              <dt className="sm:w-28 shrink-0"><Mono className="text-[#4A5B38]">{k}</Mono></dt>
              <dd className="text-[#18280E] break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="who" label="Who built it" tone="pale">
        <p className="lp-display text-2xl md:text-3xl leading-snug max-w-3xl">
          Built as a portfolio project by {CONTACT.name}, an AI student in Australia.
        </p>
        <p className="mt-4 text-[#18280E]">
          Get in touch through the <Link href="/contact" className="underline underline-offset-4 hover:text-[#3F7308]">contact page</Link>,
          on <a href={CONTACT.linkedin} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-[#3F7308]">LinkedIn</a> or
          on <a href={CONTACT.github} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-[#3F7308]">GitHub</a>.
        </p>
        <p className="mt-4 max-w-2xl text-[#4A5B38] leading-relaxed">
          Not a medical device and not for patient care. No clinical validation, accuracy evaluation or regulatory
          compliance is claimed.
        </p>
      </Section>

      <Section>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 rounded-2xl border border-[#B3C5A0]/60 p-6 md:p-10">
          <h2 className="lp-display text-2xl md:text-4xl tracking-[-0.02em]">See what it does, and what comes next.</h2>
          <div className="flex flex-wrap gap-3">
            <Link href="/" className={`${cta} bg-[#18280E] text-white hover:bg-[#090F05]`}>
              Explore the product <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/roadmap" className={`${cta} bg-[#B2EB76] text-[#18280E] hover:bg-[#a3dc66]`}>
              Read the roadmap
            </Link>
          </div>
        </div>
      </Section>
    </PublicPage>
    </div>
  );
}
