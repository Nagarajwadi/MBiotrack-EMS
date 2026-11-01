from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user, require_role
from app.models.user import User
from app.schemas.employee import (
    EmployeeCreate,
    EmployeeResponse,
    EmployeeUpdate,
)
from app.services.employee_service import EmployeeService

router = APIRouter(prefix="/api/v1/employees", tags=["Employees"])


@router.post("", response_model=EmployeeResponse, status_code=status.HTTP_201_CREATED)
def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN", "MANAGER")),
):
    return EmployeeService.create_employee(
        db=db,
        payload=payload,
        current_user=current_user,
    )


@router.get("", response_model=list[EmployeeResponse])
def list_employees(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN", "MANAGER")),
):
    return EmployeeService.list_employees(db=db)


@router.get("/{employee_id}", response_model=EmployeeResponse)
def get_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return EmployeeService.get_employee_by_id(
        db=db,
        employee_id=employee_id,
        current_user=current_user,
    )


@router.patch("/{employee_id}", response_model=EmployeeResponse)
def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return EmployeeService.update_employee(
        db=db,
        employee_id=employee_id,
        payload=payload,
        current_user=current_user,
    )


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    EmployeeService.delete_employee(
        db=db,
        employee_id=employee_id,
        current_user=current_user,
    )
