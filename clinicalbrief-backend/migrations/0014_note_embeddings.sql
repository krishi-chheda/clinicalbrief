-- v1.0.1 (roadmap 8b): note embeddings for "match meaning" search.
-- Adopted because embedding search beat full-text search on a fixed question set decided in advance
-- (clinicalbrief-backend/eval/results/search-*.json). Vectors come from the LOCAL model (nomic-embed-text, first 512
-- dimensions) and are written by `py -3.12 -m app.cli embed-notes`; nothing is sent to an outside service.
-- ~2 KB per note (35,103 notes: ~75 MB). No vector index: an exact scan is fast at this size and returns exact
-- neighbours; add an HNSW index if note counts grow by an order of magnitude.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.note_embeddings (
    document_id UUID PRIMARY KEY REFERENCES public.documents(document_id) ON DELETE CASCADE,
    model VARCHAR(100) NOT NULL,
    embedding extensions.vector(512) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only the backend reads it (it applies the role and patient checks). RLS with no policy: API roles see no rows.
ALTER TABLE public.note_embeddings ENABLE ROW LEVEL SECURITY;
