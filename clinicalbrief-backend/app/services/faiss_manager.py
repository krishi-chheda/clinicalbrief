import os
import re
import math
import logging
from typing import Dict, List, Any, Tuple

logger = logging.getLogger("clinicalbrief.faiss_manager")

def in_scope(patient_id, doc_id, scope: dict) -> bool:
    """Retrieval scope, applied BEFORE ranking so in-scope results are never crowded out."""
    if scope.get("document_id") and doc_id != scope["document_id"]:
        return False
    if scope.get("patient_id") and patient_id != scope["patient_id"]:
        return False
    if scope.get("patient_ids") is not None and patient_id not in scope["patient_ids"]:
        return False
    return True


class SimplePythonVectorIndex:
    """A lightweight, zero-dependency cosine-similarity index for text chunks."""
    def __init__(self):
        self.chunks: List[Dict[str, Any]] = []

    def add_chunks(self, doc_id: str, patient_id: str, text_chunks: List[str]):
        for chunk in text_chunks:
            self.chunks.append({
                "doc_id": doc_id,
                "patient_id": patient_id,
                "text": chunk,
                "vector": self._get_term_frequencies(chunk)
            })

    def _get_term_frequencies(self, text: str) -> Dict[str, int]:
        words = re.findall(r'\w+', text.lower())
        tf = {}
        for w in words:
            tf[w] = tf.get(w, 0) + 1
        return tf

    def _cosine_similarity(self, tf1: Dict[str, int], tf2: Dict[str, int]) -> float:
        intersection = set(tf1.keys()) & set(tf2.keys())
        numerator = sum([tf1[x] * tf2[x] for x in intersection])

        sum1 = sum([tf1[x]**2 for x in tf1.keys()])
        sum2 = sum([tf2[x]**2 for x in tf2.keys()])
        denominator = math.sqrt(sum1) * math.sqrt(sum2)

        if not denominator:
            return 0.0
        return float(numerator) / denominator

    def search(self, query: str, k: int = 5, **scope) -> List[Tuple[Dict[str, Any], float]]:
        query_vector = self._get_term_frequencies(query)
        results = []
        for item in self.chunks:
            if not in_scope(item["patient_id"], item["doc_id"], scope):
                continue
            results.append((item, self._cosine_similarity(query_vector, item["vector"])))

        # Sort by similarity score descending
        results.sort(key=lambda x: x[1], reverse=True)
        return results[:k]


class FAISSIndexManager:
    def __init__(self):
        from app.core.config import settings
        self.use_mock = settings.USE_MOCK_MODELS
        self.model = None
        self.index = None
        self.fallback_index = SimplePythonVectorIndex()

        if not self.use_mock:
            try:
                import faiss
                from sentence_transformers import SentenceTransformer
                logger.info("Initializing SentenceTransformer and FAISS...")
                self.model = SentenceTransformer(settings.EMBEDDING_MODEL)
                # FAISS index will be created dynamically as dimensions depend on model
                self.dimension = 384 # Dimension of all-MiniLM-L6-v2
                self.index = faiss.IndexFlatL2(self.dimension)
                self.chunk_metadata: List[Dict[str, Any]] = []
                logger.info("FAISS initialized successfully.")
            except Exception as e:
                logger.warning(f"Failed to load sentence-transformers / FAISS: {e}. Falling back to Python Cosine Index.")
                self.use_mock = True

    def chunk_document(self, text: str, chunk_size: int = 300, overlap: int = 50) -> List[str]:
        """Splits a document text into overlapping chunks of approx. word lengths or sentences."""
        sentences = re.split(r'(?<=[.!?])\s+', text)
        chunks = []
        current_chunk = []
        current_word_count = 0

        for sentence in sentences:
            words = sentence.split()
            word_count = len(words)
            if current_word_count + word_count > chunk_size:
                if current_chunk:
                    chunks.append(" ".join(current_chunk))
                # Create overlap: keep the last sentence if possible
                if len(current_chunk) > 1:
                    current_chunk = [current_chunk[-1], sentence]
                    current_word_count = len(current_chunk[0].split()) + word_count
                else:
                    current_chunk = [sentence]
                    current_word_count = word_count
            else:
                current_chunk.append(sentence)
                current_word_count += word_count

        if current_chunk:
            chunks.append(" ".join(current_chunk))
        return chunks

    def add_document(self, doc_id: str, patient_id: str, text: str):
        """Indexes a document text in the FAISS or fallback index."""
        chunks = self.chunk_document(text)
        if not chunks:
            return

        if self.use_mock:
            self.fallback_index.add_chunks(doc_id, patient_id, chunks)
            return

        try:
            import numpy as np
            embeddings = self.model.encode(chunks)
            vectors = np.array(embeddings).astype('float32')
            self.index.add(vectors)

            for chunk in chunks:
                self.chunk_metadata.append({
                    "document_id": doc_id,
                    "patient_id": patient_id,
                    "chunk_text": chunk
                })
        except Exception as e:
            logger.error(f"Error indexing document in FAISS: {e}. Indexing in fallback index instead.")
            self.fallback_index.add_chunks(doc_id, patient_id, chunks)

    def similarity_search(self, query: str, k: int = 5, patient_id: str = None, patient_ids=None,
                          document_id: str = None) -> List[Dict[str, Any]]:
        """Top-k chunks within the given scope (one patient, a set of patients, or one document)."""
        scope = {"patient_id": patient_id, "patient_ids": patient_ids, "document_id": document_id}
        if self.use_mock:
            raw_results = self.fallback_index.search(query, k, **scope)
            formatted = []
            for item, sim in raw_results:
                formatted.append({
                    "document_id": item["doc_id"],
                    "patient_id": item["patient_id"],
                    "chunk_text": item["text"],
                    "similarity": round(sim, 4)
                })
            return formatted

        try:
            import numpy as np
            query_vector = np.array([self.model.encode(query)]).astype('float32')
            # ponytail: IndexFlatL2 is exhaustive anyway, so scoring every chunk then filtering is exact;
            # move to a scoped pgvector query in the RAG phase.
            filtered = any(v is not None for v in scope.values())
            distances, indices = self.index.search(query_vector, self.index.ntotal if filtered else k)

            results = []
            for dist, idx in zip(distances[0], indices[0]):
                if idx == -1 or idx >= len(self.chunk_metadata):
                    continue

                meta = self.chunk_metadata[idx]
                if not in_scope(meta["patient_id"], meta["document_id"], scope):
                    continue

                # Convert L2 distance to a standard similarity percentage
                similarity = float(1 / (1 + dist))
                results.append({
                    "document_id": meta["document_id"],
                    "patient_id": meta["patient_id"],
                    "chunk_text": meta["chunk_text"],
                    "similarity": round(similarity, 4)
                })
                if len(results) >= k:
                    break
            return results
        except Exception as e:
            logger.error(f"Error searching FAISS: {e}. Falling back to Python Cosine Index search.")
            raw_results = self.fallback_index.search(query, k, **scope)
            return [{
                "document_id": item["doc_id"],
                "patient_id": item["patient_id"],
                "chunk_text": item["text"],
                "similarity": round(sim, 4)
            } for item, sim in raw_results]

# Instantiate global index manager
vector_search_manager = FAISSIndexManager()
