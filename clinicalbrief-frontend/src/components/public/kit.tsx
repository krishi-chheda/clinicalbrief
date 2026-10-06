// Shared building blocks for the public site (landing + information pages): header, footer with the ASCII
// wordmark, page frame and small typographic helpers. Visual language and tokens: see the "Landing page"
// section of globals.css (lp-*, ft-*). Every page using these is public (no sign-in needed).
import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowUp, FileText, Github, Linkedin, Mail } from "lucide-react";

// Project owner's public contact details (single source for every page). The email address is kept in two
// parts and only assembled when someone clicks an email button, so it never appears in the page for scrapers.
export const CONTACT = {
  name: "Krishi Chheda",
  emailParts: ["krishichheda10", "gmail.com"] as const,
  linkedin: "https://www.linkedin.com/in/krishi-chheda", linkedinLabel: "linkedin.com/in/krishi-chheda",
  github: "https://github.com/krishi-chheda", githubLabel: "github.com/krishi-chheda",
};

export function openEmail(subject = "ClinicalBrief") {
  const [user, domain] = CONTACT.emailParts;
  window.location.href = `mailto:${user}@${domain}?subject=${encodeURIComponent(subject)}`;
}

export const INK = "#090F05", FOREST = "#18280E", OLIVE = "#4A5B38", SAGE = "#B3C5A0", LIME = "#B2EB76", PALE = "#F4FAED", GREEN = "#3F7308";

export function Mono({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`lp-mono text-[11px] uppercase tracking-[0.14em] ${className}`}>{children}</span>;
}

export function Eyebrow({ icon: Icon, children, dark = false }: { icon: typeof FileText; children: React.ReactNode; dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`h-7 w-7 rounded-md flex items-center justify-center ${dark ? "bg-[#B2EB76] text-[#18280E]" : "bg-[#18280E] text-[#B2EB76]"}`}>
        <Icon className="h-4 w-4" />
      </span>
      <Mono className={dark ? "text-[#B3C5A0]" : "text-[#4A5B38]"}>{children}</Mono>
    </div>
  );
}

export const PAGES = [
  { href: "/", label: "Product" },
  { href: "/security", label: "Security" },
  { href: "/data", label: "Data" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/docs", label: "Docs" },
  { href: "/about", label: "About" },
] as const;

const BUTTON = "lp-mono text-[13px] px-4 py-2.5 rounded-md transition-colors";

export function SiteHeader({ onLogoClick }: { onLogoClick?: () => void }) {
  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur border-b border-[#090F05]/5">
      <div className="max-w-[1280px] mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
        <Link href="/" onClick={onLogoClick} className="lp-display text-xl tracking-tight font-semibold">CLINICALBRIEF<span className="text-[#3F7308]">&apos;</span></Link>
        <nav className="hidden md:flex items-center gap-7 lp-mono text-[13px] text-[#18280E]" aria-label="Site">
          {PAGES.map(p => <Link key={p.href} href={p.href} className="py-1.5 hover:underline underline-offset-4">{p.label}</Link>)}
        </nav>
        <Link href="/login" className={`${BUTTON} bg-[#F1F3EE] hover:bg-[#E4E9DD]`}>Sign in</Link>
      </div>
    </header>
  );
}

// --- ASCII wordmark (figlet "ANSI Shadow", generated once with pyfiglet; no runtime dependency) ---------------
const ASCII_MARK = " ██████╗██╗     ██╗███╗   ██╗██╗ ██████╗ █████╗ ██╗     ██████╗ ██████╗ ██╗███████╗███████╗\n██╔════╝██║     ██║████╗  ██║██║██╔════╝██╔══██╗██║     ██╔══██╗██╔══██╗██║██╔════╝██╔════╝\n██║     ██║     ██║██╔██╗ ██║██║██║     ███████║██║     ██████╔╝██████╔╝██║█████╗  █████╗  \n██║     ██║     ██║██║╚██╗██║██║██║     ██╔══██║██║     ██╔══██╗██╔══██╗██║██╔══╝  ██╔══╝  \n╚██████╗███████╗██║██║ ╚████║██║╚██████╗██║  ██║███████╗██████╔╝██║  ██║██║███████╗██║     \n ╚═════╝╚══════╝╚═╝╚═╝  ╚═══╝╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═════╝ ╚═╝  ╚═╝╚═╝╚══════╝╚═╝     ";
const ASCII_TICK = "██╗\n╚═╝";  // the font has no apostrophe; the brand tick is drawn beside it
const SCRAMBLE = "░▒▓█╔╗╚╝═║";
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Each character sits in its own fixed-width grid cell, so rows stay aligned even when some box-drawing glyphs
// come from a fallback font with a different advance width.
function AsciiGrid({ text, className }: { text: string; className: string }) {
  const rows = text.split("\n"), cols = Math.max(...rows.map(r => r.length));
  return (
    <div className={`ft-ascii-grid ${className}`} style={{ gridTemplateColumns: `repeat(${cols}, 0.6em)` }} aria-hidden="true">
      {rows.flatMap((r, y) => Array.from(r.padEnd(cols), (ch, x) => <span key={`${y}-${x}`}>{ch}</span>))}
    </div>
  );
}

// Scramble-in: cells settle left to right over ~1.1 s. Spaces stay spaces.
function scramble(grid: HTMLElement, text: string) {
  const rows = text.split("\n"), cols = Math.max(...rows.map(r => r.length));
  const chars = rows.flatMap(r => Array.from(r.padEnd(cols)));
  const cells = Array.from(grid.children) as HTMLElement[];
  const jitter = chars.map(() => Math.random() * 0.25);
  const start = performance.now(), dur = 1100;
  const frame = (now: number) => {
    const p = Math.min(1, (now - start) / dur);
    chars.forEach((ch, i) => {
      cells[i].textContent = ch === " " || (i % cols) / cols + jitter[i] < p * 1.25 ? ch : SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0];
    });
    if (p < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function AsciiWordmark() {
  const ref = useRef<HTMLDivElement>(null);
  const run = () => { const g = ref.current?.querySelector<HTMLElement>(".ft-ascii-mark"); if (g && !reduceMotion()) scramble(g, ASCII_MARK); };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { run(); io.disconnect(); } }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="ft-ascii mt-16 flex justify-center select-none" aria-label="ClinicalBrief" role="img" onMouseEnter={run}>
      <AsciiGrid text={ASCII_MARK} className="ft-ascii-mark text-[#18280E]" />
      <AsciiGrid text={ASCII_TICK} className="text-[#3F7308]" />
    </div>
  );
}

const linkCls = "inline-block py-1.5 hover:underline underline-offset-4";

export function SiteFooter({ onTop }: { onTop?: () => void }) {
  const toTop = onTop ?? (() => window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" }));
  return (
    <footer className="px-4 md:px-8 pt-20 pb-8 max-w-[1280px] mx-auto">
      <div className="grid gap-10 grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
        <div className="col-span-2 md:col-span-1">
          <span className="lp-display text-xl font-semibold">CLINICALBRIEF<span className="text-[#3F7308]">&apos;</span></span>
          <p className="mt-3 text-sm text-[#4A5B38] leading-relaxed max-w-xs">
            Clinical notes, turned into a reviewed, searchable and exportable record. A research and portfolio prototype.
          </p>
          <p className="mt-4 inline-flex items-center gap-2 rounded-md bg-[#F4FAED] border border-[#B3C5A0]/60 px-3 py-2 text-xs text-[#18280E]">
            Not a medical device. Not for patient care.
          </p>
        </div>
        <div>
          <Mono className="text-[#4A5B38]">Product</Mono>
          <ul className="mt-3 space-y-0.5 text-sm">
            <li><Link href="/#how" className={linkCls}>How it works</Link></li>
            <li><Link href="/#capabilities" className={linkCls}>Capabilities</Link></li>
            <li><Link href="/#access" className={linkCls}>Access</Link></li>
            <li><Link href="/login" className={linkCls}>Sign in</Link></li>
          </ul>
        </div>
        <div>
          <Mono className="text-[#4A5B38]">Project</Mono>
          <ul className="mt-3 space-y-0.5 text-sm">
            <li><Link href="/about" className={linkCls}>About</Link></li>
            <li><Link href="/roadmap" className={linkCls}>Roadmap</Link></li>
            <li><Link href="/docs" className={linkCls}>Developer docs</Link></li>
            <li><Link href="/contact" className={linkCls}>Contact</Link></li>
            <li><Link href="/#status" className={linkCls}>Status</Link></li>
          </ul>
        </div>
        <div>
          <Mono className="text-[#4A5B38]">Trust</Mono>
          <ul className="mt-3 space-y-0.5 text-sm">
            <li><Link href="/security" className={linkCls}>Security &amp; privacy</Link></li>
            <li><Link href="/data" className={linkCls}>Data &amp; licences</Link></li>
            <li><Link href="/legal" className={linkCls}>Disclaimer &amp; terms</Link></li>
          </ul>
        </div>
        <div>
          <Mono className="text-[#4A5B38]">Built with</Mono>
          <ul className="mt-4 space-y-2 text-sm text-[#4A5B38]">
            <li>FastAPI · Python 3.12</li>
            <li>PostgreSQL (Supabase)</li>
            <li>Next.js · GSAP</li>
            <li>Ollama (local model)</li>
          </ul>
        </div>
      </div>
      <AsciiWordmark />
      <p className="mt-4 text-center lp-mono text-[10px] uppercase tracking-[0.16em] text-[#4A5B38]">// the reviewed record for clinical notes · synthetic data only</p>
      <div className="mt-6 flex flex-col md:flex-row gap-3 justify-between items-center border-t border-[#B3C5A0]/50 pt-6 text-xs text-[#4A5B38]">
        <span>© 2026 {CONTACT.name} · ClinicalBrief · synthetic data only</span>
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => openEmail()} aria-label="Send an email" className="p-2 rounded-md hover:bg-[#F4FAED] hover:text-[#090F05]"><Mail className="h-4 w-4" aria-hidden="true" /></button>
          <a href={CONTACT.linkedin} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="p-2 rounded-md hover:bg-[#F4FAED] hover:text-[#090F05]"><Linkedin className="h-4 w-4" aria-hidden="true" /></a>
          <a href={CONTACT.github} target="_blank" rel="noopener noreferrer" aria-label="GitHub" className="p-2 rounded-md hover:bg-[#F4FAED] hover:text-[#090F05]"><Github className="h-4 w-4" aria-hidden="true" /></a>
        </span>
        <button onClick={toTop} className="inline-flex items-center gap-1.5 py-2 lp-mono uppercase tracking-[0.12em] hover:text-[#090F05]">
          Back to top <ArrowUp className="h-3.5 w-3.5" />
        </button>
      </div>
    </footer>
  );
}

// Frame for an information page: header, a pale hero card (eyebrow, title, intro), the page body, footer.
// Scrolls to the top when the page opens. Use <Section> for body blocks.
export function PublicPage({ eyebrow, title, intro, children }: { eyebrow: string; title: React.ReactNode; intro?: React.ReactNode; children: React.ReactNode }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return (
    <div className="lp bg-white text-[#090F05] min-h-screen">
      <SiteHeader />
      <main className="pt-16">
        <section className="lp-ruler px-4 md:px-8 pt-2 pb-6">
          <div className="max-w-[1280px] mx-auto rounded-2xl bg-[#F4FAED] px-5 md:px-12 pt-14 md:pt-20 pb-12 md:pb-16">
            <Mono className="text-[#4A5B38]">{eyebrow}</Mono>
            <h1 className="lp-display mt-5 text-[40px] leading-[1.03] md:text-[64px] tracking-[-0.02em] max-w-4xl">{title}</h1>
            {intro && <div className="mt-6 text-[17px] md:text-lg leading-relaxed text-[#18280E] max-w-2xl">{intro}</div>}
          </div>
        </section>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

// A body section: optional mono label + heading, then content. `tone` picks white, pale green or dark forest.
export function Section({ id, label, title, tone = "white", children }: {
  id?: string; label?: string; title?: React.ReactNode; tone?: "white" | "pale" | "dark"; children: React.ReactNode;
}) {
  const bg = tone === "dark" ? "bg-[#18280E] text-white rounded-2xl" : tone === "pale" ? "bg-[#F4FAED] rounded-2xl" : "";
  return (
    <section id={id} className="px-4 md:px-8 py-8 md:py-10 scroll-mt-20">
      <div className={`max-w-[1280px] mx-auto ${bg} ${tone === "white" ? "" : "p-6 md:p-12"}`}>
        {label && <Mono className={tone === "dark" ? "text-[#B3C5A0]" : "text-[#4A5B38]"}>{label}</Mono>}
        {title && <h2 className="lp-display mt-3 text-3xl md:text-[44px] leading-[1.06] tracking-[-0.02em] max-w-3xl">{title}</h2>}
        <div className={title || label ? "mt-8" : ""}>{children}</div>
      </div>
    </section>
  );
}
