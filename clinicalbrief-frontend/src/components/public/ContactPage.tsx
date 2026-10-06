"use client";
// /contact: how to reach the project owner. Contact details live in kit.tsx (CONTACT) so every page uses the same.
import React, { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ArrowUpRight, Github, Linkedin, Mail, ShieldAlert } from "lucide-react";
import { CONTACT, Mono, PublicPage, Section, openEmail } from "./kit";

gsap.registerPlugin(useGSAP);

const CHANNELS = [
  { icon: Mail, label: "Email", value: "Send an email", href: "", note: "Questions, feedback, collaboration or a security report. Opens your mail app." },
  { icon: Linkedin, label: "LinkedIn", value: CONTACT.linkedinLabel, href: CONTACT.linkedin, note: "Professional profile and messages." },
  { icon: Github, label: "GitHub", value: CONTACT.githubLabel, href: CONTACT.github, note: "Code and other projects." },
];

// External profiles are links; email is a button that assembles the address only on click.
function CardLink({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>
    : <button type="button" onClick={() => openEmail()} className={className}>{children}</button>;
}

export default function ContactPage() {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(".ct-card", { y: 24, opacity: 0, duration: 0.7, ease: "power3.out", stagger: 0.08 });
    });
  }, { scope: root });

  return (
    <div ref={root}>
      <PublicPage eyebrow="Contact" title="Get in touch."
        intro={<p>ClinicalBrief is a portfolio project by {CONTACT.name}. For questions, feedback, collaboration or a security report, these are the ways to reach me.</p>}>
        <Section>
          <ul className="grid gap-4 md:grid-cols-3">
            {CHANNELS.map(c => (
              <li key={c.label} className="ct-card">
                <CardLink href={c.href}
                  className="group flex h-full w-full text-left flex-col rounded-2xl border border-[#B3C5A0]/70 bg-white p-6 transition-colors hover:border-[#18280E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3F7308]">
                  <div className="flex items-center justify-between">
                    <span className="h-10 w-10 rounded-md bg-[#18280E] text-[#B2EB76] flex items-center justify-center">
                      <c.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <ArrowUpRight className="h-5 w-5 text-[#4A5B38] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
                  </div>
                  <Mono className="mt-6 text-[#4A5B38]">{c.label}</Mono>
                  <span className="mt-1 lp-display text-lg md:text-xl break-all">{c.value}</span>
                  <span className="mt-3 text-sm text-[#4A5B38] leading-relaxed">{c.note}</span>
                </CardLink>
              </li>
            ))}
          </ul>
        </Section>

        <Section tone="pale">
          <div className="flex gap-4 items-start max-w-3xl">
            <ShieldAlert className="h-6 w-6 shrink-0 text-[#3F7308] mt-1" aria-hidden="true" />
            <div>
              <h2 className="lp-display text-2xl md:text-3xl tracking-[-0.02em]">Please don&apos;t send patient data.</h2>
              <p className="mt-3 text-[#4A5B38] leading-relaxed">
                ClinicalBrief runs on synthetic data only. Never email real patient information. For a security issue,
                email a short description privately rather than opening a public issue.
              </p>
            </div>
          </div>
        </Section>
      </PublicPage>
    </div>
  );
}
