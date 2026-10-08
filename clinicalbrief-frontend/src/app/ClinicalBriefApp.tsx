"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../supabase";
import { INFO_VIEWS, parseRoute, pathFor, patientPath, type View } from "../lib/routes";
import InfoPage from "../components/public/InfoPage";
import KnowledgeGraphCanvas from "../components/KnowledgeGraphCanvas";
import NoteComparison from "../components/NoteComparison";
import LoginPage from "../components/public/LoginPage";
import { LoadingScreen } from "../components/public/StatusScreens";
import ReviewQueue from "../components/ReviewQueue";
import Governance from "../components/Governance";
import SystemHealth from "../components/SystemHealth";
import RecordSearch from "../components/RecordSearch";
import NoteText from "../components/NoteText";
import Landing from "../components/Landing";
import { displayName, ageLabel, sourceLabel, formatDate, formatCount, hasRealRecentDate, SOURCE_LABELS } from "../lib/clinical";
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
  RefreshCw,
  LogOut,
  Info,
  Sun,
  Menu,
  Moon,
  Sparkles,
  AlertTriangle,
  Calendar,
  HeartPulse,
  TrendingUp,
  Zap,
  CheckCircle2,
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

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  rectSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DEFAULT_LAYOUTS, knownWidgets, WidgetConfig } from "../lib/layouts";
import { Patient, Document, PatientRecord, ProcessingStatus, PIPELINE_STAGES, scoreLabel, shortCodeSystem, ICD10Mapping, Entity, Summary, ParsedMedication, ParsedAllergy, DocumentInsights, AuditLog, BACKEND_URL, fetchProfile } from "../lib/clinical";
import { SortableWidgetProps, SortableWidget, ConfidenceBadge, MetricCard, InsightCard, GROUNDING_STYLE, CopilotMessageView } from "../components/ui";

// Search by (display or source) name or id; filter by source and whether the patient has notes.
function filterPatients(patients: Patient[], query: string, source: string, withNotesOnly: boolean): Patient[] {
  const q = query.trim().toLowerCase();
  return patients.filter(p =>
    (!q || displayName(p).toLowerCase().includes(q) || `${p.first_name} ${p.last_name}`.toLowerCase().includes(q)
      || p.patient_id.toLowerCase().startsWith(q)) &&
    (source === "all" || (p.source_system || "unknown") === source) &&
    (!withNotesOnly || (p.document_count ?? 0) > 0));
}

// Knowledge graph node types, in drawing order (one sector each). Colours are distinct and readable on light and dark.
const GRAPH_TYPES = [
  { type: "Condition", plural: "Conditions", color: "#DC2626" },
  { type: "Finding", plural: "Findings", color: "#6B7A5C" },
  { type: "Medication", plural: "Medications", color: "#059669" },
  { type: "Allergy", plural: "Allergies", color: "#D97706" },
  { type: "Procedure", plural: "Procedures", color: "#7C3AED" },
  { type: "Symptom", plural: "Symptoms", color: "#DB2777" },
];
const GRAPH_COLOR: Record<string, string> = Object.fromEntries(GRAPH_TYPES.map(t => [t.type, t.color]));
const shorten = (text: string, max = 26) => (text.length > max ? text.slice(0, max - 1) + "\u2026" : text);

export default function ClinicalBriefApp() {
  // Navigation & States
  // The URL decides the view and the selected patient / note (src/lib/routes.ts).
  const pathname = usePathname() || "/";
  const router = useRouter();
  const route = parseRoute(pathname);
  const currentView = route.view;
  const setCurrentView = (view: Exclude<View, "patient">) => router.push(pathFor(view));
  const openPatient = (p: Patient | string) => router.push(patientPath(typeof p === "string" ? p : p.patient_id));
  // Session restore is async: protected pages wait for it instead of flashing the login form.
  const [authReady, setAuthReady] = useState(false);
  // Phones: the sidebar is an off-canvas menu, closed again on every navigation.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [pathname]);
  const [missingPatientId, setMissingPatientId] = useState<string | null>(null);
  // Patient list / search
  const [patientQuery, setPatientQuery] = useState("");
  const [patientSource, setPatientSource] = useState("all");
  const [patientsWithNotesOnly, setPatientsWithNotesOnly] = useState(false);
  const [sidebarQuery, setSidebarQuery] = useState("");
  // The Supabase session (and its refresh) is owned by supabase-js. `token` only marks "signed in"
  // for effects; API calls always read the current access token from the session.
  const [token, setToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [userRole, setUserRole] = useState<string>("");
  // Public demo (anonymous sign-in, role `demo`): read-only, scoped by the API to the flagged synthetic patients.
  const isDemo = userRole === "demo";
  const canReview = ["admin", "clinician", "consultant", "coder"].includes(userRole);
  const [password, setPassword] = useState<string>("");
  // Layout preview only - never changes the user's actual role.
  const [layoutPreset, setLayoutPreset] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState<boolean>(false);

  // Data Sets
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientDocuments, setPatientDocuments] = useState<Document[]>([]);
  const [patientDocumentTotal, setPatientDocumentTotal] = useState(0);  // full count; the list holds the newest 100
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [insights, setInsights] = useState<DocumentInsights | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Enterprise Features States
  const [phiRedacted, setPhiRedacted] = useState<boolean>(false);
  const [redactedText, setRedactedText] = useState<string>("");
  const [originalText, setOriginalText] = useState<string>("");
  const [isCopilotOpen, setIsCopilotOpen] = useState<boolean>(false);
  const [noteHidden, setNoteHidden] = useState(false);
  const [isFhirExpanded, setIsFhirExpanded] = useState<boolean>(false);
  const [riskInfo, setRiskInfo] = useState<{ score: number; risk_level: string; risk_factors: string[]; review_priority: string; reviewed_entities: number; pending_entities: number } | null>(null);
  const [graphData, setGraphData] = useState<{ nodes: any[]; edges: any[]; pending_review?: number; totals?: Record<string, number>; max_per_type?: number } | null>(null);
  const [comparisonData, setComparisonData] = useState<any>(null);
  const [governanceStats, setGovernanceStats] = useState<any>(null);
  const [explainEntity, setExplainEntity] = useState<Entity | null>(null);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [copilotLoading, setCopilotLoading] = useState<boolean>(false);
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConversation, setActiveConversation] = useState<any | null>(null);
  const [copilotInput, setCopilotInput] = useState<string>("");

  // Interface Operations
  const [isBackendOnline, setIsBackendOnline] = useState<boolean>(false);

  // Q&A Context
  const [qaQuestion, setQaQuestion] = useState("");
  const [qaChat, setQaChat] = useState<{ q: string; a: string; loading?: boolean }[]>([]);

  // Upload Flow
  const [uploadPatientId, setUploadPatientId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [patientRecord, setPatientRecord] = useState<PatientRecord | null>(null);
  const [importRuns, setImportRuns] = useState<any[]>([]);
  // What actually produced the AI output, as reported by the backend ("rule-based-prototype" | "transformers").
  const [aiMode, setAiMode] = useState<string | null>(null);

  // HITL state
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [activeTab, setActiveTab] = useState<"dashboard" | "entities" | "graph" | "compare">("dashboard");
  const [fhirBundle, setFhirBundle] = useState<string>("");
  // Explains what the FHIR export contains (reviewed entities only) or why it is unavailable.
  const [fhirNote, setFhirNote] = useState<string>("");
  const [fhirMeta, setFhirMeta] = useState<{ validation: string; counts: Record<string, number>; bytes: number; preview: string; lines: number } | null>(null);
  const [fhirLoading, setFhirLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);


  // Customizable Workspace Layout States
  const [layout, setLayout] = useState<WidgetConfig[]>([]);
  const [isCustomizeMode, setIsCustomizeMode] = useState<boolean>(false);
  const [fullscreenWidgetId, setFullscreenWidgetId] = useState<string | null>(null);

  // Phase 1 Additional States
  const [clickedEntity, setClickedEntity] = useState<Entity | null>(null);
  const [graphFilters, setGraphFilters] = useState<Record<string, boolean>>(
    Object.fromEntries(GRAPH_TYPES.map(t => [t.type, true])));

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const loadUserLayout = async (role: string) => {
    // Check local storage fallback first if offline
    if (!isBackendOnline) {
      const cached = localStorage.getItem(`cb_layout_${role}`);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setLayout(knownWidgets(parsed));
            return;
          }
        } catch (e) {
          console.error("Failed to parse cached layout", e);
        }
      }
    }

    if (isBackendOnline && token) {
      try {
        const res = await fetchWithAuth(`${BACKEND_URL}/api/v1/dashboard/layout`);
        if (res.ok) {
          const data = await res.json();
          if (data.layout_json) {
            try {
              const parsed = JSON.parse(data.layout_json);
              if (Array.isArray(parsed) && parsed.length > 0) {
                // Merge loaded layout with defaults to ensure new widgets aren't lost
                const defaultWidgets = DEFAULT_LAYOUTS[role] || [];
                const merged = [...parsed];
                const parsedIds = new Set(parsed.map(w => w.id));
                defaultWidgets.forEach(w => {
                  if (!parsedIds.has(w.id)) {
                    merged.push(w);
                  }
                });
                setLayout(knownWidgets(merged));
                return;
              }
            } catch (e) {
              console.error("Failed to parse backend layout JSON", e);
            }
          }
        }
      } catch (e) {
        console.error("Failed to load user layout from backend", e);
      }
    }

    // Otherwise fallback to default preset
    setLayout(DEFAULT_LAYOUTS[role] || DEFAULT_LAYOUTS.clinician);
  };

  const saveUserLayout = async (newLayout: WidgetConfig[]) => {
    setLayout(newLayout);
    if (isBackendOnline && token) {
      try {
        await fetchWithAuth(`${BACKEND_URL}/api/v1/dashboard/layout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout_json: JSON.stringify(newLayout) })
        });
      } catch (e) {
        console.error("Failed to save layout to backend", e);
      }
    } else {
      // Fallback caching in localStorage
      localStorage.setItem(`cb_layout_${userRole}`, JSON.stringify(newLayout));
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = layout.findIndex(w => w.id === active.id);
      const newIndex = layout.findIndex(w => w.id === over.id);
      const newLayout = arrayMove(layout, oldIndex, newIndex);
      saveUserLayout(newLayout);
    }
  };

  const handleResizeWidget = (id: string, size: "small" | "medium" | "large" | "full") => {
    const newLayout = layout.map(w => w.id === id ? { ...w, size } : w);
    saveUserLayout(newLayout);
  };

  const handleToggleCollapseWidget = (id: string) => {
    const newLayout = layout.map(w => w.id === id ? { ...w, collapsed: !w.collapsed } : w);
    saveUserLayout(newLayout);
  };

  const handleTogglePinWidget = (id: string) => {
    const newLayout = layout.map(w => w.id === id ? { ...w, pinned: !w.pinned } : w);
    saveUserLayout(newLayout);
  };

  const handleHideWidget = (id: string) => {
    const newLayout = layout.map(w => w.id === id ? { ...w, visible: false } : w);
    saveUserLayout(newLayout);
  };

  const handleRestoreWidget = (id: string) => {
    const newLayout = layout.map(w => w.id === id ? { ...w, visible: true } : w);
    saveUserLayout(newLayout);
  };

  const handleResetLayout = () => {
    if (window.confirm("Are you sure you want to reset this workspace to the standard role preset?")) {
      saveUserLayout(DEFAULT_LAYOUTS[userRole] || DEFAULT_LAYOUTS.clinician);
    }
  };

  const handleExportLayout = () => {
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clinicalbrief_layout_${userRole}_${Date.now()}.json`;
    a.click();
  };

  const handleDuplicateLayout = () => {
    navigator.clipboard.writeText(JSON.stringify(layout, null, 2));
    alert("Workspace Layout Configuration copied to clipboard! You can paste this to import or backup.");
  };

  // --- Note parsers: only report what is present in the note text; never fill in defaults. ---
  const escapeRegExp = (str: string) => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  const parseMedications = (noteText: string, medsList: Entity[]): ParsedMedication[] => {
    if (!noteText) return [];
    return medsList.map(m => {
      const term = m.entity_text;
      const regex = new RegExp(escapeRegExp(term) + '\\s+([^\\n\\r]+)', 'i');
      const match = noteText.match(regex);
      let dose = "—";
      let frequency = "—";
      let route = "—";
      const status = m.review_status === "rejected" ? "Rejected" : m.review_status;

      if (match && match[1]) {
        const detail = match[1].toLowerCase();
        const doseMatch = detail.match(/(\d+(\.\d+)?\s*(mg|g|mcg|ml|units?|tabs?|tablets?))/i);
        if (doseMatch) dose = doseMatch[1];
        if (/\b(po|by mouth|oral)\b/.test(detail)) route = "PO";
        else if (/\b(iv|intravenous)\b/.test(detail)) route = "IV";
        else if (/\b(sublingual|sl)\b/.test(detail)) route = "SL";
        else if (/\b(inhal(ation|ed))\b/.test(detail)) route = "Inhalation";
        if (/twice daily|twice-daily|\bbid\b/.test(detail)) frequency = "Twice daily";
        else if (/three times daily|\btid\b/.test(detail)) frequency = "Three times daily";
        else if (/four times daily|\bqid\b/.test(detail)) frequency = "Four times daily";
        else if (/every 12 hours|\bq12h\b/.test(detail)) frequency = "Q12H";
        else if (/as needed|\bprn\b/.test(detail)) frequency = "PRN";
        else if (/\bdaily\b|\bqd\b/.test(detail)) frequency = "Daily";
      }
      return { name: term, dose, frequency, route, status };
    });
  };

  const parseAllergies = (noteText: string, allergyList: Entity[]): ParsedAllergy[] => {
    // Reaction/severity are not extracted by the pipeline yet, so they are shown as not recorded.
    return allergyList.map(a => ({ name: a.entity_text, reaction: "Not extracted", severity: "Not extracted", confidence: a.confidence }));
  };

  const renderKnowledgeGraph = (isWidget: boolean) => {
    if (!graphData) return <div className="text-sm text-slate-500 p-6">Loading graph...</div>;

    const visible = graphData.nodes.filter(n => n.type === "Patient" || graphFilters[n.type]);
    const ids = new Set(visible.map(n => n.id));
    const edges = graphData.edges.filter(e => ids.has(e.source) && ids.has(e.target));
    const patientLabel = selectedPatient ? displayName(selectedPatient) : "Patient";
    const onlyPatient = visible.length <= 1;
    const capped = GRAPH_TYPES.filter(t => (graphData.totals?.[t.type] ?? 0) > (graphData.max_per_type ?? Infinity));

    return (
      <div className="flex flex-col gap-3 w-full">
        <div className="flex flex-col xl:flex-row gap-3">
          <div className="relative flex-1 min-w-0">
            <KnowledgeGraphCanvas nodes={visible} edges={edges} types={GRAPH_TYPES} filters={graphFilters} totals={graphData.totals}
              onToggleType={t => setGraphFilters(prev => ({ ...prev, [t]: !(prev[t] ?? true) }))}
              patientKey={selectedPatient?.patient_id ?? ""} patientLabel={patientLabel} selectedId={selectedNode?.id ?? null}
              onSelect={(n, label) => setSelectedNode({ ...n, label })} shorten={shorten} height={isWidget ? "h-80" : "h-[34rem]"} />
            {onlyPatient && (
              <div className="absolute inset-x-0 bottom-14 text-center text-sm text-[#B3C5A0] px-6 pointer-events-none">
                Nothing to draw yet: no current conditions, medications or allergies in the record, and no reviewed AI findings.
                {graphData.pending_review ? ` ${graphData.pending_review} AI findings await review in Entity review.` : ""}
              </div>
            )}
          </div>

          <div className="xl:w-64 shrink-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-4 text-sm space-y-3">
            {selectedNode ? (
              <div className="space-y-1.5 select-text">
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: GRAPH_COLOR[selectedNode.type] || "#3F7308" }}>{selectedNode.type}</span>
                <p className="font-semibold text-slate-900 dark:text-white">{selectedNode.label}</p>
                <p className="text-slate-600 dark:text-slate-400">{selectedNode.details}</p>
              </div>
            ) : (
              <p className="text-slate-500">Click a node for its details. Hover to light up its connections. Drag to rotate, scroll to zoom, or press tour.</p>
            )}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 space-y-1.5">
              <p>Solid outline: from the patient's record (source data).</p>
              <p>Dashed outline: AI-extracted from a note and approved by a reviewer.</p>
              {graphData.pending_review ? <p>{graphData.pending_review} AI findings await review and are not drawn.</p> : null}
              {capped.length > 0 && (
                <p>Showing the {graphData.max_per_type} most recent per type: {capped.map(t => `${t.plural.toLowerCase()} ${graphData.totals![t.type]}`).join(", ")} in total.</p>
              )}
              <p>Only current items are drawn (active conditions and medications).</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderWidgetContents = (id: string) => {
    const copilotData = getCopilotInsights();

    switch (id) {
      case "summary":
        return copilotData ? (
          <div className="flex flex-col justify-between h-full flex-1 space-y-3">
            {insights?.summary ? (
              <p className="text-xs text-slate-800 dark:text-slate-300 leading-relaxed font-sans max-h-56 overflow-y-auto pr-1 select-text">
                {insights.summary.summary_text}
              </p>
            ) : (
              <p className="text-sm text-slate-500 py-4">No summary for this note.</p>
            )}
            <span className="text-xs text-slate-500 block">{copilotData.attribution}. Sentences copied from the note; requires clinician review.</span>
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic py-6 text-center">Summary generation pending.</div>
        );

      case "primary_diag":
        return copilotData ? (
          <div className="flex flex-col justify-between h-full flex-1">
            {copilotData.primaryDiag ? (
              <div
                onClick={() => setClickedEntity(copilotData.primaryDiag)}
                className="space-y-2 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-900/30 p-2 rounded-xl border border-transparent hover:border-slate-100 dark:hover:border-slate-800 transition-all select-text"
              >
                <div className="flex items-center space-x-2">
                  <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0 animate-pulse"></span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white capitalize truncate">{copilotData.primaryDiag.entity_text}</span>
                </div>
                {copilotData.primaryDiag.icd10_mapping && (
                  <div className="text-xs text-slate-500 leading-normal font-mono bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 flex justify-between items-center">
                    <div>
                      <span className="font-bold text-blue-600 dark:text-blue-400 block">{copilotData.primaryDiag.icd10_mapping.icd10_code}</span>
                      <span className="text-[11px] text-slate-400 truncate block mt-0.5 max-w-[150px]">{copilotData.primaryDiag.icd10_mapping.code_description}</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[11px] font-mono font-bold bg-green-50 text-green-600 dark:bg-green-950/20 dark:text-green-400">
                      {scoreLabel(copilotData.primaryDiag.icd10_mapping.confidence, "dictionary match")}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500 py-4 text-center">No diagnoses mentioned in this note.</p>
            )}
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic py-4 text-center">Loading Primary Diagnosis...</div>
        );

      case "secondary_diags":
        return copilotData ? (
          <div className="flex flex-col justify-between h-full flex-1">
            <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1 scrollbar-thin select-text">
              {copilotData.secondaryDiags.length > 0 ? (
                copilotData.secondaryDiags.map((d, idx) => (
                  <div
                    key={idx}
                    onClick={() => setClickedEntity(d)}
                    className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center space-x-1.5 capitalize cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900 p-1 rounded transition-colors"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400 flex-shrink-0"></span>
                    <span className="truncate">{d.entity_text}</span>
                    {d.icd10_mapping && (
                      <span className="text-[11px] font-mono text-blue-500 font-bold ml-auto bg-blue-50/50 dark:bg-blue-950/25 px-1 rounded border border-blue-100/20">
                        {d.icd10_mapping.icd10_code}
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-slate-400">
                  <span className="text-sm">No other diagnoses mentioned.</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic py-4 text-center">Loading Secondary Diagnoses...</div>
        );

      case "meds":
        const parsedMeds = copilotData ? parseMedications(originalText, copilotData.meds) : [];
        return copilotData ? (
          <div className="flex flex-col justify-between h-full flex-1 select-text">
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 scrollbar-thin select-text">
              {parsedMeds.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[11px] font-mono tracking-wider">
                        <th className="pb-1.5 font-bold">Medication</th>
                        <th className="pb-1.5 font-bold">Dose</th>
                        <th className="pb-1.5 font-bold">Route</th>
                        <th className="pb-1.5 font-bold">Frequency</th>
                        <th className="pb-1.5 font-bold text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {parsedMeds.map((m, idx) => {
                        const originalEntity = copilotData.meds.find(e => e.entity_text === m.name);
                        return (
                          <tr
                            key={idx}
                            onClick={() => originalEntity && setClickedEntity(originalEntity)}
                            className="hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer font-sans"
                          >
                            <td className="py-2 pr-2 font-bold text-slate-800 dark:text-slate-200 truncate max-w-[80px]">{m.name}</td>
                            <td className="py-2 pr-2 text-slate-500 font-mono">{m.dose}</td>
                            <td className="py-2 pr-2 text-slate-500 font-mono">{m.route}</td>
                            <td className="py-2 pr-2 text-slate-500 font-mono">{m.frequency}</td>
                            <td className="py-2 text-right">
                              <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${m.status === "approved" || m.status === "edited" ? "bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400" : "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400"}`}>
                                {m.status === "pending" ? "Awaiting review" : m.status === "approved" ? "Approved" : m.status === "edited" ? "Edited" : m.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400 text-xs text-center border border-dashed border-slate-100 dark:border-slate-800 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-900/10">
                  <Info className="h-5 w-5 mb-1.5 text-slate-300" />
                  <span>No medications mentioned in this note.</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic py-4 text-center">Loading Medications...</div>
        );

      case "allergies":
        const parsedAllergies = copilotData ? parseAllergies(originalText, copilotData.allergies) : [];
        return copilotData ? (
          <div className="flex flex-col justify-between h-full flex-1 select-text">
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 scrollbar-thin select-text">
              {parsedAllergies.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[11px] font-mono tracking-wider">
                        <th className="pb-1.5 font-bold">Allergen</th>
                        <th className="pb-1.5 font-bold">Reaction</th>
                        <th className="pb-1.5 font-bold">Severity</th>
                        <th className="pb-1.5 font-bold text-right">Confidence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {parsedAllergies.map((a, idx) => {
                        const originalEntity = copilotData.allergies.find(e => e.entity_text === a.name);
                        return (
                          <tr
                            key={idx}
                            onClick={() => originalEntity && setClickedEntity(originalEntity)}
                            className="hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer font-sans"
                          >
                            <td className="py-2 pr-2 font-bold text-amber-700 dark:text-amber-400 truncate max-w-[80px]">{a.name}</td>
                            <td className="py-2 pr-2 text-slate-500 truncate max-w-[120px]">{a.reaction}</td>
                            <td className="py-2 pr-2 font-mono text-[11px] font-bold">
                              <span className={`px-1 rounded ${a.severity === "Severe" ? "bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-400" : "bg-amber-50 text-amber-600 dark:bg-amber-950/20 dark:text-amber-400"}`}>
                                {a.severity}
                              </span>
                            </td>
                            <td className="py-2 text-right font-mono text-xs text-slate-400">{scoreLabel(a.confidence)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400 text-xs text-center border border-dashed border-slate-100 dark:border-slate-800 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-900/10">
                  <Info className="h-5 w-5 mb-1.5 text-slate-400" />
                  <span>No allergies mentioned in this note.</span>
                  <span className="mt-1 text-slate-500">Not a confirmed absence: check the Record tab.</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic py-4 text-center">Loading Allergies...</div>
        );

      case "clinical_findings":
        const symptoms = insights ? insights.entities.filter(e => e.entity_type === "Symptom" && e.review_status !== "rejected") : [];
        const procedures = insights ? insights.entities.filter(e => e.entity_type === "Procedure" && e.review_status !== "rejected") : [];
        const findingsList = [...symptoms, ...procedures];
        return insights ? (
          <div className="flex flex-col justify-between h-full flex-1 select-text">
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 scrollbar-thin">
              {findingsList.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[11px] font-mono tracking-wider">
                        <th className="pb-1.5 font-bold">Finding</th>
                        <th className="pb-1.5 font-bold">Category</th>
                        <th className="pb-1.5 font-bold">Confidence</th>
                        <th className="pb-1.5 font-bold text-right">Evidence Snippet</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {findingsList.map((f, idx) => (
                        <tr
                          key={idx}
                          onClick={() => setClickedEntity(f)}
                          className="hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer font-sans"
                        >
                          <td className="py-2 pr-2 font-bold text-slate-800 dark:text-slate-200 truncate max-w-[100px]">{f.entity_text}</td>
                          <td className="py-2 pr-2 text-slate-500">
                            <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-mono font-bold uppercase ${f.entity_type === "Symptom" ? "bg-amber-50 text-amber-600 dark:bg-amber-950/20 dark:text-amber-400" : "bg-purple-50 text-purple-600 dark:bg-purple-950/20 dark:text-purple-400"}`}>
                              {f.entity_type}
                            </span>
                          </td>
                          <td className="py-2 pr-2 font-mono text-slate-400">{scoreLabel(f.confidence)}</td>
                          <td className="py-2 text-right text-slate-400 truncate max-w-[120px] italic font-sans" title={f.evidence}>"{f.evidence || "Narrative log match."}"</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400 text-xs text-center border border-dashed border-slate-100 dark:border-slate-800 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-900/10">
                  <Info className="h-5 w-5 mb-1.5 text-slate-300" />
                  <span>No symptoms or procedures mentioned in this note.</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic py-4 text-center">Loading Clinical Findings...</div>
        );

      case "document_metadata":
        return selectedDocument ? (
          <div className="flex flex-col justify-between h-full flex-1 select-text text-xs space-y-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 bg-slate-50/50 dark:bg-slate-900/20 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
              <div>
                <span className="text-[11px] font-mono uppercase text-slate-400 block">File Identifier</span>
                <span className="font-bold font-mono text-slate-800 dark:text-slate-200 text-xs truncate block">{selectedDocument.document_id}</span>
              </div>
              <div>
                <span className="text-[11px] font-mono uppercase text-slate-400 block">Original Filename</span>
                <span className="font-bold text-slate-800 dark:text-slate-200 truncate block">{selectedDocument.file_name}</span>
              </div>
              <div>
                <span className="text-[11px] font-mono uppercase text-slate-400 block">Classification</span>
                <span className="font-bold text-blue-600 dark:text-blue-400 block">{selectedDocument.classification || "Unclassified"}</span>
              </div>
              <div>
                <span className="text-[11px] font-mono uppercase text-slate-400 block">Status</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold inline-block ${selectedDocument.status === "completed" ? "bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400" : selectedDocument.status === "failed" ? "bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400" : "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400"}`}>
                  {selectedDocument.status === "completed" ? "Analysed" : selectedDocument.status === "pending" ? "Not analysed" : selectedDocument.status}
                </span>
              </div>
              <div>
                <span className="text-[11px] font-mono uppercase text-slate-400 block">Note date</span>
                <span className="font-bold text-slate-500 block">{formatDate(selectedDocument.document_date || selectedDocument.upload_date)}</span>
              </div>
              <div>
                <span className="text-[11px] font-mono uppercase text-slate-400 block">Document Type</span>
                <span className="font-bold font-mono text-slate-500 uppercase block">{selectedDocument.file_type} format</span>
              </div>
            </div>
            <div className="flex items-center space-x-2 text-[11px] text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
              <span>Source: {selectedDocument.source_system || "unknown"}</span>
              <span>•</span>
              <span>{originalText ? `${originalText.length.toLocaleString()} characters` : "text unavailable"}</span>
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic py-4 text-center">No active document selected.</div>
        );

      case "risk":
        return riskInfo ? (
          <div className="flex flex-col justify-between h-full flex-1 select-text">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold uppercase ${riskInfo.risk_level === 'High' ? 'bg-red-50 text-red-600 dark:bg-red-950/35 dark:text-red-400 border border-red-500/20 animate-pulse' : 'bg-amber-50 text-amber-600 dark:bg-amber-950/35 dark:text-amber-400 border border-amber-500/20'}`}>
                  {riskInfo.risk_level} Risk Level
                </span>
              </div>
              <div className="flex items-baseline space-x-1">
                <span className="text-4xl font-extrabold text-slate-900 dark:text-white font-mono">{riskInfo.score}</span>
                <span className="text-xs text-slate-400 font-semibold">/ 100</span>
              </div>
              {riskInfo.risk_factors && (
                <div className="text-xs text-slate-500 max-h-16 overflow-y-auto space-y-1 scrollbar-thin pr-1 font-sans">
                  {riskInfo.risk_factors.map((factor, idx) => (
                    <div key={idx} className="flex items-start space-x-1 bg-slate-50/50 dark:bg-slate-900/30 p-1 rounded">
                      <span className="text-amber-500 font-bold">•</span>
                      <span className="truncate">{factor}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <span className="text-[11px] text-slate-400 font-semibold uppercase block mt-2">Clinical Priority: {riskInfo.review_priority}</span>
            <span className="text-[11px] text-amber-600 font-mono uppercase block mt-1">Heuristic prototype - not clinically validated</span>
            <span className="text-[11px] text-slate-400 block mt-1">
              Based on {riskInfo.reviewed_entities} human-reviewed AI entities{riskInfo.pending_entities > 0 ? `; ${riskInfo.pending_entities} awaiting review are not counted` : ""}.
            </span>
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic py-4 text-center">Loading Risk Assessment...</div>
        );

      case "icd10":
        return copilotData ? (
          <div className="flex flex-col justify-between h-full flex-1 select-text">
            <div className="space-y-2 max-h-[225px] overflow-y-auto pr-1 scrollbar-thin">
              {copilotData.diseases.length > 0 ? (
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase text-[11px] font-mono tracking-wider">
                      <th className="pb-1.5 font-bold">Target Diagnosis</th>
                      <th className="pb-1.5 font-bold">ICD-10 Code</th>
                      <th className="pb-1.5 font-bold">Confidence</th>
                      <th className="pb-1.5 font-bold">Status</th>
                      <th className="pb-1.5 font-bold text-right">Review Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {copilotData.diseases.map((ent, idx) => (
                      <tr
                        key={idx}
                        onClick={() => setClickedEntity(ent)}
                        className="hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer font-sans"
                      >
                        <td className="py-2.5 pr-2 font-bold text-slate-900 dark:text-white capitalize">
                          {ent.entity_text}
                          {ent.evidence && <div className="text-[11px] text-slate-400 italic mt-0.5 truncate max-w-[120px]" title={ent.evidence}>"{ent.evidence}"</div>}
                        </td>
                        <td className="py-2.5 pr-2 font-mono">
                          <span className="px-1.5 py-0.5 rounded font-mono font-bold bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border border-blue-100/30 dark:border-blue-900/30">
                            {ent.icd10_mapping?.icd10_code || "Unmapped"}
                          </span>
                          <span className="text-[11px] text-slate-400 block mt-1 truncate max-w-[120px]">{ent.icd10_mapping?.code_description || "No dictionary code - code manually"}</span>
                        </td>
                        <td className="py-2.5 pr-2 font-mono text-slate-400">{ent.icd10_mapping ? scoreLabel(ent.icd10_mapping.confidence, "dictionary match") : "—"}</td>
                        <td className="py-2.5 pr-2">
                          <span className={`px-1 py-0.5 rounded text-[11px] font-bold uppercase ${ent.review_status === "approved" ? "bg-green-50 text-green-600 dark:bg-green-950/20 dark:text-green-400" : ent.review_status === "rejected" ? "bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-400" : "bg-amber-50 text-amber-600 dark:bg-amber-950/20 dark:text-amber-400"}`}>
                            {ent.review_status}
                          </span>
                        </td>
                        <td className="py-2.5 text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                          {!canReview ? null : ent.review_status === "pending" ? (
                            <div className="inline-flex space-x-0.5">
                              <button
                                onClick={() => handleReviewEntity(ent.entity_id, "approved")}
                                className="p-0.5 rounded hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-950/20 border border-slate-100 dark:border-slate-800"
                                title="Approve Mapping"
                              >
                                <Check className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => handleReviewEntity(ent.entity_id, "rejected")}
                                className="p-0.5 rounded hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20 border border-slate-100 dark:border-slate-800"
                                title="Reject Mapping"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleReviewEntity(ent.entity_id, "pending")}
                              className="px-1.5 py-0.5 rounded text-[11px] border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900"
                            >
                              Reset
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400 text-xs text-center border border-dashed border-slate-100 dark:border-slate-800 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-900/10">
                  <Info className="h-5 w-5 mb-1.5 text-slate-300" />
                  <span>No ICD-10 diagnostic mappings resolved.</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic py-4 text-center">Loading ICD-10 Mapping...</div>
        );

      case "nlp_entities":
        return insights ? (
          <div className="space-y-4 max-h-[350px] overflow-y-auto scrollbar-thin select-text">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-900 bg-slate-50/30 dark:bg-slate-950 text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
                {insights.entities && insights.entities.length > 0 ? (
                  insights.entities.map(ent => (
                    <tr
                      key={ent.entity_id}
                      onClick={() => setExplainEntity(ent)}
                      className={`text-slate-600 dark:text-slate-300 text-xs transition-colors cursor-pointer hover:bg-slate-50/40 dark:hover:bg-slate-900/20 ${ent.review_status === 'rejected' ? 'line-through opacity-30 bg-red-50/10' : ''} ${explainEntity?.entity_id === ent.entity_id ? 'bg-blue-50/50 dark:bg-blue-950/20 border-l-2 border-blue-500' : ''}`}
                    >
                      <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
                        {editingEntityId === ent.entity_id ? (
                          <input
                            type="text"
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            className="px-2 py-1 bg-slate-50 dark:bg-slate-900 border border-blue-500 rounded text-[11px]"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleReviewEntity(ent.entity_id, "edited", editingText);
                                setEditingEntityId(null);
                              }
                            }}
                          />
                        ) : (
                          <span>{ent.entity_text}</span>
                        )}
                        <div className="text-[11px] text-slate-400 font-mono">Conf: {scoreLabel(ent.confidence)}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${ent.entity_type === 'Disease' ? 'bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-400' : 'bg-blue-50 text-blue-600 dark:bg-blue-950/20 dark:text-blue-400'}`}>
                          {ent.entity_type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                        {canReview && ent.review_status === "pending" && (
                          <div className="inline-flex space-x-0.5">
                            <button
                              onClick={() => handleReviewEntity(ent.entity_id, "approved")}
                              className="p-0.5 rounded hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-950/25 border border-slate-100 dark:border-slate-800"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => {
                                setEditingEntityId(ent.entity_id);
                                setEditingText(ent.entity_text);
                              }}
                              className="p-0.5 rounded hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 border border-slate-100 dark:border-slate-800"
                            >
                              <Edit2 className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => handleReviewEntity(ent.entity_id, "rejected")}
                              className="p-0.5 rounded hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/25 border border-slate-100 dark:border-slate-800"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                        {ent.review_status !== "pending" && (
                          <span className="text-[11px] font-bold uppercase text-slate-400">{ent.review_status}</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="text-center py-6 text-slate-400 text-xs">No entities extracted.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic">No clinical note or entities available.</div>
        );

      case "timeline":
        return patientRecord && patientRecord.timeline.length > 0 ? (
          <div className="max-h-[36rem] overflow-y-auto pr-1 scrollbar-thin select-text">
            <ol className="relative border-l border-slate-200 dark:border-slate-800 ml-2 space-y-3">
              {patientRecord.timeline.map((e, idx) => (
                <li key={idx} className="ml-4">
                  <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-white dark:border-slate-950 bg-blue-500"></span>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <time className="text-xs text-slate-500">{formatDate(e.at)}</time>
                    <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 capitalize">{e.kind}</span>
                  </div>
                  <p className="text-sm text-slate-800 dark:text-slate-200">{e.label}{e.detail ? <span className="text-slate-500"> - {e.detail}</span> : null}</p>
                </li>
              ))}
            </ol>
            <span className="text-xs text-slate-500 block mt-3">Most recent {patientRecord.timeline.length} dated events from {sourceLabel(patientRecord.source_system)}</span>
          </div>
        ) : (
          <div className="text-xs text-slate-400 italic py-6 text-center">No dated clinical events recorded for this patient.</div>
        );

      case "fhir_export":
        const passed = fhirMeta?.validation.startsWith("structural-r4: pass");
        return (
          <div className="space-y-3 flex-1 flex flex-col select-text">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                onClick={() => selectedPatient && loadFhirBundle(selectedPatient.patient_id)}
                disabled={!selectedPatient || fhirLoading}
                className="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50"
              >
                {fhirLoading ? "Generating..." : fhirBundle ? "Regenerate" : "Generate FHIR bundle"}
              </button>
              {fhirBundle && selectedPatient && passed && (
                <button
                  onClick={() => {
                    const url = URL.createObjectURL(new Blob([fhirBundle], { type: "application/fhir+json" }));
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `patient_${selectedPatient.patient_id}_fhir.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 font-semibold flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-900"
                >
                  <Download className="h-4 w-4" /> Download JSON ({(fhirMeta?.bytes ?? 0) > 1e6 ? `${((fhirMeta?.bytes ?? 0) / 1e6).toFixed(1)} MB` : `${Math.ceil((fhirMeta?.bytes ?? 0) / 1e3)} KB`})
                </button>
              )}
            </div>

            {!fhirBundle && !fhirLoading && !fhirNote && (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Builds a FHIR R4 transaction bundle from this patient's record (encounters, conditions, medications, allergies,
                procedures, observations) plus reviewed AI findings. Each export is recorded in the audit log.
              </p>
            )}
            {fhirNote && <p className="text-sm text-slate-600 dark:text-slate-400">{fhirNote}</p>}

            {fhirMeta && (
              <>
                <div className={`px-3 py-2 rounded-md text-sm border ${passed ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300" : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"}`}>
                  {passed ? "Structural FHIR R4 check passed." : `Structural FHIR R4 check failed: ${fhirMeta.validation}`}
                  <span className="block text-xs opacity-80 mt-0.5">Checks R4 types and cardinality, references resolving in the bundle, and Condition con-4. Other invariants, terminology and AU Base / AU Core profiles are not checked.</span>
                  {!passed && <span className="block text-xs mt-0.5">Download is disabled for a bundle that failed the check.</span>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(fhirMeta.counts).map(([type, count]) => (
                    <span key={type} className="px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {type}: {formatCount(count)}
                    </span>
                  ))}
                </div>
                <pre className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3 overflow-auto border border-slate-200 dark:border-slate-800 font-mono text-xs h-72 text-slate-700 dark:text-slate-300">
                  {fhirMeta.preview}
                  {fhirMeta.lines > 400 ? `\n\n// Preview: first 400 of ${formatCount(fhirMeta.lines)} lines. Download for the full bundle.` : ""}
                </pre>
              </>
            )}
          </div>
        );

      case "knowledge_graph":
        return renderKnowledgeGraph(true);

      case "note_compare":
        return comparisonData ? (
          <div className="space-y-4 select-text">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-900 space-y-1">
                <span className="font-bold text-xs text-slate-700 dark:text-slate-300 block uppercase tracking-wider font-mono">Earlier note ({formatDate(comparisonData.doc1.upload_date)})</span>
                <p className="text-xs text-slate-500 leading-relaxed font-sans max-h-24 overflow-y-auto pr-1">{comparisonData.doc1.summary}</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-900 space-y-1">
                <span className="font-bold text-xs text-slate-700 dark:text-slate-300 block uppercase tracking-wider font-mono">Later note ({formatDate(comparisonData.doc2.upload_date)})</span>
                <p className="text-xs text-slate-500 leading-relaxed font-sans max-h-24 overflow-y-auto pr-1">{comparisonData.doc2.summary}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs pt-3 border-t border-slate-100 dark:border-slate-900">
              <div className="bg-slate-50/50 dark:bg-slate-900/10 p-3 rounded-xl border border-slate-100 dark:border-slate-900/50">
                <span className="font-bold text-slate-500 uppercase block mb-2 font-mono text-[11px]">Diagnoses: + later note only, - earlier note only</span>
                <div className="space-y-1.5">
                  {comparisonData.analysis.diseases.added.map((d: string, i: number) => (
                    <div key={i} className="flex items-center text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 px-2 py-0.5 rounded font-medium">+ {d}</div>
                  ))}
                  {comparisonData.analysis.diseases.resolved.map((d: string, i: number) => (
                    <div key={i} className="flex items-center text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/20 px-2 py-0.5 rounded font-medium line-through">- {d}</div>
                  ))}
                  {comparisonData.analysis.diseases.maintained.map((d: string, i: number) => (
                    <div key={i} className="flex items-center text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded font-medium">{d}</div>
                  ))}
                </div>
              </div>
              <div className="bg-slate-50/50 dark:bg-slate-900/10 p-3 rounded-xl border border-slate-100 dark:border-slate-900/50">
                <span className="font-bold text-slate-500 uppercase block mb-2 font-mono text-[11px]">Medications: + later note only, - earlier note only</span>
                <div className="space-y-1.5">
                  {comparisonData.analysis.medications.added.map((m: string, i: number) => (
                    <div key={i} className="flex items-center text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20 px-2 py-0.5 rounded font-medium" title="Only in the later note">+ {m}</div>
                  ))}
                  {comparisonData.analysis.medications.discontinued.map((m: string, i: number) => (
                    <div key={i} className="flex items-center text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/20 px-2 py-0.5 rounded font-medium line-through" title="Only in the earlier note">- {m}</div>
                  ))}
                  {comparisonData.analysis.medications.maintained.map((m: string, i: number) => (
                    <div key={i} className="flex items-center text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded font-medium" title="In both notes">{m}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-slate-400 text-xs italic">
            No comparison data.
          </div>
        );

      case "copilot":
        return (
          <div className="flex flex-col h-[350px]">
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-[11px] scrollbar-thin select-text">
              {activeConversation && activeConversation.messages && activeConversation.messages.map((msg: any) => (
                <CopilotMessageView key={msg.message_id} msg={msg} onAsk={handleSendCopilotMessage} />
              ))}
              {copilotLoading && <p className="text-xs text-slate-400 italic">Searching the record and asking the local model...</p>}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendCopilotMessage(copilotInput);
              }}
              className="flex border-t border-slate-100 dark:border-slate-900 pt-2 mt-2"
            >
              <input
                type="text"
                value={copilotInput}
                onChange={(e) => setCopilotInput(e.target.value)}
                className="flex-1 px-2.5 py-1.5 rounded-l-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-white focus:outline-none"
                placeholder="Ask Copilot about medications, allergies, ICD-10..."
              />
              <button type="submit" className="px-3 rounded-r-lg bg-blue-600 text-white hover:bg-blue-500">
                <Send className="h-3 w-3" />
              </button>
            </form>
          </div>
        );

      default:
        return <div className="text-xs text-slate-400">Unknown Widget Content</div>;
    }
  };

  // Run initial layout load when component mounts or dependencies change
  useEffect(() => {
    loadUserLayout(userRole);
  }, [token, userRole, isBackendOnline]);

  // Sync Theme State
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  // Restore an existing Supabase session on load; react to sign-out from any tab.
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const accessToken = data.session?.access_token;
      if (accessToken) {
        const res = await fetchProfile(accessToken);
        if (res?.ok) {
          const profile = await res.json();
          setUserRole(profile.role);
          setUserEmail(profile.email);
          setToken(accessToken);
        }
      }
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setToken(null);
        setCurrentView("landing");
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Signed in on the landing or login page: go to the dashboard. Deep links (e.g. /patients/:id) are kept.
  useEffect(() => {
    if (token && (currentView === "landing" || currentView === "login")) {
      router.replace(pathFor("dashboard"));
    }
  }, [token, currentView]);

  // Check Backend
  useEffect(() => {
    checkBackendHealth();
  }, []);

  const checkBackendHealth = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/`);
      if (res.ok) {
        setAiMode((await res.json()).ai_mode ?? null);
        setIsBackendOnline(true);
      } else {
        setIsBackendOnline(false);
      }
    } catch (e) {
      setIsBackendOnline(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadPatients();
      loadGovernanceStats();
    }
  }, [token]);

  // Page-specific lists load when their page opens (fresh on every visit).
  useEffect(() => {
    if (currentView === "admin" && token) loadImportRuns();
    if (currentView === "audit" && token) loadAuditLogs();
  }, [currentView, token]);

  useEffect(() => {
    if (selectedPatient) {
      loadPatientDocuments(selectedPatient.patient_id);
      loadCopilotConversations(selectedPatient.patient_id);
      loadPatientRecord(selectedPatient.patient_id);
      lazyLoaded.current = {};
      setGraphData(null);
      setComparisonData(null);
      setRiskInfo(null);
      setInsights(null);
      setSelectedDocument(null);
      setQaChat([]);
      setExplainEntity(null);
      setSelectedNode(null);
    }
  }, [selectedPatient]);

  // Graph, comparison and risk load only when their tab or dashboard widget is on screen, once per patient.
  const lazyLoaded = useRef<Record<string, string>>({});
  useEffect(() => {
    const pid = selectedPatient?.patient_id;
    if (!pid) return;
    const widgetOn = (id: string) => layout.some(w => w.id === id && w.visible);
    const items: [string, boolean, (patientId: string) => void][] = [
      ["graph", activeTab === "graph" || widgetOn("knowledge_graph"), loadPatientGraph],
      ["compare", activeTab === "compare" || widgetOn("note_compare"), loadComparisonData],
      ["risk", widgetOn("risk"), loadRiskInfo],
    ];
    for (const [key, needed, load] of items) {
      if (needed && lazyLoaded.current[key] !== pid) { lazyLoaded.current[key] = pid; load(pid); }
    }
  }, [selectedPatient, activeTab, layout]);

  useEffect(() => {
    if (selectedDocument) {
      loadDocumentInsights(selectedDocument.document_id);
      loadRedactedText(selectedDocument.document_id);
      setExplainEntity(null);
    }
  }, [selectedDocument]);

  // Stable API helper for the extracted page components (paths are relative to the backend).
  const api = useCallback((path: string, init?: RequestInit) => fetchWithAuth(`${BACKEND_URL}${path}`, init), []);
  const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
    // getSession() returns a refreshed token when the old one is near expiry.
    const { data } = await supabase.auth.getSession();
    const headers: Record<string, string> = {
      ...options.headers as Record<string, string>,
      "Authorization": `Bearer ${data.session?.access_token ?? ""}`
    };
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      // Session invalid or expired beyond refresh: sign in again. (403 = signed in but not permitted; callers handle it.)
      await supabase.auth.signOut();
      setToken(null);
    }
    return res;
  };

  // URL -> selected patient. Unknown or inaccessible ids end in a "not found" state (the API returns 404 for both).
  useEffect(() => {
    if (!route.patientId) {
      if (selectedPatient) setSelectedPatient(null);
      return;
    }
    if (!token || selectedPatient?.patient_id === route.patientId) return;
    const known = patients.find(p => p.patient_id === route.patientId);
    if (known) {
      setSelectedPatient(known);
    } else {
      const wanted = route.patientId;
      getJson(`/api/v1/patients/${wanted}`).then(p => (p ? setSelectedPatient(p) : setMissingPatientId(wanted)));
    }
  }, [route.patientId, patients, token]);

  // URL -> selected note.
  useEffect(() => {
    if (!route.docId) return;
    const doc = patientDocuments.find(d => d.document_id === route.docId);
    if (doc && doc.document_id !== selectedDocument?.document_id) setSelectedDocument(doc);
  }, [route.docId, patientDocuments]);

  // All data comes from the backend. There is no offline/mock mode: when the API is unreachable the UI says so.
  const loadFhirBundle = async (patientId: string) => {
    setFhirBundle("");
    setFhirNote("");
    setFhirMeta(null);
    setFhirLoading(true);
    try {
      const res = await fetchWithAuth(`${BACKEND_URL}/api/v1/fhir/export/${patientId}`);
      if (res.ok) {
        const text = await res.text();
        const bundle = JSON.parse(text);
        const counts: Record<string, number> = {};
        (bundle.entry || []).forEach((e: any) => { const t = e.resource?.resourceType || "Unknown"; counts[t] = (counts[t] || 0) + 1; });
        const pending = Number(res.headers.get("X-Pending-Entities") || 0);
        setFhirBundle(text);
        // Pretty-print once here; only a preview is rendered (a ~10 MB bundle would freeze the page).
        const lines = JSON.stringify(bundle, null, 2).split("\n");
        setFhirMeta({ validation: res.headers.get("X-FHIR-Validation") || "not reported", counts, bytes: text.length,
                      preview: lines.slice(0, 400).join("\n"), lines: lines.length });
        setFhirNote(`The patient's record plus AI findings a person has reviewed.${pending > 0 ? ` ${pending} AI findings await review and are not included.` : ""}`);
      } else {
        setFhirNote(res.status === 403 ? "FHIR export is not available for your role." : `Export failed (HTTP ${res.status}).`);
      }
    } catch (e) {
      console.error("FHIR export failed", e);
      setFhirNote("Export failed: the API could not be reached.");
    } finally {
      setFhirLoading(false);
    }
  };

  // FHIR export is on demand (button): it can be ~10 MB and every export is audited.
  useEffect(() => { setFhirBundle(""); setFhirNote(""); setFhirMeta(null); }, [selectedPatient?.patient_id]);

  // GET helper: parsed JSON, or null on any failure (callers render an explicit empty/unavailable state).
  const getJson = async (path: string) => {
    try {
      const res = await fetchWithAuth(`${BACKEND_URL}${path}`);
      return res.ok ? await res.json() : null;
    } catch (e) {
      console.error(`GET ${path} failed`, e);
      return null;
    }
  };

  const loadPatients = async () => setPatients((await getJson("/api/v1/patients")) || []);

  const loadPatientDocuments = async (patientId: string) => {
    // Server orders newest first; it returns at most 100 plus the linked note, if any.
    const include = route.docId ? `?include=${encodeURIComponent(route.docId)}` : "";
    let docs: Document[] = [];
    try {
      const res = await fetchWithAuth(`${BACKEND_URL}/api/v1/documents/patient/${patientId}${include}`);
      if (res.ok) {
        docs = await res.json();
        setPatientDocumentTotal(Number(res.headers.get("X-Total-Count")) || docs.length);
      }
    } catch (e) {
      console.error("Loading notes failed", e);
    }
    setPatientDocuments(docs);
    // Open the linked note, else the newest analysed one, else the newest.
    setSelectedDocument(docs.find(d => d.document_id === route.docId) || docs.find(d => d.status === "completed") || docs[0] || null);
  };

  const loadDocumentInsights = async (docId: string) => setInsights(await getJson(`/api/v1/documents/${docId}/insights`));
  const loadAuditLogs = async () => setAuditLogs((await getJson("/api/v1/audit/logs")) || []);
  const loadGovernanceStats = async () => setGovernanceStats(await getJson("/api/v1/patients/governance/stats"));
  const loadRiskInfo = async (patientId: string) => setRiskInfo(await getJson(`/api/v1/patients/${patientId}/risk`));
  const loadPatientGraph = async (patientId: string) => setGraphData(await getJson(`/api/v1/patients/${patientId}/graph`));
  const loadComparisonData = async (patientId: string) => setComparisonData(await getJson(`/api/v1/documents/compare/${patientId}`));
  const loadImportRuns = async () => setImportRuns((await getJson("/api/v1/imports")) || []);
  const loadPatientRecord = async (patientId: string) => {
    setPatientRecord(null);
    setPatientRecord(await getJson(`/api/v1/patients/${patientId}/record`));
  };

  const loadRedactedText = async (docId: string) => {
    const data = await getJson(`/api/v1/documents/${docId}/redacted`);
    setRedactedText(data?.redacted_text || "");
    // Researchers receive no original text (original_text is null): show the redacted text either way.
    setOriginalText(data?.original_text ?? data?.redacted_text ?? "");
    if (data && data.original_text === null) setPhiRedacted(true);
  };

  const handleCreateConversation = async (title: string = "New Q&A Session", patientId?: string) => {
    const activePatientId = patientId || selectedPatient?.patient_id;
    if (!activePatientId) return;
    try {
      const res = await fetchWithAuth(`${BACKEND_URL}/api/v1/copilot/conversations/${activePatientId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(prev => prev.some(c => c.conversation_id === data.conversation_id) ? prev : [data, ...prev]);
        setActiveConversation(data);
      }
    } catch (e) {
      console.error("Failed to create conversation", e);
    }
  };

  const loadCopilotConversations = async (patientId: string) => {
    const data = await getJson(`/api/v1/copilot/conversations/${patientId}`);
    if (!data) {
      setConversations([]);
      setActiveConversation(null);
      return;
    }
    setConversations(data);
    if (data.length > 0) {
      setActiveConversation(data[0]);
    } else {
      await handleCreateConversation("Initial Clinical Assessment Session", patientId);
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    if (!window.confirm("Delete this Copilot session and its messages? This cannot be undone.")) return;
    const res = await fetchWithAuth(`${BACKEND_URL}/api/v1/copilot/conversations/${conversationId}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) return;
    const rest = conversations.filter(c => c.conversation_id !== conversationId);
    setConversations(rest);
    if (activeConversation?.conversation_id === conversationId) setActiveConversation(rest[0] || null);
  };

  const handleSendCopilotMessage = async (content: string) => {
    if (!content.trim() || !activeConversation) return;
    setCopilotLoading(true);
    const userMsg = {
      message_id: `user-msg-${Date.now()}`,
      conversation_id: activeConversation.conversation_id,
      sender: "user",
      content,
      timestamp: new Date().toISOString()
    };
    const updatedMsgs = [...(activeConversation.messages || []), userMsg];
    setActiveConversation({ ...activeConversation, messages: updatedMsgs });
    setConversations(prev => prev.map(c => c.conversation_id === activeConversation.conversation_id ? { ...c, messages: updatedMsgs } : c));
    setCopilotInput("");
    try {
      const res = await fetchWithAuth(`${BACKEND_URL}/api/v1/copilot/chat/${activeConversation.conversation_id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      const assistantMsg = res.ok ? await res.json() : {
        message_id: `error-${Date.now()}`,
        conversation_id: activeConversation.conversation_id,
        sender: "assistant",
        content: "The Copilot request failed, so no answer was produced.",
        citations: "[]",
        confidence: null,
        timestamp: new Date().toISOString()
      };
      const finalConv = { ...activeConversation, messages: [...updatedMsgs, assistantMsg] };
      setActiveConversation(finalConv);
      setConversations(prev => prev.map(c => c.conversation_id === finalConv.conversation_id ? finalConv : c));
    } catch (e) {
      console.error("Failed to send copilot message", e);
    } finally {
      setCopilotLoading(false);
    }
  };

  // --- Handlers ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!isBackendOnline) {
      setLoginError("The ClinicalBrief API is unreachable. Start the backend and try again.");
      return;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email: userEmail, password });
    setPassword("");
    if (error || !data.session) {
      setLoginError(error?.message || "Sign-in failed.");
      return;
    }
    setLoginError(await finishSignIn(data.session.access_token,
      "Signed in, but this account has no ClinicalBrief role yet. Ask an administrator."));
  };

  // Loads the profile for a fresh session; returns an error message (and signs out) if there is no usable role.
  const finishSignIn = async (accessToken: string, noRoleMessage: string): Promise<string | null> => {
    const res = await fetchProfile(accessToken);
    if (!res?.ok) {
      await supabase.auth.signOut();
      return res?.status === 403 ? noRoleMessage : "Signed in, but your ClinicalBrief profile could not be loaded.";
    }
    const profile = await res.json();
    setUserRole(profile.role);
    setUserEmail(profile.email);
    setToken(accessToken);
    return null;
  };

  // "Try the demo": anonymous sign-in; the signup trigger gives anonymous users the read-only `demo` role.
  const handleTryDemo = async (captchaToken?: string): Promise<string | null> => {
    if (!isBackendOnline) return "The ClinicalBrief API is unreachable right now. Please try again in a minute.";
    const { data, error } = await supabase.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
    if (error || !data.session) {
      return /anonymous/i.test(error?.message || "") ? "The public demo is not switched on yet." : error?.message || "Could not start the demo.";
    }
    return finishSignIn(data.session.access_token, "The demo account could not be set up. Please try again later.");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setToken(null);
    setSelectedPatient(null);
    setSelectedDocument(null);
    setInsights(null);
    setCurrentView("landing");
  };

  // Polls the real processing state until the pipeline finishes (no simulated progress).
  const pollDocument = async (docId: string): Promise<ProcessingStatus | null> => {
    const started = Date.now();
    while (Date.now() - started < 120000) {
      const st: ProcessingStatus | null = await getJson(`/api/v1/documents/${docId}/status`);
      if (st) {
        setProcessingStatus(st);
        if (st.status === "completed" || st.status === "failed") return st;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    return null;
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !uploadPatientId) {
      setUploadStatus("Please choose a patient and a .txt file.");
      return;
    }
    setUploadStatus("processing");
    setProcessingStatus(null);
    try {
      const formData = new FormData();
      formData.append("patient_id", uploadPatientId);
      formData.append("file", uploadFile);
      const res = await fetchWithAuth(`${BACKEND_URL}/api/v1/documents/upload`, { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setUploadStatus(`Upload failed: ${err?.detail || `HTTP ${res.status}`}`);
        return;
      }
      const doc = await res.json();
      const final = await pollDocument(doc.document_id);
      if (final?.status === "completed") {
        setUploadStatus("success");
        const patient = patients.find(p => p.patient_id === uploadPatientId);
        if (patient) {
          openPatient(patient);
        }
      } else {
        setUploadStatus(final ? "Processing failed: the note was stored but not analysed." : "Processing is taking longer than expected. Check the patient record later.");
      }
    } catch (e) {
      setUploadStatus("Upload error: the API could not be reached.");
    }
  };

  const handleProcessDocument = async (docId: string) => {
    try {
      const res = await fetchWithAuth(`${BACKEND_URL}/api/v1/documents/${docId}/process`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(`Could not process this note: ${err?.detail || `HTTP ${res.status}`}`);
        return;
      }
      setProcessingStatus({ document_id: docId, status: "processing", step: 0, elapsed_seconds: null });
      const final = await pollDocument(docId);
      const newStatus = final?.status || "processing";
      setPatientDocuments(prev => prev.map(d => d.document_id === docId ? { ...d, status: newStatus } : d));
      setSelectedDocument(d => d && d.document_id === docId ? { ...d, status: newStatus } : d);
    } catch (e) {
      console.error("Processing request failed", e);
    }
  };

  const handleReviewEntity = async (entityId: string, status: "approved" | "rejected" | "edited" | "pending", editedText?: string) => {
    try {
      const res = await fetchWithAuth(`${BACKEND_URL}/api/v1/documents/entities/${entityId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, edited_text: editedText })
      });
      if (res.ok) {
        const updatedEntity = await res.json();
        setInsights(prev => prev ? { ...prev, entities: prev.entities.map(e => e.entity_id === entityId ? updatedEntity : e) } : prev);
      } else if (res.status === 403) {
        alert("Your role does not permit reviewing AI output.");
      }
    } catch (e) {
      console.error("Failed to review entity", e);
    }
  };

  const handleQaQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qaQuestion.trim() || !selectedDocument) return;
    const newQuestion = qaQuestion;
    setQaQuestion("");
    setQaChat([...qaChat, { q: newQuestion, a: "", loading: true }]);
    let answer = "Network error occurred.";
    try {
      const res = await fetchWithAuth(`${BACKEND_URL}/api/v1/search/qa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: selectedDocument.document_id, question: newQuestion })
      });
      answer = res.ok ? (await res.json()).answer : "Error formulating answer.";
    } catch (e) {
      // keep the network error message
    }
    setQaChat(prev => prev.map(chat => chat.q === newQuestion ? { q: newQuestion, a: answer } : chat));
  };

  const getCopilotInsights = () => {
    if (!insights || !insights.entities) return null;
    const meds = insights.entities.filter(e => e.entity_type === "Medication" && e.review_status !== "rejected");
    const allergies = insights.entities.filter(e => e.entity_type === "Allergy" && e.review_status !== "rejected");
    const diseases = insights.entities.filter(e => e.entity_type === "Disease" && e.review_status !== "rejected");
    return {
      meds,
      allergies,
      diseases,
      primaryDiag: diseases[0] || null,
      secondaryDiags: diseases.slice(1),
      summaryText: insights.summary?.summary_text || "",
      attribution: aiMode === "transformers" ? "Transformer pipeline (BART / biomedical NER)" : "Rule-based prototype pipeline (dictionary matching)"
    };
  };

  // --- Views ---

  const renderLogin = () => (
    <LoginPage onTryDemo={handleTryDemo} email={userEmail} onEmailChange={setUserEmail} password={password} onPasswordChange={setPassword}
      onSubmit={handleLogin} error={loginError} />
  );

  const renderDashboardLayout = (content: React.ReactNode) => (
    <div className="min-h-screen flex bg-[#FAFCF7] dark:bg-[#0B1209] text-[#090F05] dark:text-[#F7F9F4] transition-colors duration-300">
      {navOpen && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <aside id="app-nav" className={`w-64 shrink-0 border-r border-slate-200/50 dark:border-slate-800/40 bg-white dark:bg-[#0B1209] flex flex-col gap-3 p-5 h-screen z-50 fixed inset-y-0 left-0 transition-transform duration-300 md:sticky md:top-0 md:translate-x-0 ${navOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="space-y-6 flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
          <div className="flex items-center space-x-2.5 px-1 py-1">
            <div className="h-7 w-7 rounded-lg bg-blue-600 flex items-center justify-center text-white">
              <HeartPulse className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold text-[#090F05] dark:text-white">Clinical<span className="text-blue-600 dark:text-blue-500 font-extrabold">Brief</span></span>
          </div>

          <div className="p-3 rounded-2xl border border-slate-100 dark:border-slate-900 bg-slate-50 dark:bg-slate-900/30 flex items-center space-x-3">
            <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800/40 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold uppercase text-xs">
              {isDemo ? "D" : userEmail ? userEmail[0] : "D"}
            </div>
            <div className="overflow-hidden">
              <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate">{isDemo ? "Demo visitor" : userEmail || "Signed in"}</p>
              <p className="text-[11px] text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wide">{userRole}</p>
            </div>
          </div>

          <nav className="space-y-1">
            <button
              onClick={() => setCurrentView("dashboard")}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 text-xs font-semibold rounded-xl transition-all ${currentView === "dashboard" && !selectedPatient ? "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/10" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900/40"}`}
            >
              <Activity className="h-4 w-4" />
              <span>Dashboard</span>
            </button>

            <button
              onClick={() => setCurrentView("patients")}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 text-xs font-semibold rounded-xl transition-all ${currentView === "patients" || currentView === "patient" ? "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/10" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900/40"}`}
            >
              <UserIcon className="h-4 w-4" />
              <span>Patients</span>
            </button>

            {!isDemo && <button
              onClick={() => setCurrentView("upload")}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 text-xs font-semibold rounded-xl transition-all ${currentView === "upload" ? "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/10" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900/40"}`}
            >
              <FileUp className="h-4 w-4" />
              <span>Upload Center</span>
            </button>}

            <button
              onClick={() => setCurrentView("search")}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 text-xs font-semibold rounded-xl transition-all ${currentView === "search" ? "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/10" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900/40"}`}
            >
              <Search className="h-4 w-4" />
              <span>Search records</span>
            </button>

            {["admin", "clinician", "consultant", "coder"].includes(userRole) && (
              <button
                onClick={() => setCurrentView("review")}
                className={`w-full flex items-center space-x-3 px-3.5 py-2.5 text-xs font-semibold rounded-xl transition-all ${currentView === "review" ? "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/10" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900/40"}`}
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Review queue</span>
              </button>
            )}

            {(userRole === "admin" || userRole === "auditor") && (
              <button
                onClick={() => setCurrentView("governance")}
                className={`w-full flex items-center space-x-3 px-3.5 py-2.5 text-xs font-semibold rounded-xl transition-all ${currentView === "governance" ? "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/10" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900/40"}`}
              >
                <Activity className="h-4 w-4" />
                <span>Governance</span>
              </button>
            )}

            {(userRole === "admin" || userRole === "auditor") && (
              <button
                onClick={() => setCurrentView("ops")}
                className={`w-full flex items-center space-x-3 px-3.5 py-2.5 text-xs font-semibold rounded-xl transition-all ${currentView === "ops" ? "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/10" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900/40"}`}
              >
                <HeartPulse className="h-4 w-4" />
                <span>System health</span>
              </button>
            )}

            {!isDemo && <button
              onClick={() => setCurrentView("audit")}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 text-xs font-semibold rounded-xl transition-all ${currentView === "audit" ? "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/10" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900/40"}`}
            >
              <ShieldAlert className="h-4 w-4" />
              <span>Audit Trails</span>
            </button>}

            <button
              onClick={() => setCurrentView("settings")}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 text-xs font-semibold rounded-xl transition-all ${currentView === "settings" ? "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/10" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900/40"}`}
            >
              <SettingsIcon className="h-4 w-4" />
              <span>Model Settings</span>
            </button>

            {(userRole === "admin" || userRole === "auditor") && (
              <button
                onClick={() => setCurrentView("admin")}
                className={`w-full flex items-center space-x-3 px-3.5 py-2.5 text-xs font-semibold rounded-xl transition-all ${currentView === "admin" ? "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/10" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900/40"}`}
              >
                <Database className="h-4 w-4" />
                <span>Data Imports</span>
              </button>
            )}
          </nav>

          <div className="pt-4 border-t border-slate-100 dark:border-slate-900">
            <label className="block text-xs uppercase font-bold tracking-wider text-slate-500 mb-2 px-2" htmlFor="sidebar-patient-search">Find patient</label>
            <input
              id="sidebar-patient-search"
              type="search"
              value={sidebarQuery}
              onChange={(e) => setSidebarQuery(e.target.value)}
              placeholder="Name or ID"
              className="w-full mb-2 px-3 py-2 rounded-lg premium-input text-xs"
            />
            <div className="space-y-1">
              {filterPatients(patients, sidebarQuery, "all", false).slice(0, 8).map(p => (
                <button
                  key={p.patient_id}
                  onClick={() => openPatient(p)}
                  className={`w-full flex items-center justify-between text-left px-2 py-2 rounded-xl text-xs transition-all ${selectedPatient?.patient_id === p.patient_id ? "bg-blue-50/50 dark:bg-blue-950/25 text-blue-600 dark:text-blue-400 font-bold border border-blue-100/30 dark:border-blue-900/10" : "text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-900/20"}`}
                >
                  <span className="truncate">{displayName(p)}</span>
                  <ChevronRight className="h-3 w-3 opacity-60" />
                </button>
              ))}
              <button onClick={() => setCurrentView("patients")} className="w-full text-left px-2 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline">
                All patients ({formatCount(patients.length)})
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar Footer */}
        <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-900">
          <div className="flex items-center justify-between border border-slate-100 dark:border-slate-900 bg-slate-50 dark:bg-slate-900/20 p-1 rounded-full">
            <button
              onClick={() => setDarkMode(false)}
              className={`flex-1 py-1 flex justify-center rounded-full text-slate-500 transition-all ${!darkMode ? 'bg-white dark:bg-slate-800 shadow text-blue-600' : 'hover:text-slate-700'}`}
            >
              <Sun className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setDarkMode(true)}
              className={`flex-1 py-1 flex justify-center rounded-full text-slate-500 transition-all ${darkMode ? 'bg-white dark:bg-slate-800 shadow text-blue-500' : 'hover:text-slate-200'}`}
            >
              <Moon className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center space-x-3 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-xl transition-all"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto h-screen px-4 md:px-8 pb-6 md:py-6 w-full min-h-screen">
        {/* Phones: top bar with the menu button (the sidebar is off-canvas below md) */}
        <div className="md:hidden sticky top-0 z-30 -mx-4 mb-4 px-4 py-3 flex items-center justify-between border-b border-slate-200/50 dark:border-slate-800/40 bg-white/90 dark:bg-[#0B1209]/90 backdrop-blur">
          <span className="text-lg font-bold text-[#090F05] dark:text-white">Clinical<span className="text-blue-600 dark:text-blue-500 font-extrabold">Brief</span></span>
          <button onClick={() => setNavOpen(true)} aria-label="Open menu" aria-expanded={navOpen} aria-controls="app-nav"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200">
            <Menu className="h-5 w-5" />
          </button>
        </div>
        {isDemo && (
          <div role="status" className="mb-6 px-4 py-2.5 rounded-xl border border-[#B2EB76] bg-[#F4FAED] dark:bg-[#B2EB76]/10 dark:border-[#B2EB76]/30 text-xs text-[#18280E] dark:text-[#DFF5C4] flex flex-wrap items-center justify-between gap-2">
            <span>
              <b className="font-semibold">Demo:</b> {patients.length || 10} synthetic patients, read-only. Copilot runs the rule-based fallback on the hosted demo.
            </span>
            <button onClick={handleLogout} className="px-2.5 py-1 rounded-md border border-[#18280E]/30 dark:border-[#B2EB76]/40 font-semibold hover:bg-white/60 dark:hover:bg-white/10">Leave demo</button>
          </div>
        )}
        {!isBackendOnline && (
          <div className="mb-4 p-3 rounded-xl border border-red-200 bg-red-50 text-xs text-red-700 flex items-center justify-between">
            <span>The ClinicalBrief API is unreachable. No data can be shown until it is back.</span>
            <button onClick={checkBackendHealth} className="px-2 py-1 rounded border border-red-300 font-semibold">Retry</button>
          </div>
        )}
        <div className="animate-slide-up">
          {content}
        </div>
      </main>
    </div>
  );

  const renderDashboard = () => {
    // Governance metrics are only returned to admin/auditor; other roles see the registry without them.
    const stats = governanceStats;

    return (
      <div className="space-y-8 animate-slide-up">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Governance Dashboard</h1>
            <p className="text-[#4A5B38] dark:text-slate-400 text-sm mt-1">Patient registry and human-review status of AI output.</p>
          </div>

          {!isDemo && <button
            onClick={() => setCurrentView("upload")}
            className="px-4 py-2.5 text-xs rounded-full bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center space-x-2 transition-all shadow-lg shadow-blue-500/10"
          >
            <FileUp className="h-4 w-4" />
            <span>Ingest Document</span>
          </button>}
        </div>

        {stats ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
            <MetricCard title="Documents" value={stats.total_documents} description="Clinical notes in the system" icon={<FileText className="h-5 w-5" />} />
            <MetricCard title="Patients" value={stats.total_patients} description="In the registry" icon={<UserIcon className="h-5 w-5" />} />
            <MetricCard
              title="Reviewer Approval Rate"
              value={scoreLabel(stats.review_metrics.approval_rate, "—")}
              description={`Approved / reviewed AI entities (n=${stats.review_metrics.total_reviewed}). Not a validated accuracy measure.`}
              icon={<Award className="h-5 w-5" />}
            />
            <MetricCard title="Human Reviewed Entities" value={stats.review_metrics.total_reviewed} description="Approved, edited, or rejected" icon={<CheckCircle2 className="h-5 w-5" />} />
          </div>
        ) : (
          <div className="premium-card p-5 text-xs text-slate-500">Governance metrics are available to administrators and auditors.</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 premium-card overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-900 bg-slate-50/50 dark:bg-slate-900/25 flex items-center justify-between">
              <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">Recently seen patients</span>
              <button onClick={() => setCurrentView("patients")} className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline">
                View all {formatCount(patients.length)} patients
              </button>
            </div>

            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-900 bg-slate-50/30 dark:bg-slate-950 text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                  <th className="px-6 py-3.5">Patient</th>
                  <th className="px-6 py-3.5">Age</th>
                  <th className="px-6 py-3.5">Last encounter</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
                {patients.filter(hasRealRecentDate).sort((a, b) => (b.last_encounter_at || "").localeCompare(a.last_encounter_at || "")).slice(0, 8).map(p => (
                  <tr key={p.patient_id} className="hover:bg-slate-50/40 dark:hover:bg-slate-900/20 text-slate-600 dark:text-slate-300 text-xs transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-bold text-slate-900 dark:text-white">{displayName(p)}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{sourceLabel(p.source_system)}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-400">{ageLabel(p)}</td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-400">{formatDate(p.last_encounter_at)}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => openPatient(p)}
                        className="px-3.5 py-1.5 text-[11px] font-bold rounded-full border border-slate-200 dark:border-slate-800 hover:border-slate-300 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 transition-all shadow-sm"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-5 rounded-[24px] border border-blue-100 dark:border-blue-900/25 bg-blue-50/10 dark:bg-blue-950/5 flex flex-col space-y-4">
            <div className="flex items-center space-x-2 text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
              <Sparkles className="h-4 w-4" />
              <span>AI Governance Warnings</span>
            </div>

            {stats && (
              <InsightCard
                title="HITL Review Pending"
                type="warning"
                description={`There are currently ${stats.review_metrics.pending} clinical entities awaiting human-in-the-loop validation.`}
                metadata="REVIEW QUEUE"
              />
            )}

            <InsightCard
              title="Redaction is a prototype"
              type="warning"
              description="PHI redaction uses pattern matching (dates, phone numbers, emails, record numbers) and is not a validated de-identification method."
              metadata="PRIVACY"
            />
          </div>
        </div>
      </div>
    );
  };

  const renderProcessingStatus = () => (
    <div className="p-6 rounded-2xl bg-blue-50/10 dark:bg-blue-950/10 border border-blue-100/20 dark:border-blue-900/30 space-y-4 select-none">
      <div className="flex justify-between items-center">
        <h4 className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center">
          <RefreshCw className={`h-4 w-4 mr-1.5 ${processingStatus?.status === "completed" || processingStatus?.status === "failed" ? "" : "animate-spin"}`} />
          Processing: {processingStatus?.status || "uploading"}
        </h4>
        {processingStatus?.elapsed_seconds != null && (
          <span className="text-xs font-mono text-slate-500 bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded-md">
            Measured: {processingStatus.elapsed_seconds.toFixed(2)}s
          </span>
        )}
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        {PIPELINE_STAGES.map(stage => {
          const done = (processingStatus?.step || 0) >= stage.step;
          return (
            <li key={stage.step} className="flex items-center space-x-2">
              <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${done ? "bg-green-500" : "bg-slate-300 dark:bg-slate-700"}`}></span>
              <span className={done ? "text-slate-500" : "text-slate-800 dark:text-slate-200"}>{stage.label}</span>
            </li>
          );
        })}
      </ul>
      {processingStatus?.status === "failed" && <p className="text-xs text-red-600">{processingStatus.error || "Processing failed."}</p>}
      <p className="text-xs text-slate-400">Stages and timing are reported by the backend pipeline. AI mode: {aiMode || "unknown"}.</p>
    </div>
  );

  const renderPatientRecord = () => {
    if (!patientRecord) {
      return <div className="premium-card p-5 text-xs text-slate-400">Loading structured record...</div>;
    }
    const c = patientRecord.counts;
    const recentLabs = patientRecord.observations.slice(0, 8);
    return (
      <div className="premium-card p-5 space-y-4 select-text">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Clinical record</h2>
          <span className="text-xs text-slate-500">
            {[`${formatCount(c.encounters)} encounters`, `${formatCount(c.diagnoses)} diagnoses`, `${formatCount(c.medications)} medications`,
              `${formatCount(c.allergies)} allergies`, `${formatCount(c.procedures)} procedures`, `${formatCount(c.observations)} observations`].join(" \u00b7 ")}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div>
            <h3 className="text-xs uppercase font-semibold tracking-wide text-slate-500 mb-2">Diagnoses</h3>
            <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {patientRecord.diagnoses.slice(0, 15).map((d, i) => (
                <li key={i} className="text-slate-800 dark:text-slate-200">
                  {d.display}
                  <span className="block text-xs text-slate-500">{shortCodeSystem(d.code_system)} {d.code}{d.clinical_status ? ` · ${d.clinical_status}` : ""}</span>
                </li>
              ))}
              {patientRecord.diagnoses.length === 0 && <li className="text-slate-400 italic">None recorded</li>}
            </ul>
          </div>
          <div>
            <h3 className="text-xs uppercase font-semibold tracking-wide text-slate-500 mb-2">Medications</h3>
            <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {patientRecord.medications.slice(0, 15).map((m, i) => (
                <li key={i} className="text-slate-800 dark:text-slate-200">
                  {m.name}
                  <span className="block text-xs text-slate-500">{[m.dose, m.route, m.frequency, m.status].filter(Boolean).join(" · ") || "no dosage recorded"}</span>
                </li>
              ))}
              {patientRecord.medications.length === 0 && <li className="text-slate-400 italic">None recorded</li>}
            </ul>
          </div>
          <div>
            <h3 className="text-xs uppercase font-semibold tracking-wide text-slate-500 mb-2">Allergies</h3>
            <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {patientRecord.allergies.map((a, i) => (
                <li key={i} className="text-slate-800 dark:text-slate-200">
                  {a.allergen}
                  <span className="block text-xs text-slate-500">{[a.reaction, a.severity, a.criticality && `criticality ${a.criticality}`].filter(Boolean).join(" · ") || "no reaction recorded"}</span>
                </li>
              ))}
              {patientRecord.allergies.length === 0 && <li className="text-slate-400 italic">None recorded in source data</li>}
            </ul>
          </div>
          <div>
            <h3 className="text-xs uppercase font-semibold tracking-wide text-slate-500 mb-2">Recent Observations</h3>
            <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {recentLabs.map((o, i) => (
                <li key={i} className="text-slate-800 dark:text-slate-200">
                  {o.name}: <span className="font-mono">{o.value ?? "—"} {o.unit || ""}</span>
                  {o.flag && <span className="ml-1 text-xs font-semibold uppercase text-red-700 dark:text-red-400">{o.flag}</span>}
                  <span className="block text-xs text-slate-500">{formatDate(o.effective_at)}{o.reference_range ? ` · ref ${o.reference_range}` : ""}</span>
                </li>
              ))}
              {recentLabs.length === 0 && <li className="text-slate-400 italic">None recorded</li>}
            </ul>
          </div>
        </div>
      </div>
    );
  };

  const renderPatientList = () => {
    const rows = filterPatients(patients, patientQuery, patientSource, patientsWithNotesOnly);
    const sources = Array.from(new Set(patients.map(p => p.source_system || "unknown")));
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Patients</h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
            {formatCount(rows.length)} of {formatCount(patients.length)} patients you have access to.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[16rem]">
            <label htmlFor="patient-search" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Search</label>
            <input id="patient-search" type="search" autoFocus value={patientQuery} onChange={(e) => setPatientQuery(e.target.value)}
              placeholder="Name or patient ID" className="w-full px-3 py-2.5 rounded-lg premium-input text-sm" />
          </div>
          <div>
            <label htmlFor="patient-source" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Source</label>
            <select id="patient-source" value={patientSource} onChange={(e) => setPatientSource(e.target.value)} className="px-3 py-2.5 rounded-lg premium-input text-sm">
              <option value="all">All sources</option>
              {sources.map(s => <option key={s} value={s}>{sourceLabel(s)}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 pb-2.5">
            <input type="checkbox" checked={patientsWithNotesOnly} onChange={(e) => setPatientsWithNotesOnly(e.target.checked)} />
            Has clinical notes
          </label>
        </div>

        <div className="premium-card overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-5 py-3 font-semibold">Patient</th>
                <th className="px-5 py-3 font-semibold">Sex</th>
                <th className="px-5 py-3 font-semibold">Age</th>
                <th className="px-5 py-3 font-semibold">Source</th>
                <th className="px-5 py-3 font-semibold text-right">Notes</th>
                <th className="px-5 py-3 font-semibold">Last encounter</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
              {rows.map(p => (
                <tr key={p.patient_id} onClick={() => openPatient(p)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/40">
                  <td className="px-5 py-3">
                    <a href={patientPath(p.patient_id)} onClick={(e) => { e.preventDefault(); openPatient(p); }} className="font-semibold text-slate-900 dark:text-white hover:underline">
                      {displayName(p)}
                    </a>
                  </td>
                  <td className="px-5 py-3 text-slate-600 dark:text-slate-400">{p.gender}</td>
                  <td className="px-5 py-3 text-slate-600 dark:text-slate-400">{ageLabel(p)}</td>
                  <td className="px-5 py-3 text-slate-600 dark:text-slate-400">{sourceLabel(p.source_system)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">{formatCount(p.document_count ?? 0)}</td>
                  <td className="px-5 py-3 text-slate-600 dark:text-slate-400">{formatDate(p.last_encounter_at)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">No patients match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderUpload = () => (
    <div className="space-y-6 w-full">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Upload Center</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Upload unstructured medical records to trigger semantic pipelines.</p>
      </div>

      <form onSubmit={handleUpload} className="premium-card p-6 space-y-6">
        <div>
          <label className="block text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Assign to Patient Profile</label>
          <select
            required
            value={uploadPatientId}
            onChange={(e) => setUploadPatientId(e.target.value)}
            className="w-full px-3 py-3 rounded-xl premium-input text-xs"
          >
            <option value="">Select a patient...</option>
            {patients.map(p => (
              <option key={p.patient_id} value={p.patient_id}>{displayName(p)} ({ageLabel(p)}, {sourceLabel(p.source_system)})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">Clinical Note Document (.TXT, UTF-8, max 5 MB)</label>
          <div className="border border-dashed border-slate-200 hover:border-blue-500/50 dark:border-slate-800 dark:hover:border-blue-500/40 bg-slate-50/20 dark:bg-slate-900/10 rounded-2xl p-10 text-center flex flex-col items-center justify-center cursor-pointer transition-all relative overflow-hidden">
            <UploadCloud className="h-10 w-10 text-slate-400 mb-3" />
            {uploadFile ? (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{uploadFile.name}</p>
                <p className="text-xs text-slate-400 font-mono">{(uploadFile.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Click or drag note files here</p>
                <p className="text-[11px] text-slate-400">Plain text narratives or discharge documentation</p>
              </div>
            )}
            <input
              type="file"
              accept=".txt"
              onChange={(e) => { if (e.target.files) setUploadFile(e.target.files[0]); }}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </div>
        </div>

        {uploadStatus === "processing" && renderProcessingStatus()}

        {uploadStatus && uploadStatus !== "processing" && uploadStatus !== "success" && (
          <div className="p-3 rounded-xl border border-red-200/40 bg-red-50/30 text-xs text-red-600">{uploadStatus}</div>
        )}

        <button
          type="submit"
          disabled={uploadStatus === "processing"}
          className="w-full py-3 rounded-full bg-blue-600 hover:bg-blue-500 font-semibold text-white transition-all disabled:opacity-50 flex items-center justify-center space-x-2 shadow-lg shadow-blue-500/10"
        >
          <UploadCloud className="h-4 w-4" />
          <span>Ingest & Run Pipeline</span>
        </button>
      </form>
    </div>
  );

  const renderPatientInsights = () => {
    if (!selectedPatient) return null;
    const patientSection: "record" | "notes" = route.docId ? "notes" : "record";

    const dashboardGridClass = noteHidden ? "lg:col-span-12" : "lg:col-span-7";

    return (
      <div className="space-y-8 animate-slide-up">
        {/* Patient banner: stays visible while scrolling the record */}
        <div className="sticky top-0 md:-top-6 z-30 -mx-8 -mt-6 px-8 py-4 bg-[#FAFCF7]/95 dark:bg-[#0B1209]/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="min-w-0">
            <button onClick={() => setCurrentView("patients")} className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline">
              &larr; Patients
            </button>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight mt-1 truncate">
              {displayName(selectedPatient)}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-slate-600 dark:text-slate-400">
              <span>{ageLabel(selectedPatient)}</span>
              <span className="capitalize">{selectedPatient.gender}</span>
              {selectedPatient.date_of_birth && <span>Born {formatDate(selectedPatient.date_of_birth)}</span>}
              {selectedPatient.deceased_date && <span className="font-semibold text-red-700 dark:text-red-400">Deceased {formatDate(selectedPatient.deceased_date)}</span>}
              <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-xs font-medium">{sourceLabel(selectedPatient.source_system)}</span>
              <span className="font-mono text-xs text-slate-500" title={selectedPatient.patient_id}>ID {selectedPatient.patient_id.slice(0, 8)}</span>
            </div>
            {patientRecord && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">Allergies:</span>
                {patientRecord.allergies.length === 0 ? (
                  <span className="text-slate-500">none recorded in source data</span>
                ) : patientRecord.allergies.map((a, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-md bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900 font-medium">{a.allergen}</span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsCopilotOpen(true)}
              className="px-3 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center gap-2"
            >
              <Sparkles className="h-4 w-4" />
              <span>Ask Copilot</span>
            </button>

          </div>
        </div>

        <nav className="flex gap-1 border-b border-slate-200 dark:border-slate-800" aria-label="Patient sections">
          {([["record", "Record"], ["notes", `Notes (${formatCount(patientDocumentTotal)})`]] as const).map(([key, label]) => (
            <a
              key={key}
              href={key === "record" ? patientPath(selectedPatient.patient_id) : patientPath(selectedPatient.patient_id, selectedDocument?.document_id)}
              onClick={(e) => {
                e.preventDefault();
                router.push(key === "record" ? patientPath(selectedPatient.patient_id)
                  : patientPath(selectedPatient.patient_id, (selectedDocument ?? patientDocuments[0])?.document_id));
              }}
              aria-current={patientSection === key ? "page" : undefined}
              className={`px-4 py-2.5 -mb-px text-sm font-semibold border-b-2 ${patientSection === key ? "border-blue-600 text-blue-700 dark:text-blue-300" : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"}`}
            >
              {label}
            </a>
          ))}
        </nav>

        {patientSection === "record" && (
          <div className="grid grid-cols-1 2xl:grid-cols-3 gap-6 items-start">
            <div className="2xl:col-span-2">{renderPatientRecord()}</div>
            <div className="premium-card p-5">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-3">Timeline</h2>
              {renderWidgetContents("timeline")}
            </div>
            {["admin", "clinician", "consultant", "coder"].includes(userRole) && (
              <div className="premium-card p-5 2xl:col-span-3">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-3">FHIR export</h2>
                {renderWidgetContents("fhir_export")}
              </div>
            )}
          </div>
        )}

        {patientSection === "notes" && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedDocument?.document_id || ""}
              onChange={(e) => {
                const doc = patientDocuments.find(d => d.document_id === e.target.value);
                if (doc) router.push(patientPath(doc.patient_id, doc.document_id));
              }}
              aria-label="Clinical note" className="px-3 py-2 rounded-lg premium-input text-sm max-w-[16rem]"
            >
              <option value="">{patientDocuments.length ? "Select a note..." : "No notes"}</option>
              {patientDocumentTotal > patientDocuments.length && (
                <option value="" disabled>Showing newest {patientDocuments.length} of {formatCount(patientDocumentTotal)}</option>
              )}
              {patientDocuments.map(d => (
                <option key={d.document_id} value={d.document_id}>{d.file_name}{d.status !== "completed" ? ` [${d.status}]` : ""}</option>
              ))}
            </select>

            {selectedDocument && (selectedDocument.status === "pending" || selectedDocument.status === "failed") && ["admin", "clinician", "consultant"].includes(userRole) && (
              <button
                onClick={() => handleProcessDocument(selectedDocument.document_id)}
                disabled={processingStatus?.document_id === selectedDocument.document_id && processingStatus.status === "processing"}
                className="px-3 py-2 text-sm rounded-lg border border-blue-500 text-blue-600 font-semibold hover:bg-blue-50 dark:hover:bg-blue-950/20 disabled:opacity-50"
              >
                Process note
              </button>
            )}

            <button
              onClick={() => setIsCustomizeMode(!isCustomizeMode)}
              className={`px-3 py-2 text-sm rounded-lg font-semibold flex items-center gap-2 border ${isCustomizeMode ? "bg-blue-500 text-white border-blue-600 shadow-md shadow-blue-500/20" : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
              title="Customize workspace widgets layout"
            >
              <Sliders className="h-4 w-4" />
              <span>{isCustomizeMode ? "Done" : "Customise layout"}</span>
            </button>
          </div>
        )}

        {patientSection === "notes" && processingStatus && selectedDocument && processingStatus.document_id === selectedDocument.document_id && processingStatus.status !== "completed" && renderProcessingStatus()}

        {patientSection === "notes" && !selectedDocument && (
          <div className="text-center py-12 bg-white dark:bg-[#141D10] premium-card">
            <FileText className="h-10 w-10 text-slate-400 mx-auto mb-3" />
            <p className="font-semibold text-slate-700 dark:text-slate-300 text-sm">No clinical notes for this patient</p>
            <p className="text-sm text-slate-500 mt-1">The Record tab comes from source data. Note-based AI analysis needs a clinical note (upload one in the Upload Center).</p>
          </div>
        )}

        {patientSection === "notes" && selectedDocument && insights && (
          <div className="space-y-6">
            {isCustomizeMode && activeTab === "dashboard" && (
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 border border-blue-100/30 dark:border-blue-900/50 bg-blue-50/10 dark:bg-blue-950/15 rounded-2xl animate-slide-up">
                <div className="flex items-center space-x-2.5">
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center uppercase tracking-wide">
                    <Sliders className="h-4 w-4 mr-1.5 animate-pulse" />
                    Workspace Designer Active
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 hidden lg:inline">| Drag widgets, resize cards, or modify layouts:</span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* Role Presets Swapper (Recruiter Demo Mode / Preview) */}
                  <div className="flex items-center space-x-1.5">
                    <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Preview Preset:</span>
                    <select
                      value={layoutPreset ?? userRole}
                      onChange={(e) => {
                        const preset = e.target.value;
                        setLayoutPreset(preset);
                        loadUserLayout(preset);
                      }}
                      className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 focus:ring-0 focus:outline-none"
                    >
                      <option value="clinician">MD / Clinician</option>
                      <option value="coder">Medical Coder</option>
                      <option value="auditor">Compliance Auditor</option>
                      <option value="admin">System Administrator</option>
                    </select>
                  </div>

                  {/* Restore hidden widgets */}
                  {(() => {
                    const hidden = layout.filter(w => !w.visible);
                    return (
                      hidden.length > 0 && (
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              handleRestoreWidget(e.target.value);
                            }
                          }}
                          className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-950 text-blue-600 dark:text-blue-400 focus:ring-0 focus:outline-none"
                        >
                          <option value="">Add widget...</option>
                          {hidden.map(w => (
                            <option key={w.id} value={w.id}>{w.title}</option>
                          ))}
                        </select>
                      )
                    );
                  })()}

                  <div className="h-5 w-[1px] bg-slate-200 dark:bg-slate-800 hidden sm:block"></div>

                  {/* Reset layout */}
                  <button
                    onClick={handleResetLayout}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors font-semibold"
                    title="Reset layout to default role preset"
                  >
                    Reset
                  </button>

                  {/* Duplicate layout */}
                  <button
                    onClick={handleDuplicateLayout}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors font-semibold flex items-center space-x-1"
                    title="Copy layout JSON configuration"
                  >
                    Duplicate
                  </button>

                  {/* Export layout */}
                  <button
                    onClick={handleExportLayout}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors font-semibold flex items-center space-x-1"
                    title="Download layout JSON config file"
                  >
                    Export
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative">
            {/* Tab Selector spanning full-width */}
            <div className="col-span-12 flex items-center space-x-1 border border-slate-200/50 dark:border-slate-800/40 bg-slate-50 dark:bg-slate-950 p-1 rounded-xl overflow-x-auto mb-2">
              {(["dashboard", "entities", "graph", "compare"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-sm font-semibold rounded-lg whitespace-nowrap ${activeTab === tab ? "bg-white dark:bg-slate-800 shadow-sm text-blue-700 dark:text-blue-300" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"}`}
                >
                  {tab === "dashboard" ? "Overview" : tab === "entities" ? "Entity review" : tab === "graph" ? "Knowledge graph" : "Compare notes"}
                </button>
              ))}
              {noteHidden && (
                <button onClick={() => setNoteHidden(false)} className="ml-auto px-3 py-2 text-sm font-semibold rounded-lg whitespace-nowrap text-blue-700 dark:text-blue-300 hover:bg-white dark:hover:bg-slate-800 flex items-center gap-1.5">
                  <FileText className="h-4 w-4" /> Show note
                </button>
              )}
            </div>

            {/* Left Column: Narrative Note. Stretches to the row height; the text scrolls inside it. Hiding it widens the right column. */}
            {!noteHidden && (
              <div className="lg:col-span-5">
                <div className="premium-card p-5 flex flex-col gap-3 h-full min-h-[500px]">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-900 pb-2.5">
                    <div className="flex items-center space-x-2 min-w-0">
                      <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">{selectedDocument.file_name}</h3>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setPhiRedacted(!phiRedacted)}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${phiRedacted ? 'bg-red-500/10 text-red-600 border-red-500/30' : 'bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}
                      >
                        {phiRedacted ? "PHI redacted" : "Redact PHI"}
                      </button>
                      <button
                        onClick={() => setNoteHidden(true)}
                        className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800"
                        title="Hide note" aria-label="Hide note"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="relative flex-1 min-h-[400px]">
                    <div className="absolute inset-0 overflow-y-auto p-4 bg-slate-50 dark:bg-slate-950/40 rounded-lg border border-slate-100 dark:border-slate-900 text-sm leading-6 text-slate-800 dark:text-slate-200 select-text scrollbar-thin">
                      {(phiRedacted ? redactedText : originalText)
                        ? <NoteText text={(phiRedacted ? redactedText : originalText)!} highlight={clickedEntity?.entity_text} />
                        : "Loading clinical note narrative..."}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Right Column: Dashboard and Tabs content */}
            <div className={`${dashboardGridClass} transition-all duration-300 space-y-6`}>
              {/* A note that hasn't been analysed has no AI output: say so once, never show empty "nothing found" widgets. */}
              {selectedDocument.status !== "completed" && (activeTab === "dashboard" || activeTab === "entities") && (
                <div className="premium-card p-8 text-center space-y-3">
                  <FileText className="h-8 w-8 text-slate-400 mx-auto" />
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    {selectedDocument.status === "processing" ? "Analysing this note..." : selectedDocument.status === "failed" ? "Analysis of this note failed" : "This note hasn't been analysed yet"}
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                    Analysis extracts diagnoses, medications, allergies and findings from the note text for a clinician to review.
                    Until then there is nothing to show here; it does not mean the note mentions none. The Record tab has this patient's structured data.
                  </p>
                  {selectedDocument.status !== "processing" && (["admin", "clinician", "consultant"].includes(userRole) ? (
                    <button
                      onClick={() => handleProcessDocument(selectedDocument.document_id)}
                      disabled={processingStatus?.document_id === selectedDocument.document_id && processingStatus.status === "processing"}
                      className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50"
                    >
                      {selectedDocument.status === "failed" ? "Retry analysis" : "Analyse note"}
                    </button>
                  ) : (
                    <p className="text-xs text-slate-500">Your role can view results but cannot start analysis.</p>
                  ))}
                </div>
              )}
              {/* Tab Contents */}
              {selectedDocument.status === "completed" && activeTab === "dashboard" && (() => {
                const copilotData = getCopilotInsights();
                if (!copilotData) {
                  return (
                    <div className="premium-card p-6 text-center text-slate-400 dark:text-slate-500">
                      <Sparkles className="h-8 w-8 mx-auto mb-2 text-slate-300 animate-pulse" />
                      <p className="text-xs">Gathering clinical intelligence for dashboard...</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-6 animate-slide-up">
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={layout.filter(w => w.visible).map(w => w.id)}
                        strategy={rectSortingStrategy}
                      >
                        <div className="grid grid-cols-12 gap-6 w-full">
                          {layout
                            .filter(w => w.visible)
                            .map(w => (
                              <SortableWidget
                                key={w.id}
                                id={w.id}
                                title={w.title}
                                isCustomizeMode={isCustomizeMode}
                                size={w.size}
                                collapsed={w.collapsed}
                                pinned={w.pinned}
                                onResize={(size) => handleResizeWidget(w.id, size)}
                                onToggleCollapse={() => handleToggleCollapseWidget(w.id)}
                                onTogglePin={() => handleTogglePinWidget(w.id)}
                                onHide={() => handleHideWidget(w.id)}
                                onExpandFullscreen={() => setFullscreenWidgetId(w.id)}
                              >
                                {renderWidgetContents(w.id)}
                              </SortableWidget>
                            ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  </div>
                );
              })()}

              {selectedDocument.status === "completed" && activeTab === "entities" && (
                <div className="space-y-4">
                  <div className="premium-card overflow-hidden animate-slide-up">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-900 bg-slate-50/30 dark:bg-slate-950 text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                          <th className="px-5 py-3">Entity text</th>
                          <th className="px-5 py-3">Tag type</th>
                          <th className="px-5 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
                        {insights.entities && insights.entities.length > 0 ? (
                          insights.entities.map(ent => (
                            <tr
                              key={ent.entity_id}
                              onClick={() => setExplainEntity(ent)}
                              className={`text-slate-600 dark:text-slate-300 text-xs transition-colors cursor-pointer hover:bg-slate-50/40 dark:hover:bg-slate-900/20 ${ent.review_status === 'rejected' ? 'line-through opacity-30 bg-red-50/10' : ''} ${explainEntity?.entity_id === ent.entity_id ? 'bg-blue-50/50 dark:bg-blue-950/20 border-l-2 border-blue-500' : ''}`}
                            >
                              <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">
                                {editingEntityId === ent.entity_id ? (
                                  <input
                                    type="text"
                                    value={editingText}
                                    onChange={(e) => setEditingText(e.target.value)}
                                    className="px-2 py-1 bg-slate-50 dark:bg-slate-900 border border-blue-500 rounded text-xs"
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleReviewEntity(ent.entity_id, "edited", editingText);
                                        setEditingEntityId(null);
                                      }
                                    }}
                                  />
                                ) : (
                                  <span>{ent.entity_text}</span>
                                )}
                                <div className="text-[11px] text-slate-400 font-mono mt-0.5">Confidence: {scoreLabel(ent.confidence)}</div>
                              </td>
                              <td className="px-5 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${ent.entity_type === 'Disease' ? 'bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-400' : 'bg-blue-50 text-blue-600 dark:bg-blue-950/20 dark:text-blue-400'}`}>
                                  {ent.entity_type}
                                </span>
                              </td>
                              <td className="px-5 py-3 text-right space-x-1.5" onClick={(e) => e.stopPropagation()}>
                                {canReview && ent.review_status === "pending" && (
                                  <div className="inline-flex space-x-1">
                                    <button
                                      onClick={() => handleReviewEntity(ent.entity_id, "approved")}
                                      className="p-1 rounded-lg hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-950/20 transition-all border border-slate-100 dark:border-slate-800"
                                    >
                                      <Check className="h-3 w-3" />
                                    </button>
                                    <button
                                      onClick={() => {
                                        setEditingEntityId(ent.entity_id);
                                        setEditingText(ent.entity_text);
                                      }}
                                      className="p-1 rounded-lg hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 transition-all border border-slate-100 dark:border-slate-800"
                                    >
                                      <Edit2 className="h-3 w-3" />
                                    </button>
                                    <button
                                      onClick={() => handleReviewEntity(ent.entity_id, "rejected")}
                                      className="p-1 rounded-lg hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20 transition-all border border-slate-100 dark:border-slate-800"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                )}
                                {ent.review_status !== "pending" && (
                                  <span className="text-[11px] font-bold uppercase text-slate-400 tracking-wider capitalize">{ent.review_status}</span>
                                )}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={3} className="text-center py-10 text-slate-400 text-xs">No clinical entities extracted.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {explainEntity && (
                    <div className="p-5 rounded-2xl border border-blue-100 dark:border-blue-900/20 bg-blue-50/10 dark:bg-blue-950/5 mt-4 relative animate-scale-in">
                      <button
                        onClick={() => setExplainEntity(null)}
                        className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center space-x-1.5 mb-2">
                        <Sparkles className="h-4 w-4 animate-pulse" />
                        <span>AI Explainability Evidence Panel</span>
                      </h4>

                      <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-[11px] uppercase font-bold text-slate-400 block">Extracted Term</span>
                            <p className="font-bold text-slate-800 dark:text-white">{explainEntity.entity_text}</p>
                          </div>
                          <div>
                            <span className="text-[11px] uppercase font-bold text-slate-400 block">Confidence Score</span>
                            <p className="font-bold font-mono text-emerald-600 dark:text-emerald-400">{scoreLabel(explainEntity.confidence)}</p>
                          </div>
                        </div>
                        <div>
                          <span className="text-[11px] uppercase font-bold text-slate-400 block">Source Narrative Evidence</span>
                          <p className="italic text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-950 p-2.5 rounded-xl border border-slate-100 dark:border-slate-900 mt-1">
                            "{explainEntity.evidence || "Found in clinical note narrative text."}"
                          </p>
                        </div>
                        <div>
                          <span className="text-[11px] uppercase font-bold text-slate-400 block">Resolution Reasoning Path</span>
                          <p className="text-slate-600 dark:text-slate-400 bg-slate-100/50 dark:bg-slate-900/30 p-2.5 rounded-xl mt-1 leading-relaxed">
                            {explainEntity.reasoning || "Model matched medical term in clinical extraction patterns."}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "compare" && comparisonData && (
                <div className="premium-card p-6 space-y-6 animate-slide-up">
                  <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-slate-900">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Timeline Note Comparison</h3>
                  </div>

                  <NoteComparison data={comparisonData} canReview={["admin", "clinician", "consultant", "coder"].includes(userRole)}
                    onOpenReview={() => setCurrentView("review")} />
                </div>
              )}

              {activeTab === "graph" && graphData && (
                <div className="premium-card p-6 space-y-6 animate-slide-up">
                  <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-slate-900">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">Knowledge graph</h3>
                  </div>
                  {renderKnowledgeGraph(false)}
                </div>
              )}
            </div>

        {/* Fullscreen Expanded Widget Modal Overlay */}
        {fullscreenWidgetId && (() => {
          const widget = layout.find(w => w.id === fullscreenWidgetId);
          if (!widget) return null;
          return (
            <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-fade-in">
              <div className="bg-white dark:bg-[#0B1209] border border-slate-200 dark:border-slate-800 w-full max-w-6xl h-[85vh] rounded-[24px] flex flex-col overflow-hidden shadow-2xl relative animate-scale-in">
                <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-900 bg-slate-50/50 dark:bg-slate-900/25 flex items-center justify-between">
                  <span className="font-extrabold text-slate-800 dark:text-slate-200 text-sm uppercase tracking-wider">{widget.title} [Fullscreen View]</span>
                  <button
                    onClick={() => setFullscreenWidgetId(null)}
                    className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-400 hover:text-slate-600 dark:hover:white transition-colors"
                  >
                    <Minimize2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="p-8 flex-1 overflow-y-auto">
                  {renderWidgetContents(widget.id)}
                </div>
              </div>
            </div>
          );
        })()}
          </div>
        </div>
      )}

        {/* Copilot drawer, portalled to <body>: a transformed or filtered ancestor would re-anchor position:fixed. */}
        {typeof document !== "undefined" && createPortal(<>
        {isCopilotOpen && (
          <div
            onClick={() => setIsCopilotOpen(false)}
            className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-50 transition-opacity duration-300 animate-fade-in"
          />
        )}

        <div className={`fixed inset-y-0 right-0 w-full sm:w-[460px] h-dvh bg-white dark:bg-[#111A0D] shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col border-l border-slate-200/50 dark:border-slate-800/65 ${isCopilotOpen ? "translate-x-0" : "translate-x-full"}`}>
          {/* Drawer Header */}
          <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-900/80 bg-slate-50/50 dark:bg-slate-900/20">
            <div className="flex items-center space-x-2">
              <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-pulse" />
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                Clinical AI Copilot
              </h3>
            </div>
            <div className="flex items-center space-x-2">
              {activeConversation && (
                <span className="text-[11px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">ID: {activeConversation.conversation_id.slice(0, 8)}</span>
              )}
              <button
                onClick={() => setIsCopilotOpen(false)}
                className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Drawer Content */}
          <div className="flex-1 flex flex-col overflow-hidden p-4 space-y-4">
            {/* Copilot Session Registry */}
            <div className="p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 space-y-2.5">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sessions</span>
                <button
                  onClick={() => handleCreateConversation(`Session ${new Date().toLocaleTimeString()}`)}
                  className="text-[11px] font-bold text-blue-600 hover:text-blue-500 uppercase flex items-center space-x-0.5"
                >
                  <span>+ New Session</span>
                </button>
              </div>

              <div className="flex space-x-2 overflow-x-auto pb-1 pr-1 scrollbar-thin">
                {conversations.map(c => {
                  const asked = (c.messages || []).filter((m: any) => m.sender === "user").length;
                  const active = activeConversation?.conversation_id === c.conversation_id;
                  const label = `${formatDate(c.created_at)}, ${new Date(c.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
                  return (
                    <div key={c.conversation_id} className={`flex items-start rounded-lg flex-shrink-0 ${active ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                      <button
                        onClick={() => setActiveConversation(c)}
                        disabled={copilotLoading}
                        aria-pressed={active}
                        className="pl-3 pr-1 py-1.5 text-xs font-semibold text-left whitespace-nowrap disabled:opacity-60"
                      >
                        {label}
                        <span className={`block font-normal ${active ? "text-blue-100" : "text-slate-500"}`}>{asked} question{asked === 1 ? "" : "s"}</span>
                      </button>
                      <button
                        onClick={() => handleDeleteConversation(c.conversation_id)}
                        disabled={copilotLoading}
                        title="Delete session" aria-label={`Delete session ${label}`}
                        className={`m-1 p-0.5 rounded disabled:opacity-60 ${active ? "text-blue-100 hover:bg-blue-500" : "text-slate-400 hover:text-red-600 hover:bg-white dark:hover:bg-slate-900"}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Messages Feed */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1 text-xs scrollbar-thin flex flex-col">
              {!activeConversation && (
                <p className="m-auto text-sm text-slate-500 text-center">No session open. Use <span className="font-semibold">+ New Session</span> to start one.</p>
              )}
              {activeConversation && activeConversation.messages && activeConversation.messages.map((msg: any) => (
                <CopilotMessageView key={msg.message_id} msg={msg} />
              ))}

              {copilotLoading && (
                <div className="p-3 bg-blue-50/5 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-900 rounded-xl space-y-1">
                  <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider animate-pulse">Copilot is thinking...</span>
                  <div className="h-12 shimmer rounded"></div>
                </div>
              )}
            </div>

            {/* Quick Prompts */}
            {activeConversation && activeConversation.messages && activeConversation.messages.length <= 1 && (
              <div className="grid grid-cols-2 gap-2 my-2">
                <button
                  onClick={() => handleSendCopilotMessage("What is the primary diagnosis and its ICD-10 code?")}
                  className="p-2 text-[11px] text-left text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900/60 dark:hover:bg-slate-800 rounded-xl transition-all border border-slate-100 dark:border-slate-900/60"
                >
                  Primary diagnosis
                </button>
                <button
                  onClick={() => handleSendCopilotMessage("List all medications prescribed at discharge.")}
                  className="p-2 text-[11px] text-left text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900/60 dark:hover:bg-slate-800 rounded-xl transition-all border border-slate-100 dark:border-slate-900/60"
                >
                  Prescribed medications
                </button>
              </div>
            )}

            {/* Input form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendCopilotMessage(copilotInput);
              }}
              className="flex mt-auto border-t border-slate-100 dark:border-slate-900 pt-3"
            >
              <input
                type="text"
                required
                value={copilotInput}
                onChange={(e) => setCopilotInput(e.target.value)}
                className="flex-1 px-3 py-2.5 rounded-l-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-white focus:outline-none focus:border-blue-500"
                placeholder="Ask clinical question (e.g. drug interactions, ICD codes)..."
              />
              <button type="submit" className="px-4 rounded-r-xl bg-blue-600 hover:bg-blue-500 text-white transition-all flex items-center justify-center">
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
        </>, document.body)}
      </div>
    );
  };  const renderAuditTrail = () => (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Audit Trails</h1>
        <p className="text-[#4A5B38] dark:text-slate-400 text-sm mt-1">Logs capturing NLP processing and doctor edits.</p>
      </div>

      <div className="premium-card overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-900 bg-slate-50/30 dark:bg-slate-950 text-slate-400 text-xs font-bold uppercase tracking-wider">
              <th className="px-6 py-4">Operational Activity</th>
              <th className="px-6 py-4">Assigned Target</th>
              <th className="px-6 py-4">Validation Details</th>
              <th className="px-6 py-4 text-right">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
            {auditLogs.map(log => (
              <tr key={log.log_id} className="hover:bg-slate-50/40 dark:hover:bg-slate-900/20 text-slate-600 dark:text-slate-300 text-xs transition-colors">
                <td className="px-6 py-4 font-semibold text-slate-900 dark:text-white">
                  <span className="capitalize">{log.action_type.replace("_", " ")}</span>
                </td>
                <td className="px-6 py-4 font-mono text-slate-400 text-xs">{log.extraction_source || "-"}</td>
                <td className="px-6 py-4 text-slate-400 font-sans">
                  {log.model_used || "System Task"}
                </td>
                <td className="px-6 py-4 text-right font-mono text-slate-400">
                  {new Date(log.timestamp).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="space-y-6 w-full">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Model Settings</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Configure models and pipeline configurations.</p>
      </div>

      <div className="premium-card p-6 space-y-6">
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Transformer Pipeline Config</h3>

          <div className="space-y-3 text-xs leading-normal">
            <div className="flex justify-between border-b border-slate-100 dark:border-slate-900 pb-2">
              <span className="text-slate-400">Token Classification (NER)</span>
              <span className="font-mono text-slate-800 dark:text-slate-200">d4data/biomedical-ner-all</span>
            </div>

            <div className="flex justify-between border-b border-slate-100 dark:border-slate-900 pb-2">
              <span className="text-slate-400">Summarization Model</span>
              <span className="font-mono text-slate-800 dark:text-slate-200">facebook/bart-large-cnn</span>
            </div>

            <div className="flex justify-between border-b border-slate-100 dark:border-slate-900 pb-2">
              <span className="text-slate-400">Contextual Q&A</span>
              <span className="font-mono text-slate-800 dark:text-slate-200">deepset/roberta-base-squad2</span>
            </div>

            <div className="flex justify-between pb-2">
              <span className="text-slate-400">Sentence Embeddings</span>
              <span className="font-mono text-slate-800 dark:text-slate-200">sentence-transformers/all-MiniLM-L6-v2</span>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 dark:border-slate-900 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Operational Flags</h3>
          <div className="space-y-2">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={aiMode !== "transformers"}
                readOnly
                className="h-4 w-4 bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-blue-600 rounded focus:ring-0"
              />
              <span className="text-xs text-slate-700 dark:text-slate-300">Rule-based prototype mode (USE_MOCK_MODELS)</span>
            </label>
            <p className="text-xs text-slate-400 leading-normal">
              Reported by the backend: currently <span className="font-mono">{aiMode || "unknown"}</span>. In prototype mode, entities come from dictionary matching and
              summaries from a template; the transformer models listed above are configured but not running.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderAdmin = () => (
    <div className="space-y-8 animate-slide-up">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Data Imports</h1>
        <p className="text-[#4A5B38] dark:text-slate-400 text-sm mt-1">
          Import history from the ingestion pipeline. Imports run from the backend CLI, for example
          <code className="mx-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-900 font-mono text-[11px]">py -3.12 -m app.cli import synthea ../data/raw/synthea-fhir</code>
          and are idempotent: re-running updates records instead of duplicating them.
        </p>
      </div>

      <div className="premium-card overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-900 text-slate-400 text-xs uppercase tracking-wider font-bold">
              <th className="px-5 py-3">Started</th>
              <th className="px-5 py-3">Source</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Records written</th>
              <th className="px-5 py-3 text-right">Rejected records</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-900">
            {importRuns.map(run => {
              const written = Object.entries(run.counts || {}).filter(([k]) => k.endsWith(".written"));
              return (
                <tr key={run.run_id} className="text-slate-600 dark:text-slate-300 align-top">
                  <td className="px-5 py-3 font-mono text-[11px]">{new Date(run.started_at).toLocaleString()}</td>
                  <td className="px-5 py-3 font-semibold">{run.source_system}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${run.status === "completed" ? "bg-green-50 text-green-700" : run.status === "failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                      {run.status}{run.dry_run ? " (dry run)" : ""}
                    </span>
                    {run.message && <div className="text-xs text-slate-400 mt-1 max-w-xs">{run.message}</div>}
                  </td>
                  <td className="px-5 py-3 font-mono text-[11px]">
                    {written.length > 0 ? written.map(([k, v]) => <div key={k}>{k.replace(".written", "")}: {String(v)}</div>) : "—"}
                  </td>
                  <td className="px-5 py-3 text-right font-mono">{run.error_count}</td>
                </tr>
              );
            })}
            {importRuns.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400">No imports recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  // Router dispatcher
  if (currentView === "landing") return <Landing onSignIn={() => setCurrentView("login")} onTryDemo={handleTryDemo} />;
  if (INFO_VIEWS.includes(currentView)) return <InfoPage view={currentView} />;
  if (currentView === "login") return renderLogin();
  if (!authReady) {
    return <LoadingScreen />;
  }
  if (!token) return renderLogin();  // stays on the requested URL; continues there after sign-in

  const dispatchView = () => {
    switch (currentView) {
      case "dashboard": return renderDashboard();
      case "upload": return renderUpload();
      case "search": return <RecordSearch api={api} patients={patients} onOpenPatient={(pid) => router.push(patientPath(pid))}
                                          onOpenNote={(pid, docId) => router.push(patientPath(pid, docId))} />;
      case "patients": return renderPatientList();
      case "patient":
        if (selectedPatient) return renderPatientInsights();
        return missingPatientId === route.patientId
          ? <div className="premium-card p-8 text-sm text-slate-600">Patient not found, or you do not have access to this record.</div>
          : <div className="p-8 text-sm text-slate-500">Loading patient...</div>;
      case "audit": return renderAuditTrail();
      case "review": return <ReviewQueue api={api} onOpenNote={(pid, docId) => router.push(patientPath(pid, docId))} />;
      case "governance": return <Governance api={api} />;
      case "ops": return <SystemHealth api={api} />;
      case "settings": return renderSettings();
      case "admin": return renderAdmin();
      default: return renderDashboard();
    }
  };

  return renderDashboardLayout(dispatchView());
}
