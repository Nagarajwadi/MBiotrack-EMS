from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.user import User
from app.schemas.employee import EmployeeCreate, EmployeeUpdate


def _handle_integrity_error(exc: IntegrityError, db: Session) -> None:
    """Roll back session and strictly map PostgreSQL diagnostic constraint names.

    Prevents broad substring matching on unrelated errors and never exposes internal
    database details to API clients.
    """
    db.rollback()
    orig = getattr(exc, "orig", None)
    diag = getattr(orig, "diag", None)
    constraint_name = getattr(diag, "constraint_name", None)

    if constraint_name == "uq_employees_lower_employee_code":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Employee code already exists",
        )
    if constraint_name == "uq_employees_lower_email":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already exists",
        )

    # Fallback to exact constraint name matching in original error message if diag is absent
    msg = str(orig or exc)
    if "uq_employees_lower_employee_code" in msg:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Employee code already exists",
        )
    if "uq_employees_lower_email" in msg:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already exists",
        )

    # Generic constraint error without leaking internal details
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Database constraint violation",
    )


class EmployeeService:
    @staticmethod
    def create_employee(
        db: Session,
        payload: EmployeeCreate,
        current_user: User,
    ) -> Employee:
        norm_code = payload.employee_code.strip()
        norm_email = payload.email.strip().lower()

        # Application-level duplicate pre-checks
        existing_code = db.scalar(
            select(Employee.id).where(
                func.lower(Employee.employee_code) == norm_code.lower()
            )
        )
        if existing_code is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Employee code already exists",
            )

        existing_email = db.scalar(
            select(Employee.id).where(
                func.lower(Employee.email) == norm_email.lower()
            )
        )
        if existing_email is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already exists",
            )

        employee = Employee(
            employee_code=norm_code,
            first_name=payload.first_name.strip(),
            last_name=payload.last_name.strip(),
            email=norm_email,
            department=payload.department.strip(),
            designation=payload.designation.strip(),
            joining_date=payload.joining_date,
            is_active=payload.is_active,
        )

        db.add(employee)
        try:
            db.flush()

            # Create audit log record in same transaction
            audit = AuditLog(
                actor_user_id=current_user.id,
                action="EMPLOYEE_CREATE",
                target_type="employee",
                target_id=str(employee.id),
                ip_address=None,
                metadata_={
                    "employee_code": employee.employee_code,
                    "role": current_user.role,
                },
            )
            db.add(audit)

            db.commit()
            db.refresh(employee)
            return employee
        except IntegrityError as exc:
            _handle_integrity_error(exc, db)
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def list_employees(db: Session) -> list[Employee]:
        # Exclude soft-deleted employees
        return list(
            db.scalars(
                select(Employee)
                .where(Employee.deleted_at.is_(None))
                .order_by(Employee.id)
            ).all()
        )

    @staticmethod
    def get_employee_by_id(
        db: Session,
        employee_id: int,
        current_user: User,
    ) -> Employee:
        if current_user.role == "EMPLOYEE":
            if current_user.employee_id is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User account is not linked to an employee record.",
                )
            if current_user.employee_id != employee_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access forbidden: You may only view your own employee record.",
                )

        # Exclude soft-deleted employees
        employee = db.scalar(
            select(Employee).where(
                Employee.id == employee_id,
                Employee.deleted_at.is_(None),
            )
        )
        if employee is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employee not found",
            )
        return employee

    @staticmethod
    def update_employee(
        db: Session,
        employee_id: int,
        payload: EmployeeUpdate,
        current_user: User,
    ) -> Employee:
        updates = payload.model_dump(exclude_unset=True)

        if current_user.role == "EMPLOYEE":
            if current_user.employee_id is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User account is not linked to an employee record.",
                )
            if current_user.employee_id != employee_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access forbidden: You may only update your own employee record.",
                )
            # Self-service: only first_name and last_name permitted; email and org fields rejected
            disallowed_keys = set(updates.keys()) - {"first_name", "last_name"}
            if disallowed_keys:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Employees are only permitted to update first_name and last_name.",
                )

        if current_user.role == "MANAGER":
            # Managers cannot deactivate employees
            if "is_active" in updates and updates["is_active"] is False:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Managers are not authorized to deactivate employees. Employee deactivation requires an Administrator.",
                )

        # Query active, non-deleted employee
        employee = db.scalar(
            select(Employee).where(
                Employee.id == employee_id,
                Employee.deleted_at.is_(None),
            )
        )
        if employee is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employee not found",
            )

        if not updates:
            return employee

        # Normalize string fields
        for field in ("first_name", "last_name", "department", "designation"):
            if field in updates and updates[field] is not None:
                updates[field] = updates[field].strip()

        if "email" in updates and updates["email"] is not None:
            norm_email = updates["email"].strip().lower()
            updates["email"] = norm_email

            # Pre-check for duplicate email across other employees
            duplicate_id = db.scalar(
                select(Employee.id).where(
                    func.lower(Employee.email) == norm_email.lower(),
                    Employee.id != employee_id,
                )
            )
            if duplicate_id is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Email already exists",
                )

        for key, value in updates.items():
            setattr(employee, key, value)

        # Trigger updated_at change
        employee.updated_at = func.now()

        try:
            # Create audit log record in same transaction
            audit = AuditLog(
                actor_user_id=current_user.id,
                action="EMPLOYEE_UPDATE",
                target_type="employee",
                target_id=str(employee.id),
                ip_address=None,
                metadata_={
                    "updated_fields": sorted(list(updates.keys())),
                    "role": current_user.role,
                },
            )
            db.add(audit)

            db.commit()
            db.refresh(employee)
            return employee
        except IntegrityError as exc:
            _handle_integrity_error(exc, db)
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def delete_employee(
        db: Session,
        employee_id: int,
        current_user: User,
    ) -> None:
        if current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only administrators can deactivate employees.",
            )

        # Query active, non-deleted employee
        employee = db.scalar(
            select(Employee).where(
                Employee.id == employee_id,
                Employee.deleted_at.is_(None),
            )
        )
        if employee is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employee not found",
            )

        # Soft-deletion: set deleted_at and is_active=False. Physical deletion is strictly prohibited.
        employee.is_active = False
        employee.deleted_at = func.now()
        employee.updated_at = func.now()

        try:
            audit = AuditLog(
                actor_user_id=current_user.id,
                action="EMPLOYEE_DEACTIVATE",
                target_type="employee",
                target_id=str(employee.id),
                ip_address=None,
                metadata_={
                    "employee_code": employee.employee_code,
                    "role": current_user.role,
                },
            )
            db.add(audit)

            db.commit()
        except IntegrityError as exc:
            _handle_integrity_error(exc, db)
        except Exception:
            db.rollback()
            raise
