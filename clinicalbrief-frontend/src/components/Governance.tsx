"use client";
// Phase 6: governance numbers for admins and auditors. Every figure is a count of real rows from the backend;
// rates are shares of human decisions (not accuracy) and are shown as "—" until something has been decided.
import React, { useEffect, useState } from "react";
import { formatCount, formatDate } from "../lib/clinical";

type Api = (path: string, init?: RequestInit) => Promise<Response>;
type Counts = { pending: number; approved: number; edited: number; rejected: number };

interface Stats {
  pending: { total: number; under_1_day: number; "1_to_7_days": number; over_7_days: number; oldest_extracted_at: string | null };
  by_type: (Counts & { entity_type: string; decided: number; rates: Record<"approved" | "edited" | "rejected", number | null> })[];
  by_method: Record<string, Partial<Counts>>;
  reviewers: { reviewer: string; action: string; count: number }[];
}
interface HistoryRow { history_id: string; action: string; old_value: string | null; new_value: string | null; timestamp: string; reviewer: string | null; entity_type: string }

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const label = (t: string) => (t === "Disease" ? "Condition" : t);

function Tile({ title, value, note }: { title: string; value: string; note?: string }) {
  return (
    <div className="premium-card p-4">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</p>
      <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1 tabular-nums">{value}</p>
      {note && <p className="text-xs text-slate-500 mt-1">{note}</p>}
    </div>
  );
}

export default function Governance({ api }: { api: Api }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, h] = await Promise.all([api("/api/v1/review/stats"), api("/api/v1/review/history?everyone=true&limit=20")]);
        if (!s.ok) throw new Error(s.status === 403 ? "Governance is available to administrators and auditors." : `HTTP ${s.status}`);
        setStats(await s.json());
        setHistory(h.ok ? await h.json() : []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load governance data.");
      }
    })();
  }, [api]);

  if (error) return <div role="alert" className="premium-card p-6 text-sm text-red-700 dark:text-red-300">{error}</div>;
  if (!stats) return <div className="premium-card p-6 text-sm text-slate-500">Loading governance data...</div>;

  const p = stats.pending;
  const decided = stats.by_type.reduce((n, t) => n + t.decided, 0);
  const reviewers = Array.from(new Set(stats.reviewers.map(r => r.reviewer)));
  const actions = ["approved", "edited", "rejected", "pending"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Governance</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-3xl">
          Human oversight of AI output. All figures are live counts. Approval rates are the share of human decisions,
          not a measure of AI accuracy; the extractor has not been evaluated against labelled data.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile title="Awaiting review" value={formatCount(p.total)} />
        <Tile title="Waiting < 1 day" value={formatCount(p.under_1_day)} />
        <Tile title="1–7 days" value={formatCount(p["1_to_7_days"])} />
        <Tile title="Over 7 days" value={formatCount(p.over_7_days)} note={p.oldest_extracted_at ? `Oldest from ${formatDate(p.oldest_extracted_at)}` : undefined} />
        <Tile title="Human decisions" value={formatCount(decided)} />
      </div>

      <section className="premium-card overflow-x-auto">
        <h2 className="px-5 pt-4 text-base font-semibold text-slate-900 dark:text-white">By finding type</h2>
        <table className="w-full text-sm mt-2">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100 dark:border-slate-800">
              <th className="px-5 py-2 font-semibold">Type</th>
              {["Awaiting", "Approved", "Edited", "Rejected"].map(h => <th key={h} className="px-3 py-2 font-semibold text-right">{h}</th>)}
              {["Approved", "Edited", "Rejected"].map(h => <th key={h} className="px-3 py-2 font-semibold text-right">{h} %</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {stats.by_type.map(t => (
              <tr key={t.entity_type} className="tabular-nums">
                <td className="px-5 py-2 font-medium text-slate-900 dark:text-white">{label(t.entity_type)}</td>
                <td className="px-3 py-2 text-right">{formatCount(t.pending)}</td>
                <td className="px-3 py-2 text-right">{formatCount(t.approved)}</td>
                <td className="px-3 py-2 text-right">{formatCount(t.edited)}</td>
                <td className="px-3 py-2 text-right">{formatCount(t.rejected)}</td>
                <td className="px-3 py-2 text-right">{pct(t.rates.approved)}</td>
                <td className="px-3 py-2 text-right">{pct(t.rates.edited)}</td>
                <td className="px-3 py-2 text-right">{pct(t.rates.rejected)}</td>
              </tr>
            ))}
            {stats.by_type.length === 0 && <tr><td colSpan={8} className="px-5 py-6 text-center text-slate-500">No AI findings yet.</td></tr>}
          </tbody>
        </table>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="premium-card overflow-x-auto">
          <h2 className="px-5 pt-4 text-base font-semibold text-slate-900 dark:text-white">By extraction method</h2>
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100 dark:border-slate-800">
                <th className="px-5 py-2 font-semibold">Method</th>
                {["Awaiting", "Approved", "Edited", "Rejected"].map(h => <th key={h} className="px-3 py-2 font-semibold text-right">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {Object.entries(stats.by_method).map(([m, c]) => (
                <tr key={m} className="tabular-nums">
                  <td className="px-5 py-2 font-medium text-slate-900 dark:text-white">{m}</td>
                  {(["pending", "approved", "edited", "rejected"] as const).map(k => <td key={k} className="px-3 py-2 text-right">{formatCount(c[k] ?? 0)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="premium-card overflow-x-auto">
          <h2 className="px-5 pt-4 text-base font-semibold text-slate-900 dark:text-white">Decisions by reviewer</h2>
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100 dark:border-slate-800">
                <th className="px-5 py-2 font-semibold">Reviewer</th>
                {["Approved", "Edited", "Rejected", "Undone"].map(h => <th key={h} className="px-3 py-2 font-semibold text-right">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {reviewers.map(r => (
                <tr key={r} className="tabular-nums">
                  <td className="px-5 py-2 font-medium text-slate-900 dark:text-white truncate max-w-[16rem]">{r}</td>
                  {actions.map(a => <td key={a} className="px-3 py-2 text-right">{formatCount(stats.reviewers.find(x => x.reviewer === r && x.action === a)?.count ?? 0)}</td>)}
                </tr>
              ))}
              {reviewers.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-center text-slate-500">No review decisions yet.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>

      <section className="premium-card overflow-x-auto">
        <h2 className="px-5 pt-4 text-base font-semibold text-slate-900 dark:text-white">Latest decisions</h2>
        <table className="w-full text-sm mt-2">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100 dark:border-slate-800">
              <th className="px-5 py-2 font-semibold">When</th><th className="px-3 py-2 font-semibold">Reviewer</th>
              <th className="px-3 py-2 font-semibold">Decision</th><th className="px-3 py-2 font-semibold">Type</th><th className="px-3 py-2 font-semibold">Finding</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {history.map(h => (
              <tr key={h.history_id}>
                <td className="px-5 py-2 whitespace-nowrap text-slate-600 dark:text-slate-400">{new Date(h.timestamp).toLocaleString("en-AU")}</td>
                <td className="px-3 py-2 truncate max-w-[14rem]">{h.reviewer ?? "deleted user"}</td>
                <td className="px-3 py-2">{h.action === "pending" ? "undone" : h.action}</td>
                <td className="px-3 py-2">{label(h.entity_type)}</td>
                <td className="px-3 py-2">{h.action === "edited" && h.old_value !== h.new_value ? `${h.old_value} → ${h.new_value}` : h.new_value}</td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-center text-slate-500">No review decisions yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
