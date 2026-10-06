"use client";
// /security: what ClinicalBrief does to protect data, and where it stops. Every claim is checked against the README
// ("What is implemented", "Roles and security model", "Copilot", "Known gaps") and the backend source named inline.
import React, { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { useGSAP } from "@gsap/react";
import { AlertTriangle, Bot, Check, ClipboardList, FileUp, KeyRound, Lock, Minus, ShieldCheck, Users } from "lucide-react";
import { PublicPage, Section, Mono, Eyebrow } from "./kit";

gsap.registerPlugin(useGSAP, ScrollTrigger, ScrambleTextPlugin, DrawSVGPlugin);

const ROLE_IDS = ["admin", "clinician", "consultant", "coder", "auditor", "researcher"] as const;
type Role = typeof ROLE_IDS[number];

// Straight from clinicalbrief-backend/app/api/v1/deps.py (GLOBAL_READ / CLINICAL_WRITE / REVIEW / GOVERNANCE_ROLES)
// and fhir.py (FHIR_EXPORT_ROLES). "limited" = clinicians see only patients assigned to them.
const PERMS: { label: string; yes: Role[]; limited?: Role[]; note?: string }[] = [
  { label: "See patient records", yes: ["admin", "consultant", "coder", "auditor", "researcher"], limited: ["clinician"], note: "clinician: assigned patients only" },
  { label: "Create patients, upload notes", yes: ["admin", "clinician", "consultant"] },
  { label: "Review AI output", yes: ["admin", "clinician", "consultant", "coder"] },
  { label: "Audit log and governance", yes: ["admin", "auditor"] },
  { label: "FHIR export", yes: ["admin", "clinician", "consultant", "coder"] },
];

const level = (p: typeof PERMS[number], r: Role) => (p.yes.includes(r) ? 2 : p.limited?.includes(r) ? 1 : 0);
const LEVEL_TEXT = ["No", "Limited", "Yes"];

function Cell({ v }: { v: number }) {
  return (
    <span role="img" aria-label={LEVEL_TEXT[v]} className="sec-cell inline-flex h-7 w-7 items-center justify-center rounded-full"
      style={{ background: v === 2 ? "#B2EB76" : v === 1 ? "#EBE46A" : "#F1F3EE", color: v ? "#18280E" : "#95A386" }}>
      {v === 0 ? <Minus className="h-3.5 w-3.5" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
    </span>
  );
}

function RoleTable() {
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full min-w-[620px] text-sm border-separate border-spacing-0">
        <caption className="sr-only">Permissions by role</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left pb-3 pr-3"><Mono className="text-[#4A5B38]">Permission</Mono></th>
            {ROLE_IDS.map(r => <th key={r} scope="col" className="pb-3 px-1 lp-mono text-[11px] font-normal text-[#4A5B38]">{r}</th>)}
          </tr>
        </thead>
        <tbody>
          {PERMS.map(p => (
            <tr key={p.label}>
              <th scope="row" className="text-left font-normal py-3 pr-3 border-t border-[#B3C5A0]/50">
                {p.label}
                {p.note && <span className="block lp-mono text-[10px] uppercase tracking-[0.08em] text-[#4A5B38] mt-0.5">{p.note}</span>}
              </th>
              {ROLE_IDS.map(r => <td key={r} className="py-3 px-1 text-center border-t border-[#B3C5A0]/50"><Cell v={level(p, r)} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ icon: Icon, title, children }: { icon: typeof Lock; title: string; children: React.ReactNode }) {
  return (
    <div className="sec-card rounded-xl border border-[#B3C5A0]/60 bg-white p-5 md:p-6 motion-safe:transition-colors hover:border-[#4A5B38]/60">
      <div className="flex items-center gap-3">
        <span className="h-8 w-8 shrink-0 rounded-md bg-[#18280E] text-[#B2EB76] flex items-center justify-center"><Icon className="sec-draw h-4 w-4" aria-hidden="true" /></span>
        <h3 className="lp-display text-xl leading-tight">{title}</h3>
      </div>
      <div className="mt-4 text-[15px] leading-relaxed text-[#18280E] space-y-2">{children}</div>
    </div>
  );
}

function Bullets({ items, dark = false }: { items: React.ReactNode[]; dark?: boolean }) {
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="sec-bullet flex gap-3">
          <span aria-hidden="true" className={`sec-dot mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dark ? "bg-[#B2EB76]" : "bg-[#3F7308]"}`} />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

const LIMITS: { title: string; body: string }[] = [
  { title: "Redaction is regex only", body: "PHI redaction matches patterns (dates, US and Australian phone numbers, emails, record and insurance numbers). It is not a validated de-identification method; names, addresses and Medicare numbers are not detected." },
  { title: "Some outputs are not de-identified", body: "Only the note-text view is redacted. Copilot citations, entity evidence sentences and patient demographics are shown as stored." },
  { title: "Copilot sessions are hard-deleted", body: "Deleting a session removes the transcript permanently; what the AI said cannot be reconstructed. The audit log keeps who deleted it, for which patient. A clinical deployment would need retention instead." },
  { title: "A prototype, not a certified system", body: "No certification, compliance audit or penetration test has been done. It is a research and portfolio project, not a medical device, and runs on synthetic data only." },
];

// Motion: calm and premium (power3/expo out, no overshoot), reveal-on-scroll, once. Everything is set up inside a
// reduced-motion-gated matchMedia with from()/fromTo(), so without JS or with reduced motion the page is static and
// fully visible.
function useSecurityMotion(root: React.RefObject<HTMLDivElement | null>) {
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const q = gsap.utils.selector(root);
      const onView = (trigger: Element, start = "top 82%") => ({ trigger, start, once: true });
      const ease = "power3.out";

      // Section labels "decrypt" in when their section arrives.
      q("section[id] > div > .lp-mono").forEach((el: HTMLElement) => {
        const text = el.textContent ?? "";
        gsap.fromTo(el, { opacity: 0 }, {
          opacity: 1, duration: 0.9, ease: "none",
          scrambleText: { text, chars: "01#/<>", speed: 0.6, revealDelay: 0.15 },
          scrollTrigger: onView(el),
        });
      });

      // Cards: lift in, then the icon strokes draw themselves.
      q(".sec-card").forEach((card: HTMLElement) => {
        gsap.timeline({ scrollTrigger: onView(card, "top 88%") })
          .from(card, { y: 24, opacity: 0, duration: 0.8, ease })
          .from(card.querySelectorAll(".sec-draw > *"), { drawSVG: 0, duration: 0.8, stagger: 0.06, ease: "expo.out" }, "-=0.45");
      });

      // Permission table fills in row by row (DOM order is row-major); 30 cells x 14 ms keeps the cascade under 0.45 s.
      const cells = q(".sec-cell");
      if (cells.length) gsap.from(cells, { scale: 0.4, opacity: 0, duration: 0.5, ease, stagger: 0.014, scrollTrigger: onView(cells[0], "top 85%") });

      // Audit entries arrive like log lines; guardrails pass one after another, dot first.
      [["#audit", 0.08], ["#ai", 0.12]].forEach(([sel, each]) => {
        const items = q(`${sel} .sec-bullet`);
        if (!items.length) return;
        gsap.timeline({ scrollTrigger: onView(items[0], "top 88%") })
          .from(items, { x: -14, opacity: 0, duration: 0.6, ease, stagger: each as number })
          .from(q(`${sel} .sec-dot`), { scale: 0, duration: 0.4, ease: "expo.out", stagger: each as number }, 0.1);
      });

      // Honest limits: slight stagger, no flourish.
      const limits = q(".sec-limit");
      if (limits.length) gsap.from(limits, { y: 20, opacity: 0, duration: 0.8, ease, stagger: 0.09, scrollTrigger: onView(limits[0], "top 88%") });
    });
    return () => mm.revert();
  }, { scope: root });
}

export default function SecurityPage() {
  const root = useRef<HTMLDivElement>(null);
  useSecurityMotion(root);
  return (
    <div ref={root}>
    <PublicPage
      eyebrow="Trust · security"
      title={<>Security and privacy<span className="text-[#3F7308]">.</span></>}
      intro={<p>How ClinicalBrief controls who sees what, keeps patient data on the machine, and records access. Every point here is enforced in code, and the limits are listed just as plainly.</p>}
    >
      <Section id="access" label="01 · Access" title="Sign-in, then a role, then the data">
        <div className="grid gap-5 md:grid-cols-2">
          <Card icon={KeyRound} title="Authentication">
            <p>Sign-in uses Supabase Auth. The backend verifies every token itself (JWKS or legacy HS256), checking audience and expiry.</p>
            <p>New accounts start as <code className="lp-mono text-[13px]">pending</code>: every endpoint answers 403 until an admin assigns a role from the command line. Roles are never taken from signup data.</p>
          </Card>
          <Card icon={Users} title="Authorization">
            <p>Six roles are enforced in the API and mirrored in Postgres row-level security, so the browser&apos;s public key cannot read or write past them. Clinical tables are read-only to clients; all writes go through the API.</p>
            <p>&quot;Not yours&quot; and &quot;doesn&apos;t exist&quot; both return 404, so record ids cannot be probed.</p>
          </Card>
        </div>
        <div className="mt-10">
          <Eyebrow icon={ShieldCheck}>Permissions by role</Eyebrow>
          <div className="mt-5"><RoleTable /></div>
          <p className="mt-4 text-sm text-[#4A5B38] max-w-2xl">
            Researchers read records but never see original note text: the note view gives them the redacted version, and search returns no note text at all.
          </p>
        </div>
      </Section>

      <Section id="audit" tone="pale" label="02 · Audit" title="Every read of clinical data leaves a trace">
        <div className="grid gap-8 md:grid-cols-[1fr_1.2fr] items-start">
          <p className="text-[17px] leading-relaxed text-[#18280E]">
            The audit log records <strong>who</strong> and <strong>which id</strong>, never the content. Clients cannot write to it.
          </p>
          <Bullets items={[
            "Viewing a patient record, note text, or a note's AI output and evidence.",
            "Every review decision: approve, reject or edit.",
            "Copilot questions, logged without the question text.",
            "Record search, logged without the query.",
            "Each FHIR export.",
          ]} />
        </div>
      </Section>

      <Section id="ai" tone="dark" label="03 · AI and patient data" title="The model runs on this machine, and must cite its sources">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <Eyebrow icon={Bot} dark>Local only</Eyebrow>
            <p className="mt-4 text-[#E4EEDA] leading-relaxed">
              Copilot talks to a local Ollama model. The server URL must be a loopback address (localhost, 127.0.0.1, ::1), and Ollama
              &quot;cloud&quot; models are refused, so patient data does not leave the machine.
            </p>
          </div>
          <div>
            <Eyebrow icon={ShieldCheck} dark>Guardrails, checked in code</Eyebrow>
            <div className="mt-4 text-[#E4EEDA] leading-relaxed">
              <Bullets dark items={[
                "Note text is sent as data inside evidence tags, and the prompt says it is never instructions.",
                "Every factual sentence must cite a record; sentences without a source are removed, never shown.",
                "Treatment or dosing advice withholds the whole answer, not just the sentence.",
                "An answer citing a record with instruction-like text is never labelled grounded.",
              ]} />
            </div>
          </div>
        </div>
      </Section>

      <Section id="handling" label="04 · Files and secrets" title="Small surface, explicit switches">
        <div className="grid gap-5 md:grid-cols-2">
          <Card icon={FileUp} title="Uploads">
            <p>UTF-8 <code className="lp-mono text-[13px]">.txt</code> only, at most 5 MB. Files are stored under a server-generated name; the original filename is for display only. Storage buckets are private.</p>
          </Card>
          <Card icon={Lock} title="Secrets and databases">
            <p>The frontend holds only public values, never a service key. A git hook scans commits and pushes for secrets.</p>
            <p>The backend refuses to connect to a remote database unless that process is started with an explicit opt-in flag; the setting is never read from the shared config file.</p>
          </Card>
        </div>
      </Section>

      <Section id="limits" label="05 · Honest limits" title="What this does not protect">
        <ul className="grid gap-4 md:grid-cols-2">
          {LIMITS.map((l, i) => (
            <li key={l.title} className="sec-limit rounded-xl p-5 md:p-6 border" style={{ background: i % 2 ? "#FCF0E4" : "#FBFAE3", borderColor: i % 2 ? "#F2C7A0" : "#EBE46A" }}>
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-[#18280E]" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold text-[#090F05]">{l.title}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-[#18280E]">{l.body}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-6 inline-flex items-center gap-2 text-sm text-[#4A5B38]">
          <ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />
          The full list lives in the README under &quot;Known gaps&quot;.
        </p>
      </Section>
    </PublicPage>
    </div>
  );
}
