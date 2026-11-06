from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user, require_role
from app.models.user import User
from app.schemas.office import OfficeCreate, OfficeResponse, OfficeUpdate
from app.services.office_service import OfficeService

router = APIRouter(prefix="/api/v1/offices", tags=["Offices"])


@router.post("", response_model=OfficeResponse, status_code=status.HTTP_201_CREATED)
def create_office(
    payload: OfficeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    """Create a new office location (ADMIN only)."""
    return OfficeService.create_office(
        db=db,
        payload=payload,
        current_user=current_user,
    )


@router.get("", response_model=list[OfficeResponse])
def list_offices(
    active_only: bool = Query(default=False, description="Filter active offices only"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all registered office locations (authenticated users)."""
    return OfficeService.list_offices(db=db, active_only=active_only)


@router.get("/{office_id}", response_model=OfficeResponse)
def get_office(
    office_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve details for a specific office location."""
    return OfficeService.get_office_by_id(db=db, office_id=office_id)


@router.patch("/{office_id}", response_model=OfficeResponse)
def update_office(
    office_id: int,
    payload: OfficeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    """Update an existing office location (ADMIN only)."""
    return OfficeService.update_office(
        db=db,
        office_id=office_id,
        payload=payload,
        current_user=current_user,
    )


@router.delete("/{office_id}", response_model=OfficeResponse)
def deactivate_office(
    office_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    """Deactivate (soft-delete) an office location (ADMIN only)."""
    return OfficeService.deactivate_office(
        db=db,
        office_id=office_id,
        current_user=current_user,
    )
