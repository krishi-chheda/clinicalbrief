-- 0002: Canonical clinical model + import bookkeeping (Phase 1).
-- Safe to run right after 0001. The replaced tables (diagnoses, medications, allergies, procedures,
-- lab_results) were never read by the application, so they are dropped and recreated.

-- ---------- Provenance on patients and documents ----------
ALTER TABLE public.patients ALTER COLUMN date_of_birth DROP NOT NULL;  -- MIMIC-IV publishes no birth dates
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS deceased_date DATE;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS source_system VARCHAR(50);
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS source_id VARCHAR(255);
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS provenance VARCHAR(20) NOT NULL DEFAULT 'imported'
    CHECK (provenance IN ('imported', 'extracted', 'manual'));
ALTER TABLE public.patients ADD CONSTRAINT uq_patients_source UNIQUE (source_system, source_id);

-- ---------- Encounters ----------
CREATE TABLE public.encounters (
    encounter_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    encounter_class VARCHAR(50),
    encounter_type VARCHAR(255),
    reason VARCHAR(255),
    start_at TIMESTAMPTZ,
    end_at TIMESTAMPTZ,
    source_system VARCHAR(50),
    source_id VARCHAR(255),
    provenance VARCHAR(20) NOT NULL DEFAULT 'imported' CHECK (provenance IN ('imported', 'extracted', 'manual')),
    CONSTRAINT uq_encounters_source UNIQUE (source_system, source_id)
);
CREATE INDEX ix_encounters_patient_id ON public.encounters(patient_id);
CREATE INDEX ix_encounters_start_at ON public.encounters(start_at);

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS encounter_id UUID REFERENCES public.encounters(encounter_id) ON DELETE SET NULL;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS document_date TIMESTAMPTZ;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS source_system VARCHAR(50);
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS source_id VARCHAR(255);
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS provenance VARCHAR(20) NOT NULL DEFAULT 'imported'
    CHECK (provenance IN ('imported', 'extracted', 'manual'));
ALTER TABLE public.documents ADD CONSTRAINT uq_documents_source UNIQUE (source_system, source_id);

-- ---------- Canonical clinical facts (code + code_system + display; vocabularies differ by source) ----------
DROP TABLE IF EXISTS public.diagnoses, public.medications, public.allergies, public.procedures, public.lab_results CASCADE;

CREATE TABLE public.diagnoses (
    diagnosis_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    encounter_id UUID REFERENCES public.encounters(encounter_id) ON DELETE SET NULL,
    document_id UUID REFERENCES public.documents(document_id) ON DELETE CASCADE,
    code VARCHAR(50),
    code_system VARCHAR(255),
    display TEXT NOT NULL,
    clinical_status VARCHAR(20) CHECK (clinical_status IN ('active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved')),
    onset_at TIMESTAMPTZ,
    abatement_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_system VARCHAR(50),
    source_id VARCHAR(255),
    provenance VARCHAR(20) NOT NULL DEFAULT 'imported' CHECK (provenance IN ('imported', 'extracted', 'manual')),
    CONSTRAINT uq_diagnoses_source UNIQUE (source_system, source_id)
);

CREATE TABLE public.medications (
    medication_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    encounter_id UUID REFERENCES public.encounters(encounter_id) ON DELETE SET NULL,
    document_id UUID REFERENCES public.documents(document_id) ON DELETE CASCADE,
    code VARCHAR(50),
    code_system VARCHAR(255),
    medication_name TEXT NOT NULL,
    dose VARCHAR(100),
    route VARCHAR(100),
    frequency VARCHAR(100),
    status VARCHAR(30),
    start_at TIMESTAMPTZ,
    end_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_system VARCHAR(50),
    source_id VARCHAR(255),
    provenance VARCHAR(20) NOT NULL DEFAULT 'imported' CHECK (provenance IN ('imported', 'extracted', 'manual')),
    CONSTRAINT uq_medications_source UNIQUE (source_system, source_id)
);

CREATE TABLE public.allergies (
    allergy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(document_id) ON DELETE CASCADE,
    code VARCHAR(50),
    code_system VARCHAR(255),
    allergen TEXT NOT NULL,
    category VARCHAR(50),
    criticality VARCHAR(30),
    reaction TEXT,
    severity VARCHAR(30),
    clinical_status VARCHAR(20),
    recorded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_system VARCHAR(50),
    source_id VARCHAR(255),
    provenance VARCHAR(20) NOT NULL DEFAULT 'imported' CHECK (provenance IN ('imported', 'extracted', 'manual')),
    CONSTRAINT uq_allergies_source UNIQUE (source_system, source_id)
);

CREATE TABLE public.procedures (
    procedure_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    encounter_id UUID REFERENCES public.encounters(encounter_id) ON DELETE SET NULL,
    document_id UUID REFERENCES public.documents(document_id) ON DELETE CASCADE,
    code VARCHAR(50),
    code_system VARCHAR(255),
    procedure_name TEXT NOT NULL,
    performed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_system VARCHAR(50),
    source_id VARCHAR(255),
    provenance VARCHAR(20) NOT NULL DEFAULT 'imported' CHECK (provenance IN ('imported', 'extracted', 'manual')),
    CONSTRAINT uq_procedures_source UNIQUE (source_system, source_id)
);

CREATE TABLE public.observations (
    observation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(patient_id) ON DELETE CASCADE,
    encounter_id UUID REFERENCES public.encounters(encounter_id) ON DELETE SET NULL,
    code VARCHAR(50),
    code_system VARCHAR(255),
    name TEXT NOT NULL,
    category VARCHAR(50),
    value TEXT,
    unit VARCHAR(50),
    flag VARCHAR(30),
    reference_range VARCHAR(100),
    effective_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_system VARCHAR(50),
    source_id VARCHAR(255),
    provenance VARCHAR(20) NOT NULL DEFAULT 'imported' CHECK (provenance IN ('imported', 'extracted', 'manual')),
    CONSTRAINT uq_observations_source UNIQUE (source_system, source_id)
);

CREATE INDEX ix_diagnoses_patient_id ON public.diagnoses(patient_id);
CREATE INDEX ix_medications_patient_id ON public.medications(patient_id);
CREATE INDEX ix_allergies_patient_id ON public.allergies(patient_id);
CREATE INDEX ix_procedures_patient_id ON public.procedures(patient_id);
CREATE INDEX ix_observations_patient_id ON public.observations(patient_id);
CREATE INDEX ix_observations_effective_at ON public.observations(effective_at);

-- ---------- Import bookkeeping ----------
CREATE TABLE public.import_runs (
    run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_system VARCHAR(50) NOT NULL,
    source_path TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    dry_run BOOLEAN NOT NULL DEFAULT FALSE,
    counts JSONB,
    error_count INT NOT NULL DEFAULT 0,
    message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE TABLE public.import_errors (
    import_error_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES public.import_runs(run_id) ON DELETE CASCADE,
    source_file TEXT,
    record_ref VARCHAR(255),
    reason TEXT NOT NULL,
    raw TEXT
);
CREATE INDEX ix_import_errors_run_id ON public.import_errors(run_id);

-- ---------- RLS: read-only for clients, scoped by patient visibility (writes go through the backend) ----------
ALTER TABLE public.encounters ENABLE ROW LEVEL SECURITY;
CREATE POLICY encounters_policy ON public.encounters FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = encounters.patient_id));

ALTER TABLE public.diagnoses ENABLE ROW LEVEL SECURITY;
CREATE POLICY diagnoses_policy ON public.diagnoses FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = diagnoses.patient_id));

ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;
CREATE POLICY medications_policy ON public.medications FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = medications.patient_id));

ALTER TABLE public.allergies ENABLE ROW LEVEL SECURITY;
CREATE POLICY allergies_policy ON public.allergies FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = allergies.patient_id));

ALTER TABLE public.procedures ENABLE ROW LEVEL SECURITY;
CREATE POLICY procedures_policy ON public.procedures FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = procedures.patient_id));

ALTER TABLE public.observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY observations_policy ON public.observations FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.patients WHERE patients.patient_id = observations.patient_id));

ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_runs_policy ON public.import_runs FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'auditor')));

ALTER TABLE public.import_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_errors_policy ON public.import_errors FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'auditor')));
