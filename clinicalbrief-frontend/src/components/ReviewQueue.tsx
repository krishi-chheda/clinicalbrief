"use client";
// Phase 6: review AI-extracted findings across every patient the user may access.
// Keyboard: j / k move, a approve, r reject, e edit, u undo the last decision.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displayName, formatCount, formatDate } from "../lib/clinical";

type Api = (path: string, init?: RequestInit) => Promise<Response>;
type Status = "pending" | "approved" | "edited" | "rejected";

interface QueueItem {
  entity_id: string;
  entity_text: string;
  entity_type: string;
  review_status: Status;
  evidence: string | null;
  method: string;
  icd10_code: string | null;
  icd10_description: string | null;
  document_id: string;
  file_name: string;
  document_date: string | null;
  patient_id: string;
  first_name: string;
  last_name: string;
  source_system: string | null;
}

const TYPES = ["Disease", "Medication", "Allergy", "Symptom", "Procedure"];
const PAGE = 50;
const TYPE_STYLE: Record<string, string> = {
  Disease: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300",
  Medication: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
  Allergy: "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
  Symptom: "bg-pink-50 text-pink-700 dark:bg-pink-950/30 dark:text-pink-300",
  Procedure: "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300",
};

// The evidence sentence with the extracted term highlighted, so the reviewer sees it in context.
function Evidence({ text, term }: { text: string | null; term: string }) {
  if (!text) return <span className="italic text-slate-500">No evidence sentence recorded.</span>;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="bg-yellow-200 dark:bg-yellow-700/60 text-inherit rounded px-0.5">{text.slice(i, i + term.length)}</mark>{text.slice(i + term.length)}</>;
}

export default function ReviewQueue({ api, onOpenNote }: { api: Api; onOpenNote: (patientId: string, docId: string) => void }) {
  const [status, setStatus] = useState<Status>("pending");
  const [type, setType] = useState("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);
  const [undoStack, setUndoStack] = useState<{ ids: string[]; label: string; from: Status }[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const q = new URLSearchParams({ status, limit: String(PAGE), offset: String(offset) });
    if (type) q.set("entity_type", type);
    try {
      const res = await api(`/api/v1/review/queue?${q}`);
      if (!res.ok) throw new Error(res.status === 403 ? "Your role does not review AI output." : `HTTP ${res.status}`);
      setItems(await res.json());
      setTotal(Number(res.headers.get("X-Total-Count")) || 0);
      setFocus(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the queue.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [api, status, type, offset]);

  useEffect(() => { load(); }, [load]);
  // Pending view: decided items leave the list; when the page empties, fetch the next batch.
  useEffect(() => { if (!loading && status === "pending" && items.length === 0 && total > 0) load(); }, [items.length]);

  // Decisions: the server applies them all-or-nothing and records history + audit for each.
  const decide = useCallback(async (ids: string[], next: "approved" | "rejected" | "pending", label: string,
                                  from: Status = "pending"): Promise<boolean> => {
    if (!ids.length || busy) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await api("/api/v1/review/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_ids: ids, status: next, from_status: from }),
      });
      if (res.status === 409) {
        setError("Someone else changed some of these findings since the page loaded. Nothing was saved; the list has been refreshed.");
        load();
        return false;
      }
      if (!res.ok) throw new Error(`Review failed (HTTP ${res.status}); nothing was changed.`);
      if (next !== "pending") setUndoStack(s => [...s.slice(-19), { ids, label, from: next }]);
      setItems(prev => prev.filter(i => !ids.includes(i.entity_id)));
      setTotal(t => Math.max(0, t - ids.length));
      setFocus(f => Math.max(0, Math.min(f, items.length - ids.length - 1)));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [api, busy, items.length, load]);

  const saveEdit = async (item: QueueItem) => {
    const text = editText.trim();
    if (!text) return;
    setBusy(true);
    try {
      const res = await api(`/api/v1/documents/entities/${item.entity_id}/review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "edited", edited_text: text, from_status: "pending" }),
      });
      if (res.status === 409) {
        setEditing(null);
        setError("Someone else changed this finding since the page loaded. Nothing was saved; the list has been refreshed.");
        load();
        return;
      }
      if (!res.ok) throw new Error(`Edit failed (HTTP ${res.status}).`);
      setUndoStack(s => [...s.slice(-19), { ids: [item.entity_id], label: `edited "${item.entity_text}"`, from: "edited" }]);
      setItems(prev => prev.filter(i => i.entity_id !== item.entity_id));
      setTotal(t => Math.max(0, t - 1));
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Edit failed.");
    } finally {
      setBusy(false);
    }
  };

  const undo = useCallback(async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last || busy) return;
    if (await decide(last.ids, "pending", "undo", last.from)) {
      setUndoStack(s => s.slice(0, -1));
      load();  // the undone items reappear in the pending queue
    }
  }, [undoStack, busy, decide, load]);

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (editing || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      const item = items[focus];
      if (e.key === "j") setFocus(f => Math.min(items.length - 1, f + 1));
      else if (e.key === "k") setFocus(f => Math.max(0, f - 1));
      else if (e.key === "u") undo();
      else if (!item || status !== "pending") return;
      else if (e.key === "a") decide([item.entity_id], "approved", `approved "${item.entity_text}"`);
      else if (e.key === "r") decide([item.entity_id], "rejected", `rejected "${item.entity_text}"`);
      else if (e.key === "e") { setEditing(item.entity_id); setEditText(item.entity_text); e.preventDefault(); }
      else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, focus, status, editing, decide, undo]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${focus}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  // Group consecutive items by note (the server orders by note).
  const groups = useMemo(() => {
    const out: { doc: QueueItem; rows: { item: QueueItem; index: number }[] }[] = [];
    items.forEach((item, index) => {
      const last = out[out.length - 1];
      if (last && last.doc.document_id === item.document_id) last.rows.push({ item, index });
      else out.push({ doc: item, rows: [{ item, index }] });
    });
    return out;
  }, [items]);

  const pending = status === "pending";
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Review queue</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-3xl">
          AI-extracted findings across your patients. Nothing here counts as clinical fact until a person approves or edits it:
          only reviewed findings reach the knowledge graph, Copilot and FHIR export. Every decision is recorded with your name and time.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="rq-status" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Status</label>
          <select id="rq-status" value={status} onChange={e => { setStatus(e.target.value as Status); setOffset(0); setUndoStack([]); }} className="px-3 py-2 rounded-lg premium-input text-sm">
            <option value="pending">Awaiting review</option>
            <option value="approved">Approved</option>
            <option value="edited">Edited</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div>
          <label htmlFor="rq-type" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Type</label>
          <select id="rq-type" value={type} onChange={e => { setType(e.target.value); setOffset(0); }} className="px-3 py-2 rounded-lg premium-input text-sm">
            <option value="">All types</option>
            {TYPES.map(t => <option key={t} value={t}>{t === "Disease" ? "Condition" : t}</option>)}
          </select>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400 pb-2">{formatCount(total)} {pending ? "awaiting review" : status}</p>
        <div className="ml-auto flex items-center gap-2 pb-1">
          {undoStack.length > 0 && (
            <button onClick={undo} disabled={busy} className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 font-semibold hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-50">
              Undo: {undoStack[undoStack.length - 1].label}
            </button>
          )}
        </div>
      </div>

      {pending && <p className="text-xs text-slate-500">Keyboard: <kbd>j</kbd>/<kbd>k</kbd> move, <kbd>a</kbd> approve, <kbd>r</kbd> reject, <kbd>e</kbd> edit, <kbd>u</kbd> undo.</p>}
      {error && <div role="alert" className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300">{error}</div>}

      <div ref={listRef} className="space-y-4">
        {loading ? (
          <div className="premium-card p-8 text-sm text-slate-500">Loading...</div>
        ) : groups.length === 0 ? (
          <div className="premium-card p-8 text-center text-sm text-slate-600 dark:text-slate-400">
            {pending ? "Nothing awaiting review here. Analyse more notes from a patient's Notes tab to add to the queue." : "No findings with this status."}
          </div>
        ) : groups.map(({ doc, rows }) => (
          <section key={doc.document_id + rows[0].index} className="premium-card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/30">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 dark:text-white truncate">{displayName(doc)}</p>
                <p className="text-xs text-slate-500 truncate">{doc.file_name} · {formatDate(doc.document_date)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => onOpenNote(doc.patient_id, doc.document_id)} className="px-3 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 font-semibold hover:bg-white dark:hover:bg-slate-800">Open note</button>
                {pending && rows.length > 1 && (
                  <button onClick={() => decide(rows.map(r => r.item.entity_id), "approved", `approved ${rows.length} in ${doc.file_name}`)} disabled={busy}
                    className="px-3 py-1.5 text-xs rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-50">
                    Approve all {rows.length}
                  </button>
                )}
              </div>
            </header>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map(({ item, index }) => (
                <li key={item.entity_id} data-index={index} onClick={() => setFocus(index)}
                  className={`px-5 py-3 flex flex-col lg:flex-row lg:items-center gap-3 ${index === focus ? "bg-blue-50/70 dark:bg-blue-950/20 ring-1 ring-inset ring-blue-300 dark:ring-blue-800" : ""}`}>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {editing === item.entity_id ? (
                        <input autoFocus value={editText} onChange={e => setEditText(e.target.value)} maxLength={255} aria-label="Corrected term"
                          onKeyDown={e => { if (e.key === "Enter") saveEdit(item); if (e.key === "Escape") setEditing(null); }}
                          className="px-2 py-1 rounded-md premium-input text-sm" />
                      ) : (
                        <span className="font-semibold text-slate-900 dark:text-white">{item.entity_text}</span>
                      )}
                      <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${TYPE_STYLE[item.entity_type] || "bg-slate-100 text-slate-700"}`}>
                        {item.entity_type === "Disease" ? "Condition" : item.entity_type}
                      </span>
                      {item.icd10_code && <span className="text-xs text-slate-600 dark:text-slate-400" title={item.icd10_description || ""}>ICD-10 {item.icd10_code} (dictionary match)</span>}
                      <span className="text-xs text-slate-500">{item.method}</span>
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-300"><Evidence text={item.evidence} term={item.entity_text} /></p>
                  </div>
                  {pending && (
                    <div className="flex items-center gap-2 shrink-0">
                      {editing === item.entity_id ? (
                        <>
                          <button onClick={() => saveEdit(item)} disabled={busy} className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white font-semibold disabled:opacity-50">Save</button>
                          <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700">Cancel</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => decide([item.entity_id], "approved", `approved "${item.entity_text}"`)} disabled={busy}
                            className="px-3 py-1.5 text-sm rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-50">Approve</button>
                          <button onClick={() => { setEditing(item.entity_id); setEditText(item.entity_text); }} disabled={busy}
                            className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 font-semibold hover:bg-slate-50 dark:hover:bg-slate-900">Edit</button>
                          <button onClick={() => decide([item.entity_id], "rejected", `rejected "${item.entity_text}"`)} disabled={busy}
                            className="px-3 py-1.5 text-sm rounded-md border border-red-300 text-red-700 dark:border-red-900 dark:text-red-300 font-semibold hover:bg-red-50 dark:hover:bg-red-950/30">Reject</button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {!pending && total > PAGE && (
        <div className="flex items-center justify-between text-sm">
          <button onClick={() => setOffset(o => Math.max(0, o - PAGE))} disabled={offset === 0 || loading} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40">Previous</button>
          <span className="text-slate-600 dark:text-slate-400">{formatCount(offset + 1)}–{formatCount(offset + items.length)} of {formatCount(total)}</span>
          <button onClick={() => setOffset(o => o + PAGE)} disabled={offset + PAGE >= total || loading} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40">Next</button>
        </div>
      )}
      {pending && total > items.length && !loading && (
        <p className="text-sm text-slate-500">Showing the first {items.length} of {formatCount(total)}; more load as you review.</p>
      )}
    </div>
  );
}
