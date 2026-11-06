from datetime import date

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user, require_role
from app.models.user import User
from app.schemas.holiday import (
    HolidayCreate,
    HolidayDetail,
    HolidayListResponse,
    HolidayUpdate,
)
from app.services.holiday_service import HolidayService

router = APIRouter(prefix="/api/v1/holidays", tags=["Holiday Calendar"])


@router.get("", response_model=HolidayListResponse)
def list_holidays(
    office_id: int | None = Query(default=None, description="Filter by office ID"),
    start_date: date | None = Query(default=None, description="Filter on or after this date"),
    end_date: date | None = Query(default=None, description="Filter on or before this date"),
    include_org_wide: bool = Query(default=True, description="Whether to include organization-wide holidays when office_id is set"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List holidays with office and date filters (all authenticated users)."""
    return HolidayService.list_holidays(
        db=db,
        current_user=current_user,
        office_id=office_id,
        start_date=start_date,
        end_date=end_date,
        include_org_wide=include_org_wide,
    )


@router.post("", response_model=HolidayDetail, status_code=status.HTTP_201_CREATED)
def create_holiday(
    payload: HolidayCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    """Register a new holiday entry (ADMIN only)."""
    return HolidayService.create_holiday(
        db=db,
        current_user=current_user,
        payload=payload,
    )


@router.put("/{holiday_id}", response_model=HolidayDetail)
def update_holiday(
    holiday_id: int,
    payload: HolidayUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    """Update an existing holiday entry (ADMIN only)."""
    return HolidayService.update_holiday(
        db=db,
        current_user=current_user,
        holiday_id=holiday_id,
        payload=payload,
    )


@router.delete("/{holiday_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_holiday(
    holiday_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    """Delete a holiday entry (ADMIN only)."""
    HolidayService.delete_holiday(
        db=db,
        current_user=current_user,
        holiday_id=holiday_id,
    )
