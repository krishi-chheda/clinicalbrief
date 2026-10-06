"use client";
// Phase 8a: search every note and the structured record across the patients you may access.
// Results are real rows; the local model may only widen the search terms. Snippets are rendered as text.
import React, { useState } from "react";
import { displayName, formatCount, formatDate, type Patient } from "../lib/clinical";

type Api = (path: string, init?: RequestInit) => Promise<Response>;
const KINDS = [
  { id: "note", label: "Notes" }, { id: "condition", label: "Conditions" }, { id: "medication", label: "Medications" },
  { id: "procedure", label: "Procedures" }, { id: "observation", label: "Observations" }, { id: "allergy", label: "Allergies" },
] as const;
const KIND_STYLE: Record<string, string> = {
  note: "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300",
  condition: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300",
  medication: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
  procedure: "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300",
  observation: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  allergy: "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
};

interface Hit {
  kind: string; date: string | null; patient_id: string; first_name: string; last_name: string;
  label: string; detail: string | null; snippet: string | null; document_id?: string; event?: string; source_system: string | null;
}
interface Response_ { hits: Hit[]; counts: Record<string, number>; terms: string[]; expanded: boolean; note: string | null; notes_included: boolean }

// ts_headline marks matches with ⟦ ⟧; turn them into <mark> elements without ever injecting HTML.
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(⟦[^⟧]*⟧)/g);
  return <>{parts.map((p, i) => p.startsWith("⟦")
    ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-700/60 text-inherit rounded px-0.5">{p.slice(1, -1)}</mark>
    : <React.Fragment key={i}>{p}</React.Fragment>)}</>;
}

export default function RecordSearch({ api, patients, onOpenPatient, onOpenNote }: {
  api: Api; patients: Patient[];
  onOpenPatient: (patientId: string) => void; onOpenNote: (patientId: string, docId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [patientId, setPatientId] = useState("");
  const [kinds, setKinds] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<"relevance" | "date">("relevance");
  const [expand, setExpand] = useState(true);
  const [result, setResult] = useState<Response_ | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api("/api/v1/search/records", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(), patient_id: patientId || null, kinds: kinds.length ? kinds : null,
          date_from: dateFrom || null, date_to: dateTo || null, sort, expand,
        }),
      });
      if (!res.ok) throw new Error(res.status === 422 ? "Check the search fields (query up to 200 characters)." : `Search failed (HTTP ${res.status}).`);
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const lastYear = () => {
    const to = new Date(), from = new Date();
    from.setFullYear(to.getFullYear() - 1);
    setDateFrom(from.toISOString().slice(0, 10));
    setDateTo(to.toISOString().slice(0, 10));
  };

  const total = result ? Object.values(result.counts).reduce((a, b) => a + b, 0) : 0;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Search records</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-3xl">
          Searches every clinical note and the structured record (conditions, medications, procedures, observations, allergies)
          for the patients you can access. Use quotes for exact phrases and "or" for alternatives. Medications appear as
          started / stopped events, so a date range shows medication changes.
        </p>
      </div>

      <form onSubmit={run} className="premium-card p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-2">
          <input aria-label="Search" value={query} onChange={e => setQuery(e.target.value)} maxLength={200}
            placeholder='e.g. diabetes medication, "chest pain", asthma or wheeze' className="flex-1 px-3 py-2.5 rounded-lg premium-input text-sm" />
          <button type="submit" disabled={loading || !query.trim()} className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50">
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <div>
            <label htmlFor="rs-patient" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Patient</label>
            <select id="rs-patient" value={patientId} onChange={e => setPatientId(e.target.value)} className="px-3 py-2 rounded-lg premium-input text-sm max-w-[16rem]">
              <option value="">All my patients</option>
              {patients.map(p => <option key={p.patient_id} value={p.patient_id}>{displayName(p)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="rs-from" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">From</label>
            <input id="rs-from" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-2 rounded-lg premium-input text-sm" />
          </div>
          <div>
            <label htmlFor="rs-to" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">To</label>
            <input id="rs-to" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-2 rounded-lg premium-input text-sm" />
          </div>
          <button type="button" onClick={lastYear} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold">Last 12 months</button>
          {(dateFrom || dateTo) && <button type="button" onClick={() => { setDateFrom(""); setDateTo(""); }} className="px-2 py-2 text-xs text-slate-600 dark:text-slate-400 underline">Clear dates</button>}
          <div>
            <label htmlFor="rs-sort" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Order</label>
            <select id="rs-sort" value={sort} onChange={e => setSort(e.target.value as "relevance" | "date")} className="px-3 py-2 rounded-lg premium-input text-sm">
              <option value="relevance">Best match</option>
              <option value="date">Newest first (timeline)</option>
            </select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={expand} onChange={e => setExpand(e.target.checked)} />
            Include related terms (local model)
          </label>
        </div>
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">Record types</legend>
          {KINDS.map(k => (
            <label key={k.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium cursor-pointer">
              <input type="checkbox" checked={kinds.includes(k.id)} onChange={() => setKinds(prev => prev.includes(k.id) ? prev.filter(x => x !== k.id) : [...prev, k.id])} />
              {k.label}{result?.counts[k.id] !== undefined ? ` (${formatCount(result.counts[k.id])})` : ""}
            </label>
          ))}
          <span className="text-xs text-slate-500 self-center ml-1">{kinds.length ? "" : "All types"}</span>
        </fieldset>
      </form>

      {error && <div role="alert" className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300">{error}</div>}

      {result && (
        <div className="space-y-3">
          <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
            <p>
              {formatCount(total)} matches{total > result.hits.length ? `; showing the top ${result.hits.length} (at most 25 per type)` : ""}.
              {" "}Searched for: <span className="font-medium text-slate-800 dark:text-slate-200">{result.terms.join(", ")}</span>
              {result.expanded && <span> (related terms suggested by the local model)</span>}
            </p>
            {result.note && <p>{result.note}</p>}
            {!result.notes_included && <p>Note text is not searchable for your role (notes are not de-identified).</p>}
          </div>
          {result.hits.length === 0 ? (
            <div className="premium-card p-8 text-center text-sm text-slate-600 dark:text-slate-400">No matches. Try fewer words, other spellings, or related terms.</div>
          ) : (
            <ul className="premium-card divide-y divide-slate-100 dark:divide-slate-800">
              {result.hits.map((h, i) => (
                <li key={`${h.kind}-${h.document_id ?? h.label}-${h.date}-${i}`} className="px-5 py-3 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={`px-2 py-0.5 rounded-md text-xs font-medium capitalize ${KIND_STYLE[h.kind]}`}>{h.kind}</span>
                    <span className="text-slate-500 tabular-nums">{formatDate(h.date)}</span>
                    <button onClick={() => onOpenPatient(h.patient_id)} className="font-semibold text-slate-900 dark:text-white hover:underline">
                      {displayName({ first_name: h.first_name, last_name: h.last_name, source_system: h.source_system })}
                    </button>
                  </div>
                  <p className="text-sm text-slate-800 dark:text-slate-200">
                    <span className="font-medium">{h.label}</span>{h.detail ? <span className="text-slate-600 dark:text-slate-400"> · {h.detail}</span> : null}
                  </p>
                  {h.snippet && <p className="text-sm text-slate-600 dark:text-slate-400"><Snippet text={h.snippet} /></p>}
                  {h.document_id && (
                    <button onClick={() => onOpenNote(h.patient_id, h.document_id!)} className="text-xs font-semibold text-blue-700 dark:text-blue-300 hover:underline">Open note</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
