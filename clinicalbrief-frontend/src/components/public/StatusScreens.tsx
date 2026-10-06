"use client";
// Full-screen system states in the 404 page's visual language (ECG trace, ASCII block letters, mono log line).
// No header/footer and no router assumptions: ErrorScreen also renders from app/global-error.tsx, outside the app.
// LoadingScreen is CSS-only so it paints instantly; ErrorScreen uses GSAP, only under
// prefers-reduced-motion: no-preference. All content is in the markup, so neither needs JS to be visible.
import React, { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";

gsap.registerPlugin(useGSAP, DrawSVGPlugin);

const MOTION = "(prefers-reduced-motion: no-preference)";

// One P-QRS-T complex per 100 units of width, baseline at y=30 (viewBox height 60).
const BEAT: [number, number][] = [[0, 30], [22, 30], [28, 26], [34, 30], [40, 30], [43, 34], [48, 6], [53, 52], [57, 30], [66, 30], [74, 24], [82, 30], [100, 30]];
const beats = (n: number, odd?: number) => Array.from({ length: n }, (_, b) =>
  (b === odd
    // Arrhythmia blip: an early, wide, inverted complex, then a pause.
    ? [[10, 30], [16, 30], [24, 50], [34, 4], [44, 40], [52, 30], [100, 30]] as [number, number][]
    : BEAT).slice(b ? 1 : 0).map(([x, y]) => [x + b * 100, y]))
  .flat().map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");

const LOADING_PATH = beats(2);
const ERROR_PATH = beats(4, 2);

// --- Loading -----------------------------------------------------------------------------------------------
const LOADING_CSS = `
.cb-ecg-sweep { stroke-dasharray: 22 78; stroke-dashoffset: 100; animation: cb-ecg 1.6s linear infinite; }
@keyframes cb-ecg { to { stroke-dashoffset: 0; } }
@media (prefers-reduced-motion: reduce) { .cb-ecg-sweep { animation: none; stroke-dasharray: none; } }
`;

export function LoadingScreen({ label = "Restoring your session…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="min-h-screen bg-[#F4FAED] text-[#18280E] flex flex-col items-center justify-center gap-5 px-4">
      <style>{LOADING_CSS}</style>
      <svg viewBox="0 0 200 60" className="w-40 h-auto" aria-hidden="true">
        <path d={LOADING_PATH} fill="none" stroke="#B3C5A0" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={LOADING_PATH} pathLength={100} className="cb-ecg-sweep" fill="none" stroke="#3F7308" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <p className="lp-mono text-[12px] uppercase tracking-[0.14em] text-[#4A5B38] text-center">{label}</p>
    </div>
  );
}

// --- Error -------------------------------------------------------------------------------------------------
// figlet "ANSI Shadow" ERR, on the same fixed-width cell grid as the footer wordmark (ft-ascii-grid).
const ASCII_ERR = [
  "███████╗██████╗ ██████╗ ",
  "██╔════╝██╔══██╗██╔══██╗",
  "█████╗  ██████╔╝██████╔╝",
  "██╔══╝  ██╔══██╗██╔══██╗",
  "███████╗██║  ██║██║  ██║",
  "╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝",
];
const COLS = ASCII_ERR[0].length;

export function ErrorScreen({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    gsap.matchMedia().add(MOTION, () => {
      const q = gsap.utils.selector(root);
      gsap.timeline({ defaults: { ease: "power3.out" } })
        .from(q(".es-cell"), { autoAlpha: 0, y: 6, duration: 0.3, stagger: { each: 0.004, from: "random" } })
        .from(q(".es-line"), { drawSVG: 0, duration: 1.2, ease: "power2.inOut" }, 0.1)
        .from(q(".es-fade"), { y: 12, autoAlpha: 0, stagger: 0.08, duration: 0.45 }, 0.5);
      // Monitor sweep: a bright segment runs along the trace, across the irregular beat, on a loop.
      gsap.timeline({ repeat: -1, delay: 1.3, defaults: { ease: "none" } })
        .set(q(".es-trace"), { autoAlpha: 1 })
        .fromTo(q(".es-trace"), { drawSVG: "0% 0%" }, { drawSVG: "0% 10%", duration: 0.3 })
        .to(q(".es-trace"), { drawSVG: "90% 100%", duration: 2.6 })
        .to(q(".es-trace"), { drawSVG: "100% 100%", duration: 0.3 });
    });
  }, { scope: root });

  const retry = onRetry ?? (() => window.location.reload());
  const btn = "lp-mono inline-block text-[13px] px-4 py-2.5 rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3F7308]";

  return (
    <div ref={root} className="min-h-screen bg-white text-[#090F05] flex items-center justify-center px-4 py-10">
      <main className="w-full max-w-3xl rounded-2xl bg-[#F4FAED] px-5 py-10 md:px-12 md:py-14">
        <div className="ft-ascii-grid text-[#3F7308] select-none w-max max-w-full"
          style={{ gridTemplateColumns: `repeat(${COLS}, 0.6em)`, fontSize: "min(26px, calc((100vw - 72px) / 15))" }} aria-hidden="true">
          {ASCII_ERR.flatMap((r, y) => Array.from(r, (ch, x) => <span key={`${y}-${x}`} className="es-cell">{ch}</span>))}
        </div>

        <p className="es-fade mt-8 lp-mono text-[11px] uppercase tracking-[0.14em] text-[#4A5B38]">Error</p>
        <h1 className="es-fade lp-display mt-3 text-[36px] leading-[1.05] md:text-[52px] tracking-[-0.02em]">Something went wrong.</h1>
        <p className="es-fade mt-4 text-[17px] leading-relaxed text-[#18280E] max-w-xl">
          {message || "The page hit an unexpected error. Trying again usually helps; if it keeps happening, head back home."}
        </p>

        <div className="es-fade mt-8 rounded-xl bg-[#18280E] p-4 md:p-5">
          <svg viewBox="0 0 400 60" className="w-full h-auto block" aria-hidden="true">
            <path className="es-line" d={ERROR_PATH} fill="none" stroke="#B3C5A0" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <path className="es-trace" d={ERROR_PATH} fill="none" stroke="#B2EB76" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" style={{ opacity: 0, visibility: "hidden" }} />
          </svg>
          <p className="mt-3 lp-mono text-[12px] text-[#B3C5A0] break-words">
            <span className="text-[#B2EB76]">&gt;</span> render ... irregular rhythm detected · <span className="text-[#B2EB76]">error</span>
          </p>
        </div>

        <div className="es-fade mt-8 flex flex-wrap gap-3">
          <button type="button" onClick={retry} className={`${btn} bg-[#18280E] text-white hover:bg-[#090F05]`}>Try again</button>
          <a href="/" className={`${btn} bg-white border border-[#B3C5A0] text-[#18280E] hover:bg-[#E4E9DD]`}>Back home</a>
        </div>
      </main>
    </div>
  );
}
