// Public 404: "This page was discharged without a follow-up." A line-art hospital campus at night, simulated live:
// three ambulances loop the ring road and stop at the ED bay, a medevac helicopter lifts off the roof, circles and
// lands, ward windows light up and go dark. Drag to turn it. The counters (bottom right) are read from the same
// simulation. Drawn on a canvas with a small hand-rolled projection (painter's sort, back-face culling), no 3D
// library. Under prefers-reduced-motion the scene is a still frame (dragging still turns it).
// Wayfinding: every building is a department of the site. Hover (or tap once on touch) lights it and shows its sign;
// click (or tap again) zooms in and opens that page. The "Hospital directory" lists the same destinations as real
// links, so keyboard and screen-reader users get every route; focusing an entry highlights its building.
// Purely decorative: the canvas is aria-hidden; the page's text and link carry the meaning.
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type V = [number, number, number];                    // world: x east, y up, z south
type Item = { depth: number; draw: (c: CanvasRenderingContext2D) => void; pick?: string; shape?: V[] };

const THEMES = {
  dark: { bg: "#111711", top: "#1A2219", sideA: "#151C14", sideB: "#0E140D", ground: "#131A12", road: "#0C110B",
          line: "rgba(205,216,190,0.62)", dim: "rgba(205,216,190,0.16)", lit: "#EBE46A", text: "#E6ECDF", muted: "#7E8C72",
          heli: "rgba(205,216,190,0.85)", shadow: "rgba(0,0,0,0.35)", btnBg: "#E6ECDF", btnFg: "#0E140D",
          glass: "#22343A", tyre: "#070A07", body: "#C9D4BC",
          hi: "#B2EB76", hiTop: "#243220", hiSide: "#1A2617", signBg: "#0B100A", signFg: "#E6ECDF" },
  light: { bg: "#F3F6EE", top: "#FFFFFF", sideA: "#E8EDE1", sideB: "#D8E0CE", ground: "#EEF2E8", road: "#E1E7D8",
           line: "rgba(24,40,14,0.78)", dim: "rgba(24,40,14,0.14)", lit: "#F0CF4F", text: "#18280E", muted: "#6B7A5C",
           heli: "rgba(24,40,14,0.9)", shadow: "rgba(24,40,14,0.12)", btnBg: "#18280E", btnFg: "#F3F6EE",
           glass: "#BFD3D6", tyre: "#26301F", body: "#FFFFFF",
           hi: "#3F7308", hiTop: "#F2F9E8", hiSide: "#E3EED6", signBg: "#18280E", signFg: "#F3F6EE" },
};
type Theme = typeof THEMES.dark;

const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// --- Simulation --------------------------------------------------------------------------------------------------
// The ambulance route: out of the ED bay, round the ring road, back into the bay.
const BAY: [number, number] = [-3, 6.4];
const ROUTE: [number, number][] = [BAY, [-3, 9], [13, 9], [13, -9], [-13, -9], [-13, 9], [-3, 9], BAY];
const SEGS = ROUTE.slice(1).map((p, i) => ({ a: ROUTE[i], b: p, len: Math.hypot(p[0] - ROUTE[i][0], p[1] - ROUTE[i][1]) }));
const ROUTE_LEN = SEGS.reduce((s, x) => s + x.len, 0);
const SPEED = 4.2, DWELL = 7, CYCLE = ROUTE_LEN / SPEED + DWELL, AMBULANCES = 3;

function ambulance(t: number, k: number) {
  const u = (((t + (k * CYCLE) / AMBULANCES) % CYCLE) + CYCLE) % CYCLE;
  if (u < DWELL) return { x: BAY[0], z: BAY[1], ang: -Math.PI / 2, inBay: true, toArrive: 0 };
  let d = (u - DWELL) * SPEED;
  for (const s of SEGS) {
    if (d <= s.len) {
      const f = d / s.len;
      return { x: lerp(s.a[0], s.b[0], f), z: lerp(s.a[1], s.b[1], f), ang: Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]),
               inBay: false, toArrive: (ROUTE_LEN - (u - DWELL) * SPEED) / SPEED };
    }
    d -= s.len;
  }
  return { x: BAY[0], z: BAY[1], ang: -Math.PI / 2, inBay: true, toArrive: 0 };
}

// Medevac: on the pad, lift, fly out, circle the campus, come back, land. 34 s loop.
const PAD: V = [-2, 6.05, 0];
function helicopter(t: number) {
  const u = ((t % 34) + 34) % 34, R = 7.5, H = PAD[1] + 2.4;
  const orbit = (a: number): V => [Math.cos(a) * R, H, Math.sin(a) * R];
  const a0 = -Math.PI / 2, start = orbit(a0);
  let p: V, flying = true, heading = 0;
  if (u < 9) { p = PAD; flying = false; }
  else if (u < 12) { p = [PAD[0], lerp(PAD[1], H, smooth((u - 9) / 3)), PAD[2]]; }
  else if (u < 15) { const f = smooth((u - 12) / 3); p = [lerp(PAD[0], start[0], f), H, lerp(PAD[2], start[2], f)]; heading = Math.atan2(start[2] - PAD[2], start[0] - PAD[0]); }
  else if (u < 27) { const a = a0 + ((u - 15) / 12) * Math.PI * 2; p = orbit(a); heading = a + Math.PI / 2; }
  else if (u < 30) { const f = smooth((u - 27) / 3); p = [lerp(start[0], PAD[0], f), H, lerp(start[2], PAD[2], f)]; heading = Math.atan2(PAD[2] - start[2], PAD[0] - start[0]); }
  else { p = [PAD[0], lerp(H, PAD[1], smooth((u - 30) / 4)), PAD[2]]; }
  const rotor = flying || u > 6 ? 1 : 0.15;                // spins up before take-off
  return { p, heading, flying, rotor };
}

// Ward window lit state: each window keeps its own schedule (changes every 5-17 s).
const lit = (id: number, t: number) => {
  const period = 5 + hash(id) * 12, slot = Math.floor((t + hash(id + 9) * period) / period);
  return hash(id * 31 + slot) > 0.55;
};

// --- Static campus -------------------------------------------------------------------------------------------------
type Box = { x: number; z: number; w: number; d: number; h: number; y0?: number; win?: [number, number]; id: number; cross?: boolean };
const BUILDINGS: Box[] = [
  { id: 1, x: -6, z: -4, w: 8, d: 8, h: 6, win: [4, 6] },          // main tower (helipad on the roof)
  { id: 2, x: 2, z: -3, w: 7.5, d: 5, h: 4.4, win: [3, 6] },       // ward wing
  { id: 3, x: -8.5, z: 4, w: 7.5, d: 2.2, h: 2.2, win: [1, 6], cross: true },  // emergency department
  { id: 4, x: -4.2, z: 6.2, w: 2.4, d: 1.4, h: 0.18, y0: 2.0 },                // ED canopy over the bay
  { id: 5, x: -1, z: -7, w: 3, d: 2.6, h: 1.6, win: [1, 2] },       // plant room
  { id: 6, x: -11, z: -6, w: 4, d: 4.5, h: 2.8, win: [2, 3] },      // medical records annex
  { id: 7, x: 4, z: -7.6, w: 5, d: 3.4, h: 3, win: [2, 4] },        // administration
  { id: 8, x: 10.4, z: 2.6, w: 1.2, d: 1, h: 1.1, win: [1, 1] },    // information kiosk by the car park
];

// The site, as departments. `anchor` is where the sign hangs (above the roof); `ids` are the buildings that are it.
type Dept = { key: string; name: string; page: string; href: string; ids: number[]; anchor: V };
const DEPTS: Dept[] = [
  { key: "reception", name: "Reception", page: "Home", href: "/", ids: [1], anchor: [-4.8, 6.5, 2.8] },
  { key: "helipad", name: "Flight plan", page: "Roadmap", href: "/roadmap", ids: [], anchor: [-2, 6.7, 0] },
  { key: "emergency", name: "Emergency access", page: "Sign in", href: "/login", ids: [3, 4], anchor: [-4.75, 2.9, 5.1] },
  { key: "ward", name: "Isolation ward", page: "Security", href: "/security", ids: [2], anchor: [5.75, 4.9, -0.5] },
  { key: "records", name: "Medical records", page: "Data", href: "/data", ids: [6], anchor: [-9, 3.3, -3.75] },
  { key: "admin", name: "Administration", page: "About", href: "/about", ids: [7], anchor: [6.5, 3.5, -5.9] },
  { key: "plant", name: "Plant room", page: "Developer docs", href: "/docs", ids: [5], anchor: [0.5, 2.1, -5.7] },
  { key: "kiosk", name: "Information kiosk", page: "Contact", href: "/contact", ids: [8], anchor: [11, 1.6, 3.1] },
];
const DEPT_OF = new Map(DEPTS.flatMap(d => d.ids.map(id => [id, d.key] as const)));
const pointIn = (x: number, y: number, pts: { x: number; y: number }[]) => {   // even-odd rule
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
const CARS: Box[] = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, x: 3.2 + (i % 5) * 1.6, z: 4 + Math.floor(i / 5) * 2.3, w: 0.9, d: 1.5, h: 0.55 }));
const TREES = Array.from({ length: 16 }, (_, i) => {
  const a = hash(i) * Math.PI * 2, r = 15.5 + hash(i + 50) * 3;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r * 0.75, s: 0.55 + hash(i + 90) * 0.4 };
});
const GRASS = Array.from({ length: 160 }, (_, i) => ({ x: (hash(i + 400) - 0.5) * 44, z: (hash(i + 700) - 0.5) * 34 }));

export default function NotFoundPage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const [stats, setStats] = useState({ bay: 1, out: 2, next: 0, air: 0 });
  const modeRef = useRef(mode); modeRef.current = mode;
  const router = useRouter();
  const [hovered, setHovered] = useState<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  const wake = useRef(() => {});                           // asks the canvas to redraw (still frames under reduced motion)
  const goRef = useRef<(key: string) => void>(() => {});   // zoom into a department, then open its page
  const setHover = (k: string | null) => { if (hoverRef.current !== k) { hoverRef.current = k; setHovered(k); wake.current(); } };
  const routerRef = useRef(router); routerRef.current = router;

  useEffect(() => {
    const cv = canvas.current!, ctx = cv.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1, raf = 0, last = performance.now(), simT = 3, statsAt = 0;
    let yaw = -0.62, vYaw = 0, drag: { x: number; y: number; moved: number; touch: boolean } | null = null, dirty = true;
    let hits: { key: string; pts: { x: number; y: number }[] }[] = [];
    let zoom: { dept: Dept; t0: number } | null = null, navTimer = 0;
    wake.current = () => { dirty = true; };
    const PITCH = 0.62, cp = Math.cos(PITCH), sp = Math.sin(PITCH);

    const resize = () => {
      const r = cv.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; dirty = true;
    };
    const ro = new ResizeObserver(resize); ro.observe(cv); resize();

    const frame = () => {
      const T: Theme = THEMES[modeRef.current];
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      // The campus fits the space under the text: about the lower 55% of the screen.
      const S = Math.min(W / (W < 640 ? 33 : 46), (H * 0.55) / 22), CX = W / 2, CY = H * 0.67;
      const rot = (x: number, z: number) => [x * cy - z * sy, x * sy + z * cy];
      const P = ([x, y, z]: V) => { const [xr, zr] = rot(x, z); return { x: CX + xr * S, y: CY + (zr * sp - y * cp) * S, d: zr * cp + y * sp }; };
      const facing = (nx: number, nz: number, ny = 0) => { const [, nzr] = rot(nx, nz); return nzr * cp + ny * sp > 0.001; };
      const hov = hoverRef.current;
      const items: Item[] = [];
      const poly = (pts: V[], fill: string | null, stroke: string | null, lw = 1) => (c: CanvasRenderingContext2D) => {
        c.beginPath(); pts.forEach((v, i) => { const q = P(v); i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); }); c.closePath();
        if (fill) { c.fillStyle = fill; c.fill(); }
        if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.lineJoin = "round"; c.stroke(); }
      };
      const avgDepth = (pts: V[]) => pts.reduce((s, v) => s + P(v).d, 0) / pts.length;

      // An oriented box: footprint centred on (cx, cz), length along `ang`. Visible faces become depth-sorted items.
      const obox = (cx: number, cz: number, len: number, wid: number, h: number, y0: number, ang: number,
                    o: { win?: [number, number]; id?: number; cross?: boolean; tone?: number; pick?: string } = {}) => {
        const hot = !!o.pick && o.pick === hov;
        const edge = hot ? T.hi : T.line, edgeW = hot ? 1.8 : 1;
        const ca = Math.cos(ang), sa = Math.sin(ang), hl = len / 2, hw = wid / 2, y1 = y0 + h;
        const at = (u: number, v: number, y: number): V => [cx + u * ca - v * sa, y, cz + u * sa + v * ca];
        const c = [at(-hl, -hw, 0), at(hl, -hw, 0), at(hl, hw, 0), at(-hl, hw, 0)];
        const top: V[] = c.map(([x, , z]) => [x, y1, z] as V);
        if (facing(0, 0, 1)) items.push({ depth: avgDepth(top) + 0.01, draw: poly(top, hot ? T.hiTop : T.top, edge, edgeW), pick: o.pick, shape: top });
        for (let i = 0; i < 4; i++) {
          const a = c[i], b = c[(i + 1) % 4];
          const nx = (b[2] - a[2]), nz = -(b[0] - a[0]);              // outward normal of this wall
          if (!facing(nx, nz)) continue;
          const face: V[] = [[a[0], y0, a[2]], [b[0], y0, b[2]], [b[0], y1, b[2]], [a[0], y1, a[2]]];
          const [nxr] = rot(nx / Math.hypot(nx, nz), nz / Math.hypot(nx, nz));
          const fill = hot ? T.hiSide : nxr > 0 ? T.sideB : T.sideA;
          items.push({
            depth: avgDepth(face), pick: o.pick, shape: face, draw: (g) => {
              poly(face, fill, edge, edgeW)(g);
              if (o.win) {                                       // window grid; some lit, each on its own schedule
                const [rows, cols] = o.win, edge = Math.round(Math.hypot(b[0] - a[0], b[2] - a[2]) / Math.max(len, wid) * cols) || 1;
                for (let r = 0; r < rows; r++) for (let k = 0; k < edge; k++) {
                  const u0 = (k + 0.25) / edge, u1 = (k + 0.75) / edge, v0 = y0 + (r + 0.3) / rows * h, v1 = y0 + (r + 0.72) / rows * h;
                  const pt = (u: number, y: number): V => [lerp(a[0], b[0], u), y, lerp(a[2], b[2], u)];
                  const on = lit((o.id || 0) * 1000 + i * 100 + r * 10 + k, simT);
                  poly([pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v1)], on ? T.lit : null, T.dim, 0.8)(g);
                }
              }
              if (o.cross && i === 2) {                          // red cross on the ED front wall
                const m = (u: number, y: number): V => [lerp(a[0], b[0], u), y, lerp(a[2], b[2], u)];
                const midU = 0.5, yC = y0 + h * 0.62, s = 0.32 / Math.hypot(b[0] - a[0], b[2] - a[2]);
                g.strokeStyle = "#E5484D"; g.lineWidth = 3; g.lineCap = "round"; g.beginPath();
                let q1 = P(m(midU - s, yC)), q2 = P(m(midU + s, yC)); g.moveTo(q1.x, q1.y); g.lineTo(q2.x, q2.y);
                q1 = P(m(midU, yC - 0.32)); q2 = P(m(midU, yC + 0.32)); g.moveTo(q1.x, q1.y); g.lineTo(q2.x, q2.y); g.stroke();
              }
            },
          });
        }
      };

      // Ground layer (not sorted). There is no ground plate: the page background is the ground, so the scene has no
      // edge. Grass ticks thin out with distance; the ring road, its dashed centre line and the car park lines.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
      // Zooming into a department: scale about its sign's anchor and slide that point to the screen centre.
      const zf = zoom ? smooth((performance.now() - zoom.t0) / 520) : 0;
      if (zoom) {
        const a = P(zoom.dept.anchor), k = 1 + zf * 2.2, tx = lerp(a.x, W / 2, zf), ty = lerp(a.y, H * 0.55, zf);
        ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (tx - a.x * k), dpr * (ty - a.y * k));
      }
      ctx.strokeStyle = T.dim; ctx.lineWidth = 1;
      for (const g of GRASS) {
        const q = P([g.x, 0, g.z]);
        ctx.globalAlpha = 1 - smooth((Math.hypot(g.x / 22, g.z / 17) - 0.45) / 0.55);
        ctx.beginPath(); ctx.moveTo(q.x - 3, q.y); ctx.quadraticCurveTo(q.x, q.y - 2, q.x + 3, q.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const ring = (o: number): V[] => [[-13 - o, 0, -9 - o], [13 + o, 0, -9 - o], [13 + o, 0, 9 + o], [-13 - o, 0, 9 + o]];
      poly(ring(0.9), T.road, T.dim)(ctx); poly(ring(-0.9), T.bg, T.dim)(ctx);
      poly([[-3.8, 0, 6.2], [-2.2, 0, 6.2], [-2.2, 0, 9], [-3.8, 0, 9]], T.road, T.dim)(ctx);       // spur to the bay
      ctx.setLineDash([5, 7]); poly(ring(0), null, T.dim)(ctx); ctx.setLineDash([]);
      for (let i = 0; i <= 5; i++) { const x = 2.4 + i * 1.6; poly([[x, 0, 3.6], [x, 0, 8.4]], null, T.dim)(ctx); }

      // Campus.
      for (const b of BUILDINGS) obox(b.x + b.w / 2, b.z + b.d / 2, b.w, b.d, b.h, b.y0 || 0, 0, { win: b.win, id: b.id, cross: b.cross, pick: DEPT_OF.get(b.id) });
      for (const c of CARS) obox(c.x + c.w / 2, c.z + c.d / 2, c.w, c.d, c.h, 0, 0);
      // Canopy posts.
      for (const [x, z] of [[-4.1, 7.5], [-1.9, 7.5]] as [number, number][]) {
        const pts: V[] = [[x, 0, z], [x, 2.0, z]]; items.push({ depth: avgDepth(pts), draw: poly(pts, null, T.line) });
      }
      // Helipad on the tower roof.
      const padPts: V[] = Array.from({ length: 28 }, (_, i) => [PAD[0] + Math.cos(i / 28 * Math.PI * 2) * 2.1, PAD[1] - 0.04, PAD[2] + Math.sin(i / 28 * Math.PI * 2) * 2.1] as V);
      const padHot = hov === "helipad";
      items.push({
        depth: avgDepth(padPts) + 0.02, pick: "helipad", shape: padPts, draw: (g) => {
          poly(padPts, padHot ? T.hiTop : null, padHot ? T.hi : T.line, padHot ? 2 : 1)(g);
          const hp = (x: number, z: number): V => [PAD[0] + x, PAD[1] - 0.04, PAD[2] + z];
          for (const seg of [[hp(-0.7, -0.9), hp(-0.7, 0.9)], [hp(0.7, -0.9), hp(0.7, 0.9)], [hp(-0.7, 0), hp(0.7, 0)]]) poly(seg, null, padHot ? T.hi : T.line, 1.6)(g);
        },
      });
      // Trees: a trunk and a round crown, billboarded.
      for (const tr of TREES) {
        const base = P([tr.x, 0, tr.z]), top = P([tr.x, 1.6 * tr.s, tr.z]);
        items.push({
          depth: base.d, draw: (g) => {
            g.strokeStyle = T.line; g.lineWidth = 1; g.beginPath(); g.moveTo(base.x, base.y); g.lineTo(top.x, top.y); g.stroke();
            g.beginPath(); g.arc(top.x, top.y - 0.55 * S * tr.s, 0.75 * S * tr.s, 0, Math.PI * 2); g.fillStyle = T.top; g.fill(); g.stroke();
          },
        });
      }

      // --- Vehicles: solids built from faces in local coordinates (u forward, v right, y up). Each face is
      // painter-sorted on its own and shaded by which way it points; `after` draws details onto a face.
      type L = [number, number, number];
      type F = { p: L[]; fill?: string; after?: (g: CanvasRenderingContext2D, at: (l: L) => V) => void };
      const solid = (cx: number, cz: number, ang: number, y0: number, faces: F[]) => {
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const at = ([u, v, y]: L): V => [cx + u * ca - v * sa, y0 + y, cz + u * sa + v * ca];
        for (const f of faces) {
          const pts = f.p.map(at);
          let nx = 0, ny = 0, nz = 0;                       // Newell normal (only its direction matters here)
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
          }
          const n = Math.hypot(nx, ny, nz) || 1, [rx, rz] = rot(nx, nz);
          const fill = f.fill ?? (Math.abs(ny) / n > 0.6 ? T.top : Math.abs(rx) > Math.abs(rz) ? T.sideB : T.sideA);
          items.push({ depth: avgDepth(pts), draw: (g) => { poly(pts, fill, T.line)(g); f.after?.(g, at); } });
        }
        return at;
      };
      // A six-sided block from a bottom and a top quad (they may differ: tapers, slopes). Bottom is never seen.
      const block = (b: L[], t: L[], side: (i: number) => Partial<F> = () => ({}), top: Partial<F> = {}): F[] => [
        { p: t, ...top },
        ...[0, 1, 2, 3].map(i => ({ p: [b[i], b[(i + 1) % 4], t[(i + 1) % 4], t[i]], ...side(i) })),
      ];
      const seg = (g: CanvasRenderingContext2D, a: V, b: V, color: string, w = 1.2) => {
        const p1 = P(a), p2 = P(b); g.strokeStyle = color; g.lineWidth = w; g.lineCap = "round";
        g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke();
      };
      const line = (a: V, b: V, color = T.line, w = 1.2, bias = 0) =>
        items.push({ depth: (P(a).d + P(b).d) / 2 + bias, draw: (g) => seg(g, a, b, color, w) });

      // Ambulances: box body with a red stripe and cross on both sides, a lower cab with a sloped windscreen,
      // a light bar that flashes red/blue while driving, four wheels.
      let bay = 0, out = 0, next = Infinity;
      for (let k = 0; k < AMBULANCES; k++) {
        const a = ambulance(simT, k);
        if (a.inBay) bay++; else { out++; next = Math.min(next, a.toArrive); }
        const flash = !a.inBay && Math.floor(simT * 5 + k) % 2 === 0;
        const ca = Math.cos(a.ang), sa = Math.sin(a.ang);
        const wheelAt = (u: number, v: number): V => [a.x + u * ca - v * sa, 0.17, a.z + u * sa + v * ca];
        for (const [u, v] of [[-0.62, -0.41], [-0.62, 0.41], [0.6, -0.41], [0.6, 0.41]]) {
          const c = wheelAt(u, v), q = P(c);
          items.push({ depth: q.d - 0.2, draw: (g) => { g.fillStyle = T.tyre; g.strokeStyle = T.line; g.lineWidth = 1; g.beginPath(); g.ellipse(q.x, q.y, 0.2 * S, 0.15 * S, 0, 0, Math.PI * 2); g.fill(); g.stroke(); } });
        }
        const markings = (i: number): Partial<F> => (i === 0 || i === 2 ? {
          fill: T.body,
          after: (g, at) => {
            const v = i === 0 ? -0.401 : 0.401;
            seg(g, at([-0.92, v, 0.5]), at([0.28, v, 0.5]), "#E5484D", 2.2);              // stripe
            seg(g, at([-0.38, v, 0.62]), at([-0.38, v, 0.88]), "#E5484D", 2.2);           // cross
            seg(g, at([-0.51, v, 0.75]), at([-0.25, v, 0.75]), "#E5484D", 2.2);
          },
        } : { fill: T.body });
        solid(a.x, a.z, a.ang, 0, [
          ...block([[-0.95, -0.4, 0.17], [0.3, -0.4, 0.17], [0.3, 0.4, 0.17], [-0.95, 0.4, 0.17]],
                   [[-0.95, -0.4, 0.98], [0.3, -0.4, 0.98], [0.3, 0.4, 0.98], [-0.95, 0.4, 0.98]], markings, { fill: T.body }),
          ...block([[0.3, -0.38, 0.17], [0.92, -0.38, 0.17], [0.92, 0.38, 0.17], [0.3, 0.38, 0.17]],
                   [[0.3, -0.36, 0.74], [0.62, -0.34, 0.68], [0.62, 0.34, 0.68], [0.3, 0.36, 0.74]],
                   (i) => (i === 1 ? { fill: T.glass } : { fill: T.body }), { fill: T.body }),
          ...block([[0.1, -0.3, 0.98], [0.27, -0.3, 0.98], [0.27, 0.3, 0.98], [0.1, 0.3, 0.98]],
                   [[0.1, -0.3, 1.07], [0.27, -0.3, 1.07], [0.27, 0.3, 1.07], [0.1, 0.3, 1.07]],
                   () => ({}), { fill: a.inBay ? T.top : flash ? "#E5484D" : "#4C8DF6" }),
        ]);
        if (!a.inBay) {
          const bp = P([a.x + 0.18 * ca, 1.1, a.z + 0.18 * sa]);
          items.push({ depth: bp.d + 0.5, draw: (g) => {
            g.fillStyle = flash ? "#E5484D" : "#4C8DF6"; g.globalAlpha = 0.22;
            g.beginPath(); g.arc(bp.x, bp.y, 0.3 * S, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
          } });
        }
      }

      // Medevac helicopter: cabin with a glazed tapered nose, tapering tail boom, fin and tail rotor, skids on
      // struts, mast and a two-blade rotor (a faint disc when it spins fast). Shadow only when over open ground.
      const hc = helicopter(simT), [hx, hy, hz] = hc.p;
      const overBuilding = BUILDINGS.some(b => hx > b.x && hx < b.x + b.w && hz > b.z && hz < b.z + b.d);
      if (!overBuilding) {
        const sh = P([hx, 0, hz]);
        items.push({ depth: -1e3, draw: (g) => { g.fillStyle = T.shadow; g.beginPath(); g.ellipse(sh.x, sh.y, 1.3 * S, 0.5 * S, 0, 0, Math.PI * 2); g.fill(); } });
      }
      const hAt = solid(hx, hz, hc.heading, hy, [
        ...block([[-0.55, -0.3, 0.28], [0.35, -0.3, 0.28], [0.35, 0.3, 0.28], [-0.55, 0.3, 0.28]],
                 [[-0.45, -0.25, 0.88], [0.18, -0.25, 0.88], [0.18, 0.25, 0.88], [-0.45, 0.25, 0.88]],
                 (i) => ({ fill: T.body, after: i === 0 || i === 2 ? (g, at) => {
                   const v = i === 0 ? -0.29 : 0.29;                      // side window + red cross
                   poly([at([0.0, v, 0.5]), at([0.28, v, 0.5]), at([0.2, v, 0.76]), at([0.0, v, 0.76])], T.glass, T.line)(g);
                   seg(g, at([-0.3, v, 0.45]), at([-0.3, v, 0.71]), "#E5484D", 2); seg(g, at([-0.43, v, 0.58]), at([-0.17, v, 0.58]), "#E5484D", 2);
                 } : undefined }), { fill: T.body }),
        ...block([[0.35, -0.3, 0.28], [0.86, -0.15, 0.3], [0.86, 0.15, 0.3], [0.35, 0.3, 0.28]],
                 [[0.18, -0.25, 0.88], [0.64, -0.12, 0.6], [0.64, 0.12, 0.6], [0.18, 0.25, 0.88]],
                 (i) => ({ fill: i === 3 ? T.body : T.glass }), { fill: T.glass }),
        ...block([[-0.5, -0.1, 0.48], [-2.0, -0.04, 0.62], [-2.0, 0.04, 0.62], [-0.5, 0.1, 0.48]],
                 [[-0.5, -0.1, 0.76], [-2.0, -0.04, 0.73], [-2.0, 0.04, 0.73], [-0.5, 0.1, 0.76]], () => ({ fill: T.body }), { fill: T.body }),
        { p: [[-1.82, 0, 0.68], [-2.04, 0, 0.68], [-2.16, 0, 1.18], [-1.98, 0, 1.18]], fill: T.body },
      ]);
      const L3 = (u: number, v: number, y: number): V => hAt([u, v, y]);
      for (const v of [-0.36, 0.36]) {                             // skids and struts
        line(L3(-0.62, v, 0), L3(0.66, v, 0)); line(L3(0.66, v, 0), L3(0.78, v, 0.1));
        line(L3(-0.3, v, 0), L3(-0.3, v * 0.8, 0.3)); line(L3(0.3, v, 0), L3(0.25, v * 0.8, 0.3));
      }
      line(L3(-0.12, 0, 0.88), L3(-0.12, 0, 1.04), T.line, 1.6, 0.2);   // mast
      const spin = simT * (hc.rotor > 0.5 ? 24 : 2.5);
      const fast = hc.rotor > 0.5;
      const hub = L3(-0.12, 0, 1.04);
      const blade = (a: number, r: number): V => [hub[0] + Math.cos(a) * r, hub[1], hub[2] + Math.sin(a) * r];
      items.push({ depth: P(hub).d + 2, draw: (g) => {
        if (fast) {                                                // motion blur disc
          const disc = Array.from({ length: 32 }, (_, i) => blade((i / 32) * Math.PI * 2, 1.8));
          g.globalAlpha = 0.12; poly(disc, T.heli, null)(g); g.globalAlpha = 0.35; poly(disc, null, T.heli)(g); g.globalAlpha = 1;
        }
        for (const off of [0, Math.PI]) seg(g, hub, blade(spin + off, 1.8), T.heli, fast ? 1 : 1.6);
      } });
      const tr = L3(-2.02, 0.07, 0.92);                              // tail rotor, spinning in its own plane
      for (const off of [0, Math.PI]) {
        const a = spin * 1.6 + off, e = L3(-2.02 + Math.cos(a) * 0.24, 0.07, 0.92 + Math.sin(a) * 0.24);
        line(tr, e, T.heli, 1, 0.1);
      }

      items.sort((p, q) => p.depth - q.depth);
      for (const it of items) it.draw(ctx);
      hits = items.filter(it => it.pick && it.shape).map(it => ({ key: it.pick!, pts: it.shape!.map(P) }));
      // Fade the far ground into the page (an ellipse matching the ground's perspective).
      ctx.save(); ctx.translate(CX, CY); ctx.scale(1, 0.62);
      const fade = ctx.createRadialGradient(0, 0, 15.5 * S, 0, 0, 24 * S);
      fade.addColorStop(0, T.bg + "00"); fade.addColorStop(1, T.bg);
      ctx.fillStyle = fade; ctx.fillRect(-W, -H / 0.62, 2 * W, (2 * H) / 0.62); ctx.restore();

      // Wayfinding: a small marker over every department; the hovered one gets its sign.
      const pulse = reduce ? 0 : (Math.sin(performance.now() / 420) + 1) / 2;
      for (const d of DEPTS) {
        const q = P(d.anchor), on = d.key === hov;
        ctx.globalAlpha = zoom ? 1 - zf : 1;
        ctx.strokeStyle = T.hi; ctx.fillStyle = T.hi; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(q.x, q.y, on ? 5 : 3.5 + pulse * 1.5, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(q.x, q.y, on ? 2.6 : 1.6, 0, Math.PI * 2); ctx.fill();
        if (on && !zoom) {
          const label = `${d.name.toUpperCase()}  ·  ${d.page} →`;
          ctx.font = '600 12px "JetBrains Mono", ui-monospace, monospace';
          const tw = ctx.measureText(label).width, bw = tw + 22, bh = 28;
          const bx = Math.min(Math.max(8, q.x - bw / 2), W - bw - 8), by = q.y - bh - 16;
          ctx.strokeStyle = T.hi; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(q.x, q.y - 5); ctx.lineTo(q.x, by + bh); ctx.stroke();
          ctx.fillStyle = T.signBg; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 6); ctx.fill(); ctx.stroke();
          ctx.fillStyle = T.signFg; ctx.textBaseline = "middle"; ctx.fillText(label, bx + 11, by + bh / 2 + 0.5);
        }
      }
      ctx.globalAlpha = 1;
      if (zoom) {                                              // the page fades out as the camera arrives
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = smooth((zf - 0.55) / 0.45);
        ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
        if (zf >= 1) { const href = zoom.dept.href; zoom = null; clearTimeout(navTimer); routerRef.current.push(href); }
      }
      return { bay, out, next: Number.isFinite(next) ? Math.ceil(next) : 0, air: hc.flying ? 1 : 0 };
    };

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!reduce) simT += dt;
      if (!drag) { yaw += vYaw; vYaw *= 0.93; }
      if (!reduce || dirty || zoom || Math.abs(vYaw) > 1e-4 || drag) {
        const s = frame(); dirty = false;
        if (now - statsAt > 250) { statsAt = now; setStats(prev => (prev.bay === s.bay && prev.out === s.out && prev.next === s.next && prev.air === s.air ? prev : s)); }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const pickAt = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      for (let i = hits.length - 1; i >= 0; i--) if (pointIn(x, y, hits[i].pts)) return hits[i].key;   // top-most first
      return null;
    };
    goRef.current = (key: string) => {
      const dept = DEPTS.find(d => d.key === key);
      if (!dept || zoom) return;
      if (reduce) { routerRef.current.push(dept.href); return; }
      setHover(key); zoom = { dept, t0: performance.now() };
      // The zoom advances on painted frames; if none come (background tab), open the page anyway.
      navTimer = window.setTimeout(() => { if (zoom) { const href = zoom.dept.href; zoom = null; routerRef.current.push(href); } }, 800);
    };
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, moved: 0, touch: e.pointerType === "touch" }; vYaw = 0;
    };
    const move = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.x; drag.moved += Math.abs(dx) + Math.abs(e.clientY - drag.y);
        drag.x = e.clientX; drag.y = e.clientY; vYaw = dx * 0.008; yaw += vYaw; dirty = true;
        return;
      }
      const k = pickAt(e); setHover(k); cv.style.cursor = k ? "pointer" : "grab";
    };
    const up = (e: PointerEvent) => {
      const d = drag; drag = null;
      if (!d || d.moved > 6) return;                           // a drag turns the campus; it never opens a page
      const k = pickAt(e);
      if (!k) { setHover(null); return; }
      if (d.touch && hoverRef.current !== k) { setHover(k); return; }   // touch: first tap shows the sign
      goRef.current(k);
    };
    const leave = () => { if (!drag) setHover(null); };
    cv.addEventListener("pointerleave", leave);
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", () => { drag = null; });
    const redraw = () => { dirty = true; };
    window.addEventListener("cb-404-theme", redraw);
    return () => {
      cancelAnimationFrame(raf); clearTimeout(navTimer); ro.disconnect(); window.removeEventListener("cb-404-theme", redraw);
      cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointerleave", leave);
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { window.dispatchEvent(new Event("cb-404-theme")); }, [mode]);

  const T = THEMES[mode];
  const mono = "font-mono uppercase tracking-[0.14em]";
  return (
    <main className="relative min-h-[100svh] w-full overflow-hidden select-none" style={{ background: T.bg, color: T.text }}>
      <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing touch-none" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-5 pt-4 text-[12px]" style={{ color: T.muted }}>
        <button type="button" onClick={() => setMode(m => (m === "dark" ? "light" : "dark"))}
          className="pointer-events-auto font-mono tracking-[0.06em] hover:underline underline-offset-4">
          {mode === "dark" ? "Dark" : "Light"}
        </button>
        <span className={mono}>St. 404 General</span>
      </div>

      <div className="pointer-events-none relative z-10 flex flex-col items-center px-6 pt-[9vh] text-center">
        <h1 className="font-mono font-medium leading-none tracking-[0.04em] text-[clamp(64px,13vw,128px)]">404</h1>
        <p className="mt-5 font-mono text-[clamp(14px,2.2vw,20px)] tracking-[0.03em]" style={{ color: T.muted }}>
          This page was discharged without a follow-up.
        </p>
        <Link href="/" className={`pointer-events-auto mt-7 px-6 py-3 text-[13px] font-semibold ${mono} transition-transform hover:-translate-y-0.5 motion-reduce:transition-none`}
          style={{ background: T.btnBg, color: T.btnFg }}>
          Back to reception
        </Link>
      </div>

      {/* Hospital directory: every department as a real link. Hover or focus highlights its building. */}
      <nav aria-label="Hospital directory"
        className="absolute z-10 inset-x-0 bottom-16 px-5 sm:bottom-12 lg:inset-x-auto lg:bottom-auto lg:left-5 lg:top-1/2 lg:-translate-y-1/2 lg:px-0">
        <p className={`mb-2 text-[11px] ${mono}`} style={{ color: T.muted }}>Hospital directory</p>
        <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-col lg:gap-1 lg:overflow-visible">
          {DEPTS.map(d => {
            const on = hovered === d.key;
            return (
              <li key={d.key} className="shrink-0">
                <Link href={d.href}
                  onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(d.key)} onBlur={() => setHover(null)}
                  onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); goRef.current(d.key); }}
                  className="flex items-baseline gap-2 whitespace-nowrap rounded-md border px-2.5 py-1.5 font-mono text-[11px] tracking-[0.06em] transition-colors motion-reduce:transition-none"
                  style={{ borderColor: on ? T.hi : "transparent", background: on ? T.signBg : "transparent", color: on ? T.signFg : T.text }}>
                  <span className="uppercase">{d.name}</span>
                  <span style={{ color: on ? T.hi : T.muted }}>{d.page} →</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={`pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-start gap-1 px-5 pb-4 text-[12px] sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${mono}`} style={{ color: T.muted }}>
        <span>Drag to turn · tap or click a building to visit</span>
        <span className="normal-case tracking-[0.06em] tabular-nums" aria-live="off">
          in bay {stats.bay} · en route {stats.out} · next arrival {stats.next}s<span className="hidden sm:inline"> · air {stats.air}</span>
        </span>
      </div>
    </main>
  );
}
