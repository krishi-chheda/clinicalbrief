// Landing hero scene: an extruded, contour-lined heart with a heartbeat trace, and synthetic record cards
// floating around it. Motion: Premium personality (calm, no overshoot).
//   Primary   - the heart's entrance (rise + settle) and its heartbeat trace.
//   Secondary - the data cards rising in, staggered 100 ms, then floating out of phase.
//   Ambient   - the slow float of the heart and cards; a soft beat pulse.
// All data shown is synthetic and labelled as such. Pure SVG + CSS (globals.css, "hs-" classes).
import React from "react";
import { Pill, FlaskConical, HeartPulse, ShieldAlert } from "lucide-react";

// Classic parametric heart, sampled into a closed path. Width ~ 32 * s, height ~ 30 * s.
function heartPath(cx: number, cy: number, s: number): string {
  const pts: string[] = [];
  for (let i = 0; i <= 96; i++) {
    const t = (i / 96) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push(`${(cx + x * s).toFixed(1)} ${(cy - y * s).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}

const CX = 200, CY = 196, S = 8.6;
const DEPTH = 18;                            // extrusion layers (the "coin edge")
const FACE = heartPath(CX, CY, S);
const LAYERS = Array.from({ length: DEPTH }, (_, k) => heartPath(CX - (DEPTH - k) * 1.35, CY + (DEPTH - k) * 1.6, S));
// Topographic rings: alternating plain / hatched bands, drifting slightly up-left like a raised relief.
const RINGS = [0.8, 0.62, 0.44, 0.27].map((f, i) => ({ d: heartPath(CX - 6 * (1 - f), CY - 10 * (1 - f), S * f), hatched: i % 2 === 1 }));
const ECG = "M70 200 H150 l10 -10 l8 10 h10 l10 -62 l12 104 l10 -58 h14 l8 -12 l8 12 H330";

function DataBox({ label, children, className = "", delay }: { label: string; children: React.ReactNode; className?: string; delay: number }) {
  return (
    <div className={`hs-card ${className}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="hs-float rounded-[3px] border-[1.5px] border-[#090F05] bg-[#F4FAED] px-3 py-2.5 text-left shadow-[0_1px_0_#090F05]">
        <div className="lp-mono text-[10px] uppercase tracking-[0.12em] text-[#18280E]">&#9658; {label}</div>
        <div className="lp-mono mt-1.5 text-[11px] leading-[1.45] uppercase tracking-[0.06em] text-[#18280E]">{children}</div>
      </div>
    </div>
  );
}

export default function HealthScene() {
  return (
    <div className="relative mx-auto mt-6 md:mt-2 h-[340px] md:h-[440px] max-w-5xl" aria-hidden="true">
      {/* Heart */}
      <div className="hs-heart absolute left-1/2 top-0 -translate-x-1/2 w-[320px] md:w-[420px]">
        <svg viewBox="0 0 400 400" className="hs-float hs-float-slow w-full h-auto overflow-visible">
          <defs>
            <pattern id="hs-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#4A5B38" strokeWidth="1.1" />
            </pattern>
          </defs>
          <g className="hs-beat">
            {LAYERS.map((d, k) => (
              <path key={k} d={d} fill={k % 3 === 0 ? "#E3EED5" : "#EEF5E4"} stroke="#4A5B38" strokeWidth="0.8" strokeLinejoin="round" />
            ))}
            <path d={FACE} fill="#F4FAED" stroke="#18280E" strokeWidth="1.4" />
            <path d={FACE} fill="url(#hs-hatch)" opacity="0.75" />
            {RINGS.map((r, i) => (
              <path key={i} d={r.d} className="hs-ring" style={{ animationDelay: `${250 + i * 90}ms` }}
                fill={r.hatched ? "url(#hs-hatch)" : "#F4FAED"} stroke="#4A5B38" strokeWidth="1" />
            ))}
            <path d={ECG} className="hs-ecg" fill="none" stroke="#18280E" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" pathLength={100} />
          </g>
        </svg>
      </div>

      {/* Floating record cards (synthetic) */}
      <DataBox label="Patient" delay={350} className="absolute left-0 md:left-[2%] top-[14%] hidden sm:block">
        SYN-0381 &middot; F &middot; 54 Y<br />SYNTHEA (SYNTHETIC)
      </DataBox>
      <DataBox label="Observation" delay={450} className="absolute left-0 md:left-[6%] top-[44%] hidden sm:block">
        HBA1C 6.8 %<br />2024-03-01<br />LOINC 4548-4
      </DataBox>

      <div className="hs-card absolute right-0 md:right-[1%] top-[26%] hidden sm:block" style={{ animationDelay: "550ms" }}>
        <div className="hs-float hs-float-alt w-[280px] rounded-xl bg-white p-4 text-left shadow-[0_12px_40px_-12px_rgba(9,15,5,0.25)]">
          <div className="h-10 w-10 rounded-md bg-[#3F7308] text-white flex items-center justify-center"><Pill className="h-5 w-5" /></div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm text-[#090F05]">Metformin oral tablet</div>
              <div className="lp-mono text-[11px] text-[#4A5B38]">2024-03-01 09:23 &middot; started</div>
            </div>
            <div className="lp-display text-2xl text-[#090F05] whitespace-nowrap">500 mg</div>
          </div>
        </div>
      </div>

      <div className="hs-card absolute right-[6%] top-[68%] hidden md:block" style={{ animationDelay: "650ms" }}>
        <div className="hs-float inline-flex items-center gap-2 rounded-full bg-[#18280E] px-3 py-1.5 lp-mono text-[10px] uppercase tracking-[0.12em] text-[#B2EB76]">
          <span className="hs-dot h-1.5 w-1.5 rounded-full bg-[#B2EB76]" /> reviewed by a clinician
        </div>
      </div>
    </div>
  );
}


// --- Statement band: record fragments drifting around the text at three depths --------------------------
// Far cards sit behind the text, small and faint, and move least; near cards sit in front and move most
// (scroll parallax via GSAP ScrollTrigger in Landing.tsx, plus a slow independent CSS float). All values synthetic.
type Frag =
  | { kind: "box"; label: string; lines: string[]; x: string; y: string; depth: 0 | 1 | 2 }
  | { kind: "item"; title: string; sub: string; value: string; icon: "pill" | "lab" | "vital" | "allergy"; x: string; y: string; depth: 0 | 1 | 2 };

const FRAGS: Frag[] = [
  { kind: "box", label: "Encounter", lines: ["GENERAL PRACTICE", "2024-03-01"], x: "41%", y: "8%", depth: 0 },
  { kind: "item", title: "METFORMIN 500 MG", sub: "Medication", value: "started", icon: "pill", x: "52%", y: "22%", depth: 2 },
  { kind: "box", label: "Code", lines: ["ICD-10: E11.9", "TYPE 2 DIABETES"], x: "16%", y: "27%", depth: 1 },
  { kind: "box", label: "Observation", lines: ["LOINC 4548-4"], x: "60%", y: "31%", depth: 0 },
  { kind: "box", label: "Status", lines: ["CLINICAL STATUS: ACTIVE"], x: "72%", y: "34%", depth: 1 },
  { kind: "item", title: "HBA1C 6.8 %", sub: "Lab result", value: "flag: high", icon: "lab", x: "17%", y: "63%", depth: 2 },
  { kind: "box", label: "Provenance", lines: ["SYNTHEA SYN-0381"], x: "11%", y: "75%", depth: 0 },
  { kind: "box", label: "Review", lines: ["APPROVED BY CLINICIAN"], x: "44%", y: "76%", depth: 1 },
  { kind: "box", label: "Evidence", lines: ["\"HISTORY OF TYPE 2 DIABETES\""], x: "59%", y: "73%", depth: 0 },
  { kind: "item", title: "PENICILLIN", sub: "Allergy", value: "high", icon: "allergy", x: "57%", y: "81%", depth: 2 },
  { kind: "item", title: "BP 128/82 MMHG", sub: "Vital sign", value: "normal", icon: "vital", x: "76%", y: "60%", depth: 1 },
];

const FRAG_ICON = { pill: Pill, lab: FlaskConical, vital: HeartPulse, allergy: ShieldAlert };
const FRAG_TILE = { pill: "bg-[#B2EB76]", lab: "bg-[#EBE46A]", vital: "bg-[#B2EB76]", allergy: "bg-[#F2C7A0]" };
// depth -> [opacity, parallax travel in px, z-index]
const FRAG_DEPTH = [[0.32, 40, 0], [0.7, 90, 0], [1, 160, 20]] as const;

export function StatementFragments() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {FRAGS.map((f, i) => {
        const [opacity, travel, z] = FRAG_DEPTH[f.depth];
        const style = { left: f.x, top: f.y, opacity, zIndex: z,
          animationDelay: `${-i * 0.9}s` } as React.CSSProperties;
        const hideSmall = f.depth === 2 ? "hidden lg:block" : i % 2 === 1 ? "hidden md:block" : "";
        return (
          <div key={i} className={`sf-par absolute ${hideSmall}`} style={style} data-travel={travel}>
            <div className="sf-float" style={{ animationDelay: `${-i * 1.3}s` }}>
              {f.kind === "box" ? (
                <div className="sf-box px-4 py-3 text-left">
                  <div className="lp-mono text-[10px] uppercase tracking-[0.14em] text-[#B2EB76]">&#9658; <span className="text-white/90">{f.label}</span></div>
                  {f.lines.map(l => <div key={l} className="lp-mono mt-1 text-[10px] uppercase tracking-[0.1em] text-[#B3C5A0] whitespace-nowrap">{l}</div>)}
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-md border border-white/80 bg-[#18280E] px-3 py-2.5 min-w-[250px]">
                  {React.createElement(FRAG_ICON[f.icon], { className: `h-7 w-7 p-1.5 rounded ${FRAG_TILE[f.icon]} text-[#18280E] shrink-0` })}
                  <div className="text-left">
                    <div className="text-[13px] font-medium text-white whitespace-nowrap">{f.title}</div>
                    <div className="lp-mono text-[10px] tracking-[0.08em] text-[#B3C5A0]">{f.sub}</div>
                  </div>
                  <div className="ml-auto pl-4 lp-display text-[14px] text-white whitespace-nowrap">{f.value}</div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
