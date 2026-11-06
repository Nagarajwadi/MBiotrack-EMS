from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user, require_role
from app.models.user import User
from app.schemas.device import DeviceCreate, DeviceResponse, DeviceUpdate
from app.services.device_service import DeviceService

router = APIRouter(prefix="/api/v1/devices", tags=["Device Registry"])


@router.post("", response_model=DeviceResponse, status_code=status.HTTP_201_CREATED)
def create_device(
    payload: DeviceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    """Register a new biometric terminal device (ADMIN only)."""
    return DeviceService.create_device(
        db=db,
        payload=payload,
        current_user=current_user,
    )


@router.get("", response_model=list[DeviceResponse])
def list_devices(
    office_id: int | None = Query(default=None, description="Filter by office ID"),
    status: str | None = Query(default=None, description="Filter by status (ACTIVE, INACTIVE, DECOMMISSIONED)"),
    active_only: bool = Query(default=False, description="Filter active devices only"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List registered devices (authenticated users)."""
    return DeviceService.list_devices(
        db=db,
        office_id=office_id,
        status_filter=status,
        active_only=active_only,
    )


@router.get("/{device_id}", response_model=DeviceResponse)
def get_device(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve details for a specific device."""
    return DeviceService.get_device_by_id(db=db, device_id=device_id)


@router.patch("/{device_id}", response_model=DeviceResponse)
def update_device(
    device_id: int,
    payload: DeviceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    """Update device metadata, network parameters, or status (ADMIN only)."""
    return DeviceService.update_device(
        db=db,
        device_id=device_id,
        payload=payload,
        current_user=current_user,
    )


@router.post("/{device_id}/decommission", response_model=DeviceResponse)
def decommission_device(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    """Permanently decommission a device terminal (ADMIN only)."""
    return DeviceService.decommission_device(
        db=db,
        device_id=device_id,
        current_user=current_user,
    )


@router.delete("/{device_id}", response_model=DeviceResponse)
def deactivate_device(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    """Deactivate (soft-delete) a device terminal (ADMIN only)."""
    return DeviceService.deactivate_device(
        db=db,
        device_id=device_id,
        current_user=current_user,
    )
