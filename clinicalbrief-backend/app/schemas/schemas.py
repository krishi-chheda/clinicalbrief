from pydantic import BaseModel, ConfigDict, Field, model_validator
from datetime import date, datetime
from typing import List, Literal, Optional

class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

# --- User Schemas ---
class UserBase(BaseSchema):
    email: str

class UserCreate(UserBase):
    password: str
    role: Optional[str] = "clinician"

class UserResponse(UserBase):
    id: str
    role: str
    created_at: datetime

class TokenResponse(BaseSchema):
    access_token: str
    token_type: str
    role: str
    email: str

# --- Patient Schemas ---
class PatientBase(BaseSchema):
    first_name: str
    last_name: str
    date_of_birth: date
    gender: str

class PatientCreate(PatientBase):
    pass

class PatientResponse(PatientBase):
    patient_id: str
    date_of_birth: Optional[date] = None   # not every source publishes a birth date
    deceased_date: Optional[date] = None
    source_system: Optional[str] = None
    created_at: datetime

class PatientListItem(PatientResponse):
    document_count: int = 0
    last_encounter_at: Optional[datetime] = None


# --- ICD-10 Mappings ---
class ICD10MappingResponse(BaseSchema):
    mapping_id: str
    icd10_code: str
    code_description: str
    confidence: Optional[float] = None

# --- Entity Schemas ---
class EntityBase(BaseSchema):
    entity_text: str
    entity_type: str
    confidence: Optional[float] = None   # None = no calibrated score (never invented)
    review_status: str

class EntityResponse(EntityBase):
    entity_id: str
    document_id: str
    extracted_at: datetime
    reviewer_id: Optional[str] = None
    review_timestamp: Optional[datetime] = None
    original_value: Optional[str] = None
    edited_value: Optional[str] = None
    evidence: Optional[str] = None
    reasoning: Optional[str] = None
    icd10_mapping: Optional[ICD10MappingResponse] = None

class EntityReviewRequest(BaseSchema):
    status: Literal["approved", "rejected", "edited", "pending"]  # "pending" = reset a previous decision
    edited_text: Optional[str] = Field(default=None, min_length=1, max_length=255)
    # The state the reviewer saw; when given and no longer current, the API answers 409 and changes nothing.
    from_status: Optional[Literal["approved", "rejected", "edited", "pending"]] = None

    @model_validator(mode="after")
    def edited_needs_text(self):
        if self.status == "edited" and not self.edited_text:
            raise ValueError("edited_text is required when status is 'edited'")
        return self

# --- Summary Schemas ---
class SummaryResponse(BaseSchema):
    summary_id: str
    document_id: str
    summary_text: str
    created_at: datetime

# --- Document Schemas ---
class DocumentBase(BaseSchema):
    file_name: str
    file_type: str
    classification: Optional[str] = None
    status: str

class DocumentCreate(DocumentBase):
    patient_id: str
    uploaded_by: Optional[str] = None

class DocumentResponse(DocumentBase):
    document_id: str
    patient_id: str
    upload_date: datetime
    document_date: Optional[datetime] = None   # clinical date of the note (upload_date = ingestion time)
    encounter_id: Optional[str] = None
    source_system: Optional[str] = None
    uploaded_by: Optional[str] = None
    file_url: Optional[str] = None

class DocumentInsightsResponse(BaseSchema):
    document_id: str
    file_name: str
    classification: Optional[str] = None
    status: str
    summary: Optional[SummaryResponse] = None
    entities: List[EntityResponse] = []

# --- Semantic Search & QA ---
class SearchRequest(BaseSchema):
    query: str
    patient_id: Optional[str] = None
    k: Optional[int] = 5

class SearchResultItem(BaseSchema):
    document_id: str
    patient_id: str
    chunk_text: str
    similarity: float

class SearchResponse(BaseSchema):
    results: List[SearchResultItem]

class QARequest(BaseSchema):
    document_id: str
    question: str

class QAResponse(BaseSchema):
    answer: str
    confidence: Optional[float] = None  # None unless a model produced a real score

# --- Audit Log Schemas ---
class AuditLogResponse(BaseSchema):
    log_id: str
    user_id: Optional[str] = None
    action_type: str
    model_used: Optional[str] = None
    confidence_score: Optional[float] = None
    extraction_source: Optional[str] = None
    timestamp: datetime

# --- Review History ---
class ReviewHistoryResponse(BaseSchema):
    history_id: str
    entity_id: str
    reviewer_id: Optional[str] = None
    action: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    timestamp: datetime

# --- Risk Scores ---
class RiskScoreResponse(BaseSchema):
    risk_score_id: str
    patient_id: str
    score_value: float
    risk_level: str
    risk_factors: Optional[str] = None
    review_priority: str
    created_at: datetime

# --- Copilot Conversations & Messages ---
class CopilotMessageCreate(BaseSchema):
    content: str = Field(min_length=1, max_length=2000)

class CopilotMessageResponse(BaseSchema):
    message_id: str
    conversation_id: str
    sender: str
    content: str
    citations: Optional[str] = None
    confidence: Optional[float] = None
    timestamp: datetime
    suggested_questions: Optional[List[str]] = None
    mode: Optional[str] = None        # "local-llm:<model>" or "rule-based"
    grounding: Optional[str] = None   # grounded | partial | no-evidence | withheld
    warnings: Optional[List[str]] = None
    search_terms: Optional[List[str]] = None  # terms the local model suggested for retrieval

class CopilotConversationCreate(BaseSchema):
    title: str = Field(min_length=1, max_length=255)  # copilot_sessions.title is VARCHAR(255)

class CopilotConversationResponse(BaseSchema):
    conversation_id: str
    patient_id: str
    user_id: str
    title: str
    created_at: datetime
    messages: List[CopilotMessageResponse] = []

# --- Redaction Logs ---
class RedactionLogResponse(BaseSchema):
    redaction_log_id: str
    document_id: str
    entity_type: str
    original_text: Optional[str] = None
    redacted_text: Optional[str] = None
    timestamp: datetime

# --- Document Comparisons ---
class DocumentComparisonResponse(BaseSchema):
    comparison_id: str
    patient_id: str
    doc1_id: str
    doc2_id: str
    comparison_data: str
    created_at: datetime
