// Domain types and small helpers shared across the workspace.
// --- Types & Interfaces ---
export interface Patient {
  patient_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;   // nullable: not every source publishes a birth date
  deceased_date?: string | null;
  gender: string;
  source_system?: string | null;
  document_count?: number;        // from GET /patients
  last_encounter_at?: string | null;
}

export const SOURCE_LABELS: Record<string, string> = {
  synthea: "Synthea (synthetic)",
  clinicalbrief: "Entered in ClinicalBrief",
};
export const sourceLabel = (source?: string | null) => (source && SOURCE_LABELS[source]) || source || "Unknown source";

// Synthea appends digits to generated names ("Alexandra16") so they can never match a real person.
// They are hidden for display only; the stored source name is unchanged.
const cleanName = (name: string) => name.replace(/\d+/g, "").replace(/\s+/g, " ").trim();
export const displayName = (p: Pick<Patient, "first_name" | "last_name" | "source_system">) =>
  p.source_system === "synthea" ? `${cleanName(p.first_name)} ${cleanName(p.last_name)}` : `${p.first_name} ${p.last_name}`;

// Age in whole years (at death if deceased). No birth date means no age - never guessed.
export const ageYears = (p: Pick<Patient, "date_of_birth" | "deceased_date">): number | null => {
  if (!p.date_of_birth) return null;
  const dob = new Date(p.date_of_birth);
  const end = p.deceased_date ? new Date(p.deceased_date) : new Date();
  let age = end.getFullYear() - dob.getFullYear();
  if (end.getMonth() < dob.getMonth() || (end.getMonth() === dob.getMonth() && end.getDate() < dob.getDate())) age--;
  return age;
};
export const ageLabel = (p: Pick<Patient, "date_of_birth" | "deceased_date">) => {
  const age = ageYears(p);
  if (age == null) return "Age unknown";
  return p.deceased_date ? `Deceased (aged ${age})` : `${age} y`;
};

export const formatCount = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-AU"));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const formatDate = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  // Fixed 3-letter months: en-AU "short" mixes "Dec" with "June"/"Sept".
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
// Synthea can generate encounters slightly in the future; "recently seen" only lists past ones.
export const hasRealRecentDate = (p: Pick<Patient, "last_encounter_at">) =>
  !!p.last_encounter_at && new Date(p.last_encounter_at) <= new Date();

export interface Document {
  document_id: string;
  patient_id: string;
  file_name: string;
  file_type: string;
  classification?: string;
  status: string;
  upload_date: string;
  document_date?: string | null;
  source_system?: string | null;
}

// Canonical (imported / entered) record from GET /patients/{id}/record. Nothing in it is AI-generated.
export interface PatientRecord {
  source_system: string | null;
  date_of_birth_known: boolean;
  counts: Record<string, number>;
  diagnoses: { code: string | null; code_system: string | null; display: string; clinical_status: string | null; onset_at: string | null; source_system: string | null }[];
  medications: { name: string; dose: string | null; route: string | null; frequency: string | null; status: string | null; start_at: string | null; source_system: string | null }[];
  allergies: { allergen: string; reaction: string | null; severity: string | null; criticality: string | null; clinical_status: string | null; source_system: string | null }[];
  observations: { name: string; value: string | null; unit: string | null; flag: string | null; reference_range: string | null; effective_at: string | null; category: string | null }[];
  timeline: { at: string; kind: string; label: string; detail: string | null }[];
}

export interface ProcessingStatus {
  document_id: string;
  status: string;
  step: number;
  elapsed_seconds: number | null;
  error?: string | null;
}

// Pipeline stages as recorded in processing_jobs.step by the backend.
export const PIPELINE_STAGES = [
  { step: 2, label: "Note text loaded" },
  { step: 3, label: "Document classified" },
  { step: 4, label: "Entities extracted" },
  { step: 5, label: "ICD-10 candidates mapped" },
  { step: 6, label: "Summary generated" },
  { step: 9, label: "Indexed for search and redaction applied" },
];

// Scores are shown only when the backend measured one; a missing score is never displayed as a number.
export const scoreLabel = (value: number | null | undefined, nullLabel = "no score") =>
  value == null ? nullLabel : `${Math.round(value * 100)}%`;

export const shortCodeSystem = (system: string | null) => {
  if (!system) return "";
  if (system.includes("snomed")) return "SNOMED CT";
  if (system.includes("icd-10-cm")) return "ICD-10-CM";
  if (system.includes("icd-9-cm")) return "ICD-9-CM";
  if (system.includes("ICD10")) return "ICD-10-PCS";
  if (system.includes("rxnorm")) return "RxNorm";
  if (system.includes("loinc")) return "LOINC";
  if (system.includes("ndc")) return "NDC";
  return system;
};

export interface ICD10Mapping {
  icd10_code: string;
  code_description: string;
  confidence: number | null;
}

export interface Entity {
  entity_id: string;
  entity_text: string;
  entity_type: string;
  confidence: number | null; // null = extractor has no calibrated score (rule-based mode)
  review_status: string; // pending, approved, rejected, edited
  icd10_mapping?: ICD10Mapping | null;
  evidence?: string;
  reasoning?: string;
}

export interface Summary {
  summary_text: string;
}

export interface ParsedMedication {
  name: string;
  dose: string;
  frequency: string;
  route: string;
  status: string;
}

export interface ParsedAllergy {
  name: string;
  reaction: string;
  severity: string;
  confidence: number | null;
}

export interface DocumentInsights {
  document_id: string;
  file_name: string;
  classification?: string;
  status: string;
  summary?: Summary;
  entities: Entity[];
}

export interface AuditLog {
  log_id: string;
  action_type: string;
  model_used?: string;
  confidence_score?: number;
  extraction_source?: string;
  timestamp: string;
}

export const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Loads the ClinicalBrief profile for a Supabase access token. The role returned here is the only one the UI trusts.
export const fetchProfile = (accessToken: string) =>
  fetch(`${BACKEND_URL}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => null);

