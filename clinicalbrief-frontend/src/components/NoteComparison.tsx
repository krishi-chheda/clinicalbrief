// Timeline note comparison: earliest vs latest analysed note for a patient (GET /documents/compare/{patient_id}).
// Two different comparisons, labelled as such:
//   1. Note text: each extractive summary split into items; items only in one note are marked. Plain text matching,
//      no AI, nothing reviewed.
//   2. Reviewed findings: diagnoses, medications, allergies and ICD-10 codes that a person approved or edited.
//      Pending AI findings are not compared; their count is shown with a link to the review queue.
import React from "react";
import { formatDate } from "../lib/clinical";

type Change = { added: string[]; removed: string[]; same: string[] };
type Code = { code: string; description: string };

// Summaries are lists ("a; b; c - d") or sentences: split on either.
const items = (text: string) =>
  (text || "").split(/;\s+|\s+-\s+|(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim().replace(/[.;]$/, "")).filter(Boolean);
const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

function monthsApart(a?: string, b?: string) {
  if (!a || !b) return "";
  const d1 = new Date(a), d2 = new Date(b);
  const m = (d2.getFullYear() - d1.getFullYear()) * 12 + d2.getMonth() - d1.getMonth();
  if (isNaN(m)) return "";
  if (m <= 0) return "same month";
  return m < 24 ? `${m} month${m === 1 ? "" : "s"} apart` : `${Math.round(m / 12)} years apart`;
}

const Eyebrow = ({ children }: { children: React.ReactNode }) =>
  <span className="text-[11px] font-mono uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{children}</span>;

function NoteColumn({ title, date, list, other, side }: { title: string; date?: string; list: string[]; other: Set<string>; side: "earlier" | "later" }) {
  const only = list.filter(i => !other.has(key(i))).length;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-4 min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">{title}</span>
        <span className="text-[11px] font-mono text-slate-400 shrink-0">{formatDate(date)}</span>
      </div>
      <p className="mt-1 text-[11px] font-mono uppercase tracking-wider text-slate-400">
        {side} note · {list.length} items{only ? ` · ${only} only here` : ""}
      </p>
      <ul className="mt-3 space-y-1.5">
        {list.map((item, i) => {
          const unique = !other.has(key(item));
          const mark = unique ? (side === "later" ? "+" : "−") : "";
          const tone = !unique ? "text-slate-500 dark:text-slate-400"
            : side === "later" ? "bg-[#E6F4D4] text-[#18280E] dark:bg-[#B2EB76]/15 dark:text-[#DFF5C4]"
            : "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300";
          return (
            <li key={i} className={`flex gap-2 rounded-md px-2 py-1 text-[13px] leading-snug ${tone}`}>
              <span className="w-3 shrink-0 font-mono font-bold">{mark}</span>
              <span className="min-w-0 break-words">{item}</span>
            </li>
          );
        })}
        {list.length === 0 && <li className="text-[13px] text-slate-400">No summary for this note.</li>}
      </ul>
    </div>
  );
}

function FindingGroup({ title, change }: { title: string; change: Change }) {
  const empty = !change.added.length && !change.removed.length && !change.same.length;
  const Chip = ({ text, tone }: { text: string; tone: string }) =>
    <span className={`inline-block rounded px-2 py-0.5 mr-1.5 mb-1.5 text-xs font-medium ${tone}`}>{text}</span>;
  return (
    <div className="min-w-0">
      <h5 className="text-sm font-semibold text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-800 pb-1.5">{title}</h5>
      {empty ? (
        <p className="mt-2 text-xs text-slate-400">No reviewed {title.toLowerCase()} in either note yet.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {change.added.length > 0 && <div><Eyebrow>Only in later note</Eyebrow><div className="mt-1">{change.added.map(t => <Chip key={t} text={`+ ${t}`} tone="bg-[#E6F4D4] text-[#18280E] dark:bg-[#B2EB76]/15 dark:text-[#DFF5C4]" />)}</div></div>}
          {change.removed.length > 0 && <div><Eyebrow>Only in earlier note</Eyebrow><div className="mt-1">{change.removed.map(t => <Chip key={t} text={`− ${t}`} tone="bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300" />)}</div></div>}
          {change.same.length > 0 && <div><Eyebrow>In both notes</Eyebrow><div className="mt-1">{change.same.map(t => <Chip key={t} text={t} tone="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" />)}</div></div>}
          {!change.added.length && !change.removed.length && <p className="text-xs text-slate-400">No change between the notes.</p>}
        </div>
      )}
    </div>
  );
}

export default function NoteComparison({ data, canReview, onOpenReview }: { data: any; canReview: boolean; onOpenReview: () => void }) {
  if (!data?.can_compare) {
    return <div className="text-center py-10 text-sm text-slate-500">{data?.message || "Needs at least two analysed notes to compare."}</div>;
  }
  const a = items(data.doc1.summary), b = items(data.doc2.summary);
  const ka = new Set(a.map(key)), kb = new Set(b.map(key));
  const added = b.filter(i => !ka.has(key(i))).length, removed = a.filter(i => !kb.has(key(i))).length;
  const an = data.analysis;
  const codes = (c: Code[]) => c.map(x => `${x.code} ${x.description}`);
  const groups: [string, Change][] = [
    ["Diagnoses", { added: an.diseases.added, removed: an.diseases.resolved, same: an.diseases.maintained }],
    ["Medications", { added: an.medications.added, removed: an.medications.discontinued, same: an.medications.maintained }],
    ["Allergies", { added: an.allergies?.added ?? [], removed: an.allergies?.discontinued ?? [], same: an.allergies?.maintained ?? [] }],
    ["ICD-10 codes", { added: codes(an.icd10?.added ?? []), removed: codes(an.icd10?.removed ?? []), same: codes(an.icd10?.maintained ?? []) }],
  ];
  const span = monthsApart(data.doc1.upload_date, data.doc2.upload_date);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
        <span className="font-mono">{formatDate(data.doc1.upload_date)}</span>
        <span className="text-slate-400">→</span>
        <span className="font-mono">{formatDate(data.doc2.upload_date)}</span>
        {span && <span className="text-xs text-slate-400">· {span}</span>}
        <span className="text-xs text-slate-400">· earliest and latest analysed notes</span>
      </div>

      {data.pending_review > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#EBE46A] bg-[#FBF9D8] dark:bg-[#EBE46A]/10 dark:border-[#EBE46A]/30 px-4 py-3">
          <p className="text-sm text-[#333109] dark:text-[#F3EFA0]">
            {data.pending_review} AI finding{data.pending_review === 1 ? "" : "s"} in these notes {data.pending_review === 1 ? "awaits" : "await"} review
            and {data.pending_review === 1 ? "is" : "are"} not compared yet.
          </p>
          {canReview && (
            <button onClick={onOpenReview} className="rounded-md bg-[#18280E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#24420A]">Open review queue</button>
          )}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Eyebrow>What changed in the note text</Eyebrow>
          <span className="text-xs text-slate-500">
            {added || removed ? <><b className="text-[#3F7308] dark:text-[#B2EB76]">+{added}</b> only in later · <b className="text-red-700 dark:text-red-400">−{removed}</b> only in earlier</> : "Same items in both notes"}
            <span className="text-slate-400"> · text matching, not reviewed</span>
          </span>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <NoteColumn title={data.doc1.classification} date={data.doc1.upload_date} list={a} other={kb} side="earlier" />
          <NoteColumn title={data.doc2.classification} date={data.doc2.upload_date} list={b} other={ka} side="later" />
        </div>
      </section>

      <section className="space-y-3">
        <Eyebrow>Reviewed findings</Eyebrow>
        <div className="grid sm:grid-cols-2 gap-5">
          {groups.map(([title, change]) => <FindingGroup key={title} title={title} change={change} />)}
        </div>
      </section>
    </div>
  );
}
