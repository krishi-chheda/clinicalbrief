"use client";
// Phase 9: system health for admins and auditors. Live dependency checks plus request metrics from the backend's
// in-memory telemetry (route templates only; no patient ids, queries or note text). Refreshes every 15 s while visible.
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { formatCount } from "../lib/clinical";

type Api = (path: string, init?: RequestInit) => Promise<Response>;
interface Check { name: string; ok: boolean; latency_ms: number | null; detail: string; note?: string }
interface Health { status: "ok" | "degraded" | "down"; version: string; uptime_s: number; checks: Check[] }
interface Stats { count: number; client_errors: number; server_errors: number; p50_ms: number | null; p95_ms: number | null; max_ms: number | null }
interface Metrics {
  window_s: number | null; uptime_s: number; events_in_memory: number; overall: Stats; per_minute: number[];
  routes: (Stats & { method: string; route: string })[];
  recent_server_errors: { at: number; method: string; route: string; status: number; ms: number; request_id: string }[];
}

const WINDOWS = [{ s: 900, label: "Last 15 min" }, { s: 3600, label: "Last hour" }, { s: 0, label: "Since restart" }];
const CHECK_LABEL: Record<string, string> = { database: "Database", local_llm: "Local AI model", search_index: "Search index" };
const ms = (v: number | null) => (v == null ? "—" : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`);
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
const uptime = (s: number) => (s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`);

// Status is never colour alone: icon + word + colour.
const STATUS = {
  ok: { label: "All systems working", cls: "bg-green-50 text-green-800 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-900", Icon: CheckCircle2 },
  degraded: { label: "Degraded", cls: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900", Icon: AlertTriangle },
  down: { label: "Down", cls: "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900", Icon: XCircle },
};

function Tile({ title, value, note }: { title: string; value: string; note?: string }) {
  return (
    <div className="premium-card p-4">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</p>
      <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1 tabular-nums">{value}</p>
      {note && <p className="text-xs text-slate-500 mt-1">{note}</p>}
    </div>
  );
}

// Requests per minute: one series, one hue, thin rounded bars with a 2px gap, per-bar tooltip, recessive baseline.
function Throughput({ perMinute }: { perMinute: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...perMinute);
  const n = perMinute.length;
  return (
    <div className="relative">
      <div className="flex items-end gap-[2px] h-28 border-b border-slate-200 dark:border-slate-800" role="img"
        aria-label={`Requests per minute over the last ${n} minutes; peak ${max}.`}>
        {perMinute.map((v, i) => (
          <div key={i} className="flex-1 h-full flex items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className={`w-full rounded-t-[4px] ${hover === i ? "bg-blue-800 dark:bg-blue-300" : "bg-blue-600 dark:bg-blue-400"}`}
              style={{ height: v ? `${Math.max(3, (v / max) * 100)}%` : "0" }} />
          </div>
        ))}
      </div>
      {hover != null && (
        <div className="absolute -top-2 -translate-y-full px-2 py-1 rounded-md bg-slate-900 text-white text-xs tabular-nums pointer-events-none whitespace-nowrap"
          style={{ left: `${((hover + 0.5) / n) * 100}%`, transform: "translate(-50%, -100%)" }}>
          {n - 1 - hover === 0 ? "This minute" : `${n - 1 - hover} min ago`}: {perMinute[hover]} requests
        </div>
      )}
      <div className="mt-1 flex justify-between text-[11px] text-slate-500"><span>{n} min ago</span><span>now</span></div>
    </div>
  );
}

export default function SystemHealth({ api }: { api: Api }) {
  const [win, setWin] = useState(900);
  const [health, setHealth] = useState<Health | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // In an outage the health request itself fails (signing in needs the database), so a network error or a 5xx
  // means "down / unreachable" rather than just an error message.
  const [unreachable, setUnreachable] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let h: Response, m: Response;
      try {
        [h, m] = await Promise.all([api("/api/v1/ops/health"), api(`/api/v1/ops/metrics?window=${win}`)]);
      } catch {
        setUnreachable("The backend did not respond. It may be stopped or unreachable.");
        return;
      }
      if (h.status >= 500 || m.status >= 500) {
        setUnreachable(`The backend answered with an error (HTTP ${h.status >= 500 ? h.status : m.status}); the database or the app may be down.`);
        return;
      }
      setUnreachable(null);
      if (!h.ok || !m.ok) throw new Error(h.status === 403 || m.status === 403 ? "System health is available to administrators and auditors." : `Request failed (HTTP ${h.ok ? m.status : h.status}).`);
      setHealth(await h.json());
      setMetrics(await m.json());
      setError(null);
      setUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load system health.");
    } finally {
      setLoading(false);
    }
  }, [api, win]);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const s = health ? STATUS[health.status] : null;
  const o = metrics?.overall;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">System health</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-3xl">
            Live checks of the database, the local AI model and the search index, plus request timing from this backend
            process. Metrics record route patterns only (never patient ids, search text or notes) and reset when the backend restarts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="sh-window" className="sr-only">Time window</label>
          <select id="sh-window" value={win} onChange={e => setWin(Number(e.target.value))} className="px-3 py-2 rounded-lg premium-input text-sm">
            {WINDOWS.map(w => <option key={w.s} value={w.s}>{w.label}</option>)}
          </select>
          <button onClick={load} disabled={loading} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>

      {unreachable && (
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${STATUS.down.cls}`} role="alert">
          <span className="flex items-center gap-2 font-semibold"><XCircle className="h-5 w-5" aria-hidden="true" /> Down or unreachable</span>
          <span className="text-xs">{unreachable}{updated ? ` Last good check ${updated.toLocaleTimeString()}; figures below are from then.` : ""}</span>
        </div>
      )}

      {error && <div role="alert" className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300">{error}</div>}

      {health && s && !unreachable && (
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${s.cls}`} role="status">
          <span className="flex items-center gap-2 font-semibold"><s.Icon className="h-5 w-5" aria-hidden="true" /> {s.label}</span>
          <span className="text-xs">Version {health.version} · up {uptime(health.uptime_s)}{updated ? ` · checked ${updated.toLocaleTimeString()}` : ""}</span>
        </div>
      )}

      {health && (
        <div className="grid gap-4 md:grid-cols-3">
          {health.checks.map(c => (
            <div key={c.name} className="premium-card p-4 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900 dark:text-white">{CHECK_LABEL[c.name] ?? c.name}</span>
                <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md ${c.ok ? "bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-300" : "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300"}`}>
                  {c.ok ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                  {c.ok ? "Working" : "Unavailable"}
                </span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400 break-words">{c.detail}</p>
              {c.latency_ms != null && <p className="text-xs text-slate-500 tabular-nums">Check took {ms(c.latency_ms)}</p>}
              {!c.ok && c.note && <p className="text-xs text-slate-500">{c.note}</p>}
            </div>
          ))}
        </div>
      )}

      {metrics && o && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Tile title="Requests" value={formatCount(o.count)} note={WINDOWS.find(w => w.s === win)?.label} />
            <Tile title="Server errors (5xx)" value={pct(o.server_errors, o.count)} note={`${formatCount(o.server_errors)} of ${formatCount(o.count)}`} />
            <Tile title="Median response" value={ms(o.p50_ms)} />
            <Tile title="95th percentile" value={ms(o.p95_ms)} note={`slowest ${ms(o.max_ms)}`} />
          </div>

          <div className="premium-card p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Requests per minute</h2>
            <Throughput perMinute={metrics.per_minute} />
          </div>

          <div className="premium-card overflow-hidden">
            <h2 className="px-5 pt-4 pb-2 text-sm font-semibold text-slate-900 dark:text-white">By endpoint</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100 dark:border-slate-800">
                    <th className="px-5 py-2 font-semibold">Endpoint</th>
                    <th className="px-3 py-2 font-semibold text-right">Requests</th>
                    <th className="px-3 py-2 font-semibold text-right">4xx</th>
                    <th className="px-3 py-2 font-semibold text-right">5xx</th>
                    <th className="px-3 py-2 font-semibold text-right">Median</th>
                    <th className="px-3 py-2 font-semibold text-right">p95</th>
                    <th className="px-5 py-2 font-semibold text-right">Slowest</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 tabular-nums">
                  {metrics.routes.length === 0 && <tr><td colSpan={7} className="px-5 py-6 text-center text-slate-500">No requests in this window yet.</td></tr>}
                  {metrics.routes.map(r => (
                    <tr key={`${r.method} ${r.route}`}>
                      <td className="px-5 py-2 font-mono text-xs whitespace-nowrap"><span className="text-slate-500 mr-2">{r.method}</span>{r.route}</td>
                      <td className="px-3 py-2 text-right">{formatCount(r.count)}</td>
                      <td className="px-3 py-2 text-right">{r.client_errors || "—"}</td>
                      <td className={`px-3 py-2 text-right ${r.server_errors ? "font-semibold text-red-700 dark:text-red-300" : ""}`}>{r.server_errors || "—"}</td>
                      <td className="px-3 py-2 text-right">{ms(r.p50_ms)}</td>
                      <td className="px-3 py-2 text-right">{ms(r.p95_ms)}</td>
                      <td className="px-5 py-2 text-right">{ms(r.max_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="premium-card overflow-hidden">
            <h2 className="px-5 pt-4 pb-2 text-sm font-semibold text-slate-900 dark:text-white">Recent server errors</h2>
            {metrics.recent_server_errors.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-slate-500">None in this window.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100 dark:border-slate-800">
                      <th className="px-5 py-2 font-semibold">Time</th><th className="px-3 py-2 font-semibold">Endpoint</th>
                      <th className="px-3 py-2 font-semibold">Status</th><th className="px-3 py-2 font-semibold text-right">Took</th>
                      <th className="px-5 py-2 font-semibold">Request id</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 tabular-nums">
                    {metrics.recent_server_errors.map(e => (
                      <tr key={e.request_id}>
                        <td className="px-5 py-2 whitespace-nowrap">{new Date(e.at * 1000).toLocaleTimeString()}</td>
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap"><span className="text-slate-500 mr-2">{e.method}</span>{e.route}</td>
                        <td className="px-3 py-2">{e.status}</td>
                        <td className="px-3 py-2 text-right">{ms(e.ms)}</td>
                        <td className="px-5 py-2 font-mono text-xs">{e.request_id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="px-5 pb-4 text-xs text-slate-500">The same request id is written to the backend log, so an error here can be found there.</p>
          </div>

          <p className="text-xs text-slate-500">
            Kept in memory: {formatCount(metrics.events_in_memory)} recent requests (the oldest drop off first). Not a substitute for a
            metrics service; history is lost on restart.
          </p>
        </>
      )}
    </div>
  );
}
