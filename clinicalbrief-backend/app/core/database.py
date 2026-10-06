import os
from urllib.parse import parse_qs, urlsplit

from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker
from app.core.config import settings

url = settings.DATABASE_URL
# Supabase hands out postgres:// / postgresql:// URLs; route them to the psycopg 3 driver.
for prefix in ("postgres://", "postgresql://"):
    if url.startswith(prefix):
        url = "postgresql+psycopg://" + url[len(prefix):]

is_sqlite = url.startswith("sqlite")

# Remote databases are opt-in per PROCESS, never via .env (N-20): .env is read by every process, including ad-hoc
# scripts and CLI writes, so a live database must not be anyone's silent default. The backend launch config and
# start script set CLINICALBRIEF_ALLOW_REMOTE_DB=1; a CLI write against live data needs the same explicit flag.
def _target_host(db_url: str) -> str:
    """Where libpq will actually connect: the URL host, else a ?host= parameter, else PGHOST (N-23)."""
    parts = urlsplit(db_url)
    return parts.hostname or (parse_qs(parts.query).get("host") or [""])[0] or os.environ.get("PGHOST", "")


db_host = "" if is_sqlite else _target_host(url)
# Local = loopback or a Unix socket directory; anything else (including an unknown host) counts as remote.
is_remote = not is_sqlite and not (db_host in {"", "localhost", "127.0.0.1", "::1"} or db_host.startswith("/"))
if is_remote and os.environ.get("CLINICALBRIEF_ALLOW_REMOTE_DB") != "1":
    raise RuntimeError(
        f"Refusing to connect to the remote database at {db_host}: set CLINICALBRIEF_ALLOW_REMOTE_DB=1 for this "
        "process if you really mean to use it (the backend launch config does). Leave DATABASE_URL unset for the "
        "local SQLite database.")

engine = create_engine(
    url,
    connect_args={"check_same_thread": False} if is_sqlite else {},
    pool_pre_ping=not is_sqlite,
)

if is_sqlite:
    # SQLite ignores foreign keys unless enabled per connection; enforce them so dev matches Postgres.
    @event.listens_for(engine, "connect")
    def _enable_sqlite_fks(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
