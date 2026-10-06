// Workspace widget presets per role.
export interface WidgetConfig {
  id: string;
  title: string;
  size: "small" | "medium" | "large" | "full";
  visible: boolean;
  collapsed: boolean;
  pinned: boolean;
}

export const DEFAULT_LAYOUTS: Record<string, WidgetConfig[]> = {
  clinician: [
    { id: "summary", title: "AI Clinical Summary", size: "large", visible: true, collapsed: false, pinned: false },
    { id: "primary_diag", title: "First diagnosis mentioned", size: "small", visible: true, collapsed: false, pinned: false },
    { id: "secondary_diags", title: "Other diagnoses mentioned", size: "medium", visible: true, collapsed: false, pinned: false },
    { id: "meds", title: "Medications", size: "medium", visible: true, collapsed: false, pinned: false },
    { id: "allergies", title: "Allergies", size: "medium", visible: true, collapsed: false, pinned: false },
    { id: "clinical_findings", title: "Clinical Findings", size: "medium", visible: true, collapsed: false, pinned: false },
    { id: "document_metadata", title: "Document Metadata", size: "medium", visible: true, collapsed: false, pinned: false },
    { id: "risk", title: "Risk Assessment", size: "small", visible: false, collapsed: false, pinned: false },
    { id: "icd10", title: "ICD-10 Mapping", size: "medium", visible: false, collapsed: false, pinned: false },
    { id: "nlp_entities", title: "NLP Entity Extraction", size: "large", visible: false, collapsed: false, pinned: false },
    { id: "timeline", title: "Clinical Patient Timeline", size: "full", visible: false, collapsed: false, pinned: false },
    { id: "fhir_export", title: "FHIR Export", size: "full", visible: false, collapsed: false, pinned: false },
    { id: "knowledge_graph", title: "Patient Knowledge Graph", size: "large", visible: false, collapsed: false, pinned: false },
    { id: "note_compare", title: "Timeline Note Comparison", size: "large", visible: false, collapsed: false, pinned: false },
    { id: "copilot", title: "AI Copilot Panel", size: "medium", visible: false, collapsed: false, pinned: false }
  ],
  coder: [
    { id: "summary", title: "AI Clinical Summary", size: "large", visible: true, collapsed: false, pinned: false },
    { id: "risk", title: "Risk Assessment", size: "small", visible: true, collapsed: false, pinned: false },
    { id: "icd10", title: "ICD-10 Mapping", size: "medium", visible: true, collapsed: false, pinned: false },
    { id: "fhir_export", title: "FHIR Export", size: "full", visible: true, collapsed: false, pinned: false },
    { id: "clinical_findings", title: "Clinical Findings", size: "medium", visible: true, collapsed: false, pinned: false },
    { id: "document_metadata", title: "Document Metadata", size: "medium", visible: true, collapsed: false, pinned: false },
    { id: "primary_diag", title: "First diagnosis mentioned", size: "small", visible: false, collapsed: false, pinned: false },
    { id: "secondary_diags", title: "Other diagnoses mentioned", size: "medium", visible: false, collapsed: false, pinned: false },
    { id: "meds", title: "Medications", size: "medium", visible: false, collapsed: false, pinned: false },
    { id: "allergies", title: "Allergies", size: "medium", visible: false, collapsed: false, pinned: false },
    { id: "nlp_entities", title: "NLP Entity Extraction", size: "large", visible: false, collapsed: false, pinned: false },
    { id: "timeline", title: "Clinical Patient Timeline", size: "full", visible: false, collapsed: false, pinned: false },
    { id: "knowledge_graph", title: "Patient Knowledge Graph", size: "large", visible: false, collapsed: false, pinned: false },
    { id: "note_compare", title: "Timeline Note Comparison", size: "large", visible: false, collapsed: false, pinned: false },
    { id: "copilot", title: "AI Copilot Panel", size: "medium", visible: false, collapsed: false, pinned: false }
  ],
  auditor: [
    { id: "nlp_entities", title: "NLP Entity Extraction", size: "large", visible: true, collapsed: false, pinned: false },
    { id: "risk", title: "Risk Assessment", size: "medium", visible: true, collapsed: false, pinned: false },
    { id: "fhir_export", title: "FHIR Export", size: "full", visible: true, collapsed: false, pinned: false },
    { id: "clinical_findings", title: "Clinical Findings", size: "medium", visible: true, collapsed: false, pinned: false },
    { id: "document_metadata", title: "Document Metadata", size: "medium", visible: true, collapsed: false, pinned: false },
    { id: "summary", title: "AI Clinical Summary", size: "large", visible: false, collapsed: false, pinned: false },
    { id: "primary_diag", title: "First diagnosis mentioned", size: "small", visible: false, collapsed: false, pinned: false },
    { id: "secondary_diags", title: "Other diagnoses mentioned", size: "medium", visible: false, collapsed: false, pinned: false },
    { id: "meds", title: "Medications", size: "medium", visible: false, collapsed: false, pinned: false },
    { id: "allergies", title: "Allergies", size: "medium", visible: false, collapsed: false, pinned: false },
    { id: "icd10", title: "ICD-10 Mapping", size: "medium", visible: false, collapsed: false, pinned: false },
    { id: "timeline", title: "Clinical Patient Timeline", size: "full", visible: false, collapsed: false, pinned: false },
    { id: "knowledge_graph", title: "Patient Knowledge Graph", size: "large", visible: false, collapsed: false, pinned: false },
    { id: "note_compare", title: "Timeline Note Comparison", size: "large", visible: false, collapsed: false, pinned: false },
    { id: "copilot", title: "AI Copilot Panel", size: "medium", visible: false, collapsed: false, pinned: false }
  ]
}

// Admins get the clinician view of a patient; system-wide panels live on Dashboard / Patients / Audit.
DEFAULT_LAYOUTS.admin = DEFAULT_LAYOUTS.clinician;

// Widget ids that no longer exist (removed system-wide panels) are dropped from saved layouts.
export const KNOWN_WIDGETS = new Set(Object.values(DEFAULT_LAYOUTS).flat().map(w => w.id));
const TITLES = new Map(Object.values(DEFAULT_LAYOUTS).flat().map(w => [w.id, w.title]));
// Saved layouts keep the user's order and sizes, but always show the current widget names.
export const knownWidgets = (layout: WidgetConfig[]) =>
  layout.filter(w => KNOWN_WIDGETS.has(w.id)).map(w => ({ ...w, title: TITLES.get(w.id) ?? w.title }));
