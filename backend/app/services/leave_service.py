import zoneinfo
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.holiday import Holiday
from app.models.leave_entitlement import LeaveBalanceLedger
from app.models.leave_request import LeaveRequest
from app.models.office import EmployeeOfficeAssignment, Office
from app.models.user import User
from app.schemas.leave import (
    LeaveRequestCreate,
    LeaveRequestDetail,
    LeaveRequestListResponse,
    LeaveRequestReview,
)
from app.services.leave_entitlement_service import LeaveEntitlementService


class LeaveService:
    """Service handling leave request submission, approval workflows, and queries."""

    @staticmethod
    def _get_manager_department(db: Session, current_user: User) -> str:
        """Validate manager account is linked and return assigned department, or raise HTTP 403."""
        if current_user.employee_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Manager user account is not linked to an employee staff profile. Contact an administrator to link your account.",
            )
        manager_emp = db.scalar(
            select(Employee).where(
                Employee.id == current_user.employee_id,
                Employee.deleted_at.is_(None),
            )
        )
        if not manager_emp or not manager_emp.department:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Manager has no assigned department team.",
            )
        return manager_emp.department

    @staticmethod
    def _to_detail(req: LeaveRequest, db: Session | None = None) -> LeaveRequestDetail:
        emp = req.employee
        reviewer = req.decision_by_user
        emp_name = f"{emp.first_name} {emp.last_name}" if emp else None
        reviewer_name = f"{reviewer.email}" if reviewer else None

        allocated_days: int | None = None
        available_days_before: int | None = None
        available_days_after: int | None = None

        if db is not None and req.leave_type != "UNPAID" and req.working_days is not None:
            leave_year = req.start_date.year
            allocated, _ = LeaveEntitlementService.get_effective_entitlement(
                db=db,
                employee_id=req.employee_id,
                year=leave_year,
                leave_type=req.leave_type,
            )
            if allocated is not None:
                allocated_days = allocated
                start_of_year = date(leave_year, 1, 1)
                end_of_year = date(leave_year, 12, 31)

                other_used = db.scalar(
                    select(func.coalesce(func.sum(LeaveRequest.working_days), 0)).where(
                        LeaveRequest.employee_id == req.employee_id,
                        LeaveRequest.leave_type == req.leave_type,
                        LeaveRequest.status == "APPROVED",
                        LeaveRequest.id != req.id,
                        LeaveRequest.start_date >= start_of_year,
                        LeaveRequest.start_date <= end_of_year,
                    )
                ) or 0

                other_pending = db.scalar(
                    select(func.coalesce(func.sum(LeaveRequest.working_days), 0)).where(
                        LeaveRequest.employee_id == req.employee_id,
                        LeaveRequest.leave_type == req.leave_type,
                        LeaveRequest.status == "PENDING",
                        LeaveRequest.id != req.id,
                        LeaveRequest.start_date >= start_of_year,
                        LeaveRequest.start_date <= end_of_year,
                    )
                ) or 0

                available_days_before = max(0, allocated - other_used - other_pending)
                available_days_after = max(0, available_days_before - req.working_days)

        return LeaveRequestDetail(
            id=req.id,
            employee_id=req.employee_id,
            employee_code=emp.employee_code if emp else None,
            employee_name=emp_name,
            department=emp.department if emp else None,
            start_date=req.start_date,
            end_date=req.end_date,
            leave_type=req.leave_type,
            reason=req.reason,
            status=req.status,
            working_days=req.working_days,
            decision_by_user_id=req.decision_by_user_id,
            decision_by_user_name=reviewer_name,
            decision_notes=req.decision_notes,
            decided_at=req.decided_at,
            allocated_days=allocated_days,
            available_days_before=available_days_before,
            available_days_after=available_days_after,
            created_at=req.created_at,
            updated_at=req.updated_at,
        )

    @staticmethod
    def calculate_working_days(
        db: Session,
        employee_id: int,
        start_date: date,
        end_date: date,
        optional_holiday_dates: list[date] | None = None,
    ) -> int:
        """Calculate the working-day duration for a requested leave span.

        Policy rules:
        - Monday–Friday are counted as working days.
        - Saturdays and Sundays are excluded.
        - Applicable organization-wide official holidays are excluded.
        - Official holidays belonging to employee's effective assigned office are excluded.
        - Holidays belonging to other offices are not excluded.
        - Leave date ranges are inclusive [start_date, end_date].
        - Optional/restricted holidays are excluded only when explicitly selected.
        - If no office assignment is effective on a date, apply org-wide holidays only.
        - Assignment effectiveness is resolved using the office's configured timezone
          at local noon (12:00:00 local time) for date-level assignment resolution.
        - Every submitted optional holiday date is validated against an actual applicable
          optional holiday; invalid, unrelated, or non-optional selections are rejected (HTTP 422).
        """
        if end_date < start_date:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="end_date must be on or after start_date.",
            )

        # 1. Fetch all office assignments for this employee with joined office details
        assignments = db.scalars(
            select(EmployeeOfficeAssignment)
            .options(joinedload(EmployeeOfficeAssignment.office))
            .where(EmployeeOfficeAssignment.employee_id == employee_id)
        ).all()

        # 2. Fetch all holidays falling within [start_date, end_date]
        holidays = db.scalars(
            select(Holiday).where(
                Holiday.holiday_date >= start_date,
                Holiday.holiday_date <= end_date,
            )
        ).all()

        holidays_by_date: dict[date, list[Holiday]] = {}
        for h in holidays:
            holidays_by_date.setdefault(h.holiday_date, []).append(h)

        selected_opt_dates = set(optional_holiday_dates or [])

        # Validate that all submitted optional holiday dates fall within the leave range
        for opt_date in selected_opt_dates:
            if opt_date < start_date or opt_date > end_date:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Selected optional holiday date {opt_date} is outside the requested leave range.",
                )

        working_days = 0
        curr = start_date

        while curr <= end_date:
            # Weekend exclusion
            if curr.weekday() >= 5:
                curr += timedelta(days=1)
                continue

            # Resolve effective office assignment for date curr using local noon in office timezone
            effective_office: Office | None = None
            for asgn in assignments:
                if asgn.office and asgn.valid_from and asgn.valid_to:
                    tz_name = asgn.office.timezone or "Asia/Kolkata"
                    try:
                        office_tz = zoneinfo.ZoneInfo(tz_name)
                    except Exception:
                        office_tz = zoneinfo.ZoneInfo("Asia/Kolkata")

                    local_noon = datetime.combine(curr, time(12, 0), tzinfo=office_tz)
                    if asgn.valid_from <= local_noon < asgn.valid_to:
                        effective_office = asgn.office
                        break

            # Evaluate holidays on date curr
            day_holidays = holidays_by_date.get(curr, [])
            is_holiday_excluded = False

            for h in day_holidays:
                is_applicable = (h.office_id is None) or (
                    effective_office is not None and h.office_id == effective_office.id
                )
                if not is_applicable:
                    continue

                if not h.is_optional:
                    # Official holiday: always excluded
                    is_holiday_excluded = True
                    break
                else:
                    # Optional holiday: excluded only if explicitly selected
                    if curr in selected_opt_dates:
                        is_holiday_excluded = True
                        break

            if not is_holiday_excluded:
                working_days += 1

            curr += timedelta(days=1)

        # Validate every submitted optional holiday date against actual applicable optional holidays
        for opt_date in selected_opt_dates:
            opt_effective_office: Office | None = None
            for asgn in assignments:
                if asgn.office and asgn.valid_from and asgn.valid_to:
                    tz_name = asgn.office.timezone or "Asia/Kolkata"
                    try:
                        office_tz = zoneinfo.ZoneInfo(tz_name)
                    except Exception:
                        office_tz = zoneinfo.ZoneInfo("Asia/Kolkata")
                    local_noon = datetime.combine(opt_date, time(12, 0), tzinfo=office_tz)
                    if asgn.valid_from <= local_noon < asgn.valid_to:
                        opt_effective_office = asgn.office
                        break

            opt_holidays = holidays_by_date.get(opt_date, [])
            has_valid_optional = any(
                h.is_optional
                and (
                    h.office_id is None
                    or (opt_effective_office is not None and h.office_id == opt_effective_office.id)
                )
                for h in opt_holidays
            )
            if not has_valid_optional:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Date {opt_date} is not a valid applicable optional holiday for this employee.",
                )

        return working_days

    @staticmethod
    def submit_leave_request(
        db: Session,
        current_user: User,
        payload: LeaveRequestCreate,
    ) -> LeaveRequestDetail:
        """Submit a new leave request with date validation and conflict checks."""
        # 1. Determine target employee
        if payload.start_date.year != payload.end_date.year:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Leave request cannot span across multiple calendar years (January 1 - December 31). Please submit separate requests for each calendar year.",
            )
        leave_year = payload.start_date.year

        if current_user.role == "EMPLOYEE":
            if current_user.employee_id is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User account is not linked to an employee profile.",
                )
            if payload.employee_id is not None and payload.employee_id != current_user.employee_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Employees may only submit leave requests for their own profile.",
                )
            target_employee_id = current_user.employee_id
        elif current_user.role == "MANAGER":
            mgr_dept = LeaveService._get_manager_department(db, current_user)
            target_employee_id = payload.employee_id or current_user.employee_id
            if target_employee_id is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="employee_id is required when submitting on behalf of an employee.",
                )
        elif current_user.role == "ADMIN":
            target_employee_id = payload.employee_id or current_user.employee_id
            if target_employee_id is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="employee_id is required when submitting on behalf of an employee.",
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized role for submitting leave requests.",
            )

        # 2. Acquire lock on employee row to prevent race conditions during concurrent submissions
        emp_lock = db.execute(
            select(Employee)
            .where(
                Employee.id == target_employee_id,
                Employee.is_active.is_(True),
                Employee.deleted_at.is_(None),
            )
            .with_for_update()
        ).scalar_one_or_none()

        if not emp_lock:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employee not found or inactive.",
            )

        if current_user.role == "MANAGER" and target_employee_id != current_user.employee_id:
            if emp_lock.department != mgr_dept:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access forbidden: You may only submit leave requests for employees within your authorized team.",
                )

        # 3. Check for overlapping active (PENDING or APPROVED) leave requests
        conflict = db.scalar(
            select(LeaveRequest.id)
            .where(
                LeaveRequest.employee_id == target_employee_id,
                LeaveRequest.status.in_(["PENDING", "APPROVED"]),
                LeaveRequest.start_date <= payload.end_date,
                LeaveRequest.end_date >= payload.start_date,
            )
            .limit(1)
        )
        if conflict:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A conflicting active or pending leave request already exists for this date range.",
            )

        # 4. Calculate working days
        working_days = LeaveService.calculate_working_days(
            db=db,
            employee_id=target_employee_id,
            start_date=payload.start_date,
            end_date=payload.end_date,
            optional_holiday_dates=payload.optional_holiday_dates,
        )

        if working_days <= 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="The requested leave period contains 0 working days.",
            )

        # 5. Check annual leave entitlement if configured and paid leave type
        allocated: int | None = None
        if payload.leave_type != "UNPAID":
            allocated, _ = LeaveEntitlementService.get_effective_entitlement(
                db=db,
                employee_id=target_employee_id,
                year=leave_year,
                leave_type=payload.leave_type,
            )
            if allocated is not None:
                start_of_year = date(leave_year, 1, 1)
                end_of_year = date(leave_year, 12, 31)
                used_days = db.scalar(
                    select(func.coalesce(func.sum(LeaveRequest.working_days), 0)).where(
                        LeaveRequest.employee_id == target_employee_id,
                        LeaveRequest.leave_type == payload.leave_type,
                        LeaveRequest.status == "APPROVED",
                        LeaveRequest.start_date >= start_of_year,
                        LeaveRequest.start_date <= end_of_year,
                    )
                ) or 0
                pending_days = db.scalar(
                    select(func.coalesce(func.sum(LeaveRequest.working_days), 0)).where(
                        LeaveRequest.employee_id == target_employee_id,
                        LeaveRequest.leave_type == payload.leave_type,
                        LeaveRequest.status == "PENDING",
                        LeaveRequest.start_date >= start_of_year,
                        LeaveRequest.start_date <= end_of_year,
                    )
                ) or 0
                available = max(0, allocated - used_days - pending_days)
                if working_days > available:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=(
                            f"Insufficient leave balance for {payload.leave_type} in {leave_year}. "
                            f"Allocated: {allocated}, used: {used_days}, pending: {pending_days}, "
                            f"available: {available}, requested: {working_days} day(s)."
                        ),
                    )

        # 6. Create leave request
        new_request = LeaveRequest(
            employee_id=target_employee_id,
            start_date=payload.start_date,
            end_date=payload.end_date,
            leave_type=payload.leave_type,
            reason=payload.reason,
            status="PENDING",
            working_days=working_days,
        )
        db.add(new_request)
        db.flush()

        # 7. Record reservation in balance ledger if entitlement is active
        if payload.leave_type != "UNPAID" and allocated is not None:
            ledger_entry = LeaveBalanceLedger(
                leave_request_id=new_request.id,
                employee_id=target_employee_id,
                year=leave_year,
                leave_type=payload.leave_type,
                transaction_type="RESERVATION",
                days=working_days,
                created_by_user_id=current_user.id,
            )
            db.add(ledger_entry)

            audit_ledger = AuditLog(
                actor_user_id=current_user.id,
                action="LEAVE_BALANCE_RESERVED",
                target_type="leave_request",
                target_id=str(new_request.id),
                metadata_={
                    "employee_id": target_employee_id,
                    "year": leave_year,
                    "leave_type": payload.leave_type,
                    "days": working_days,
                },
            )
            db.add(audit_ledger)

        # 8. Record audit log
        audit = AuditLog(
            actor_user_id=current_user.id,
            action="LEAVE_REQUEST_SUBMITTED",
            target_type="leave_request",
            target_id=str(new_request.id),
            metadata_={
                "employee_id": target_employee_id,
                "start_date": str(new_request.start_date),
                "end_date": str(new_request.end_date),
                "leave_type": new_request.leave_type,
                "working_days": working_days,
            },
        )
        db.add(audit)

        db.commit()
        db.refresh(new_request)
        return LeaveService._to_detail(new_request, db=db)

    @staticmethod
    def list_leave_requests(
        db: Session,
        current_user: User,
        employee_id: int | None = None,
        department: str | None = None,
        status_filter: str | None = None,
        leave_type_filter: str | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> LeaveRequestListResponse:
        """Query leave requests with role-based scoping and practical filters."""
        safe_limit = max(1, min(limit, 100))
        safe_offset = max(0, offset)

        # Role scoping
        target_employee_id: int | None = None
        manager_dept: str | None = None
        filter_dept: str | None = None

        if current_user.role == "EMPLOYEE":
            if current_user.employee_id is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User account is not linked to an employee profile.",
                )
            if employee_id is not None and employee_id != current_user.employee_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Employees may only query their own leave requests.",
                )
            target_employee_id = current_user.employee_id
        elif current_user.role == "MANAGER":
            manager_dept = LeaveService._get_manager_department(db, current_user)
            filter_dept = manager_dept
            if employee_id is not None:
                target_emp = db.scalar(
                    select(Employee).where(
                        Employee.id == employee_id,
                        Employee.deleted_at.is_(None),
                    )
                )
                if not target_emp:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Employee not found.",
                    )
                if target_emp.department != manager_dept:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Access forbidden: You may only query leave requests for employees within your authorized team.",
                    )
                target_employee_id = employee_id
        elif current_user.role == "ADMIN":
            target_employee_id = employee_id
            if department and department.strip() and department.strip().upper() != "ALL":
                filter_dept = department.strip()
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized role for leave queries.",
            )

        query = select(LeaveRequest).join(Employee, LeaveRequest.employee_id == Employee.id)
        count_query = select(func.count(LeaveRequest.id)).join(Employee, LeaveRequest.employee_id == Employee.id)

        if filter_dept is not None:
            query = query.where(Employee.department == filter_dept)
            count_query = count_query.where(Employee.department == filter_dept)

        if target_employee_id is not None:
            query = query.where(LeaveRequest.employee_id == target_employee_id)
            count_query = count_query.where(LeaveRequest.employee_id == target_employee_id)

        if status_filter and status_filter.strip() and status_filter.strip().upper() != "ALL":
            norm_status = status_filter.strip().upper()
            query = query.where(LeaveRequest.status == norm_status)
            count_query = count_query.where(LeaveRequest.status == norm_status)

        if leave_type_filter and leave_type_filter.strip() and leave_type_filter.strip().upper() != "ALL":
            norm_type = leave_type_filter.strip().upper()
            query = query.where(LeaveRequest.leave_type == norm_type)
            count_query = count_query.where(LeaveRequest.leave_type == norm_type)

        if start_date is not None:
            query = query.where(LeaveRequest.end_date >= start_date)
            count_query = count_query.where(LeaveRequest.end_date >= start_date)

        if end_date is not None:
            query = query.where(LeaveRequest.start_date <= end_date)
            count_query = count_query.where(LeaveRequest.start_date <= end_date)

        total = db.scalar(count_query) or 0

        paged_query = (
            query.order_by(LeaveRequest.created_at.desc(), LeaveRequest.id.desc())
            .offset(safe_offset)
            .limit(safe_limit)
        )
        rows = db.scalars(paged_query).all()

        return LeaveRequestListResponse(
            items=[LeaveService._to_detail(r) for r in rows],
            total=total,
            limit=safe_limit,
            offset=safe_offset,
            department=manager_dept or filter_dept,
        )

    @staticmethod
    def get_leave_request(
        db: Session,
        current_user: User,
        leave_id: int,
    ) -> LeaveRequestDetail:
        """Retrieve single leave request by ID with permission checks."""
        req = db.get(LeaveRequest, leave_id)
        if not req:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Leave request not found.",
            )

        if current_user.role == "EMPLOYEE":
            if req.employee_id != current_user.employee_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized to view this leave request.",
                )
        elif current_user.role == "MANAGER":
            mgr_dept = LeaveService._get_manager_department(db, current_user)
            if not req.employee or req.employee.department != mgr_dept:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access forbidden: You may only view leave requests for employees within your authorized team.",
                )
        elif current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized role for viewing leave requests.",
            )

        return LeaveService._to_detail(req, db=db)

    @staticmethod
    def review_leave_request(
        db: Session,
        current_user: User,
        leave_id: int,
        payload: LeaveRequestReview,
    ) -> LeaveRequestDetail:
        """Approve or reject a pending leave request (Admin/Manager only, no self-approval)."""
        if current_user.role == "EMPLOYEE":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only managers and administrators can review leave requests.",
            )

        mgr_dept: str | None = None
        if current_user.role == "MANAGER":
            mgr_dept = LeaveService._get_manager_department(db, current_user)
        elif current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized role for reviewing leave requests.",
            )

        req = db.execute(
            select(LeaveRequest)
            .where(LeaveRequest.id == leave_id)
            .with_for_update()
        ).scalar_one_or_none()

        if not req:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Leave request not found.",
            )

        if current_user.role == "MANAGER":
            if not req.employee or req.employee.department != mgr_dept:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access forbidden: You may only review leave requests for employees within your authorized team.",
                )

        # Self-approval check: User cannot approve their own request
        if current_user.employee_id is not None and current_user.employee_id == req.employee_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Users cannot review or approve their own leave requests.",
            )

        # State machine check
        if req.status != "PENDING":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot review leave request in '{req.status}' status. Only PENDING requests may be reviewed.",
            )

        # Acquire lock on Employee row to serialize concurrent leave submissions/approvals
        db.execute(
            select(Employee.id)
            .where(Employee.id == req.employee_id)
            .with_for_update()
        )

        decision_upper = payload.decision.upper()
        now_utc = datetime.now(timezone.utc)
        leave_year = req.start_date.year

        if decision_upper == "APPROVED":
            # Guard against overlapping approved requests
            overlap = db.scalar(
                select(LeaveRequest.id)
                .where(
                    LeaveRequest.employee_id == req.employee_id,
                    LeaveRequest.id != req.id,
                    LeaveRequest.status == "APPROVED",
                    LeaveRequest.start_date <= req.end_date,
                    LeaveRequest.end_date >= req.start_date,
                )
                .limit(1)
            )
            if overlap:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Cannot approve request: an overlapping approved leave request already exists.",
                )

            # Revalidate balance availability at approval
            if req.leave_type != "UNPAID" and req.working_days is not None:
                allocated, _ = LeaveEntitlementService.get_effective_entitlement(
                    db=db,
                    employee_id=req.employee_id,
                    year=leave_year,
                    leave_type=req.leave_type,
                )
                if allocated is not None:
                    start_of_year = date(leave_year, 1, 1)
                    end_of_year = date(leave_year, 12, 31)
                    other_used = db.scalar(
                        select(func.coalesce(func.sum(LeaveRequest.working_days), 0)).where(
                            LeaveRequest.employee_id == req.employee_id,
                            LeaveRequest.leave_type == req.leave_type,
                            LeaveRequest.status == "APPROVED",
                            LeaveRequest.id != req.id,
                            LeaveRequest.start_date >= start_of_year,
                            LeaveRequest.start_date <= end_of_year,
                        )
                    ) or 0

                    if other_used + req.working_days > allocated:
                        raise HTTPException(
                            status_code=status.HTTP_409_CONFLICT,
                            detail=(
                                f"Cannot approve leave request #{req.id}: Insufficient annual entitlement. "
                                f"Allocated: {allocated}, already approved/used: {other_used}, "
                                f"requested: {req.working_days} day(s)."
                            ),
                        )

                    consumption_entry = LeaveBalanceLedger(
                        leave_request_id=req.id,
                        employee_id=req.employee_id,
                        year=leave_year,
                        leave_type=req.leave_type,
                        transaction_type="CONSUMPTION",
                        days=req.working_days,
                        created_by_user_id=current_user.id,
                    )
                    db.add(consumption_entry)

                    audit_ledger = AuditLog(
                        actor_user_id=current_user.id,
                        action="LEAVE_BALANCE_CONSUMED",
                        target_type="leave_request",
                        target_id=str(req.id),
                        metadata_={
                            "employee_id": req.employee_id,
                            "year": leave_year,
                            "leave_type": req.leave_type,
                            "days": req.working_days,
                        },
                    )
                    db.add(audit_ledger)

            req.status = "APPROVED"
            audit_event = "LEAVE_REQUEST_APPROVED"
        else:
            # Release reservation on rejection if a reservation exists
            if req.leave_type != "UNPAID" and req.working_days is not None:
                has_reservation = db.scalar(
                    select(LeaveBalanceLedger.id).where(
                        LeaveBalanceLedger.leave_request_id == req.id,
                        LeaveBalanceLedger.transaction_type == "RESERVATION",
                    )
                )
                if has_reservation:
                    existing_release = db.scalar(
                        select(LeaveBalanceLedger.id).where(
                            LeaveBalanceLedger.leave_request_id == req.id,
                            LeaveBalanceLedger.transaction_type == "RESERVATION_RELEASE",
                        )
                    )
                    if not existing_release:
                        release_entry = LeaveBalanceLedger(
                            leave_request_id=req.id,
                            employee_id=req.employee_id,
                            year=leave_year,
                            leave_type=req.leave_type,
                            transaction_type="RESERVATION_RELEASE",
                            days=req.working_days,
                            created_by_user_id=current_user.id,
                        )
                        db.add(release_entry)

                        audit_ledger = AuditLog(
                            actor_user_id=current_user.id,
                            action="LEAVE_BALANCE_RELEASED",
                            target_type="leave_request",
                            target_id=str(req.id),
                            metadata_={
                                "employee_id": req.employee_id,
                                "year": leave_year,
                                "leave_type": req.leave_type,
                                "days": req.working_days,
                                "reason": "REJECTED",
                            },
                        )
                        db.add(audit_ledger)

            req.status = "REJECTED"
            audit_event = "LEAVE_REQUEST_REJECTED"

        req.decision_by_user_id = current_user.id
        req.decision_notes = payload.decision_notes
        req.decided_at = now_utc

        audit = AuditLog(
            actor_user_id=current_user.id,
            action=audit_event,
            target_type="leave_request",
            target_id=str(req.id),
            metadata_={
                "decision": req.status,
                "decision_notes": req.decision_notes,
                "decided_at": now_utc.isoformat(),
                "department": req.employee.department if req.employee else None,
            },
        )
        db.add(audit)

        db.commit()
        db.refresh(req)
        return LeaveService._to_detail(req, db=db)

    @staticmethod
    def cancel_leave_request(
        db: Session,
        current_user: User,
        leave_id: int,
    ) -> LeaveRequestDetail:
        """Cancel a leave request subject to role permissions."""
        req = db.execute(
            select(LeaveRequest)
            .where(LeaveRequest.id == leave_id)
            .with_for_update()
        ).scalar_one_or_none()

        if not req:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Leave request not found.",
            )

        if current_user.role == "EMPLOYEE":
            if req.employee_id != current_user.employee_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized to cancel another employee's leave request.",
                )
            if req.status != "PENDING":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Employees may only cancel PENDING requests. Current status is '{req.status}'.",
                )
        elif current_user.role == "MANAGER":
            mgr_dept = LeaveService._get_manager_department(db, current_user)
            if not req.employee or req.employee.department != mgr_dept:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access forbidden: You may only cancel leave requests for employees within your authorized team.",
                )
            if req.status in ("REJECTED", "CANCELLED"):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Cannot cancel a leave request in '{req.status}' status.",
                )
        elif current_user.role == "ADMIN":
            if req.status in ("REJECTED", "CANCELLED"):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Cannot cancel a leave request in '{req.status}' status.",
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized role for cancelling leave requests.",
            )

        # Acquire lock on Employee row to serialize concurrent balance operations
        db.execute(
            select(Employee.id)
            .where(Employee.id == req.employee_id)
            .with_for_update()
        )

        old_status = req.status
        leave_year = req.start_date.year

        if req.leave_type != "UNPAID" and req.working_days is not None:
            if old_status == "PENDING":
                has_reservation = db.scalar(
                    select(LeaveBalanceLedger.id).where(
                        LeaveBalanceLedger.leave_request_id == req.id,
                        LeaveBalanceLedger.transaction_type == "RESERVATION",
                    )
                )
                if has_reservation:
                    existing_release = db.scalar(
                        select(LeaveBalanceLedger.id).where(
                            LeaveBalanceLedger.leave_request_id == req.id,
                            LeaveBalanceLedger.transaction_type == "RESERVATION_RELEASE",
                        )
                    )
                    if not existing_release:
                        release_entry = LeaveBalanceLedger(
                            leave_request_id=req.id,
                            employee_id=req.employee_id,
                            year=leave_year,
                            leave_type=req.leave_type,
                            transaction_type="RESERVATION_RELEASE",
                            days=req.working_days,
                            created_by_user_id=current_user.id,
                        )
                        db.add(release_entry)

                        audit_ledger = AuditLog(
                            actor_user_id=current_user.id,
                            action="LEAVE_BALANCE_RELEASED",
                            target_type="leave_request",
                            target_id=str(req.id),
                            metadata_={
                                "employee_id": req.employee_id,
                                "year": leave_year,
                                "leave_type": req.leave_type,
                                "days": req.working_days,
                                "reason": "CANCELLED_FROM_PENDING",
                            },
                        )
                        db.add(audit_ledger)
            elif old_status == "APPROVED":
                has_consumption = db.scalar(
                    select(LeaveBalanceLedger.id).where(
                        LeaveBalanceLedger.leave_request_id == req.id,
                        LeaveBalanceLedger.transaction_type == "CONSUMPTION",
                    )
                )
                if has_consumption:
                    existing_release = db.scalar(
                        select(LeaveBalanceLedger.id).where(
                            LeaveBalanceLedger.leave_request_id == req.id,
                            LeaveBalanceLedger.transaction_type == "CONSUMPTION_RELEASE",
                        )
                    )
                    if not existing_release:
                        release_entry = LeaveBalanceLedger(
                            leave_request_id=req.id,
                            employee_id=req.employee_id,
                            year=leave_year,
                            leave_type=req.leave_type,
                            transaction_type="CONSUMPTION_RELEASE",
                            days=req.working_days,
                            created_by_user_id=current_user.id,
                        )
                        db.add(release_entry)

                        audit_ledger = AuditLog(
                            actor_user_id=current_user.id,
                            action="LEAVE_BALANCE_RELEASED",
                            target_type="leave_request",
                            target_id=str(req.id),
                            metadata_={
                                "employee_id": req.employee_id,
                                "year": leave_year,
                                "leave_type": req.leave_type,
                                "days": req.working_days,
                                "reason": "CANCELLED_FROM_APPROVED",
                            },
                        )
                        db.add(audit_ledger)

        req.status = "CANCELLED"

        audit = AuditLog(
            actor_user_id=current_user.id,
            action="LEAVE_REQUEST_CANCELLED",
            target_type="leave_request",
            target_id=str(req.id),
            metadata_={
                "previous_status": old_status,
                "department": req.employee.department if req.employee else None,
            },
        )
        db.add(audit)

        db.commit()
        db.refresh(req)
        return LeaveService._to_detail(req, db=db)
