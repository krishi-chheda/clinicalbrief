from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.models import User
from app.schemas.schemas import UserResponse
from app.api.v1.deps import get_current_user
import logging

logger = logging.getLogger("clinicalbrief.api.auth")
router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.get("/me", response_model=UserResponse)
def get_current_user_profile(current_user: User = Depends(get_current_user)):
    """The signed-in user's profile. The role returned here is the only role the UI should trust."""
    return current_user
