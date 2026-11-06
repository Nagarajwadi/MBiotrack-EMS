from datetime import date

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.schemas.leave import (
    LeaveRequestCreate,
    LeaveRequestDetail,
    LeaveRequestListResponse,
    LeaveRequestReview,
)
from app.services.leave_service import LeaveService

router = APIRouter(prefix="/api/v1/leaves", tags=["Leave Management"])


@router.post("", response_model=LeaveRequestDetail, status_code=status.HTTP_201_CREATED)
def submit_leave_request(
    payload: LeaveRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit a leave request.

    - Employees can submit only for their own linked employee profile.
    - Admins and Managers can submit for specified active employees.
    - Conflicting active/pending leave spans are rejected.
    """
    return LeaveService.submit_leave_request(
        db=db,
        current_user=current_user,
        payload=payload,
    )


@router.get("", response_model=LeaveRequestListResponse)
def list_leave_requests(
    employee_id: int | None = Query(default=None, description="Filter by employee ID (restricted for EMPLOYEE role)"),
    status: str | None = Query(default=None, description="Filter by status (PENDING, APPROVED, REJECTED, CANCELLED)"),
    leave_type: str | None = Query(default=None, description="Filter by leave type (ANNUAL, SICK, CASUAL, UNPAID)"),
    start_date: date | None = Query(default=None, description="Filter requests overlapping on or after this date"),
    end_date: date | None = Query(default=None, description="Filter requests overlapping on or before this date"),
    limit: int = Query(default=50, ge=1, le=100, description="Max records to return"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List leave requests with role scoping and filters.

    - EMPLOYEE: Can view only their own requests.
    - MANAGER / ADMIN: Organization-wide query access across all active employees.
    """
    return LeaveService.list_leave_requests(
        db=db,
        current_user=current_user,
        employee_id=employee_id,
        status_filter=status,
        leave_type_filter=leave_type,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        offset=offset,
    )


@router.get("/{leave_id}", response_model=LeaveRequestDetail)
def get_leave_request(
    leave_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve details for a single leave request."""
    return LeaveService.get_leave_request(
        db=db,
        current_user=current_user,
        leave_id=leave_id,
    )


@router.post("/{leave_id}/review", response_model=LeaveRequestDetail)
def review_leave_request(
    leave_id: int,
    payload: LeaveRequestReview,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Approve or reject a pending leave request.

    - Restrict to ADMIN or MANAGER.
    - Self-approval is forbidden (users cannot approve their own requests).
    - Already decided requests cannot be re-decided.
    """
    return LeaveService.review_leave_request(
        db=db,
        current_user=current_user,
        leave_id=leave_id,
        payload=payload,
    )


@router.post("/{leave_id}/cancel", response_model=LeaveRequestDetail)
def cancel_leave_request(
    leave_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cancel a leave request.

    - Employees can cancel their own PENDING requests.
    - Admins/Managers can cancel PENDING or APPROVED requests.
    """
    return LeaveService.cancel_leave_request(
        db=db,
        current_user=current_user,
        leave_id=leave_id,
    )
