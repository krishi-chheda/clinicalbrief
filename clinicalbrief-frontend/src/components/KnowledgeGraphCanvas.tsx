// Knowledge graph "scope": a 3D sphere of the patient's record, drawn on a 2D canvas (no 3D library).
// Items are spread evenly over a sphere around the patient, grouped by type; drag to rotate (with momentum),
// scroll to zoom, hover to light a node and its links, click for details. "Tour" turns to face each type in turn.
// Follows the site theme (html.dark), switching live. Motion (Premium: power3, no overshoot): the sphere expands out
// of the patient on entry and turns slowly while idle. Under prefers-reduced-motion there is no auto-rotation or
// entrance, and the tour jumps instead of turning. The frame loop runs on gsap.ticker (pauses with the tab).
import React, { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

export type GraphNode = { id: string; type: string; label: string; details?: string; source?: string };
export type GraphEdge = { source: string; target: string; label?: string };
export type GraphType = { type: string; plural: string };

// Type colours: the app's own on light, brighter ones on dark (the light ones are too dim there).
const PALETTE = {
  light: {
    node: { Patient: "#3F7308", Condition: "#DC2626", Finding: "#6B7A5C", Medication: "#059669", Allergy: "#D97706", Procedure: "#7C3AED", Symptom: "#DB2777" } as Record<string, string>,
    link: "#4A5B38", spokeA: 0.18, chip: "255,255,255", chipA: 0.9, text: "24,40,14", glowA: 0.3,
  },
  dark: {
    node: { Patient: "#B2EB76", Condition: "#F87171", Finding: "#B3C5A0", Medication: "#34D399", Allergy: "#FBBF24", Procedure: "#A78BFA", Symptom: "#F472B6" } as Record<string, string>,
    link: "#C5D0B8", spokeA: 0.13, chip: "9,15,5", chipA: 0.72, text: "238,242,233", glowA: 0.55,
  },
};
const isDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");
const colorOf = (type: string, dark: boolean) => (dark ? PALETTE.dark : PALETTE.light).node[type] || "#6B7A5C";
const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, a)})`;
};
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; };
const norm = (v: number[]) => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const easeOut = gsap.parseEase("power2.out");

// Point i of n spread evenly over the sphere (Fibonacci spiral). Items are ordered by type, so each type gets its
// own band of the sphere and nothing piles up, however many types are present.
function fib(i: number, n: number) {
  const y = n === 1 ? 0 : 0.92 - (1.84 * i) / (n - 1), r = Math.sqrt(1 - y * y), a = i * 2.39996;
  return [Math.cos(a) * r, y, Math.sin(a) * r];
}

type P3 = { id: string; v: number[]; node: GraphNode; delay: number };
type Proj = { x: number; y: number; z: number; s: number };

export default function KnowledgeGraphCanvas({ nodes, edges, types, filters, totals, onToggleType, patientLabel, patientKey,
  selectedId, onSelect, shorten, height }: {
  nodes: GraphNode[]; edges: GraphEdge[]; types: GraphType[]; filters: Record<string, boolean>; totals?: Record<string, number>;
  onToggleType: (type: string) => void; patientLabel: string; patientKey: string; selectedId: string | null;
  onSelect: (n: GraphNode, label: string) => void; shorten: (s: string) => string; height: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [caption, setCaption] = useState("");
  const [touring, setTouring] = useState(false);
  const [dark, setDark] = useState(false);
  // Everything the frame loop reads lives in one mutable ref (no React render per frame).
  const st = useRef({
    yaw: 0.4, pitch: -0.25, vYaw: 0, vPitch: 0, zoom: 1, expand: 0, idleAt: 0, hover: null as string | null,
    focusType: null as string | null, drag: null as null | { x: number; y: number; moved: number },
    pts: [] as P3[], byId: new Map<string, P3>(), patientId: "", edges: [] as GraphEdge[],
    proj: new Map<string, Proj>(), hl: new Map<string, number>(),
    selectedId: null as string | null, reduce: false, tour: null as gsap.core.Timeline | null,
  });
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const labelRef = useRef(patientLabel); labelRef.current = patientLabel;
  const shortenRef = useRef(shorten); shortenRef.current = shorten;

  const present = types.filter(t => nodes.some(n => n.type === t.type));

  // The legend and chrome follow the theme too.
  useEffect(() => {
    const sync = () => setDark(isDark());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  // Positions: patient at the centre, items spread over the sphere grouped by type.
  useEffect(() => {
    const s = st.current;
    const rank = (t: string) => types.findIndex(x => x.type === t);
    const items = nodes.filter(n => n.type !== "Patient").sort((a, b) => rank(a.type) - rank(b.type) || a.id.localeCompare(b.id));
    s.pts = [
      ...nodes.filter(n => n.type === "Patient").map(n => ({ id: n.id, v: [0, 0, 0], node: n, delay: 0 })),
      ...items.map((n, i) => ({ id: n.id, v: fib(i, items.length).map(c => c * (0.86 + hash(n.id) * 0.14)), node: n, delay: hash(n.id + "d") })),
    ];
    s.byId = new Map(s.pts.map(p => [p.id, p]));
    s.patientId = nodes.find(n => n.type === "Patient")?.id ?? "";
    s.edges = edges;
  }, [nodes, edges, types]);

  useEffect(() => { st.current.selectedId = selectedId; }, [selectedId]);

  // Entrance per patient: the sphere expands out of the patient node.
  useEffect(() => {
    const s = st.current;
    s.reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (s.reduce) { s.expand = 1; return; }
    s.expand = 0;
    const tw = gsap.to(s, { expand: 1, duration: 1.2, ease: "power3.out", delay: 0.1 });
    return () => { tw.kill(); };
  }, [patientKey]);

  const stopTour = () => {
    const s = st.current;
    s.tour?.kill(); s.tour = null; s.focusType = null; setCaption(""); setTouring(false);
  };
  const stopTourRef = useRef(stopTour); stopTourRef.current = stopTour;

  // Frame loop + input.
  useEffect(() => {
    const cv = canvas.current!, ctx = cv.getContext("2d")!, s = st.current;
    let W = 0, H = 0, dpr = 1;
    const resize = () => {
      const r = cv.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr;
    };
    const ro = new ResizeObserver(resize); ro.observe(cv); resize();

    const project = (v: number[]): Proj => {
      const [x, y, z] = v, cy = Math.cos(s.yaw), sy = Math.sin(s.yaw), cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy, y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      const R = Math.min(W * 0.4, H * 0.36) * s.zoom, persp = 3 / (3 - z2);
      return { x: W / 2 + x1 * R * persp, y: H / 2 + 8 + y2 * R * persp, z: z2, s: persp };
    };
    const neighbours = (id: string) => s.edges.flatMap(e => e.source === id ? [e.target] : e.target === id ? [e.source] : []);

    const tick = (time: number, dt: number) => {
      if (!W) return;
      const sec = Math.min(dt, 50) / 1000, now = performance.now();
      const dk = isDark(), pal = dk ? PALETTE.dark : PALETTE.light, col = (t: string) => colorOf(t, dk);
      // Rotation: drag momentum decays; auto-rotate once idle for 2.5 s (not while touring or hovering).
      if (!s.drag) {
        s.yaw += s.vYaw; s.pitch += s.vPitch; s.vYaw *= 0.94; s.vPitch *= 0.94;
        if (!s.reduce && !s.tour && !s.hover && now - s.idleAt > 2500) s.yaw += 0.12 * sec;
      }
      s.pitch = Math.max(-1.2, Math.min(1.2, s.pitch));

      const focus = s.hover ?? s.selectedId;
      const lit = focus ? new Set([focus, ...neighbours(focus)]) : null;
      for (const p of s.pts) {
        const target = s.focusType ? (p.node.type === s.focusType || p.id === s.patientId ? 1 : 0.12)
          : lit ? (lit.has(p.id) ? 1 : 0.12) : 1;
        const cur = s.hl.get(p.id) ?? 1;
        s.hl.set(p.id, cur + (target - cur) * Math.min(1, sec * 10));
        const e = s.reduce ? 1 : Math.max(0, Math.min(1, s.expand * 1.35 - p.delay * 0.35));
        s.proj.set(p.id, project(p.v.map(c => c * easeOut(e))));
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // Links: spokes to the patient faint, links between items stronger; lit ones in the item's colour.
      for (const e of s.edges) {
        const a = s.proj.get(e.source), b = s.proj.get(e.target);
        if (!a || !b) continue;
        const h = Math.min(s.hl.get(e.source) ?? 1, s.hl.get(e.target) ?? 1);
        const item = s.byId.get(e.source === s.patientId ? e.target : e.source)?.node;
        const hot = !!focus && (e.source === focus || e.target === focus);
        const spoke = e.source === s.patientId || e.target === s.patientId;
        const depth = ((a.z + b.z) / 2 + 1) / 2;
        ctx.strokeStyle = hot ? rgba(col(item?.type ?? ""), 0.85)
          : rgba(pal.link, (spoke ? pal.spokeA : 0.38) * (0.4 + depth * 0.6) * h * s.expand);
        ctx.lineWidth = hot ? 1.4 : 0.8;
        ctx.setLineDash(e.label === "mentioned in same note" ? [3, 4] : []);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.setLineDash([]);

      // Nodes back to front: soft glow, core, dashed ring for reviewed AI findings, selection ring.
      const order = [...s.pts].sort((p, q) => s.proj.get(p.id)!.z - s.proj.get(q.id)!.z);
      for (const p of order) {
        const q = s.proj.get(p.id)!, h = s.hl.get(p.id) ?? 1, depth = (q.z + 1) / 2;
        const isPatient = p.id === s.patientId, c = col(p.node.type);
        const r = (isPatient ? 7 : 3.4) * q.s * (p.id === s.hover ? 1.5 : 1), a = (0.35 + depth * 0.65) * h;
        const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r * 4);
        g.addColorStop(0, rgba(c, pal.glowA * a)); g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q.x, q.y, r * 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgba(c, Math.min(1, a + 0.15)); ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
        if (isPatient && !s.reduce) {
          const ph = (time % 2.4) / 2.4;
          ctx.strokeStyle = rgba(c, 0.45 * (1 - ph)); ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(q.x, q.y, r * (1.4 + ph * 2.4), 0, Math.PI * 2); ctx.stroke();
        }
        if (p.node.source === "ai") {
          ctx.setLineDash([2, 2]); ctx.strokeStyle = rgba(c, a); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(q.x, q.y, r + 3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
        if (p.id === s.selectedId) {
          ctx.strokeStyle = col("Patient"); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(q.x, q.y, r + 6, 0, Math.PI * 2); ctx.stroke();
        }
      }

      // Labels: the front half, or whatever is lit. Mono text in a chip with a coloured left edge; labels on the
      // right half of the panel open to the left so they stay inside it.
      if (s.expand > 0.6) {
        ctx.textBaseline = "middle";
        for (const p of order) {
          const q = s.proj.get(p.id)!, h = s.hl.get(p.id) ?? 1, isPatient = p.id === s.patientId;
          const show = isPatient || (lit ? lit.has(p.id) : s.focusType ? p.node.type === s.focusType : q.z > 0.1);
          if (!show) continue;
          const text = isPatient ? labelRef.current : shortenRef.current(p.node.label);
          ctx.font = `${isPatient ? 12 : 11}px "JetBrains Mono", ui-monospace, monospace`;
          const tw = ctx.measureText(text).width + 14;
          const left = !isPatient && q.x > W * 0.62;
          const x = isPatient ? q.x - tw / 2 : left ? q.x - 12 - tw : q.x + 12, y = isPatient ? q.y + 26 : q.y;
          const a = Math.min(1, (0.45 + ((q.z + 1) / 2) * 0.55) * h * (s.expand - 0.6) / 0.4);
          ctx.fillStyle = `rgba(${pal.chip},${pal.chipA * a})`; ctx.fillRect(x, y - 10, tw, 20);
          ctx.fillStyle = rgba(col(p.node.type), a); ctx.fillRect(left ? x + tw - 2 : x, y - 10, 2, 20);
          ctx.fillStyle = `rgba(${pal.text},${a})`; ctx.fillText(text, x + 7, y + 0.5);
        }
      }
    };
    gsap.ticker.add(tick);

    // Input: drag rotates (momentum on release), a still click selects, wheel zooms.
    const hit = (ev: PointerEvent) => {
      const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
      let best: P3 | null = null, bestScore = Infinity;
      for (const p of s.pts) {
        const q = s.proj.get(p.id); if (!q) continue;
        const d = Math.hypot(q.x - mx, q.y - my);
        if (d < 16 && d - q.z * 6 < bestScore) { best = p; bestScore = d - q.z * 6; }  // nearer nodes win ties
      }
      return best;
    };
    const down = (ev: PointerEvent) => {
      cv.setPointerCapture(ev.pointerId); s.drag = { x: ev.clientX, y: ev.clientY, moved: 0 };
      s.idleAt = performance.now(); if (s.tour) stopTourRef.current();
    };
    const move = (ev: PointerEvent) => {
      if (s.drag) {
        const dx = ev.clientX - s.drag.x, dy = ev.clientY - s.drag.y;
        s.drag.moved += Math.abs(dx) + Math.abs(dy); s.drag.x = ev.clientX; s.drag.y = ev.clientY;
        s.vYaw = dx * 0.006; s.vPitch = dy * 0.006; s.yaw += s.vYaw; s.pitch += s.vPitch; s.idleAt = performance.now();
      } else {
        const p = hit(ev); s.hover = p?.id ?? null; cv.style.cursor = p ? "pointer" : "grab";
      }
    };
    const up = (ev: PointerEvent) => {
      if (s.drag && s.drag.moved < 5) {
        s.vYaw = s.vPitch = 0;
        const p = hit(ev);
        if (p) onSelectRef.current(p.node, p.id === s.patientId ? labelRef.current : p.node.label);
      }
      s.drag = null; s.idleAt = performance.now();
    };
    const leave = () => { s.hover = null; };
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault(); s.zoom = Math.max(0.6, Math.min(2.2, s.zoom * (ev.deltaY < 0 ? 1.08 : 0.92))); s.idleAt = performance.now();
    };
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up);
    cv.addEventListener("pointerleave", leave); cv.addEventListener("wheel", wheel, { passive: false });
    return () => {
      gsap.ticker.remove(tick); ro.disconnect(); s.tour?.kill();
      cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointerleave", leave); cv.removeEventListener("wheel", wheel);
    };
  }, []);

  // Tour: turn to face each type (the centre of its nodes, shortest way round), name it, move on.
  const startTour = () => {
    const s = st.current;
    if (s.tour) { stopTour(); return; }
    const dur = s.reduce ? 0 : 1.1;
    const tl = gsap.timeline({ onComplete: stopTour });
    let yaw = s.yaw;
    present.forEach(t => {
      const group = s.pts.filter(p => p.node.type === t.type);
      const [dx, dy, dz] = norm([0, 1, 2].map(k => group.reduce((acc, p) => acc + p.v[k], 0)));
      let ty = Math.atan2(-dx, dz);
      ty += Math.round((yaw - ty) / (2 * Math.PI)) * 2 * Math.PI; yaw = ty;
      const total = totals?.[t.type] ?? group.length;
      tl.to(s, { yaw: ty, pitch: Math.atan2(dy, Math.hypot(dx, dz)), duration: dur, ease: "power3.inOut",
        onStart: () => { s.focusType = t.type; s.vYaw = s.vPitch = 0; setCaption(`${t.plural} · ${group.length}${total > group.length ? ` of ${total}` : ""}`); } })
        .to({}, { duration: 1.4 });
    });
    s.tour = tl; setTouring(true);
  };

  const shown = nodes.length - 1;
  const mono = "font-mono uppercase tracking-[0.14em]";
  return (
    <div className={`relative rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 bg-[radial-gradient(ellipse_at_center,#F4FAED_0%,#FFFFFF_72%)] dark:bg-[radial-gradient(ellipse_at_center,#18280E_0%,#0B1209_70%)] ${height}`}>
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 px-4 pt-3 text-[10px] whitespace-nowrap text-slate-500 dark:text-[#B3C5A0] pointer-events-none">
        <span className={`${mono} text-[#3F7308] dark:text-[#B2EB76]`}>§ graph</span>
        <span className={`${mono} truncate min-w-0`}>{patientLabel}</span>
        <span className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
        <span className={`${mono} hidden sm:inline`}>drag to rotate · tap a node</span>
      </div>

      <div className="absolute left-3 top-10 z-10 flex flex-col items-start gap-1.5">
        {types.map(t => {
          const on = filters[t.type] ?? true, n = totals?.[t.type] ?? nodes.filter(x => x.type === t.type).length;
          if (!n) return null;
          return (
            <button key={t.type} onClick={() => onToggleType(t.type)} aria-pressed={on}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${mono} text-[10px] transition-colors ${on
                ? "border-slate-200 bg-white/80 text-slate-800 hover:border-slate-400 dark:border-white/15 dark:bg-black/40 dark:text-[#EEF2E9] dark:hover:border-white/30"
                : "border-slate-200/60 bg-white/40 text-slate-400 line-through dark:border-white/5 dark:bg-black/20 dark:text-[#6B7A5C]"}`}>
              <span className={`h-2 w-2 rounded-full ${on ? "" : "opacity-30"}`} style={{ background: colorOf(t.type, dark) }} />
              {t.plural} <span className="text-slate-400 dark:text-[#95A386]">{n}</span>
            </button>
          );
        })}
      </div>

      <canvas ref={canvas} className="absolute inset-0 h-full w-full cursor-grab touch-none" role="img"
        aria-label={`3D graph of ${shown} items linked to ${patientLabel}. The list of items below the graph selects one.`} />

      {caption && (
        <div className={`absolute left-1/2 top-12 -translate-x-1/2 z-10 rounded-md border px-3 py-1.5 ${mono} text-[11px] border-slate-200 bg-white/90 text-[#3F7308] dark:border-white/15 dark:bg-black/60 dark:text-[#B2EB76]`}>
          {caption}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 px-4 pb-3 text-[10px] whitespace-nowrap text-slate-500 dark:text-[#95A386] pointer-events-none">
        <span className={`${mono} truncate min-w-0`}>
          <span className="text-[#3F7308] dark:text-[#B2EB76]">live</span> {shown} items · {edges.length} links · {present.length} {present.length === 1 ? "type" : "types"}
        </span>
        <button onClick={startTour} className={`pointer-events-auto shrink-0 flex items-center gap-2 rounded-md border px-3 py-1.5 ${mono} text-[11px] border-slate-200 bg-white/90 text-slate-800 hover:border-[#3F7308] dark:border-white/15 dark:bg-black/50 dark:text-[#EEF2E9] dark:hover:border-[#B2EB76]/60`}>
          <span className="text-[#3F7308] dark:text-[#B2EB76]">{touring ? "■" : "▶"}</span>{touring ? "stop" : "tour"}
        </button>
      </div>

      {/* Keyboard and screen-reader access to every node. */}
      <ul className="sr-only">
        {nodes.map(n => (
          <li key={n.id}><button onClick={() => onSelect(n, n.type === "Patient" ? patientLabel : n.label)}>{n.type}: {n.type === "Patient" ? patientLabel : n.label}</button></li>
        ))}
      </ul>
    </div>
  );
}
