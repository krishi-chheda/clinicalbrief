// Public 404 page for any unknown URL: "Patient not found". A flatlined ECG that can be revived into a looping
// heartbeat, an ASCII "404" that scrambles in, a mock record-lookup log and a heart you can fling.
// Motion only runs under prefers-reduced-motion: no-preference; otherwise everything is static and fully visible,
// and the ECG button still swaps the line without animating. All content is in the markup, so nothing needs JS
// to be visible. Nothing here is patient data; the monitor is decoration.
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import { SplitText } from "gsap/SplitText";
import { Draggable } from "gsap/Draggable";
import { InertiaPlugin } from "gsap/InertiaPlugin";
import { Heart } from "lucide-react";
import { PublicPage, Section, Mono } from "./kit";

gsap.registerPlugin(useGSAP, ScrambleTextPlugin, DrawSVGPlugin, MorphSVGPlugin, SplitText, Draggable, InertiaPlugin);

const MOTION = "(prefers-reduced-motion: no-preference)";
const reduced = () => typeof window !== "undefined" && !window.matchMedia(MOTION).matches;

// figlet "ANSI Shadow" 404, drawn on a fixed-width cell grid like the footer wordmark (ft-ascii-grid).
const ASCII_404 = [
  "██╗  ██╗ ██████╗ ██╗  ██╗",
  "██║  ██║██╔═████╗██║  ██║",
  "███████║██║██╔██║███████║",
  "╚════██║████╔╝██║╚════██║",
  "     ██║╚██████╔╝     ██║",
  "     ╚═╝ ╚═════╝      ╚═╝",
];
const COLS = ASCII_404[0].length;
const SCRAMBLE = "░▒▓█╔╗╚╝═║";

// Two P-QRS-T complexes across a 600x120 strip; the flat line has the same points at baseline, so the morph is
// point-for-point.
const BEAT_PTS: [number, number][] = [[0, 60], [70, 60], [85, 52], [100, 60], [120, 60], [130, 70], [145, 14], [160, 102], [172, 60], [200, 60], [225, 47], [250, 60], [300, 60]];
const pts = (flat: boolean) => [...BEAT_PTS, ...BEAT_PTS.slice(1).map(([x, y]) => [x + 300, y] as [number, number])]
  .map(([x, y], i) => `${i ? "L" : "M"}${x} ${flat ? 60 : y}`).join(" ");
const FLAT = pts(true), BEAT = pts(false);
const SWEEP = 2; // seconds per sweep: two beats, so 60 bpm on the display

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/login", label: "Sign in" },
] as const;

export default function NotFoundPage() {
  const root = useRef<HTMLDivElement>(null);
  const loop = useRef<gsap.core.Timeline | null>(null);
  const [path, setPath] = useState("");
  const [alive, setAlive] = useState(false);
  useEffect(() => { setPath(window.location.pathname); }, []);

  const { contextSafe } = useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION, () => {
      const q = gsap.utils.selector(root);
      const cells = (q(".nf-cell") as HTMLElement[]).filter(c => c.textContent !== " ");

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from(q(".nf-monitor"), { y: 24, autoAlpha: 0, duration: 0.6 })
        .from(q(".nf-flat"), { drawSVG: 0, duration: 1.1, ease: "power2.inOut" }, "-=0.2")
        .add(scrambleIn(cells), 0)
        .from(q(".nf-link"), { y: 12, autoAlpha: 0, stagger: 0.07, duration: 0.4 }, 0.9);

      // The heart can be flung around inside the monitor card and springs back home.
      const heart = q(".nf-heart")[0];
      const home = () => gsap.to(heart, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1, 0.45)" });
      const [drag] = Draggable.create(heart, {
        type: "x,y", bounds: q(".nf-monitor")[0], inertia: true, edgeResistance: 0.6,
        onRelease() { if (!this.tween) home(); },
        onThrowComplete: home,
      });
      return () => drag.kill();
    });
  }, { scope: root });

  // "Typing" log: characters appear in order, like a terminal. Runs once the real pathname is known; the <p> is
  // keyed by path so React replaces the node rather than patching text SplitText has already split.
  useGSAP(() => {
    if (!path) return;
    gsap.matchMedia().add(MOTION, () => {
      SplitText.create(root.current!.querySelector(".nf-log"), {
        type: "chars", aria: "none",
        onSplit: self => gsap.from(self.chars, { autoAlpha: 0, duration: 0.01, stagger: 0.02, delay: 0.3, ease: "none" }),
      });
    });
  }, { scope: root, dependencies: [path] });

  function scrambleIn(cells: HTMLElement[]) {
    const tl = gsap.timeline();
    cells.forEach((c, i) => {
      const col = Array.prototype.indexOf.call(c.parentNode!.children, c) % COLS;
      tl.to(c, { duration: 0.5 + Math.random() * 0.3, scrambleText: { text: c.dataset.ch!, chars: SCRAMBLE, speed: 0.6 } }, col * 0.025 + (i % 3) * 0.02);
    });
    return tl;
  }

  const rescramble = contextSafe(() => {
    if (reduced() || !root.current) return;
    const cells = Array.from(root.current.querySelectorAll<HTMLElement>(".nf-cell")).filter(c => c.dataset.ch !== " ");
    gsap.killTweensOf(cells);
    scrambleIn(cells);
  });

  const toggle = contextSafe(() => {
    const q = gsap.utils.selector(root);
    const next = !alive;
    setAlive(next);
    loop.current?.kill();
    loop.current = null;
    if (reduced()) { gsap.set(q(".nf-flat"), { attr: { d: next ? BEAT : FLAT } }); return; }
    gsap.to(q(".nf-flat"), { morphSVG: next ? BEAT : FLAT, duration: next ? 0.7 : 0.9, ease: next ? "elastic.out(1, 0.5)" : "power2.inOut" });
    if (!next) { gsap.to(q(".nf-trace"), { autoAlpha: 0, duration: 0.3 }); return; }
    // Monitor sweep: a bright segment runs along the trace; the heart thumps on each R wave (x = 145 and 445).
    const tl = gsap.timeline({ repeat: -1, delay: 0.4, defaults: { ease: "none" } });
    tl.set(q(".nf-trace"), { autoAlpha: 1 })
      .fromTo(q(".nf-trace"), { drawSVG: "0% 0%" }, { drawSVG: "0% 14%", duration: SWEEP * 0.14 })
      .to(q(".nf-trace"), { drawSVG: "86% 100%", duration: SWEEP * 0.72 })
      .to(q(".nf-trace"), { drawSVG: "100% 100%", duration: SWEEP * 0.14 });
    [145, 445].forEach(x => tl.fromTo(q(".nf-heart-icon"), { scale: 1 }, { scale: 1.3, duration: 0.09, yoyo: true, repeat: 1, ease: "power2.out" }, (x / 600) * SWEEP));
    loop.current = tl;
  });

  return (
    <PublicPage eyebrow="Error 404" title="Patient not found."
      intro={<p>No record matches this URL. It may have moved, or the link may be mistyped. The vitals below are only a joke.</p>}>
      <div ref={root}>
        <Section>
          <div className="grid gap-8 lg:grid-cols-[auto_1fr] lg:items-center">
            <div className="ft-ascii-grid text-[#3F7308] select-none cursor-default w-max"
              style={{ gridTemplateColumns: `repeat(${COLS}, 0.6em)`, fontSize: "min(30px, calc((100vw - 48px) / 16))" }}
              aria-hidden="true" onMouseEnter={rescramble} onClick={rescramble}>
              {ASCII_404.flatMap((r, y) => Array.from(r, (ch, x) => <span key={`${y}-${x}`} className="nf-cell" data-ch={ch}>{ch}</span>))}
            </div>

            <div className="nf-monitor relative min-w-0 rounded-2xl bg-[#18280E] text-white p-5 md:p-7 overflow-hidden">
              <div className="flex items-center justify-between gap-3">
                <Mono className="text-[#B3C5A0]">Monitor · bed /404</Mono>
                <span className="nf-heart relative z-10 touch-none cursor-grab active:cursor-grabbing p-1 -m-1" aria-hidden="true">
                  <Heart className={`nf-heart-icon h-6 w-6 ${alive ? "fill-[#B2EB76] text-[#B2EB76]" : "text-[#4A5B38]"}`} />
                </span>
              </div>
              <button type="button" onClick={toggle} aria-pressed={alive}
                aria-label={alive ? "Flatline the heartbeat" : "Revive the heartbeat"}
                className="mt-4 block w-full rounded-lg bg-[#090F05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B2EB76]"
                style={{ backgroundImage: "linear-gradient(rgba(178,235,118,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(178,235,118,.07) 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
                <svg viewBox="0 0 600 120" className="w-full h-auto block" aria-hidden="true">
                  <path className="nf-flat" d={FLAT} fill="none" stroke="#B3C5A0" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                  <path className="nf-trace" d={BEAT} fill="none" stroke="#B2EB76" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" style={{ opacity: 0, visibility: "hidden" }} />
                </svg>
              </button>
              <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="lp-mono text-sm" aria-live="polite">
                  {alive ? <>HR <span className="text-[#B2EB76]">60</span> bpm · pulse restored, page still missing</> : <>HR <span className="text-[#B2EB76]">--</span> · no pulse on this URL</>}
                </span>
                <Mono className="text-[#B3C5A0]">{alive ? "tap to flatline" : "tap the line to revive"}</Mono>
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-xl border border-[#B3C5A0]/70 bg-[#F4FAED] px-4 py-3 lp-mono text-[13px] leading-relaxed text-[#18280E] break-all">
            <p key={path} className="nf-log"><span className="text-[#3F7308]">&gt;</span> GET {path || "/"} ... <span className="text-[#3F7308]">404</span> · no record matches this URL</p>
          </div>

          <ul className="mt-8 flex flex-wrap gap-3">
            {LINKS.map(l => (
              <li key={l.href} className="nf-link">
                <Link href={l.href} className="lp-mono inline-block text-[13px] px-4 py-2.5 rounded-md bg-[#18280E] text-white hover:bg-[#090F05] transition-colors">{l.label}</Link>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </PublicPage>
  );
}
