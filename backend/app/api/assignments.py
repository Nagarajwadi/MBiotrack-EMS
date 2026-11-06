from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user, require_role
from app.models.user import User
from app.schemas.assignment import AssignmentCreate, AssignmentResponse
from app.services.assignment_service import AssignmentService

router = APIRouter(prefix="/api/v1/offices/assignments", tags=["Office Assignments"])


@router.post("", response_model=AssignmentResponse, status_code=status.HTTP_201_CREATED)
def create_assignment(
    payload: AssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN", "MANAGER")),
):
    """Create a new employee office assignment with GiST overlap protection (ADMIN, MANAGER)."""
    return AssignmentService.create_assignment(
        db=db,
        payload=payload,
        current_user=current_user,
    )


@router.get("", response_model=list[AssignmentResponse])
def list_assignments(
    employee_id: int | None = Query(default=None, description="Filter by employee ID"),
    office_id: int | None = Query(default=None, description="Filter by office ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List employee office assignments with RBAC scoping."""
    if current_user.role == "EMPLOYEE":
        if employee_id is not None and employee_id != current_user.employee_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Employees may only query their own office assignments.",
            )
        employee_id = current_user.employee_id

    return AssignmentService.list_assignments(
        db=db,
        employee_id=employee_id,
        office_id=office_id,
    )


@router.get("/{assignment_id}", response_model=AssignmentResponse)
def get_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve details for a specific employee office assignment."""
    assignment = AssignmentService.get_assignment_by_id(db=db, assignment_id=assignment_id)
    if current_user.role == "EMPLOYEE" and assignment.employee_id != current_user.employee_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Employees may only view their own office assignments.",
        )
    return assignment


@router.delete("/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    """Delete an employee office assignment (ADMIN only)."""
    AssignmentService.delete_assignment(
        db=db,
        assignment_id=assignment_id,
        current_user=current_user,
    )
