"use client";
// Shared presentational components.
import React from "react";
import {
  Activity,
  FileText,
  Search,
  FileUp,
  ShieldAlert,
  Settings as SettingsIcon,
  ChevronRight,
  UploadCloud,
  User as UserIcon,
  Check,
  X,
  Edit2,
  Download,
  Database,
  Clock,
  Send,
  Lock,
  ArrowRight,
  RefreshCw,
  LogOut,
  Info,
  Sun,
  Moon,
  Sparkles,
  AlertTriangle,
  Layers,
  ChevronLeft,
  Calendar,
  HeartPulse,
  TrendingUp,
  FileCheck,
  Zap,
  CheckCircle2,
  Terminal,
  Eye,
  Sliders,
  Award,
  GripVertical,
  EyeOff,
  Pin,
  Maximize2,
  Minimize2,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface SortableWidgetProps {
  id: string;
  title: string;
  isCustomizeMode: boolean;
  size: "small" | "medium" | "large" | "full";
  collapsed: boolean;
  pinned: boolean;
  onResize: (size: "small" | "medium" | "large" | "full") => void;
  onToggleCollapse: () => void;
  onTogglePin: () => void;
  onHide: () => void;
  onExpandFullscreen: () => void;
  children: React.ReactNode;
}

export const SortableWidget: React.FC<SortableWidgetProps> = ({
  id,
  title,
  isCustomizeMode,
  size,
  collapsed,
  pinned,
  onResize,
  onToggleCollapse,
  onTogglePin,
  onHide,
  onExpandFullscreen,
  children
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id, disabled: pinned || !isCustomizeMode });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 50 : "auto",
  };

  const getColSpanClass = () => {
    switch (size) {
      // Widgets live in a column that is only part of the page, so at most two per row.
      case "small": return "col-span-12 xl:col-span-6";
      case "medium": return "col-span-12 xl:col-span-6";
      case "large": return "col-span-12";
      case "full": return "col-span-12";
      default: return "col-span-12";
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`premium-card flex flex-col justify-between overflow-hidden relative group transition-all duration-350 ${getColSpanClass()} ${isCustomizeMode ? "border-dashed border-blue-400 dark:border-blue-700 bg-blue-50/5 dark:bg-blue-950/5 hover:border-blue-500" : ""}`}
    >
      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-900 bg-slate-50/50 dark:bg-slate-900/25 flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          {isCustomizeMode && !pinned && (
            <div
              {...attributes}
              {...listeners}
              className="cursor-grab p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-slate-400 hover:text-slate-600 transition-colors"
              title="Drag to Reorder"
            >
              <GripVertical className="h-4 w-4" />
            </div>
          )}
          <span className="font-bold text-slate-800 dark:text-slate-200 text-xs truncate uppercase tracking-wider">
            {title}
          </span>
        </div>

        <div className="flex items-center space-x-1">
          {isCustomizeMode && (
            <>
              <select
                value={size}
                onChange={(e) => onResize(e.target.value as any)}
                className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs font-semibold text-slate-500 hover:border-blue-500/50 transition-colors focus:ring-0 focus:outline-none"
                title="Resize Widget"
              >
                <option value="small">S (25%)</option>
                <option value="medium">M (50%)</option>
                <option value="large">L (75%)</option>
                <option value="full">Full (100%)</option>
              </select>

              <button
                onClick={onTogglePin}
                className={`p-1 rounded-lg border transition-all ${pinned ? "bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-950/20 dark:border-blue-800" : "border-slate-100 text-slate-400 hover:text-slate-700 dark:border-slate-800"}`}
                title={pinned ? "Unpin Widget" : "Pin Widget"}
              >
                <Pin className="h-3.5 w-3.5" />
              </button>

              <button
                onClick={onHide}
                className="p-1 rounded-lg border border-slate-100 dark:border-slate-800 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all"
                title="Hide Widget"
              >
                <EyeOff className="h-3.5 w-3.5" />
              </button>
            </>
          )}

          <button
            onClick={onExpandFullscreen}
            className="p-1 rounded-lg border border-slate-100 dark:border-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-all"
            title="Toggle Fullscreen"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={onToggleCollapse}
            className="p-1 rounded-lg border border-slate-100 dark:border-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-all"
            title={collapsed ? "Expand Body" : "Collapse Body"}
          >
            {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className={`transition-all duration-300 ${collapsed ? "h-0 overflow-hidden opacity-0 p-0" : "p-5 flex-1 flex flex-col justify-between"}`}>
        {children}
      </div>
    </div>
  );
};

// --- Design System Atomic Components ---

export const ConfidenceBadge: React.FC<{ score: number }> = ({ score }) => {
  const pct = Math.round(score * 100);
  let badgeColor = "bg-[#F4FAED] text-[#3F7308] border-[#E6F4D4] dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/30";
  if (pct >= 90) {
    badgeColor = "bg-[#F0FDF4] text-[#16A34A] border-[#DCFCE7] dark:bg-green-950/20 dark:text-green-400 dark:border-green-900/30";
  } else if (pct < 75) {
    badgeColor = "bg-[#FEF2F2] text-[#DC2626] border-[#FEE2E2] dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30";
  }
  return (
    <span className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-bold border tracking-wider font-mono ${badgeColor}`}>
      <Zap className="h-2.5 w-2.5" />
      <span>{pct}% Match</span>
    </span>
  );
};

export const MetricCard: React.FC<{
  title: string;
  value: string | number;
  description?: string;
  icon: React.ReactNode;
  trend?: string;
  sparklineData?: number[];
}> = ({ title, value, description, icon, trend, sparklineData }) => {
  return (
    <div className="premium-card p-6 flex flex-col justify-between h-40 relative group overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/0 via-blue-500/0 to-blue-500/[0.02] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-400 dark:text-slate-500 tracking-wider uppercase">{title}</span>
        <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-300">
          {icon}
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold tracking-tight text-[#090F05] dark:text-[#F7F9F4]">{typeof value === "number" ? value.toLocaleString("en-AU") : value}</span>
            {trend && (
              <span className="text-xs font-bold text-[#16A34A] flex items-center bg-green-50 dark:bg-green-950/20 px-1.5 py-0.5 rounded-md">
                {trend}
              </span>
            )}
          </div>
          {description && <p className="text-[11px] text-[#4A5B38] dark:text-slate-400 mt-1">{description}</p>}
        </div>

        {sparklineData && (
          <div className="w-16 h-8 opacity-70 group-hover:opacity-100 transition-opacity">
            <svg className="w-full h-full" viewBox="0 0 100 40">
              <path
                d={`M ${sparklineData.map((val, idx) => `${(idx / (sparklineData.length - 1)) * 100} ${40 - (val / 10) * 35}`).join(' L ')}`}
                fill="none"
                stroke="#3F7308"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};

export const InsightCard: React.FC<{
  title: string;
  type: "warning" | "info" | "success" | "danger";
  description: string;
  metadata?: string;
}> = ({ title, type, description, metadata }) => {
  let icon = <Sparkles className="h-4 w-4 text-[#3F7308]" />;
  let cardStyle = "border-blue-100 bg-blue-50/20 dark:border-blue-900/10 dark:bg-blue-950/5";

  if (type === "warning") {
    icon = <AlertTriangle className="h-4 w-4 text-[#F59E0B]" />;
    cardStyle = "border-amber-100 bg-amber-50/20 dark:border-amber-900/10 dark:bg-amber-950/5";
  } else if (type === "danger") {
    icon = <ShieldAlert className="h-4 w-4 text-[#DC2626]" />;
    cardStyle = "border-red-100 bg-red-50/20 dark:border-red-900/10 dark:bg-red-950/5";
  } else if (type === "success") {
    icon = <CheckCircle2 className="h-4 w-4 text-[#16A34A]" />;
    cardStyle = "border-green-100 bg-green-50/20 dark:border-green-900/10 dark:bg-green-950/5";
  }

  return (
    <div className={`p-4 rounded-[16px] border text-xs leading-relaxed transition-all ${cardStyle}`}>
      <div className="flex items-center space-x-2 font-bold">
        {icon}
        <span className="text-slate-900 dark:text-white font-semibold">{title}</span>
      </div>
      <p className="text-[#4A5B38] dark:text-slate-400 mt-1.5 leading-normal pl-6">{description}</p>
      {metadata && (
        <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 pl-6 mt-1 uppercase tracking-wider">
          {metadata}
        </div>
      )}
    </div>
  );
};


// One rendering for Copilot messages: answer, which model produced it, whether it is grounded, and its sources.
export const GROUNDING_STYLE: Record<string, { label: string; cls: string }> = {
  grounded: { label: "Grounded in sources", cls: "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400" },
  partial: { label: "Partly grounded - check warnings", cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400" },
  "no-evidence": { label: "No evidence in record", cls: "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400" },
  withheld: { label: "Answer withheld (unsupported)", cls: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400" },
  "records-only": { label: "Matching records shown (no generated answer)", cls: "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400" },
};

export const CopilotMessageView: React.FC<{ msg: any; onAsk?: (q: string) => void }> = ({ msg, onAsk }) => {
  const isAssistant = msg.sender === "assistant";
  const citations: any[] = (() => { try { return msg.citations ? JSON.parse(msg.citations) : []; } catch { return []; } })();
  const grounding = msg.grounding ? GROUNDING_STYLE[msg.grounding] : null;
  // Sources stay hidden until a marker like [E38] (or a source chip) is clicked; one is shown at a time.
  const [openId, setOpenId] = React.useState<string | null>(null);
  const toggle = (id: string) => setOpenId(cur => (cur === id ? null : id));
  const open = citations.find((c: any, i: number) => (c.id || `${i + 1}`) === openId);
  const cited = new Set(citations.map((c: any, i: number) => c.id || `${i + 1}`));
  const withMarkers = (text: string) => text.split(/(\[E\d+\])/g).map((part, i) => {
    const id = part.slice(1, -1);
    return /^\[E\d+\]$/.test(part) && cited.has(id)
      ? <button key={i} onClick={() => toggle(id)} aria-expanded={openId === id} title="Show source"
          className={`mx-0.5 px-1 rounded font-mono text-[11px] font-bold align-baseline ${openId === id ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300"}`}>{id}</button>
      : <React.Fragment key={i}>{part}</React.Fragment>;
  });
  return (
    <div className={`p-3 rounded-xl border space-y-2 text-xs ${isAssistant ? "bg-blue-50/10 border-blue-500/10 text-slate-700 dark:text-slate-300" : "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200"}`}>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="font-bold text-[11px] uppercase tracking-wider text-slate-500">{isAssistant ? "Copilot" : "You"}</span>
        {isAssistant && (
          <div className="flex flex-wrap gap-1">
            {msg.mode && <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-900 text-slate-500 font-mono text-[11px]">{msg.mode === "rule-based" ? "rule-based fallback" : msg.mode.replace("local-llm:", "local model: ")}</span>}
            {grounding && <span className={`px-1.5 py-0.5 rounded font-mono text-[11px] font-bold ${grounding.cls}`}>{grounding.label}</span>}
          </div>
        )}
      </div>
      <div className="space-y-1 leading-relaxed">
        {String(msg.content).split("\n").filter((l: string) => l.trim()).map((line: string, idx: number) =>
          /^\s*[-*•]\s+/.test(line)
            ? <li key={idx} className="ml-3 list-disc">{withMarkers(line.replace(/^\s*[-*•]\s+/, ""))}</li>
            : <p key={idx}>{withMarkers(line)}</p>)}
      </div>
      {isAssistant && msg.warnings?.length > 0 && (
        <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
          {msg.warnings.map((w: string, i: number) => <li key={i}>! {w}</li>)}
        </ul>
      )}
      {isAssistant && citations.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider mr-1">Sources</span>
          {citations.map((cite: any, i: number) => {
            const id = cite.id || `${i + 1}`;
            return (
              <button key={id} onClick={() => toggle(id)} aria-expanded={openId === id}
                className={`px-1.5 py-0.5 rounded font-mono text-[11px] font-bold ${openId === id ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300"}`}>
                {id}
              </button>
            );
          })}
        </div>
      )}
      {open && (
        <div className="bg-slate-50 dark:bg-slate-950/50 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">
              <span className="font-mono font-bold text-blue-600 dark:text-blue-400 mr-1">{open.id}</span>
              {open.kind}{open.source_system ? ` · ${open.source_system}` : ""}{open.date ? ` · ${open.date}` : ""}
              {open.similarity != null && ` · similarity ${Number(open.similarity).toFixed(2)}`}
            </span>
            <button onClick={() => setOpenId(null)} aria-label="Close source" className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-sm leading-none">×</button>
          </div>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-snug max-h-48 overflow-y-auto whitespace-pre-line">{open.text}</p>
        </div>
      )}
      {isAssistant && msg.search_terms?.length > 0 && (
        <details className="text-[11px] text-slate-400">
          <summary className="cursor-pointer select-none">Search terms used</summary>
          {msg.search_terms.join(", ")}
        </details>
      )}
      {isAssistant && onAsk && msg.suggested_questions?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {msg.suggested_questions.map((q: string, i: number) => (
            <button key={i} onClick={() => onAsk(q)} className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 hover:bg-blue-600 hover:text-white">{q}</button>
          ))}
        </div>
      )}
    </div>
  );
};

