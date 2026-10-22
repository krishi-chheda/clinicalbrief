import os
from pathlib import Path
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")


class Settings:
    PROJECT_NAME: str = "ClinicalBrief API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"

    # Supabase project (e.g. https://<ref>.supabase.co). Used to fetch JWKS for token verification.
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "").rstrip("/")

    # Local dev falls back to SQLite; Supabase Postgres in any real environment.
    DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'clinicalbrief_dev.db'}")

    # Legacy Supabase HS256 secret. Only needed if the project still signs tokens with the shared secret.
    # No default: an empty secret means HS256 tokens are rejected.
    JWT_SECRET: str = os.getenv("JWT_SECRET", "")
    JWT_AUDIENCE: str = "authenticated"

    CORS_ORIGINS: list[str] = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]

    UPLOAD_DIR: Path = Path(os.getenv("UPLOAD_DIR", BACKEND_DIR / "uploads"))
    MAX_UPLOAD_BYTES: int = int(os.getenv("MAX_UPLOAD_BYTES", 5 * 1024 * 1024))

    # Local LLM for the Copilot (Ollama). Must be a loopback address and a locally-run model.
    LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "http://localhost:11434")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "qwen3.5")  # chosen over llama3.1: see README comparison
    LLM_TIMEOUT_SECONDS: float = float(os.getenv("LLM_TIMEOUT_SECONDS", "120"))

    # S-4: interactive API docs (/docs, /redoc, /openapi.json) are off unless switched on (local development).
    EXPOSE_API_DOCS: bool = os.getenv("EXPOSE_API_DOCS", "false").lower() == "true"
    # S-2: per-user request limits on the expensive routes. "off" only for the test suite (see tests/conftest.py).
    RATE_LIMITS: bool = os.getenv("RATE_LIMITS", "on").lower() != "off"

    # AI Engine Configuration
    USE_MOCK_MODELS: bool = os.getenv("USE_MOCK_MODELS", "true").lower() == "true"

    # Models Name
    NER_MODEL: str = "d4data/biomedical-ner-all"
    SUMMARIZATION_MODEL: str = "facebook/bart-large-cnn"
    QA_MODEL: str = "deepset/roberta-base-squad2"
    EMBEDDING_MODEL: str = "sentence-transformers/all-MiniLM-L6-v2"
    CLASSIFICATION_MODEL: str = "distilbert-base-uncased-finetuned-sst-2-english"

settings = Settings()
