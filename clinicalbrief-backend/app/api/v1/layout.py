from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.api.v1.deps import get_current_user
from app.models.models import User, UserDashboardLayout
from pydantic import BaseModel, Field
import logging

logger = logging.getLogger("clinicalbrief.api.layout")
router = APIRouter(prefix="/dashboard", tags=["dashboard"])

class LayoutSchema(BaseModel):
    layout_json: str = Field(max_length=20_000)  # ~20 widgets of JSON; bounded so one user can't store megabytes

@router.get("/layout")
def get_layout(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    layout = db.query(UserDashboardLayout).filter(UserDashboardLayout.user_id == current_user.id).first()
    if not layout:
        return {"user_id": current_user.id, "layout_json": None}
    return {"user_id": current_user.id, "layout_json": layout.layout_json}

@router.post("/layout")
def save_layout(
    payload: LayoutSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    layout = db.query(UserDashboardLayout).filter(UserDashboardLayout.user_id == current_user.id).first()
    if layout:
        layout.layout_json = payload.layout_json
    else:
        layout = UserDashboardLayout(user_id=current_user.id, layout_json=payload.layout_json)
        db.add(layout)
    try:
        db.commit()
        db.refresh(layout)
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to save user layout: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database transaction failed."
        )
    return {"status": "success", "layout_json": layout.layout_json}
