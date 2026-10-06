import logging
from typing import Dict, Any
from app.core.config import settings
from app.services.faiss_manager import vector_search_manager

logger = logging.getLogger("clinicalbrief.qa_engine")

class ClinicalQAEngine:
    def __init__(self):
        self.use_mock = settings.USE_MOCK_MODELS
        self.qa_pipeline = None

        if not self.use_mock:
            try:
                from transformers import pipeline
                logger.info("Initializing Hugging Face Q&A Pipeline...")
                self.qa_pipeline = pipeline("question-answering", model=settings.QA_MODEL)
                logger.info("HF Q&A Pipeline initialized successfully.")
            except Exception as e:
                logger.warning(f"Failed to load HF Q&A: {e}. Falling back to Keyword Context Parser.")
                self.use_mock = True

    def answer_question(self, document_id: str, question: str) -> Dict[str, Any]:
        """Retrieves matching chunks and answers questions about a specific document."""
        # 1. Fetch relevant chunks from the document
        doc_chunks = vector_search_manager.similarity_search(query=question, document_id=document_id, k=3)

        if not doc_chunks:
            # Fallback: check if we have any chunks cached
            # If empty, return a friendly clinical placeholder
            return {
                "answer": "I could not find matching clinical context inside this document to address your question.",
                "confidence": None
            }

        context = "\n".join([c["chunk_text"] for c in doc_chunks])

        if self.use_mock:
            # Smart text heuristics to locate appropriate sentences
            q_clean = question.lower()
            sentences = [s.strip() for s in context.split('.') if s.strip()]

            # Simple keyword matching heuristic
            best_match = None
            max_score = 0

            # Extract keywords from the question
            keywords = [w for w in q_clean.split() if len(w) > 3]

            for sentence in sentences:
                s_lower = sentence.lower()
                score = 0
                for kw in keywords:
                    if kw in s_lower:
                        score += 1

                # Check for specific intents
                if "medication" in q_clean or "prescrib" in q_clean or "drug" in q_clean:
                    if any(med.lower() in s_lower for med in ["aspirin", "atorvastatin", "metformin", "lisinopril", "albuterol", "insulin", "dose", "tablet", "mg"]):
                        score += 2
                if "diagnos" in q_clean or "disease" in q_clean or "condition" in q_clean:
                    if any(dis.lower() in s_lower for dis in ["infarction", "diabetes", "hypertension", "kidney", "pneumonia", "asthma", "failure"]):
                        score += 2

                if score > max_score:
                    max_score = score
                    best_match = sentence

            if best_match and max_score > 0:
                return {
                    "answer": best_match + ".",
                    "confidence": None  # keyword overlap is not a calibrated score
                }

            # No sentence matched the question: say so instead of returning unrelated text.
            return {
                "answer": "I couldn't find evidence for this in the available records.",
                "confidence": None
            }

        try:
            res = self.qa_pipeline(question=question, context=context)
            return {
                "answer": res.get("answer", "No answer could be formulated."),
                "confidence": float(res["score"]) if res.get("score") is not None else None
            }
        except Exception as e:
            logger.error(f"Error in HF QA pipeline: {e}")
            return {
                "answer": "Error retrieving pipeline response.",
                "confidence": None
            }

qa_engine = ClinicalQAEngine()
