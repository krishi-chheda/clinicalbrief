// Renders a clinical note's plain text readably: "# Heading" lines become headings, "- item" lines and
// ";"-separated lists become bullets, and long "history of A (disorder), B (finding)" runs become a list.
// Display only: the text itself is never changed, and nothing is rendered as HTML.
import React from "react";

const TAG = /(\((?:disorder|finding|situation|procedure|qualifier value|observable entity|regime\/therapy|morphologic abnormality|event|person|substance)\))/i;

type Block = { kind: "h"; text: string } | { kind: "p"; text: string } | { kind: "ul"; items: string[]; lead?: string };

// Split on "; " outside brackets/braces (medication names like "{7 (a) / 84 (b)}" stay whole).
function splitSemicolons(line: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth = Math.max(0, depth - 1);
    if (c === ";" && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

export function parseNote(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { blocks.push({ kind: "h", text: h[1] }); continue; }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "ul" && !last.lead) last.items.push(bullet[1]); else blocks.push({ kind: "ul", items: [bullet[1]] });
      continue;
    }
    const parts = splitSemicolons(line);
    if (parts.length >= 2) { blocks.push({ kind: "ul", items: parts }); continue; }
    // "... has a history of A (disorder), B (finding), C (situation)." -> lead sentence + list
    const hx = line.match(/^(.*?history of)\s+(.*?)\.?$/i);
    if (hx && (hx[2].match(/\),\s+/g) || []).length >= 2) {
      blocks.push({ kind: "ul", lead: hx[1] + ":", items: hx[2].split(/(?<=\)),\s+/) });
      continue;
    }
    blocks.push({ kind: "p", text: line });
  }
  return blocks;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default function NoteText({ text, highlight }: { text: string; highlight?: string }) {
  const hl = highlight ? new RegExp(`(${escapeRegExp(highlight)})`, "gi") : null;
  const inline = (s: string) => (hl ? s.split(hl) : [s]).map((part, i) =>
    hl && part.toLowerCase() === highlight!.toLowerCase()
      ? <mark key={i} className="bg-yellow-300 dark:bg-yellow-800 text-black dark:text-white font-bold px-1 rounded">{part}</mark>
      : <React.Fragment key={i}>{part.split(TAG).map((p, j) => TAG.test(p)
          ? <span key={j} className="text-xs text-slate-400 dark:text-slate-500">{p}</span>
          : p)}</React.Fragment>);

  return (
    <div className="space-y-2">
      {parseNote(text).map((b, i) => b.kind === "h" ? (
        <h4 key={i} className={`text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 ${i ? "pt-3" : ""}`}>{b.text}</h4>
      ) : b.kind === "ul" ? (
        <div key={i}>
          {b.lead && <p>{inline(b.lead)}</p>}
          <ul className="list-disc pl-5 space-y-0.5">{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>
        </div>
      ) : (
        <p key={i}>{inline(b.text)}</p>
      ))}
    </div>
  );
}
