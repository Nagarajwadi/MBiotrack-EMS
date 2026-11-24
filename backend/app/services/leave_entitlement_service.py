from datetime import datetime, timezone
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.leave_entitlement import (
    EmployeeLeaveEntitlement,
    LeaveBalanceLedger,
    LeaveEntitlementDefault,
)
from app.models.leave_request import LeaveRequest
from app.models.user import User
from app.schemas.leave_entitlement import (
    ALL_LEAVE_TYPES,
    VALID_PAID_LEAVE_TYPES,
    EmployeeLeaveBalanceSummary,
    EmployeeLeaveEntitlementCreate,
    EmployeeLeaveEntitlementResponse,
    EmployeeLeaveEntitlementUpdate,
    LeaveBalanceLedgerResponse,
    LeaveEntitlementDefaultCreate,
    LeaveEntitlementDefaultResponse,
    LeaveEntitlementDefaultUpdate,
    LeaveTypeBalance,
)


class LeaveEntitlementService:
    """Service handling organization defaults, employee overrides, and leave balance ledger accounting."""

    @staticmethod
    def get_defaults(db: Session, year: int) -> list[LeaveEntitlementDefaultResponse]:
        """List all organization-wide leave entitlement defaults for a calendar year."""
        stmt = (
            select(LeaveEntitlementDefault)
            .where(LeaveEntitlementDefault.year == year)
            .order_by(LeaveEntitlementDefault.leave_type.asc())
        )
        defaults = db.scalars(stmt).all()
        return [LeaveEntitlementDefaultResponse.model_validate(d) for d in defaults]

    @staticmethod
    def set_default(
        db: Session,
        current_user: User,
        payload: LeaveEntitlementDefaultCreate,
    ) -> LeaveEntitlementDefaultResponse:
        """Create or update organization-wide default entitlement for (year, leave_type). Admin only."""
        if current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only administrators may configure organization leave entitlement defaults.",
            )

        norm_type = payload.leave_type.strip().upper()
        if norm_type not in VALID_PAID_LEAVE_TYPES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid leave_type '{payload.leave_type}'. Defaults can only be configured for: {', '.join(sorted(VALID_PAID_LEAVE_TYPES))}.",
            )

        existing = db.scalar(
            select(LeaveEntitlementDefault).where(
                LeaveEntitlementDefault.year == payload.year,
                LeaveEntitlementDefault.leave_type == norm_type,
            )
        )

        now_utc = datetime.now(timezone.utc)
        prev_days = None

        if existing:
            prev_days = existing.allocated_days
            existing.allocated_days = payload.allocated_days
            existing.updated_at = now_utc
            target_record = existing
            action = "LEAVE_ENTITLEMENT_DEFAULT_UPDATED"
        else:
            new_default = LeaveEntitlementDefault(
                year=payload.year,
                leave_type=norm_type,
                allocated_days=payload.allocated_days,
                created_by_user_id=current_user.id,
                created_at=now_utc,
                updated_at=now_utc,
            )
            db.add(new_default)
            db.flush()
            target_record = new_default
            action = "LEAVE_ENTITLEMENT_DEFAULT_CREATED"

        audit = AuditLog(
            actor_user_id=current_user.id,
            action=action,
            target_type="leave_entitlement_default",
            target_id=str(target_record.id),
            metadata_={
                "year": payload.year,
                "leave_type": norm_type,
                "allocated_days": payload.allocated_days,
                "previous_allocated_days": prev_days,
            },
        )
        db.add(audit)
        db.commit()
        db.refresh(target_record)
        return LeaveEntitlementDefaultResponse.model_validate(target_record)

    @staticmethod
    def delete_default(
        db: Session,
        current_user: User,
        default_id: int,
    ) -> None:
        """Delete an organization-wide default entitlement. Admin only."""
        if current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only administrators may delete organization leave entitlement defaults.",
            )

        record = db.get(LeaveEntitlementDefault, default_id)
        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Leave entitlement default not found.",
            )

        audit = AuditLog(
            actor_user_id=current_user.id,
            action="LEAVE_ENTITLEMENT_DEFAULT_DELETED",
            target_type="leave_entitlement_default",
            target_id=str(record.id),
            metadata_={
                "year": record.year,
                "leave_type": record.leave_type,
                "allocated_days": record.allocated_days,
            },
        )
        db.add(audit)
        db.delete(record)
        db.commit()

    @staticmethod
    def list_overrides(
        db: Session,
        current_user: User,
        year: int,
        employee_id: int | None = None,
    ) -> list[EmployeeLeaveEntitlementResponse]:
        """List employee-specific leave entitlement overrides."""
        if current_user.role == "EMPLOYEE":
            if current_user.employee_id is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Employee account is not linked to a staff profile.",
                )
            employee_id = current_user.employee_id

        stmt = select(EmployeeLeaveEntitlement).where(EmployeeLeaveEntitlement.year == year)

        if employee_id is not None:
            stmt = stmt.where(EmployeeLeaveEntitlement.employee_id == employee_id)

        stmt = stmt.order_by(
            EmployeeLeaveEntitlement.employee_id.asc(),
            EmployeeLeaveEntitlement.leave_type.asc(),
        )
        overrides = db.scalars(stmt).all()

        results = []
        for o in overrides:
            emp = o.employee
            emp_name = f"{emp.first_name} {emp.last_name}" if emp else None
            results.append(
                EmployeeLeaveEntitlementResponse(
                    id=o.id,
                    employee_id=o.employee_id,
                    employee_code=emp.employee_code if emp else None,
                    employee_name=emp_name,
                    department=emp.department if emp else None,
                    year=o.year,
                    leave_type=o.leave_type,
                    allocated_days=o.allocated_days,
                    created_by_user_id=o.created_by_user_id,
                    created_at=o.created_at,
                    updated_at=o.updated_at,
                )
            )
        return results

    @staticmethod
    def set_override(
        db: Session,
        current_user: User,
        payload: EmployeeLeaveEntitlementCreate,
    ) -> EmployeeLeaveEntitlementResponse:
        """Create or update an employee-specific entitlement override. Admin only."""
        if current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only administrators may configure employee leave entitlement overrides.",
            )

        emp = db.scalar(
            select(Employee).where(
                Employee.id == payload.employee_id,
                Employee.deleted_at.is_(None),
            )
        )
        if not emp:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employee profile not found or inactive.",
            )

        norm_type = payload.leave_type.strip().upper()
        if norm_type not in VALID_PAID_LEAVE_TYPES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid leave_type '{payload.leave_type}'. Overrides can only be configured for: {', '.join(sorted(VALID_PAID_LEAVE_TYPES))}.",
            )

        existing = db.scalar(
            select(EmployeeLeaveEntitlement).where(
                EmployeeLeaveEntitlement.employee_id == payload.employee_id,
                EmployeeLeaveEntitlement.year == payload.year,
                EmployeeLeaveEntitlement.leave_type == norm_type,
            )
        )

        now_utc = datetime.now(timezone.utc)
        prev_days = None

        if existing:
            prev_days = existing.allocated_days
            existing.allocated_days = payload.allocated_days
            existing.updated_at = now_utc
            target_record = existing
            action = "EMPLOYEE_LEAVE_ENTITLEMENT_OVERRIDE_UPDATED"
        else:
            new_override = EmployeeLeaveEntitlement(
                employee_id=payload.employee_id,
                year=payload.year,
                leave_type=norm_type,
                allocated_days=payload.allocated_days,
                created_by_user_id=current_user.id,
                created_at=now_utc,
                updated_at=now_utc,
            )
            db.add(new_override)
            db.flush()
            target_record = new_override
            action = "EMPLOYEE_LEAVE_ENTITLEMENT_OVERRIDE_CREATED"

        audit = AuditLog(
            actor_user_id=current_user.id,
            action=action,
            target_type="employee_leave_entitlement",
            target_id=str(target_record.id),
            metadata_={
                "employee_id": payload.employee_id,
                "year": payload.year,
                "leave_type": norm_type,
                "allocated_days": payload.allocated_days,
                "previous_allocated_days": prev_days,
            },
        )
        db.add(audit)
        db.commit()
        db.refresh(target_record)

        emp_name = f"{emp.first_name} {emp.last_name}"
        return EmployeeLeaveEntitlementResponse(
            id=target_record.id,
            employee_id=target_record.employee_id,
            employee_code=emp.employee_code,
            employee_name=emp_name,
            department=emp.department,
            year=target_record.year,
            leave_type=target_record.leave_type,
            allocated_days=target_record.allocated_days,
            created_by_user_id=target_record.created_by_user_id,
            created_at=target_record.created_at,
            updated_at=target_record.updated_at,
        )

    @staticmethod
    def delete_override(
        db: Session,
        current_user: User,
        override_id: int,
    ) -> None:
        """Delete an employee-specific entitlement override. Admin only."""
        if current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only administrators may delete employee leave entitlement overrides.",
            )

        record = db.get(EmployeeLeaveEntitlement, override_id)
        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employee leave entitlement override not found.",
            )

        audit = AuditLog(
            actor_user_id=current_user.id,
            action="EMPLOYEE_LEAVE_ENTITLEMENT_OVERRIDE_DELETED",
            target_type="employee_leave_entitlement",
            target_id=str(record.id),
            metadata_={
                "employee_id": record.employee_id,
                "year": record.year,
                "leave_type": record.leave_type,
                "allocated_days": record.allocated_days,
            },
        )
        db.add(audit)
        db.delete(record)
        db.commit()

    @staticmethod
    def get_effective_entitlement(
        db: Session,
        employee_id: int,
        year: int,
        leave_type: str,
    ) -> tuple[int | None, bool]:
        """Resolve effective annual entitlement for an employee.

        Returns (allocated_days, is_override).
        - If employee override exists, returns (override.allocated_days, True).
        - Else if organization default exists, returns (default.allocated_days, False).
        - Else returns (None, False), indicating unconfigured / enforcement not active.
        """
        norm_type = leave_type.strip().upper()
        if norm_type not in VALID_PAID_LEAVE_TYPES:
            return (None, False)

        # 1. Check employee override
        override = db.scalar(
            select(EmployeeLeaveEntitlement).where(
                EmployeeLeaveEntitlement.employee_id == employee_id,
                EmployeeLeaveEntitlement.year == year,
                EmployeeLeaveEntitlement.leave_type == norm_type,
            )
        )
        if override is not None:
            return (override.allocated_days, True)

        # 2. Check organization default
        default = db.scalar(
            select(LeaveEntitlementDefault).where(
                LeaveEntitlementDefault.year == year,
                LeaveEntitlementDefault.leave_type == norm_type,
            )
        )
        if default is not None:
            return (default.allocated_days, False)

        return (None, False)

    @staticmethod
    def get_employee_balance_summary(
        db: Session,
        current_user: User,
        employee_id: int,
        year: int,
    ) -> EmployeeLeaveBalanceSummary:
        """Get leave balance summary for an employee across all leave types for a calendar year."""
        # Permission check
        if current_user.role == "EMPLOYEE":
            if current_user.employee_id != employee_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Employees may only view their own leave balances.",
                )
        elif current_user.role == "MANAGER":
            if current_user.employee_id is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Manager account is not linked to an employee profile.",
                )
            mgr_emp = db.get(Employee, current_user.employee_id)
            target_emp = db.get(Employee, employee_id)
            if not target_emp or not mgr_emp or target_emp.department != mgr_emp.department:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Managers may only view balances for employees in their department.",
                )
        elif current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized role for viewing leave balances.",
            )

        emp = db.get(Employee, employee_id)
        if not emp:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employee profile not found.",
            )

        # Query all leave requests for this employee in this year
        # Leave year is Jan 1 - Dec 31
        start_of_year = func.make_date(year, 1, 1)
        end_of_year = func.make_date(year, 12, 31)

        # Sum of approved working days by leave_type
        approved_stmt = (
            select(
                LeaveRequest.leave_type,
                func.coalesce(func.sum(LeaveRequest.working_days), 0),
            )
            .where(
                LeaveRequest.employee_id == employee_id,
                LeaveRequest.status == "APPROVED",
                LeaveRequest.start_date >= start_of_year,
                LeaveRequest.start_date <= end_of_year,
            )
            .group_by(LeaveRequest.leave_type)
        )
        approved_counts = dict(db.execute(approved_stmt).all())

        # Sum of pending working days by leave_type
        pending_stmt = (
            select(
                LeaveRequest.leave_type,
                func.coalesce(func.sum(LeaveRequest.working_days), 0),
            )
            .where(
                LeaveRequest.employee_id == employee_id,
                LeaveRequest.status == "PENDING",
                LeaveRequest.start_date >= start_of_year,
                LeaveRequest.start_date <= end_of_year,
            )
            .group_by(LeaveRequest.leave_type)
        )
        pending_counts = dict(db.execute(pending_stmt).all())

        balances: list[LeaveTypeBalance] = []

        # Order: ANNUAL, SICK, CASUAL, UNPAID
        for l_type in ["ANNUAL", "SICK", "CASUAL", "UNPAID"]:
            used = int(approved_counts.get(l_type, 0))
            pending = int(pending_counts.get(l_type, 0))

            if l_type == "UNPAID":
                balances.append(
                    LeaveTypeBalance(
                        leave_type=l_type,
                        is_enforced=False,
                        allocated_days=None,
                        used_days=used,
                        pending_days=pending,
                        available_days=None,
                        is_override=False,
                    )
                )
            else:
                allocated, is_override = LeaveEntitlementService.get_effective_entitlement(
                    db=db,
                    employee_id=employee_id,
                    year=year,
                    leave_type=l_type,
                )
                if allocated is not None:
                    # Enforced
                    available = max(0, allocated - used - pending)
                    balances.append(
                        LeaveTypeBalance(
                            leave_type=l_type,
                            is_enforced=True,
                            allocated_days=allocated,
                            used_days=used,
                            pending_days=pending,
                            available_days=available,
                            is_override=is_override,
                        )
                    )
                else:
                    # Unconfigured
                    balances.append(
                        LeaveTypeBalance(
                            leave_type=l_type,
                            is_enforced=False,
                            allocated_days=None,
                            used_days=used,
                            pending_days=pending,
                            available_days=None,
                            is_override=False,
                        )
                    )

        emp_name = f"{emp.first_name} {emp.last_name}"
        return EmployeeLeaveBalanceSummary(
            employee_id=emp.id,
            employee_code=emp.employee_code,
            employee_name=emp_name,
            department=emp.department,
            year=year,
            balances=balances,
        )

    @staticmethod
    def get_ledger(
        db: Session,
        current_user: User,
        employee_id: int,
        year: int,
    ) -> list[LeaveBalanceLedgerResponse]:
        """View ledger transaction history for an employee in a calendar year."""
        if current_user.role == "EMPLOYEE":
            if current_user.employee_id != employee_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Employees may only view their own balance ledger.",
                )
        elif current_user.role == "MANAGER":
            if current_user.employee_id is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Manager account is not linked to an employee profile.",
                )
            mgr_emp = db.get(Employee, current_user.employee_id)
            target_emp = db.get(Employee, employee_id)
            if not target_emp or not mgr_emp or target_emp.department != mgr_emp.department:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Managers may only view ledger for employees in their department.",
                )
        elif current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized role for viewing balance ledger.",
            )

        stmt = (
            select(LeaveBalanceLedger)
            .where(
                LeaveBalanceLedger.employee_id == employee_id,
                LeaveBalanceLedger.year == year,
            )
            .order_by(LeaveBalanceLedger.created_at.desc(), LeaveBalanceLedger.id.desc())
        )
        rows = db.scalars(stmt).all()
        return [LeaveBalanceLedgerResponse.model_validate(r) for r in rows]
