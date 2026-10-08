import uuid
import json
from sqlalchemy import Column, String, Float, DateTime, Date, ForeignKey, Text, Integer, JSON, Uuid, Boolean, UniqueConstraint, false
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import UserDefinedType
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base

# Helper to generate UUIDs
def generate_uuid():
    return str(uuid.uuid4())

# Native uuid on Postgres (matches migrations/), CHAR(32) on SQLite; Python side stays str.
UUIDStr = Uuid(as_uuid=False)

# JSONB on Postgres, plain JSON on the SQLite dev database.
JSONType = JSON().with_variant(JSONB(), "postgresql")


class SourceMixin:
    """Provenance carried by every canonical clinical record.

    source_system: where the record came from ('synthea', 'upload', ...)
    source_id:     the record's identifier in that system, so imports are idempotent and traceable
    provenance:    'imported' (source system), 'manual' (entered/uploaded in ClinicalBrief)
                   or 'extracted' (proposed by the AI pipeline)
    """
    source_system = Column(String(50), nullable=True)
    source_id = Column(String(255), nullable=True)
    provenance = Column(String(20), nullable=False, default="imported")


def source_unique(table: str):
    return (UniqueConstraint("source_system", "source_id", name=f"uq_{table}_source"),)


# PGVector custom type mapping for SQLAlchemy
class Vector(UserDefinedType):
    def __init__(self, dim=384):
        self.dim = dim

    def get_col_spec(self, **kw):
        return f"vector({self.dim})"

class User(Base):
    __tablename__ = "users"

    id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    email = Column(String(255), unique=True, nullable=False, index=True)
    role = Column(String(50), nullable=False, default="pending")  # no access until an admin sets a role
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    documents = relationship("Document", back_populates="uploader")
    audit_logs = relationship("AuditLog", back_populates="user")

class Patient(SourceMixin, Base):
    __tablename__ = "patients"
    __table_args__ = source_unique("patients")

    patient_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    date_of_birth = Column(Date, nullable=True)  # nullable: not every source publishes a birth date
    deceased_date = Column(Date, nullable=True)
    gender = Column(String(20), nullable=False)
    assigned_clinician_id = Column(UUIDStr, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # Public demo sandbox (migration 0012): the only patients the anonymous 'demo' role can see.
    is_demo = Column(Boolean, nullable=False, default=False, server_default=false())
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    documents = relationship("Document", back_populates="patient", cascade="all, delete-orphan")

class Encounter(SourceMixin, Base):
    __tablename__ = "encounters"
    __table_args__ = source_unique("encounters")

    encounter_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    patient_id = Column(UUIDStr, ForeignKey("patients.patient_id", ondelete="CASCADE"), nullable=False, index=True)
    encounter_class = Column(String(50), nullable=True)   # e.g. AMB, EMER, IMP
    encounter_type = Column(String(255), nullable=True)
    reason = Column(String(255), nullable=True)
    start_at = Column(DateTime(timezone=True), nullable=True, index=True)
    end_at = Column(DateTime(timezone=True), nullable=True)


class Document(SourceMixin, Base):
    __tablename__ = "documents"
    __table_args__ = source_unique("documents")

    document_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    encounter_id = Column(UUIDStr, ForeignKey("encounters.encounter_id", ondelete="SET NULL"), nullable=True)
    document_date = Column(DateTime(timezone=True), nullable=True)  # clinical date; upload_date is ingestion time
    patient_id = Column(UUIDStr, ForeignKey("patients.patient_id", ondelete="CASCADE"), nullable=False, index=True)
    file_name = Column(String(255), nullable=False)
    file_type = Column(String(50), nullable=False)
    file_url = Column(String(512), nullable=True)
    classification = Column(String(100), nullable=True)
    status = Column(String(50), nullable=False, default="pending")
    upload_date = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    uploaded_by = Column(UUIDStr, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    patient = relationship("Patient", back_populates="documents")
    uploader = relationship("User", back_populates="documents")
    summary = relationship("Summary", uselist=False, back_populates="document", cascade="all, delete-orphan")
    entities = relationship("Entity", back_populates="document", cascade="all, delete-orphan")
    clinical_note = relationship("ClinicalNote", uselist=False, back_populates="document", cascade="all, delete-orphan")

class ClinicalNote(Base):
    __tablename__ = "clinical_notes"

    note_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    document_id = Column(UUIDStr, ForeignKey("documents.document_id", ondelete="CASCADE"), unique=True, nullable=False)
    patient_id = Column(UUIDStr, ForeignKey("patients.patient_id", ondelete="CASCADE"), nullable=False)
    original_text = Column(Text, nullable=False)
    redacted_text = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    document = relationship("Document", back_populates="clinical_note")

class Summary(Base):
    __tablename__ = "summaries"

    summary_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    document_id = Column(UUIDStr, ForeignKey("documents.document_id", ondelete="CASCADE"), unique=True, nullable=False)
    summary_text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    document = relationship("Document", back_populates="summary")

class Entity(Base):
    __tablename__ = "entities"

    entity_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    document_id = Column(UUIDStr, ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=False, index=True)
    entity_text = Column(String(255), nullable=False)
    entity_type = Column(String(100), nullable=False)
    confidence = Column(Float, nullable=True)  # NULL when the extractor has no calibrated score (rule-based mode)
    review_status = Column(String(50), nullable=False, default="pending") # pending, approved, rejected, edited
    reviewer_id = Column(UUIDStr, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    review_timestamp = Column(DateTime(timezone=True), nullable=True)
    original_value = Column(String(255), nullable=True)
    edited_value = Column(String(255), nullable=True)
    evidence = Column(Text, nullable=True)
    reasoning = Column(Text, nullable=True)
    extracted_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    document = relationship("Document", back_populates="entities")
    icd10_mapping = relationship("ICD10Mapping", uselist=False, back_populates="entity", cascade="all, delete-orphan")

class ICD10Mapping(Base):
    __tablename__ = "icd10_mappings"

    mapping_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    entity_id = Column(UUIDStr, ForeignKey("entities.entity_id", ondelete="CASCADE"), unique=True, nullable=False)
    icd10_code = Column(String(20), nullable=False, index=True)
    code_description = Column(Text, nullable=False)
    confidence = Column(Float, nullable=True)  # NULL for exact dictionary lookups

    entity = relationship("Entity", back_populates="icd10_mapping")

# --- Canonical clinical facts ------------------------------------------------------------------
# Codes are stored as (code, code_system, display) because sources use different vocabularies:
# Synthea uses SNOMED CT / RxNorm / LOINC.

class Diagnosis(SourceMixin, Base):
    __tablename__ = "diagnoses"
    __table_args__ = source_unique("diagnoses")

    diagnosis_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    patient_id = Column(UUIDStr, ForeignKey("patients.patient_id", ondelete="CASCADE"), nullable=False, index=True)
    encounter_id = Column(UUIDStr, ForeignKey("encounters.encounter_id", ondelete="SET NULL"), nullable=True)
    document_id = Column(UUIDStr, ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=True)
    code = Column(String(50), nullable=True)
    code_system = Column(String(255), nullable=True)
    display = Column(Text, nullable=False)
    clinical_status = Column(String(20), nullable=True)  # FHIR condition-clinical; NULL when the source doesn't say
    onset_at = Column(DateTime(timezone=True), nullable=True)
    abatement_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Medication(SourceMixin, Base):
    __tablename__ = "medications"
    __table_args__ = source_unique("medications")

    medication_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    patient_id = Column(UUIDStr, ForeignKey("patients.patient_id", ondelete="CASCADE"), nullable=False, index=True)
    encounter_id = Column(UUIDStr, ForeignKey("encounters.encounter_id", ondelete="SET NULL"), nullable=True)
    document_id = Column(UUIDStr, ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=True)
    code = Column(String(50), nullable=True)
    code_system = Column(String(255), nullable=True)
    medication_name = Column(Text, nullable=False)
    dose = Column(String(100), nullable=True)
    route = Column(String(100), nullable=True)
    frequency = Column(String(100), nullable=True)
    status = Column(String(30), nullable=True)
    start_at = Column(DateTime(timezone=True), nullable=True)
    end_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Allergy(SourceMixin, Base):
    __tablename__ = "allergies"
    __table_args__ = source_unique("allergies")

    allergy_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    patient_id = Column(UUIDStr, ForeignKey("patients.patient_id", ondelete="CASCADE"), nullable=False, index=True)
    document_id = Column(UUIDStr, ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=True)
    code = Column(String(50), nullable=True)
    code_system = Column(String(255), nullable=True)
    allergen = Column(Text, nullable=False)
    category = Column(String(50), nullable=True)
    criticality = Column(String(30), nullable=True)
    reaction = Column(Text, nullable=True)
    severity = Column(String(30), nullable=True)
    clinical_status = Column(String(20), nullable=True)
    recorded_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Procedure(SourceMixin, Base):
    __tablename__ = "procedures"
    __table_args__ = source_unique("procedures")

    procedure_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    patient_id = Column(UUIDStr, ForeignKey("patients.patient_id", ondelete="CASCADE"), nullable=False, index=True)
    encounter_id = Column(UUIDStr, ForeignKey("encounters.encounter_id", ondelete="SET NULL"), nullable=True)
    document_id = Column(UUIDStr, ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=True)
    code = Column(String(50), nullable=True)
    code_system = Column(String(255), nullable=True)
    procedure_name = Column(Text, nullable=False)
    performed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Observation(SourceMixin, Base):
    """Labs, vital signs and other measurements."""
    __tablename__ = "observations"
    __table_args__ = source_unique("observations")

    observation_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    patient_id = Column(UUIDStr, ForeignKey("patients.patient_id", ondelete="CASCADE"), nullable=False, index=True)
    encounter_id = Column(UUIDStr, ForeignKey("encounters.encounter_id", ondelete="SET NULL"), nullable=True)
    code = Column(String(50), nullable=True)
    code_system = Column(String(255), nullable=True)
    name = Column(Text, nullable=False)
    category = Column(String(50), nullable=True)   # laboratory, vital-signs, survey, ...
    value = Column(Text, nullable=True)
    unit = Column(String(50), nullable=True)
    flag = Column(String(30), nullable=True)       # abnormal flag exactly as the source reports it
    reference_range = Column(String(100), nullable=True)
    effective_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# --- Import bookkeeping ------------------------------------------------------------------------

class ImportRun(Base):
    __tablename__ = "import_runs"

    run_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    source_system = Column(String(50), nullable=False)
    source_path = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="running")  # running | completed | failed
    dry_run = Column(Boolean, nullable=False, default=False)
    counts = Column(JSONType, nullable=True)
    error_count = Column(Integer, nullable=False, default=0)
    message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)


class ImportErrorRecord(Base):
    """A source record that failed validation and was skipped (the rest of the import continues)."""
    __tablename__ = "import_errors"

    import_error_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    run_id = Column(UUIDStr, ForeignKey("import_runs.run_id", ondelete="CASCADE"), nullable=False, index=True)
    source_file = Column(Text, nullable=True)
    record_ref = Column(String(255), nullable=True)
    reason = Column(Text, nullable=False)
    raw = Column(Text, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    log_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    user_id = Column(UUIDStr, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action_type = Column(String(100), nullable=False)
    model_used = Column(String(100), nullable=True)
    confidence_score = Column(Float, nullable=True)
    extraction_source = Column(String(255), nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    user = relationship("User", back_populates="audit_logs")

class CopilotConversation(Base):
    __tablename__ = "copilot_sessions"

    conversation_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    patient_id = Column(UUIDStr, ForeignKey("patients.patient_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUIDStr, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    messages = Column(JSONType, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

class ProcessingJob(Base):
    __tablename__ = "processing_jobs"

    job_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    document_id = Column(UUIDStr, ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=False)
    status = Column(String(50), nullable=False, default="pending")
    step = Column(Integer, nullable=False, default=0)
    elapsed_time = Column(Float, nullable=False, default=0.0)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

class KnowledgeGraphNode(Base):
    __tablename__ = "knowledge_graph_nodes"

    node_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    patient_id = Column(UUIDStr, ForeignKey("patients.patient_id", ondelete="CASCADE"), nullable=False)
    label = Column(String(255), nullable=False)
    type = Column(String(100), nullable=False)
    details = Column(Text, nullable=True)
    entity_id = Column(UUIDStr, ForeignKey("entities.entity_id", ondelete="SET NULL"), nullable=True)

class KnowledgeGraphEdge(Base):
    __tablename__ = "knowledge_graph_edges"

    edge_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    patient_id = Column(UUIDStr, ForeignKey("patients.patient_id", ondelete="CASCADE"), nullable=False)
    source_node_id = Column(UUIDStr, ForeignKey("knowledge_graph_nodes.node_id", ondelete="CASCADE"), nullable=False)
    target_node_id = Column(UUIDStr, ForeignKey("knowledge_graph_nodes.node_id", ondelete="CASCADE"), nullable=False)
    label = Column(String(100), nullable=False)

class UserDashboardLayout(Base):
    __tablename__ = "dashboard_layouts"

    id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    user_id = Column(UUIDStr, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    layout_json = Column(JSONType, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

class UserPreference(Base):
    __tablename__ = "user_preferences"

    preference_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    user_id = Column(UUIDStr, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    theme = Column(String(20), nullable=False, default="light")
    role_preset = Column(String(50), nullable=False, default="clinician")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

class Embedding(Base):
    __tablename__ = "embeddings"

    embedding_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    document_id = Column(UUIDStr, ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=False)
    chunk_text = Column(Text, nullable=False)
    embedding = Column(Vector(384), nullable=False)
    model = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

# --- BACKWARDS COMPATIBILITY ONLY MODELS ---
class ReviewHistory(Base):
    __tablename__ = "review_history"

    history_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    entity_id = Column(UUIDStr, ForeignKey("entities.entity_id", ondelete="CASCADE"), nullable=False)
    reviewer_id = Column(UUIDStr, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(50), nullable=False)
    old_value = Column(String(255), nullable=True)
    new_value = Column(String(255), nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

class RiskScore(Base):
    __tablename__ = "risk_scores"

    risk_score_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    patient_id = Column(UUIDStr, ForeignKey("patients.patient_id", ondelete="CASCADE"), nullable=False, index=True)
    score_value = Column(Float, nullable=False)
    risk_level = Column(String(50), nullable=False)
    risk_factors = Column(Text, nullable=True)
    review_priority = Column(String(50), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

class RedactionLog(Base):
    __tablename__ = "redaction_logs"

    redaction_log_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    document_id = Column(UUIDStr, ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=False, index=True)
    entity_type = Column(String(100), nullable=False)
    original_text = Column(String(255), nullable=True)
    redacted_text = Column(String(255), nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

class DocumentComparison(Base):
    __tablename__ = "document_comparisons"

    comparison_id = Column(UUIDStr, primary_key=True, default=generate_uuid)
    patient_id = Column(UUIDStr, ForeignKey("patients.patient_id", ondelete="CASCADE"), nullable=False, index=True)
    doc1_id = Column(UUIDStr, ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=False)
    doc2_id = Column(UUIDStr, ForeignKey("documents.document_id", ondelete="CASCADE"), nullable=False)
    comparison_data = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
