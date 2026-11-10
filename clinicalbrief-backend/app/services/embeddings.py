"""Note embeddings for "match meaning" search (v1.0.1, roadmap 8b; adopted after eval/results/search-*.json).

Embeddings come only from the local model (Ollama `nomic-embed-text`), through LocalLLM, so the Copilot's rules apply:
loopback address only, cloud models refused. The first DIMS dimensions are kept (the model is trained for that):
512 scored the same as all 768 on the evaluation questions and stores a third less.
"""
from app.services.llm import LocalLLM

EMBED_MODEL = "nomic-embed-text"
DIMS = 512


def shorten(vecs, dims: int = DIMS):
    """First `dims` dimensions, unit length (so a dot product is the cosine similarity)."""
    import numpy as np
    v = np.asarray(vecs, dtype=np.float32)[:, :dims]
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def embed(texts: list[str], task: str) -> list[list[float]]:
    """Raw embeddings. `task` is nomic's prefix: search_document or search_query. Raises LLMUnavailable."""
    llm = LocalLLM(model=EMBED_MODEL)
    llm.check()
    out = []
    for i in range(0, len(texts), 64):
        batch = [f"{task}: {t}" for t in texts[i:i + 64]]
        out += llm._request("/api/embed", {"model": EMBED_MODEL, "input": batch, "truncate": True}, timeout=300)["embeddings"]
    return out


def to_pg(vec) -> str:
    """pgvector text form: '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"


def rrf(rankings: list[list], k: int = 60) -> list:
    """Reciprocal-rank fusion: items ranked well by several lists come first."""
    scores: dict = {}
    for ranking in rankings:
        for i, d in enumerate(ranking, 1):
            scores[d] = scores.get(d, 0.0) + 1 / (k + i)
    return sorted(scores, key=lambda d: -scores[d])
