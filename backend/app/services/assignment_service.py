from fastapi import HTTPException, status
from psycopg.types.range import Range
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.office import EmployeeOfficeAssignment, Office
from app.models.user import User
from app.schemas.assignment import AssignmentCreate


def _handle_assignment_integrity_error(exc: IntegrityError, db: Session) -> None:
    db.rollback()
    orig = getattr(exc, "orig", None)
    sqlstate = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
    diag = getattr(orig, "diag", None)
    constraint_name = getattr(diag, "constraint_name", None)
    msg = str(orig or exc)

    if (
        sqlstate == "23P01"
        or constraint_name == "ex_employee_office_assignment_no_overlap"
        or "ex_employee_office_assignment_no_overlap" in msg
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Employee already has an overlapping office assignment for this period.",
        )

    if (
        constraint_name == "ck_assignment_range_finite_and_valid"
        or "ck_assignment_range_finite_and_valid" in msg
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Assignment validity range must be finite, non-empty, and half-open [).",
        )

    if (
        constraint_name == "fk_employee_office_assignments_employee_id"
        or "fk_employee_office_assignments_employee_id" in msg
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee not found",
        )

    if (
        constraint_name == "fk_employee_office_assignments_office_id"
        or "fk_employee_office_assignments_office_id" in msg
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Office not found",
        )

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Database constraint violation on office assignment.",
    )


class AssignmentService:
    @staticmethod
    def create_assignment(
        db: Session,
        payload: AssignmentCreate,
        current_user: User,
    ) -> EmployeeOfficeAssignment:
        # 1. Preflight check: Employee existence and active status
        employee = db.get(Employee, payload.employee_id)
        if employee is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employee not found",
            )
        if not employee.is_active or employee.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot assign inactive or deleted employee to an office.",
            )

        # 2. Preflight check: Office existence and active status
        office = db.get(Office, payload.office_id)
        if office is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Office not found",
            )
        if not office.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot assign employee to an inactive office.",
            )

        # 3. Construct PostgreSQL half-open range [valid_from, valid_to)
        val_range = Range(
            payload.valid_from,
            payload.valid_to,
            bounds="[)",
        )

        assignment = EmployeeOfficeAssignment(
            employee_id=payload.employee_id,
            office_id=payload.office_id,
            validity_range=val_range,
            is_primary=payload.is_primary,
        )

        db.add(assignment)
        try:
            db.flush()

            audit = AuditLog(
                actor_user_id=current_user.id,
                action="ASSIGNMENT_CREATE",
                target_type="employee_office_assignment",
                target_id=str(assignment.id),
                metadata_={
                    "employee_id": assignment.employee_id,
                    "office_id": assignment.office_id,
                    "is_primary": assignment.is_primary,
                },
            )
            db.add(audit)

            db.commit()
            db.refresh(assignment)
            return assignment
        except IntegrityError as exc:
            _handle_assignment_integrity_error(exc, db)
            raise

    @staticmethod
    def list_assignments(
        db: Session,
        employee_id: int | None = None,
        office_id: int | None = None,
    ) -> list[EmployeeOfficeAssignment]:
        stmt = select(EmployeeOfficeAssignment).order_by(
            EmployeeOfficeAssignment.created_at.desc()
        )
        if employee_id is not None:
            stmt = stmt.where(EmployeeOfficeAssignment.employee_id == employee_id)
        if office_id is not None:
            stmt = stmt.where(EmployeeOfficeAssignment.office_id == office_id)

        return list(db.scalars(stmt).all())

    @staticmethod
    def get_assignment_by_id(
        db: Session,
        assignment_id: int,
    ) -> EmployeeOfficeAssignment:
        assignment = db.get(EmployeeOfficeAssignment, assignment_id)
        if assignment is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Office assignment not found",
            )
        return assignment

    @staticmethod
    def delete_assignment(
        db: Session,
        assignment_id: int,
        current_user: User,
    ) -> None:
        assignment = AssignmentService.get_assignment_by_id(db, assignment_id)

        db.delete(assignment)
        try:
            db.flush()

            audit = AuditLog(
                actor_user_id=current_user.id,
                action="ASSIGNMENT_DELETE",
                target_type="employee_office_assignment",
                target_id=str(assignment_id),
                metadata_={
                    "employee_id": assignment.employee_id,
                    "office_id": assignment.office_id,
                },
            )
            db.add(audit)

            db.commit()
        except IntegrityError as exc:
            _handle_assignment_integrity_error(exc, db)
            raise
