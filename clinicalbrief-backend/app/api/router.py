from fastapi import APIRouter
from app.api.v1.auth import router as auth_router
from app.api.v1.documents import router as documents_router
from app.api.v1.patients import router as patients_router
from app.api.v1.search import router as search_router
from app.api.v1.fhir import router as fhir_router
from app.api.v1.audit import router as audit_router
from app.api.v1.copilot import router as copilot_router
from app.api.v1.layout import router as layout_router
from app.api.v1.imports import router as imports_router
from app.api.v1.review import router as review_router
from app.api.v1.ops import router as ops_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(patients_router)
api_router.include_router(documents_router)
api_router.include_router(search_router)
api_router.include_router(fhir_router)
api_router.include_router(audit_router)
api_router.include_router(copilot_router)
api_router.include_router(layout_router)
api_router.include_router(imports_router)
api_router.include_router(review_router)
api_router.include_router(ops_router)
