-- Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "vector";

-- 1. Users Profile Table (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'clinician' CHECK (role IN ('admin', 'clinician', 'consultant', 'coder', 'auditor', 'researcher')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to sync auth.users with public.users.
-- Every new account starts as 'clinician' with no assigned patients (i.e. sees nothing).
-- Roles are granted only by an admin; signup metadata is user-controlled and is never trusted.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, role, created_at)
    VALUES (NEW.id, NEW.email, 'clinician', COALESCE(NEW.created_at, NOW()))
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Patients Table
CREATE TABLE IF NOT EXISTS public.patients (
    patient_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth Date NOT NULL,
    gender VARCHAR(20) NOT NULL,
    assigned_clinician_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Documents Table
CREATE TABLE IF NOT EXISTS public.documents (
    document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(50) NOT NULL,
    file_url VARCHAR(512),
    classification VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    upload_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    uploaded_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

-- 4. Clinical Notes Table
CREATE TABLE IF NOT EXISTS public.clinical_notes (
    note_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID UNIQUE NOT NULL REFERENCES public.documents(document_id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    original_text TEXT NOT NULL,
    redacted_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Summaries Table
CREATE TABLE IF NOT EXISTS public.summaries (
    summary_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID UNIQUE NOT NULL REFERENCES public.documents(document_id) ON DELETE CASCADE,
    summary_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Entities Table (Extracted medical elements)
CREATE TABLE IF NOT EXISTS public.entities (
    entity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(document_id) ON DELETE CASCADE,
    entity_text VARCHAR(255) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    confidence DOUBLE PRECISION NOT NULL,
    review_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected', 'edited')),
    reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    review_timestamp TIMESTAMPTZ,
    original_value VARCHAR(255),
    edited_value VARCHAR(255),
    evidence TEXT,
    reasoning TEXT,
    extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Diagnoses Table (Clinical Condition Records)
CREATE TABLE IF NOT EXISTS public.diagnoses (
    diagnosis_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(document_id) ON DELETE CASCADE,
    icd10_code VARCHAR(20) NOT NULL,
    code_description TEXT NOT NULL,
    onset_date Date,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'maintained')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Medications Table (Clinical Prescription Records)
CREATE TABLE IF NOT EXISTS public.medications (
    medication_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(document_id) ON DELETE CASCADE,
    medication_name VARCHAR(255) NOT NULL,
    dose VARCHAR(50),
    route VARCHAR(50),
    frequency VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'discontinued', 'maintained')),
    prescribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Allergies Table (Patient Drug/Food/Environmental Allergies)
CREATE TABLE IF NOT EXISTS public.allergies (
    allergy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(document_id) ON DELETE CASCADE,
    allergen VARCHAR(255) NOT NULL,
    reaction TEXT,
    severity VARCHAR(50) CHECK (severity IN ('Mild', 'Moderate', 'Severe')),
    confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Procedures Table
CREATE TABLE IF NOT EXISTS public.procedures (
    procedure_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(document_id) ON DELETE CASCADE,
    procedure_name VARCHAR(255) NOT NULL,
    icd10_procedure_code VARCHAR(20),
    performed_date Date,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Lab Results Table
CREATE TABLE IF NOT EXISTS public.lab_results (
    lab_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(document_id) ON DELETE CASCADE,
    test_name VARCHAR(255) NOT NULL,
    value VARCHAR(50) NOT NULL,
    unit VARCHAR(50),
    flag VARCHAR(20) CHECK (flag IN ('normal', 'abnormal', 'high', 'low')),
    tested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. ICD-10 Mappings
CREATE TABLE IF NOT EXISTS public.icd10_mappings (
    mapping_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID UNIQUE NOT NULL REFERENCES public.entities(entity_id) ON DELETE CASCADE,
    icd10_code VARCHAR(20) NOT NULL,
    code_description TEXT NOT NULL,
    confidence DOUBLE PRECISION NOT NULL
);

-- 13. Audit Logs Table
CREATE TABLE IF NOT EXISTS public.audit_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    action_type VARCHAR(100) NOT NULL,
    model_used VARCHAR(100),
    confidence_score DOUBLE PRECISION,
    extraction_source VARCHAR(255),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. Copilot Sessions Table
CREATE TABLE IF NOT EXISTS public.copilot_sessions (
    conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. Processing Jobs Table
CREATE TABLE IF NOT EXISTS public.processing_jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(document_id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    step INT NOT NULL DEFAULT 0,
    elapsed_time DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. Knowledge Graph Nodes
CREATE TABLE IF NOT EXISTS public.knowledge_graph_nodes (
    node_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    label VARCHAR(255) NOT NULL,
    type VARCHAR(100) NOT NULL,
    details TEXT,
    entity_id UUID REFERENCES public.entities(entity_id) ON DELETE SET NULL
);

-- 17. Knowledge Graph Edges
CREATE TABLE IF NOT EXISTS public.knowledge_graph_edges (
    edge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    source_node_id UUID NOT NULL REFERENCES public.knowledge_graph_nodes(node_id) ON DELETE CASCADE,
    target_node_id UUID NOT NULL REFERENCES public.knowledge_graph_nodes(node_id) ON DELETE CASCADE,
    label VARCHAR(100) NOT NULL
);

-- 18. Dashboard Layouts Table
CREATE TABLE IF NOT EXISTS public.dashboard_layouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    layout_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 19. User Preferences Table
CREATE TABLE IF NOT EXISTS public.user_preferences (
    preference_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    theme VARCHAR(20) NOT NULL DEFAULT 'light',
    role_preset VARCHAR(50) NOT NULL DEFAULT 'clinician',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 20. Embeddings Table (Vector index for semantic search)
CREATE TABLE IF NOT EXISTS public.embeddings (
    embedding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(document_id) ON DELETE CASCADE,
    chunk_text TEXT NOT NULL,
    embedding vector(384) NOT NULL,
    model VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- BACKWARDS COMPATIBILITY TABLES
-- ==========================================

-- Review History
CREATE TABLE IF NOT EXISTS public.review_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID NOT NULL REFERENCES public.entities(entity_id) ON DELETE CASCADE,
    reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    old_value VARCHAR(255),
    new_value VARCHAR(255),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Risk Scores
CREATE TABLE IF NOT EXISTS public.risk_scores (
    risk_score_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    score_value DOUBLE PRECISION NOT NULL,
    risk_level VARCHAR(50) NOT NULL,
    risk_factors TEXT,
    review_priority VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Redaction Logs
CREATE TABLE IF NOT EXISTS public.redaction_logs (
    redaction_log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(document_id) ON DELETE CASCADE,
    entity_type VARCHAR(100) NOT NULL,
    original_text VARCHAR(255),
    redacted_text VARCHAR(255),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Document Comparisons
CREATE TABLE IF NOT EXISTS public.document_comparisons (
    comparison_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    doc1_id UUID NOT NULL REFERENCES public.documents(document_id) ON DELETE CASCADE,
    doc2_id UUID NOT NULL REFERENCES public.documents(document_id) ON DELETE CASCADE,
    comparison_data TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Initialize Storage Buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('fhir_exports', 'fhir_exports', false) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('attachments', 'attachments', false) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('knowledge_graph_images', 'knowledge_graph_images', false) ON CONFLICT DO NOTHING;

-- Enable Realtime Replication
ALTER PUBLICATION supabase_realtime ADD TABLE public.processing_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.documents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.entities;
ALTER PUBLICATION supabase_realtime ADD TABLE public.patients;

-- ==========================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Browser clients only ever READ clinical tables through RLS. All writes go through the FastAPI
-- backend (DB owner connection), which enforces role rules and writes the audit trail.
-- ==========================================

-- 1. Users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_select_all ON public.users FOR SELECT TO authenticated USING (true);
-- No UPDATE policy: users must not be able to change their own role. Admins change roles server-side.

-- 2. Patients
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
-- Mirrors app/api/v1/deps.py: global-read roles see every patient, clinicians see assigned patients.
CREATE POLICY patients_role_policy ON public.patients FOR SELECT TO authenticated
USING (
    (auth.uid() = assigned_clinician_id) OR
    (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'consultant', 'coder', 'auditor', 'researcher')))
);

-- Helper macros to apply RLS recursively to children tables based on patient accessibility
-- 3. Documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_policy ON public.documents FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = documents.patient_id));

-- 4. Clinical Notes
ALTER TABLE public.clinical_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_policy ON public.clinical_notes FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = clinical_notes.patient_id));

-- 5. Summaries
ALTER TABLE public.summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY summaries_policy ON public.summaries FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.documents WHERE documents.document_id = summaries.document_id));

-- 6. Entities
ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY entities_policy ON public.entities FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.documents WHERE documents.document_id = entities.document_id));

-- 7. Diagnoses
ALTER TABLE public.diagnoses ENABLE ROW LEVEL SECURITY;
CREATE POLICY diagnoses_policy ON public.diagnoses FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = diagnoses.patient_id));

-- 8. Medications
ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;
CREATE POLICY medications_policy ON public.medications FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = medications.patient_id));

-- 9. Allergies
ALTER TABLE public.allergies ENABLE ROW LEVEL SECURITY;
CREATE POLICY allergies_policy ON public.allergies FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = allergies.patient_id));

-- 10. Procedures
ALTER TABLE public.procedures ENABLE ROW LEVEL SECURITY;
CREATE POLICY procedures_policy ON public.procedures FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = procedures.patient_id));

-- 11. Lab Results
ALTER TABLE public.lab_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY lab_results_policy ON public.lab_results FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = lab_results.patient_id));

-- 12. ICD-10 Mappings
ALTER TABLE public.icd10_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY mappings_policy ON public.icd10_mappings FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.entities WHERE entities.entity_id = icd10_mappings.entity_id));

-- 13. Audit Logs (Auditors and Admins have global access, others none/restricted)
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_select_policy ON public.audit_logs FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'auditor')));
-- No INSERT policy: audit entries are written only by the backend, so clients cannot forge them.

-- 14. Copilot Sessions
ALTER TABLE public.copilot_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY copilot_policy ON public.copilot_sessions FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- 15. Processing Jobs
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY jobs_policy ON public.processing_jobs FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.documents WHERE documents.document_id = processing_jobs.document_id));

-- 16 & 17. Knowledge Graph
ALTER TABLE public.knowledge_graph_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY kg_nodes_policy ON public.knowledge_graph_nodes FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = knowledge_graph_nodes.patient_id));

ALTER TABLE public.knowledge_graph_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY kg_edges_policy ON public.knowledge_graph_edges FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = knowledge_graph_edges.patient_id));

-- 18. Dashboard Layouts
ALTER TABLE public.dashboard_layouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY layouts_policy ON public.dashboard_layouts FOR ALL TO authenticated
USING (auth.uid() = user_id);

-- 19. User Preferences
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY preferences_policy ON public.user_preferences FOR ALL TO authenticated
USING (auth.uid() = user_id);

-- 20. Embeddings
ALTER TABLE public.embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY embeddings_policy ON public.embeddings FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.documents WHERE documents.document_id = embeddings.document_id));

-- Backwards compatibility table policies
ALTER TABLE public.review_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY history_policy ON public.review_history FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.entities WHERE entities.entity_id = review_history.entity_id));

ALTER TABLE public.risk_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY risk_scores_policy ON public.risk_scores FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = risk_scores.patient_id));

ALTER TABLE public.redaction_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY redactions_policy ON public.redaction_logs FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.documents WHERE documents.document_id = redaction_logs.document_id));

ALTER TABLE public.document_comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY comparisons_policy ON public.document_comparisons FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = document_comparisons.patient_id));
