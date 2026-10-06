import datetime, os, tempfile, time, uuid
from pathlib import Path

# Configure before the app is imported.
#   default          -> throwaway SQLite database
#   TEST_PG=1        -> throwaway local Postgres (pgserver) with the real migrations/ applied
#   TEST_DATABASE_URL-> an existing Postgres you have prepared yourself
_tmp = Path(tempfile.mkdtemp(prefix="cb_test_"))


def _local_postgres() -> str:
    import pgserver, psycopg
    uri = pgserver.get_server(_tmp / "pg", cleanup_mode="stop").get_uri()
    here = Path(__file__).parent
    with psycopg.connect(uri, autocommit=True) as conn:
        conn.execute((here / "supabase_stub.sql").read_text())
        for migration in sorted((here.parent / "migrations").glob("*.sql")):
            conn.execute(migration.read_text())
    return uri


if os.environ.get("TEST_PG") == "1":
    os.environ["DATABASE_URL"] = _local_postgres()
else:
    os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_tmp / 'test.db'}")
os.environ["JWT_SECRET"] = "test-secret-at-least-32-bytes-long!!"
os.environ["SUPABASE_URL"] = ""
os.environ["UPLOAD_DIR"] = str(_tmp / "uploads")
os.environ["USE_MOCK_MODELS"] = "true"
# Tests never call a real LLM: point the Copilot at a closed local port (tests that need a model use a fake).
os.environ["LLM_BASE_URL"] = "http://127.0.0.1:9"

import logging
import jwt
import pytest
from fastapi.testclient import TestClient

logging.raiseExceptions = False  # pgserver logs its shutdown after pytest has closed stdout

from app.main import app
from app.core.database import SessionLocal
from app.models.models import User, Patient


def token_for(user_id, secret=os.environ["JWT_SECRET"], aud="authenticated", exp_in=3600):
    claims = {"sub": user_id, "aud": aud, "role": "authenticated", "exp": int(time.time()) + exp_in}
    return jwt.encode(claims, secret, algorithm="HS256")


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:  # runs lifespan -> creates SQLite schema
        yield c


@pytest.fixture(scope="session")
def world(client):
    """One user per role, plus two patients: one assigned to `clinician`, one unassigned."""
    from sqlalchemy import text
    from app.core.database import is_sqlite
    db = SessionLocal()
    users = {}
    for role in ["admin", "clinician", "consultant", "coder", "auditor", "researcher"]:
        uid, email = str(uuid.uuid4()), f"{role}-{uuid.uuid4().hex[:6]}@test.local"
        if is_sqlite:
            db.add(User(id=uid, email=email, role=role))
        else:
            # Postgres/Supabase: profiles come from the auth.users trigger; an admin then sets the role.
            db.execute(text("INSERT INTO auth.users (id, email) VALUES (:id, :email)"), {"id": uid, "email": email})
            db.execute(text("UPDATE public.users SET role = :role WHERE id = :id"), {"id": uid, "role": role})
        db.commit()
        users[role] = db.get(User, uid)
    mine = Patient(first_name="Assigned", last_name="Patient", date_of_birth=datetime.date(1960, 1, 1),
                   gender="Female", assigned_clinician_id=users["clinician"].id)
    other = Patient(first_name="Other", last_name="Patient", date_of_birth=datetime.date(1970, 1, 1), gender="Male")
    db.add_all([mine, other])
    db.commit()
    world = {"users": {r: u.id for r, u in users.items()}, "mine": mine.patient_id, "other": other.patient_id}
    db.close()
    return world


@pytest.fixture
def auth(world):
    return lambda role: {"Authorization": f"Bearer {token_for(world['users'][role])}"}
