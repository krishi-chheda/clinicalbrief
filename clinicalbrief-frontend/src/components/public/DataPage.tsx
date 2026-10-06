// Public "/data" page: what the demo dataset is, how it is imported, licences and attribution, hosting.
// Every figure and claim here comes from README.md ("Data", "Import CLI", "What is implemented", "Known gaps").
//
// Motion (GSAP, scroll-triggered, once): h2 line reveals, stat tiles count up to their true values, the example
// provenance card assembles row by row with scrambled values, the import steps run in sequence behind a drawn
// connector, the licence cards rise in. Everything sits inside matchMedia("no-preference"): with reduced motion
// nothing runs and the server-rendered content (true numbers included) is shown as is.
import React, { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { useGSAP } from "@gsap/react";
import { Database, FileText, Scale, Server } from "lucide-react";
import { PublicPage, Section, Mono, Eyebrow } from "./kit";

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText, ScrambleTextPlugin, DrawSVGPlugin);

const EASE = "power3.out";
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

function useDataMotion(root: React.RefObject<HTMLDivElement | null>) {
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", (ctx) => {
      const q = gsap.utils.selector(root);
      const st = (trigger: Element, start = "top 82%") => ({ trigger, start, once: true });

      // Section headings: lines slide up out of a mask.
      q("main section h2").forEach((h: Element) => {
        SplitText.create(h, {
          type: "lines", mask: "lines", autoSplit: true,
          // the masks clip at the line box; pad them so descenders (g, p, y) are not cut at leading 1.06
          onSplit: self => (gsap.set(self.masks, { paddingBottom: "0.14em", marginBottom: "-0.14em" }), gsap.fromTo(self.lines, { yPercent: 105 }, { yPercent: 0, duration: 0.8, ease: "expo.out", stagger: 0.08, scrollTrigger: st(h, "top 88%") })),
        });
      });

      // Triggers are measured once the web fonts have settled the layout; measured earlier, a trigger just below
      // the fold could fire at load (the stat tiles did) and the reveal would play unseen.
      let live = true;
      document.fonts.ready.then(() => live && ctx.add(() => {
      // Stat tiles: rise in, then count up. The last frame writes the exact formatted value.
      const tiles = q("[data-stat]");
      if (tiles.length) {
        const tl = gsap.timeline({ scrollTrigger: st(tiles[0]) });
        tl.fromTo(tiles, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: EASE, stagger: 0.08 });
        q("[data-count]").forEach((el: HTMLElement, i: number) => {
          const end = Number(el.dataset.count), o = { v: 0 }, final = el.textContent;
          tl.to(o, { v: end, duration: 1.4, ease: "expo.out", onUpdate: () => { el.textContent = fmt(o.v); }, onComplete: () => { el.textContent = final; } }, 0.1 + i * 0.08);
        });
      }

      // Provenance card: rows assemble one by one, values unscramble into their real text.
      const card = q("[data-prov]")[0];
      if (card) {
        const tl = gsap.timeline({ scrollTrigger: st(card) });
        tl.fromTo(card, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: EASE });
        q("[data-prov-row]").forEach((row: HTMLElement, i: number) => {
          const dd = row.querySelector("dd");
          tl.fromTo(row, { x: -12, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: EASE }, 0.25 + i * 0.12);
          if (dd) tl.to(dd, { duration: 0.7, scrambleText: { text: dd.textContent ?? "", chars: "0123456789abcdef", speed: 0.6 } }, 0.25 + i * 0.12);
        });
      }

      // Import pipeline: the connector draws, the numbered steps follow it in order.
      const steps = q("[data-step]");
      if (steps.length) {
        const tl = gsap.timeline({ scrollTrigger: st(steps[0]) });
        tl.fromTo(q("[data-pipe]"), { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.9, ease: "power2.inOut" })
          .fromTo(steps, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: EASE, stagger: 0.07 }, 0.15);
      }

      // Licence cards and citation.
      const lic = q("[data-licence]");
      if (lic.length) gsap.fromTo(lic, { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: EASE, stagger: 0.12, scrollTrigger: st(lic[0]) });
      }));
      return () => { live = false; };
    });
  }, { scope: root });
}

const EXT = { target: "_blank", rel: "noopener noreferrer" } as const;
const A = "underline underline-offset-4 decoration-[#3F7308]/50 hover:decoration-[#3F7308] break-words";

const STATS = [
  { n: "409", label: "Synthetic patients", note: "109 Synthea sample + 300 Synthea Coherent" },
  { n: "35,103", label: "Synthetic clinical notes", note: "All searchable in the database" },
  { n: "824", label: "Notes run through the AI pipeline", note: "Findings wait for human review" },
  { n: "0", label: "Real patients", note: "No real patient data anywhere" },
];

const TABLES = ["patients", "encounters", "notes", "diagnoses", "medications", "allergies", "procedures", "observations"];

const IMPORT_STEPS = [
  ["Dry run", "See what a folder contains and what would be imported or skipped, without writing anything."],
  ["Per-record validation", "Invalid source records are skipped and written to a rejected-record log with a reason; the rest continues."],
  ["Idempotent re-import", "Record ids are derived from source system, table and source id, so re-importing updates rows instead of duplicating them."],
  ["All or nothing on failure", "An unexpected failure rolls back every data write and marks the run as failed."],
  ["Run history", "Each run is recorded with its counts, rejected records and skipped resource types."],
  ["Nothing invented", "Unknown birth dates, statuses and codes stay empty rather than being guessed."],
];

// Illustrative only: field names match the canonical model, values are made up for the example.
const EXAMPLE = [
  ["patient", "Magali989 (synthetic)"],
  ["source_system", "synthea"],
  ["source_id", "8f3c…e21a"],
  ["provenance", "imported"],
];

export default function DataPage() {
  const root = useRef<HTMLDivElement>(null);
  useDataMotion(root);
  return (
    <div ref={root}>
    <PublicPage
      eyebrow="Data and licences"
      title={<>Synthetic patients only. <span className="text-[#3F7308]">Every record traceable.</span></>}
      intro={<p>ClinicalBrief runs on generated data from the Synthea project. Nothing in the demo belongs to a real person. Here is what the dataset contains, how it gets in, and who to credit for it.</p>}
    >
      <Section id="dataset" label="The demo dataset" title="What is in the database">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px rounded-2xl overflow-hidden bg-[#B3C5A0]/60 border border-[#B3C5A0]/60">
          {STATS.map(s => (
            <div key={s.label} data-stat className="bg-white p-6 md:p-8 min-w-0">
              <p className="lp-display text-5xl md:text-6xl tracking-[-0.03em] text-[#18280E] tabular-nums" data-count={s.n.replace(/,/g, "")}>{s.n}</p>
              <h3 className="mt-4 font-medium text-[#090F05]">{s.label}</h3>
              <p className="mt-1 text-sm text-[#4A5B38]">{s.note}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-[#4A5B38] max-w-3xl leading-relaxed">
          The notes are templated by the generator, so the AI pipeline&apos;s results will look better here than they would on real clinical notes.
        </p>
      </Section>

      <Section id="synthea" tone="pale" label="What synthetic means" title="Realistic records, fictional people">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4 text-[#18280E] leading-relaxed max-w-2xl">
            <p>
              <a href="https://synthetichealth.github.io/synthea/" {...EXT} className={A}>Synthea</a> is an open-source synthetic patient generator.
              It simulates whole lives of fictional patients, from birth through encounters, diagnoses, medications and procedures, and writes them out as standard FHIR records.
            </p>
            <p>
              The records look and behave like real ones, but no one in them exists. Names such as <Mono className="normal-case tracking-normal text-[13px] text-[#090F05]">Magali989</Mono> are generated (the digits are part of the generated name), and clinical histories are simulated.
            </p>
            <p>That is what lets the demo be public: you can open any patient, read their notes and inspect the AI output without seeing anyone&apos;s private data.</p>
          </div>
          <figure data-prov className="rounded-xl bg-white border border-[#B3C5A0]/70 p-5 md:p-6 min-w-0 self-start">
            <div className="flex items-center justify-between gap-3">
              <Mono className="text-[#4A5B38]">Provenance</Mono>
              <Mono className="text-[10px] rounded bg-[#B2EB76] text-[#18280E] px-2 py-0.5">example</Mono>
            </div>
            <dl className="mt-4 divide-y divide-[#B3C5A0]/50 lp-mono text-[13px]">
              {EXAMPLE.map(([k, v]) => (
                <div key={k} data-prov-row className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2.5">
                  <dt className="text-[#4A5B38]">{k}</dt>
                  <dd className="text-[#090F05] break-all">{v}</dd>
                </div>
              ))}
            </dl>
            <figcaption className="mt-4 text-xs text-[#4A5B38] leading-relaxed">
              Illustrative values. Every imported record carries these fields, so any row can be traced back to the source file it came from.
            </figcaption>
          </figure>
        </div>
      </Section>

      <Section id="import" label="What is imported" title="FHIR R4 in, one canonical model out">
        <div className="max-w-3xl text-[#18280E] leading-relaxed">
          <p>The Synthea adapter reads FHIR R4 bundles and maps them into one canonical clinical model:</p>
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Canonical tables">
            {TABLES.map(t => <li key={t} className="lp-mono text-[12px] rounded-md bg-[#F4FAED] border border-[#B3C5A0]/60 px-2.5 py-1">{t}</li>)}
          </ul>
          <p className="mt-4">Every record keeps <code className="lp-mono text-[14px]">source_system</code>, <code className="lp-mono text-[14px]">source_id</code> and <code className="lp-mono text-[14px]">provenance</code>.</p>
        </div>
        <svg className="mt-10 block w-full h-2 overflow-visible" viewBox="0 0 100 2" preserveAspectRatio="none" aria-hidden="true">
          <line data-pipe x1="0" y1="1" x2="100" y2="1" stroke="#3F7308" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
        </svg>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {IMPORT_STEPS.map(([t, d], i) => (
            <div key={t} data-step className="rounded-xl border border-[#B3C5A0]/60 p-5 motion-safe:transition-colors hover:bg-[#F4FAED]">
              <Mono className="text-[#3F7308]">{String(i + 1).padStart(2, "0")}</Mono>
              <h3 className="mt-2 font-medium text-[#090F05]">{t}</h3>
              <p className="mt-1.5 text-sm text-[#4A5B38] leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-[#4A5B38] max-w-3xl leading-relaxed">
          Not yet imported: Synthea immunisations, diagnostic reports, care plans and claims. From the Coherent dataset only the FHIR part is used; imaging, genomics and ECG data are not downloaded.
        </p>
      </Section>

      <Section id="licences" tone="dark" label="Licences and attribution" title="Credit where it is due">
        <div className="grid gap-6 lg:grid-cols-2">
          <article data-licence className="rounded-xl bg-white/5 border border-white/10 p-6 min-w-0">
            <Eyebrow icon={Database} dark>Synthea sample, FHIR R4</Eyebrow>
            <h3 className="mt-4 text-xl font-medium">109 patients</h3>
            <p className="mt-2 text-sm text-[#B3C5A0] leading-relaxed">
              Sample data published by the Synthea project, generated with{" "}
              <a href="https://synthetichealth.github.io/synthea/" {...EXT} className={A}>Synthea</a>.
            </p>
            <p className="mt-3 text-sm"><a href="https://synthetichealth.github.io/synthea-sample-data/" {...EXT} className={A}>synthetichealth.github.io/synthea-sample-data</a></p>
          </article>
          <article data-licence className="rounded-xl bg-white/5 border border-white/10 p-6 min-w-0">
            <Eyebrow icon={Scale} dark>Synthea Coherent Data Set · CC BY 4.0</Eyebrow>
            <h3 className="mt-4 text-xl font-medium">300 of 1,278 patients</h3>
            <p className="mt-2 text-sm text-[#B3C5A0] leading-relaxed">
              Used under the{" "}
              <a href="https://creativecommons.org/licenses/by/4.0/" {...EXT} className={A}>Creative Commons Attribution 4.0 licence</a>.
              300 patients imported to stay within the free database tier.
            </p>
            <p className="mt-3 text-sm"><a href="https://synthea.mitre.org/downloads" {...EXT} className={A}>synthea.mitre.org/downloads</a></p>
          </article>
        </div>
        <blockquote data-licence className="mt-6 rounded-xl border-l-4 border-[#B2EB76] bg-white/5 p-5 md:p-6 text-sm leading-relaxed">
          <Mono className="text-[#B3C5A0]">Citation</Mono>
          <p className="mt-2">
            Walonoski J, et al. The &ldquo;Coherent Data Set&rdquo;: Combining Patient Data and Imaging in a Comprehensive, Synthetic Health Record. <em>Electronics</em>. 2022;11(8):1199.{" "}
            <a href="https://doi.org/10.3390/electronics11081199" {...EXT} className={`${A} text-[#B2EB76]`}>doi.org/10.3390/electronics11081199</a>
          </p>
        </blockquote>
      </Section>

      <Section id="mimic" label="Why not MIMIC" title="A real dataset was tried, then removed">
        <div className="flex flex-col md:flex-row gap-6 md:gap-10 max-w-4xl">
          <Eyebrow icon={FileText}>MIMIC-IV demo</Eyebrow>
          <p className="text-[#18280E] leading-relaxed">
            The MIMIC-IV demo was imported earlier and later removed. It publishes no names, birth dates or notes, and its dates are shifted into the 2100s, which did not suit a patient-centred workspace built around reading notes.
          </p>
        </div>
      </Section>

      <Section id="hosting" tone="pale" label="Where the data lives" title="One database, in Sydney">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl bg-white border border-[#B3C5A0]/60 p-6">
            <Eyebrow icon={Database}>Supabase Postgres</Eyebrow>
            <h3 className="mt-4 font-medium">Hosted in Sydney (ap-southeast-2)</h3>
            <p className="mt-2 text-sm text-[#4A5B38] leading-relaxed">The canonical record, notes, AI output, review decisions and audit log are stored there. Browsers can only read through row-level security; all writes go through the API.</p>
          </div>
          <div className="rounded-xl bg-white border border-[#B3C5A0]/60 p-6">
            <Eyebrow icon={Server}>Local model</Eyebrow>
            <h3 className="mt-4 font-medium">Evidence stays on the same machine</h3>
            <p className="mt-2 text-sm text-[#4A5B38] leading-relaxed">The Copilot uses a local model through Ollama. Only loopback model addresses are accepted and cloud models are refused, so the evidence it is given never leaves the machine running it.</p>
          </div>
        </div>
      </Section>
    </PublicPage>
    </div>
  );
}
