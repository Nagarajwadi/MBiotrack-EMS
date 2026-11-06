from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.leave_request import LeaveRequest
from app.models.user import User
from app.schemas.leave import (
    LeaveRequestCreate,
    LeaveRequestDetail,
    LeaveRequestListResponse,
    LeaveRequestReview,
)


class LeaveService:
    """Service handling leave request submission, approval workflows, and queries."""

    @staticmethod
    def _to_detail(req: LeaveRequest) -> LeaveRequestDetail:
        emp = req.employee
        reviewer = req.decision_by_user
        emp_name = f"{emp.first_name} {emp.last_name}" if emp else None
        reviewer_name = f"{reviewer.email}" if reviewer else None

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
            decision_by_user_id=req.decision_by_user_id,
            decision_by_user_name=reviewer_name,
            decision_notes=req.decision_notes,
            decided_at=req.decided_at,
            created_at=req.created_at,
            updated_at=req.updated_at,
        )

    @staticmethod
    def submit_leave_request(
        db: Session,
        current_user: User,
        payload: LeaveRequestCreate,
    ) -> LeaveRequestDetail:
        """Submit a new leave request with date validation and conflict checks."""
        # 1. Determine target employee
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
        elif current_user.role in ("ADMIN", "MANAGER"):
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

        # 4. Create leave request
        new_request = LeaveRequest(
            employee_id=target_employee_id,
            start_date=payload.start_date,
            end_date=payload.end_date,
            leave_type=payload.leave_type,
            reason=payload.reason,
            status="PENDING",
        )
        db.add(new_request)
        db.flush()

        # 5. Record audit log
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
            },
        )
        db.add(audit)

        db.commit()
        db.refresh(new_request)
        return LeaveService._to_detail(new_request)

    @staticmethod
    def list_leave_requests(
        db: Session,
        current_user: User,
        employee_id: int | None = None,
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
        elif current_user.role in ("ADMIN", "MANAGER"):
            target_employee_id = employee_id
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized role for leave queries.",
            )

        query = select(LeaveRequest)
        count_query = select(func.count(LeaveRequest.id))

        if target_employee_id is not None:
            query = query.where(LeaveRequest.employee_id == target_employee_id)
            count_query = count_query.where(LeaveRequest.employee_id == target_employee_id)

        if status_filter and status_filter.strip():
            norm_status = status_filter.strip().upper()
            query = query.where(LeaveRequest.status == norm_status)
            count_query = count_query.where(LeaveRequest.status == norm_status)

        if leave_type_filter and leave_type_filter.strip():
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

        if current_user.role == "EMPLOYEE" and req.employee_id != current_user.employee_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized to view this leave request.",
            )

        return LeaveService._to_detail(req)

    @staticmethod
    def review_leave_request(
        db: Session,
        current_user: User,
        leave_id: int,
        payload: LeaveRequestReview,
    ) -> LeaveRequestDetail:
        """Approve or reject a pending leave request (Admin/Manager only, no self-approval)."""
        if current_user.role not in ("ADMIN", "MANAGER"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only managers and administrators can review leave requests.",
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

        decision_upper = payload.decision.upper()
        now_utc = datetime.now(timezone.utc)

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
            req.status = "APPROVED"
            audit_event = "LEAVE_REQUEST_APPROVED"
        else:
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
            },
        )
        db.add(audit)

        db.commit()
        db.refresh(req)
        return LeaveService._to_detail(req)

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
        elif current_user.role in ("ADMIN", "MANAGER"):
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

        old_status = req.status
        req.status = "CANCELLED"

        audit = AuditLog(
            actor_user_id=current_user.id,
            action="LEAVE_REQUEST_CANCELLED",
            target_type="leave_request",
            target_id=str(req.id),
            metadata_={"previous_status": old_status},
        )
        db.add(audit)

        db.commit()
        db.refresh(req)
        return LeaveService._to_detail(req)
