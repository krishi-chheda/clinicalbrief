// Patient "Record" tab: the structured record, quiet by default.
//   RecordSummary  - collapsible sections in safety order (allergies, medications, diagnoses, observations), a filter,
//                    "Active only" by default, one line per item, first 5 per section with "Show all".
//   RecordTimeline - events grouped by day (newest open), with type filters.
// Display only: every value comes from the record as stored; formatting never invents or rounds clinical values
// (doses only lose a trailing ".0"; frequencies are reworded, e.g. "1 per 1.0 d" -> "once daily").
"use client";
import React, { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { formatDate, PatientRecord } from "../lib/clinical";

// SNOMED display names end in a semantic tag: "Gingivitis (disorder)". Shown as a muted tag, not part of the name.
const TAG = /\s*\((disorder|finding|situation|procedure|substance|organism|regime\/therapy|observable entity|qualifier value|event)\)\s*$/i;
const splitTag = (s: string) => { const m = s.match(TAG); return m ? [s.replace(TAG, ""), m[1].toLowerCase()] as const : [s, null] as const; };
const num = (s: string) => s.replace(/(\d)\.0\b/g, "$1");

// "1 per 1.0 d" -> "once daily", "2 per 1 d" -> "twice daily", "1 per 8 h" -> "every 8 hours". Unknown shapes pass through.
function frequency(f: string | null) {
  if (!f) return null;
  const m = f.match(/^(\d+(?:\.\d+)?) per (\d+(?:\.\d+)?) ?(h|d|wk|mo)$/);
  if (!m) return f;
  const n = Number(m[1]), every = Number(m[2]), unit = { h: "hour", d: "day", wk: "week", mo: "month" }[m[3] as "h"];
  const per = every === 1 ? { hour: "hourly", day: "daily", week: "weekly", month: "monthly" }[unit] : `every ${every} ${unit}s`;
  if (every === 1) return n === 1 ? `once ${per}` : n === 2 ? `twice ${per}` : `${n}× ${per}`;
  return n === 1 ? per : `${n}× ${per}`;
}
const unit = (u: string | null) => (u && !/^\{.*\}$/.test(u) ? u : "");   // UCUM annotations like {score} are not units

const ACTIVE = new Set(["active", "recurrence", "relapse"]);
const Dot = ({ on }: { on: boolean }) =>
  <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${on ? "bg-[#3F7308] dark:bg-[#B2EB76]" : "bg-slate-300 dark:bg-slate-600"}`} />;

function usePersistent(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => {
    try { const s = localStorage.getItem(key); return s === null ? initial : s === "1"; } catch { return initial; }
  });
  return [v, (x: boolean) => { setV(x); try { localStorage.setItem(key, x ? "1" : "0"); } catch { /* storage unavailable */ } }];
}

type Row = { key: string; name: string; tag?: string | null; meta?: string; active: boolean; value?: string; long?: boolean; noDot?: boolean };

function Section({ id, title, rows, hidden, preview, defaultOpen, filtering, empty }: {
  id: string; title: string; rows: Row[]; hidden: number; preview: string; defaultOpen: boolean; filtering: boolean; empty: string;
}) {
  const [open, setOpen] = usePersistent(`cb_record_${id}`, defaultOpen);
  const [all, setAll] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const isOpen = open || (filtering && rows.length > 0);         // a filter opens the sections it matches
  const shown = all || filtering ? rows : rows.slice(0, 5);
  return (
    <section className="border-t border-slate-100 dark:border-slate-800/80 first:border-t-0">
      <button type="button" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen}
        className="group flex w-full items-center gap-3 py-3 text-left">
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform motion-reduce:transition-none ${isOpen ? "" : "-rotate-90"}`} aria-hidden="true" />
        <span className="text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{rows.length}</span>
        {!isOpen && <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{preview}</span>}
        {isOpen && hidden > 0 && <span className="ml-auto text-[11px] text-slate-400">{hidden} not active hidden</span>}
      </button>
      {isOpen && (
        <div className="pb-3 pl-7">
          {rows.length === 0 ? <p className="text-xs italic text-slate-400">{empty}</p> : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {shown.map(r => {
                const ex = expanded.has(r.key);
                return (
                  <li key={r.key} className="flex items-start gap-2.5 py-1.5">
                    {r.noDot ? <span className="w-1.5 shrink-0" /> : <Dot on={r.active} />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 truncate text-[13px] text-slate-800 dark:text-slate-200" title={r.name}>{r.name}</span>
                        {r.tag && <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">{r.tag}</span>}
                        {r.value && !r.long && <span className="ml-auto shrink-0 font-mono text-[12px] text-slate-700 dark:text-slate-300">{r.value}</span>}
                      </div>
                      {r.value && r.long && (
                        <p className={`mt-0.5 text-[12px] text-slate-600 dark:text-slate-400 ${ex ? "" : "line-clamp-1"}`}>
                          {r.value}{" "}
                          <button type="button" className="text-[11px] font-semibold text-[#3F7308] dark:text-[#B2EB76] hover:underline"
                            onClick={() => setExpanded(s => { const n = new Set(s); ex ? n.delete(r.key) : n.add(r.key); return n; })}>
                            {ex ? "less" : "more"}
                          </button>
                        </p>
                      )}
                      {r.meta && <p className="text-[11px] text-slate-500">{r.meta}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {!filtering && rows.length > 5 && (
            <button type="button" onClick={() => setAll(!all)} className="mt-1 text-xs font-semibold text-[#3F7308] dark:text-[#B2EB76] hover:underline">
              {all ? "Show fewer" : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function RecordSummary({ record }: { record: PatientRecord }) {
  const [q, setQ] = useState("");
  const [activeOnly, setActiveOnly] = usePersistent("cb_record_active_only", true);
  const query = q.trim().toLowerCase();
  const match = (...parts: (string | null | undefined)[]) => !query || parts.some(p => p?.toLowerCase().includes(query));
  const c = record.counts;

  const sections = useMemo(() => {
    const keep = (rows: Row[]) => {
      const visible = rows.filter(r => !activeOnly || r.active);
      return { rows: visible, hidden: rows.length - visible.length };
    };
    const allergies: Row[] = record.allergies.filter(a => match(a.allergen, a.reaction)).map((a, i) => {
      const [name, tag] = splitTag(a.allergen);
      return { key: `a${i}`, name, tag, active: !a.clinical_status || ACTIVE.has(a.clinical_status),
               meta: [a.reaction && splitTag(a.reaction)[0], a.severity, a.criticality && `${a.criticality} criticality`].filter(Boolean).join(" · ") || undefined };
    });
    const meds: Row[] = record.medications.filter(m => match(m.name)).map((m, i) => ({
      key: `m${i}`, name: m.name, active: m.status === "active",
      meta: [m.dose && num(m.dose), m.route, frequency(m.frequency), m.status !== "active" && m.status].filter(Boolean).join(" · ") || undefined,
    }));
    const dx: Row[] = record.diagnoses.filter(d => match(d.display, d.code)).map((d, i) => {
      const [name, tag] = splitTag(d.display);
      return { key: `d${i}`, name, tag, active: !!d.clinical_status && ACTIVE.has(d.clinical_status),
               meta: [d.clinical_status !== "active" && d.clinical_status, d.onset_at && `since ${formatDate(d.onset_at)}`].filter(Boolean).join(" · ") || undefined };
    });
    const obs: Row[] = record.observations.filter(o => match(o.name, o.value)).map((o, i) => {
      const value = [o.value ?? "—", unit(o.unit)].filter(Boolean).join(" ");
      return { key: `o${i}`, name: o.name.replace(/\s*\[[^\]]*\]\s*$/, ""), active: true, noDot: true, value: o.flag ? `${value} ${o.flag.toUpperCase()}` : value,
               long: value.length > 28, meta: [formatDate(o.effective_at), o.reference_range && `ref ${o.reference_range}`].filter(Boolean).join(" · ") };
    });
    return { allergies: keep(allergies), meds: keep(meds), dx: keep(dx), obs: { rows: obs, hidden: 0 } };
  }, [record, activeOnly, query]);  // eslint-disable-line react-hooks/exhaustive-deps

  const preview = (rows: Row[]) => rows.slice(0, 3).map(r => r.name).join(", ") + (rows.length > 3 ? ", …" : "");
  return (
    <div className="premium-card p-5 select-text">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Clinical record</h2>
          <p className="text-[11px] text-slate-500">{c.encounters} encounters · {c.procedures} procedures · {c.observations} observations in the source record</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative">
            <span className="sr-only">Filter the record</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter the record"
              className="w-44 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs text-slate-800 outline-none focus:border-[#3F7308] dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200" />
          </label>
          <button type="button" role="switch" aria-checked={activeOnly} onClick={() => setActiveOnly(!activeOnly)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${activeOnly ? "border-[#3F7308]/40 bg-[#F4FAED] text-[#24420A] dark:border-[#B2EB76]/30 dark:bg-[#B2EB76]/10 dark:text-[#DFF5C4]" : "border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-300"}`}>
            {activeOnly ? "Active only" : "Showing all"}
          </button>
        </div>
      </div>
      <div className="mt-3">
        <Section id="allergies" title="Allergies" {...sections.allergies} preview={preview(sections.allergies.rows)} defaultOpen filtering={!!query}
          empty={record.allergies.length ? "None active." : "None recorded in the source data."} />
        <Section id="medications" title="Medications" {...sections.meds} preview={preview(sections.meds.rows)} defaultOpen filtering={!!query}
          empty={record.medications.length ? "None active." : "None recorded."} />
        <Section id="diagnoses" title="Diagnoses" {...sections.dx} preview={preview(sections.dx.rows)} defaultOpen={false} filtering={!!query}
          empty={record.diagnoses.length ? "None active." : "None recorded."} />
        <Section id="observations" title="Recent observations" {...sections.obs} preview={preview(sections.obs.rows)} defaultOpen={false} filtering={!!query}
          empty="None recorded." />
      </div>
    </div>
  );
}

const KIND_DOT: Record<string, string> = {
  encounter: "bg-sky-500", diagnosis: "bg-red-500", procedure: "bg-violet-500", medication: "bg-emerald-500",
  observation: "bg-amber-500", allergy: "bg-orange-500",
};

export function RecordTimeline({ record, sourceLabel }: { record: PatientRecord; sourceLabel: string }) {
  const [kind, setKind] = useState<string | null>(null);
  const [openDays, setOpenDays] = useState<Set<string> | null>(null);   // null = only the newest day open
  const kinds = useMemo(() => {
    const n: Record<string, number> = {};
    for (const e of record.timeline) n[e.kind] = (n[e.kind] || 0) + 1;
    return Object.entries(n).sort((a, b) => b[1] - a[1]);
  }, [record]);
  const days = useMemo(() => {
    const groups: { day: string; events: PatientRecord["timeline"] }[] = [];
    for (const e of record.timeline) {
      if (kind && e.kind !== kind) continue;
      const day = (e.at || "").slice(0, 10);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.events.push(e); else groups.push({ day, events: [e] });
    }
    return groups;
  }, [record, kind]);

  if (!record.timeline.length) return <div className="py-6 text-center text-xs italic text-slate-400">No dated clinical events recorded for this patient.</div>;
  const isOpen = (day: string, i: number) => (openDays ? openDays.has(day) : i === 0);
  const toggle = (day: string, i: number) => {
    const cur = openDays ?? new Set(days.length ? [days[0].day] : []);
    const n = new Set(cur); isOpen(day, i) ? n.delete(day) : n.add(day); setOpenDays(n);
  };
  const summary = (events: PatientRecord["timeline"]) => {
    const n: Record<string, number> = {};
    for (const e of events) n[e.kind] = (n[e.kind] || 0) + 1;
    const plural = (k: string, v: number) => (v === 1 ? k : k === "diagnosis" ? "diagnoses" : k === "allergy" ? "allergies" : `${k}s`);
    return Object.entries(n).map(([k, v]) => `${v} ${plural(k, v)}`).join(", ");
  };

  return (
    <div className="select-text">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {[["All", null, record.timeline.length] as const, ...kinds.map(([k, n]) => [k, k, n] as const)].map(([label, k, n]) => (
          <button key={label} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium capitalize ${kind === k ? "bg-[#18280E] text-white dark:bg-[#B2EB76] dark:text-[#18280E]" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"}`}>
            {label} <span className="font-mono opacity-70">{n}</span>
          </button>
        ))}
      </div>
      <ol className="max-h-[34rem] space-y-1 overflow-y-auto pr-1 scrollbar-thin">
        {days.map((g, i) => {
          const open = isOpen(g.day, i);
          return (
            <li key={g.day}>
              <button type="button" onClick={() => toggle(g.day, i)} aria-expanded={open}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-900/50">
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform motion-reduce:transition-none ${open ? "" : "-rotate-90"}`} aria-hidden="true" />
                <time className="text-[12px] font-semibold text-slate-800 dark:text-slate-200">{formatDate(g.day)}</time>
                <span className="truncate text-[11px] text-slate-500">{g.events.length} {g.events.length === 1 ? "event" : "events"}: {summary(g.events)}</span>
              </button>
              {open && (
                <ul className="mb-2 ml-[18px] space-y-1.5 border-l border-slate-200 pl-3 dark:border-slate-800">
                  {g.events.map((e, j) => {
                    const [label] = splitTag(e.label);
                    return (
                      <li key={j} className="flex items-start gap-2">
                        <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${KIND_DOT[e.kind] || "bg-slate-400"}`} />
                        <p className="text-[13px] leading-snug text-slate-800 dark:text-slate-200">
                          {label}
                          {e.detail && <span className="text-slate-500"> · {splitTag(e.detail)[0]}</span>}
                          <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-400">{e.kind}</span>
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-[11px] text-slate-500">Most recent {record.timeline.length} dated events from {sourceLabel}</p>
    </div>
  );
}
