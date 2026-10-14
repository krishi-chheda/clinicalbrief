// Copilot "Thinking" timeline (F-01). Renders ONLY the steps the backend reported (StepTrace in
// grounded_copilot.py): each one was emitted when the pipeline really started or finished it, with measured ms.
// Nothing here invents a step, a label or a duration; the live seconds are real time since the question was sent.
// Active step: present tense, spinner + text shimmer (both off under prefers-reduced-motion). Finished: past tense
// with real counts and chips. Dead ends (removed, withheld, model down): greyed with x, indented.
"use client";
import React, { useEffect, useState } from "react";
import { Check, ChevronDown, Loader2, X } from "lucide-react";

export type ThinkingStep = {
  id: string;
  status: "active" | "done" | "dead";
  label: string;
  ms?: number | null;
  chips?: string[];
  more?: number;
};

const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;

export default function CopilotThinking({ steps, running, startedAt, totalMs, grounding, sources, citedIds, onChip, answeredOnly }: {
  steps: ThinkingStep[];
  running: boolean;
  startedAt?: number;          // Date.now() when the question was sent (live counter)
  totalMs?: number | null;     // measured total, once finished
  grounding?: string | null;
  sources?: number;
  citedIds?: Set<string>;      // chips whose id is cited open the same source panel as the [E#] markers
  onChip?: (id: string) => void;
  answeredOnly?: boolean;      // stream unavailable: no steps to show, only the measured time
}) {
  const [open, setOpen] = useState(running);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setOpen(running); }, [running]);
  // Real elapsed time while running (re-rendered 10x a second; it reports time, it does not drive any step).
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [running]);

  const elapsed = running && startedAt ? now - startedAt : totalMs ?? 0;
  const lastFinished = [...steps].reverse().find(s => s.status !== "active");

  if (answeredOnly) {
    return <p className="text-[11px] font-mono text-slate-400">Answered in {secs(elapsed)}</p>;
  }
  if (!steps.length && !running) return null;

  return (
    <div className="rounded-lg border border-slate-200/70 dark:border-slate-800 bg-white/60 dark:bg-slate-950/30">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] font-mono text-slate-500 dark:text-slate-400">
        <span className={running ? "cb-think-shimmer font-semibold" : ""}>
          {running ? `Thinking · ${secs(elapsed)}` : `Thought for ${secs(elapsed)}`}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <ol className="relative mx-2.5 mb-2 ml-4 border-l border-slate-200 dark:border-slate-800 space-y-1.5 pb-0.5">
          {steps.map(s => {
            const dead = s.status === "dead";
            const active = s.status === "active";
            return (
              <li key={s.id} className={`relative pl-4 ${dead ? "ml-3" : ""}`}>
                <span className="absolute -left-[7px] top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white dark:bg-slate-950">
                  {active ? <Loader2 className="h-3 w-3 text-blue-600 motion-safe:animate-spin" aria-hidden="true" />
                    : dead ? <X className="h-3 w-3 text-slate-400" aria-hidden="true" />
                    : <Check className="h-3 w-3 text-green-600 dark:text-green-400" aria-hidden="true" />}
                </span>
                <div className={`text-[11px] leading-snug ${active ? "cb-think-shimmer font-medium text-slate-700 dark:text-slate-200" : dead ? "text-slate-400 dark:text-slate-500" : "text-slate-500 dark:text-slate-400"}`}>
                  {s.label}
                  {!active && s.ms != null && <span className="ml-1.5 font-mono text-[10px] text-slate-400">{secs(s.ms)}</span>}
                </div>
                {!!s.chips?.length && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.chips.map(c => {
                      const id = c.split(" ")[0];
                      const clickable = !!onChip && !!citedIds?.has(id);
                      const cls = "max-w-[14rem] truncate rounded px-1.5 py-0.5 font-mono text-[10px] bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400";
                      return clickable
                        ? <button key={c} type="button" onClick={() => onChip!(id)} title="Show source" className={`${cls} hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/40`}>{c}</button>
                        : <span key={c} className={cls} title={c}>{c}</span>;
                    })}
                    {!!s.more && <span className="rounded px-1.5 py-0.5 font-mono text-[10px] text-slate-400">+{s.more} more</span>}
                  </div>
                )}
              </li>
            );
          })}
          {!running && (
            <li className="relative pl-4 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-700" aria-hidden="true" />
              Finished{grounding ? ` · ${grounding}` : ""}{sources != null ? ` · ${sources} ${sources === 1 ? "source" : "sources"}` : ""}
            </li>
          )}
        </ol>
      )}

      {/* Screen readers hear each step as it finishes, once. */}
      <p className="sr-only" aria-live="polite">{running && lastFinished ? lastFinished.label : ""}</p>
    </div>
  );
}
