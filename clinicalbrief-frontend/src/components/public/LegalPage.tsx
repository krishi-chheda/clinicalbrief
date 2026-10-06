// Public "/legal" page: medical disclaimer, synthetic-data rule, terms of use, privacy notice, security contact.
// Plain English, no compliance claims. Facts mirror README.md ("Roles and security model", "Known gaps").
// Motion (prefers-reduced-motion: no-preference only): headings rise in line by line, the disclaimer card gets a
// soft lime ring on entry, and contents links scroll smoothly. The contents highlight for the section in view is a
// plain class toggle, so it also runs with reduced motion. Content is fully visible without JS.
import React, { useRef } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { SplitText } from "gsap/SplitText";
import { PublicPage, Section, Mono, openEmail } from "./kit";

gsap.registerPlugin(useGSAP, ScrollTrigger, ScrollToPlugin, SplitText);
const MOTION = "(prefers-reduced-motion: no-preference)";

const TOC = [
  { id: "medical", label: "Medical disclaimer" },
  { id: "data", label: "Synthetic data only" },
  { id: "terms", label: "Terms of use" },
  { id: "privacy", label: "Privacy notice" },
  { id: "security", label: "Security issues" },
] as const;

const P = "text-[16px] leading-relaxed text-[#18280E] max-w-3xl";
const LI = "flex gap-3 text-[16px] leading-relaxed text-[#18280E]";
const A = "underline underline-offset-4 decoration-[#3F7308] hover:text-[#3F7308]";

function List({ items, dark = false }: { items: React.ReactNode[]; dark?: boolean }) {
  return (
    <ul className="space-y-3 max-w-3xl">
      {items.map((it, i) => (
        <li key={i} className={dark ? LI.replace("text-[#18280E]", "text-white/90") : LI}>
          <span aria-hidden="true" className={`lp-mono mt-[3px] text-[12px] ${dark ? "text-[#B2EB76]" : "text-[#3F7308]"}`}>{String(i + 1).padStart(2, "0")}</span>
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  );
}

export default function LegalPage() {
  const root = useRef<HTMLDivElement>(null);

  const { contextSafe } = useGSAP(() => {
    const q = gsap.utils.selector(root);
    // Contents: highlight the link for the section crossing the middle of the viewport.
    TOC.forEach(t => ScrollTrigger.create({
      trigger: `#${t.id}`, start: "top 50%", end: "bottom 50%",
      toggleClass: { targets: q(`a[href="#${t.id}"]`), className: "is-active" },
    }));

    gsap.matchMedia().add(MOTION, () => {
      q("section h2").forEach(h => SplitText.create(h, {
        type: "lines", mask: "lines", autoSplit: true,
        onSplit: self => gsap.from(self.lines, {
          yPercent: 100, duration: 0.7, stagger: 0.08, ease: "power3.out",
          scrollTrigger: { trigger: h, start: "top 88%", once: true },
        }),
      }));
      const card = q("#medical > div")[0];
      gsap.timeline({ scrollTrigger: { trigger: card, start: "top 80%", once: true } })
        .from(card, { y: 24, scale: 0.985, duration: 0.6, ease: "power3.out" })
        .from(q("#medical li"), { y: 10, autoAlpha: 0, stagger: 0.08, duration: 0.4, ease: "power2.out" }, 0.2)
        .fromTo(card, { boxShadow: "0 0 0 0px rgba(178,235,118,0.55)" }, { boxShadow: "0 0 0 10px rgba(178,235,118,0)", duration: 1.1, ease: "sine.out", clearProps: "boxShadow" }, 0.35);
    });
  }, { scope: root });

  // Smooth scroll for the contents links; with reduced motion the browser's plain anchor jump is kept.
  const jump = contextSafe((e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    if (!window.matchMedia(MOTION).matches) return;
    e.preventDefault();
    gsap.to(window, { scrollTo: { y: `#${id}`, offsetY: 48 }, duration: 0.8, ease: "power2.inOut" });
    history.replaceState(null, "", `#${id}`);
  });

  return (
    <div ref={root}>
    <PublicPage
      eyebrow="Disclaimer & terms"
      title="Disclaimer and terms"
      intro={<p>ClinicalBrief is a research and portfolio prototype. This page explains, in plain English, what it is not, how it may be used and what it stores about you. It is not legal advice, and it does not claim compliance with any law or regulation.</p>}
    >
      <nav aria-label="On this page" className="px-4 md:px-8 py-6">
        <div className="max-w-[1280px] mx-auto">
          <Mono className="text-[#4A5B38]">On this page</Mono>
          <ol className="mt-3 flex flex-wrap gap-2">
            {TOC.map((t, i) => (
              <li key={t.id}>
                <a href={`#${t.id}`} onClick={e => jump(e, t.id)} className="inline-flex items-center gap-2 rounded-md border border-[#B3C5A0]/70 px-3 py-2 text-sm text-[#18280E] hover:bg-[#F4FAED] motion-safe:transition-colors [&.is-active]:bg-[#18280E] [&.is-active]:border-[#18280E] [&.is-active]:text-white [&.is-active>span]:text-[#B2EB76]">
                  <span className="lp-mono text-[11px] text-[#3F7308]">{String(i + 1).padStart(2, "0")}</span>{t.label}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </nav>

      <Section id="medical" label="01 · Medical disclaimer" title="Not a medical device. Not for patient care." tone="dark">
        <List dark items={[
          "ClinicalBrief is a research and portfolio prototype. It is not a medical device and has not been assessed or approved by any regulator.",
          "Do not use it for diagnosis, treatment, triage or any other part of patient care.",
          "AI output can be wrong or incomplete. AI findings are treated as unconfirmed until a person approves or edits them, and the graph, export, risk score and Copilot answers use reviewed findings only. Human review lowers the risk of errors; it does not remove it.",
          "Copilot is built not to give treatment or dosing advice: if a draft answer contains such advice, the whole answer is withheld. Treatment plans quoted from a record are labelled as documented, not recommended. This guard is rule-based and can miss things.",
        ]} />
      </Section>

      <Section id="data" label="02 · Data" title="Synthetic data only" tone="pale">
        <div className="space-y-4">
          <p className={P}><strong>Never upload real patient data.</strong> Not de-identified data, not test records copied from a real system, not your own notes.</p>
          <p className={P}>The demo data is synthetic, generated with Synthea and Synthea Coherent (CC BY 4.0). The people in it do not exist. Sources and licences are on the <Link href="/data" className={A}>data page</Link>.</p>
        </div>
      </Section>

      <Section id="terms" label="03 · Terms" title="Terms of use">
        <List items={[
          "Access is by invitation only.",
          "New accounts start with no access. Every feature stays locked until the project owner grants a role.",
          "Only access the records your role allows. Do not try to reach data you are not assigned, probe ids, or get around the access controls.",
          "The software and the demo are provided “as is”, without warranty of any kind. They may change, break or be taken offline at any time.",
        ]} />
      </Section>

      <Section id="privacy" label="04 · Privacy" title="What we store about you" tone="pale">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Account", "Your email address and your role, held by Supabase Auth."],
            ["Audit log", "Actions you take: who, which record id, and when. Never the text of a note or of a Copilot question or answer."],
            ["Copilot conversations", "Conversations you create. You can delete your own; deletion is permanent and cannot be undone. The audit log keeps only that you deleted one."],
          ].map(([h, b]) => (
            <div key={h} className="rounded-xl bg-white border border-[#B3C5A0]/60 p-5">
              <h3 className="lp-display text-xl">{h}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[#18280E]">{b}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 space-y-4">
          <p className={P}>The database is Supabase Postgres, hosted in the Sydney region.</p>
          <p className={P}>The AI model runs locally. No patient data is sent to external AI services.</p>
          <p className={P}>The site uses no analytics or advertising trackers.</p>
          <p className={P} id="cookies">
            <strong>Cookies and local storage.</strong> Only what the site needs to work: Supabase sign-in cookies that keep you
            signed in (set only when you sign in), and your dashboard layout saved in this browser&apos;s local storage. Nothing
            is used for tracking or advertising, so there is no cookie banner; signing out ends the session.
          </p>
        </div>
      </Section>

      <Section id="security" label="05 · Security" title="Found a security issue?">
        <p className={P}>Please report it privately by email rather than opening a public issue or sharing details publicly. Never include real patient data.</p>
        <button type="button" onClick={() => openEmail("ClinicalBrief security report")}
          className="mt-4 lp-mono text-[13px] px-4 py-2.5 rounded-md bg-[#18280E] text-white hover:bg-[#090F05]">Email a security report</button>
      </Section>
    </PublicPage>
    </div>
  );
}
