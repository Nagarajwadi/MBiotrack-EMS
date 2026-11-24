import csv
from datetime import date, datetime, time, timedelta, timezone
import io
from typing import Any
import zoneinfo
from fastapi import HTTPException, status
from psycopg.types.range import Range
from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.attendance_correction import AttendanceCorrection
from app.models.attendance_event import AttendanceEvent
from app.models.attendance_review import AttendanceReview
from app.models.audit_log import AuditLog
from app.models.device import Device
from app.models.employee import Employee
from app.models.holiday import Holiday
from app.models.leave_request import LeaveRequest
from app.models.office import EmployeeOfficeAssignment, Office
from app.models.user import User
from app.schemas.attendance import (
    AttendanceCorrectionCreate,
    AttendanceCorrectionListResponse,
    AttendanceCorrectionResponse,
    AttendanceCorrectionReview,
    AttendanceEventDetail,
    AttendanceExceptionItem,
    AttendanceExceptionListResponse,
    AttendanceListResponse,
    AttendancePunchCreate,
    AttendancePunchResponse,
    AttendanceReportItem,
    AttendanceReportResponse,
    AttendanceReportSummary,
    AttendanceReviewCreate,
    AttendanceReviewHistoryResponse,
    AttendanceReviewResponse,
    DailyAttendanceOperationsResponse,
    DailyAttendanceSummary,
    DailyPunchDetail,
    EmployeeDailyAttendanceItem,
)


class AttendanceService:
    """Service handling normalized attendance punch ingestion, validation, and audit recording."""

    @staticmethod
    def record_punch(
        db: Session,
        payload: AttendancePunchCreate,
        current_user: User,
        client_ip: str | None = None,
    ) -> AttendancePunchResponse:
        # 1. Caller role authorization and employee target resolution
        if current_user.role == "EMPLOYEE":
            if current_user.employee_id is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User account is not linked to an employee profile",
                )
            if payload.employee_id is not None and payload.employee_id != current_user.employee_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Employees are only authorized to record punches for themselves",
                )
            target_employee_id = current_user.employee_id
        elif current_user.role in ("ADMIN", "MANAGER"):
            if payload.employee_id is not None:
                target_employee_id = payload.employee_id
            elif current_user.employee_id is not None:
                target_employee_id = current_user.employee_id
            else:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="employee_id is required for administrative punch entry",
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized role for attendance ingestion",
            )

        # 2. Server-side validation of Employee
        employee = db.get(Employee, target_employee_id)
        if employee is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employee not found",
            )
        if not employee.is_active or employee.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Employee is inactive or deleted",
            )

        # 3. Server-side validation of Terminal Device
        device = db.get(Device, payload.device_id)
        if device is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Device not found",
            )
        if not device.is_active or device.status != "ACTIVE":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Device is not active (current status: {device.status})",
            )

        # 4. Server-side validation of Office
        office = db.get(Office, device.office_id)
        if office is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Office associated with device not found",
            )
        if not office.is_active:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Office associated with device is inactive",
            )

        # 5. Server-controlled timestamp determination
        now = datetime.now(timezone.utc)
        if payload.punch_time is not None:
            event_timestamp = payload.punch_time
            if event_timestamp.tzinfo is None:
                event_timestamp = event_timestamp.replace(tzinfo=timezone.utc)
            if event_timestamp > now + timedelta(minutes=5):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="punch_time cannot be in the future",
                )
        else:
            event_timestamp = now

        # 6. Effective Employee-Office Assignment & Roaming Check
        active_assignment = db.scalar(
            select(EmployeeOfficeAssignment).where(
                EmployeeOfficeAssignment.employee_id == employee.id,
                EmployeeOfficeAssignment.office_id == office.id,
                EmployeeOfficeAssignment.validity_range.contains(event_timestamp),
            )
        )

        if active_assignment is not None:
            is_roaming = False
            notes = "In-assignment punch"
        else:
            is_roaming = True
            notes = "Roaming punch: employee is not assigned to this office at punch time (flagged under GOV-08)"

        # 7. Pre-insertion Deduplication & Idempotency Check
        if payload.idempotency_key and payload.idempotency_key.strip():
            existing_by_key = db.scalar(
                select(AttendanceEvent).where(
                    AttendanceEvent.idempotency_key == payload.idempotency_key.strip()
                )
            )
            if existing_by_key is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Duplicate punch submission: idempotency key '{payload.idempotency_key.strip()}' already processed",
                )

        natural_dup = db.scalar(
            select(AttendanceEvent).where(
                AttendanceEvent.employee_id == employee.id,
                AttendanceEvent.device_id == device.id,
                AttendanceEvent.punch_type == payload.punch_type,
                AttendanceEvent.event_timestamp == event_timestamp,
            )
        )
        if natural_dup is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Duplicate punch submission detected for this employee, device, and timestamp",
            )

        # 8. Transaction-Safe Event Persistence
        event = AttendanceEvent(
            employee_id=employee.id,
            device_id=device.id,
            office_id=office.id,
            punch_type=payload.punch_type,
            event_timestamp=event_timestamp,
            is_roaming=is_roaming,
            idempotency_key=payload.idempotency_key.strip() if payload.idempotency_key else None,
            actor_user_id=current_user.id,
        )
        db.add(event)

        try:
            db.flush()
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Duplicate punch submission detected by database constraint",
            ) from exc

        # 9. Atomic Audit Trail Recording
        audit = AuditLog(
            actor_user_id=current_user.id,
            action="ATTENDANCE_PUNCH_RECORDED",
            target_type="attendance_event",
            target_id=str(event.id),
            before_state=None,
            after_state={
                "event_id": event.id,
                "employee_id": event.employee_id,
                "device_id": event.device_id,
                "office_id": event.office_id,
                "punch_type": event.punch_type,
                "event_timestamp": event.event_timestamp.isoformat(),
                "is_roaming": event.is_roaming,
                "idempotency_key": event.idempotency_key,
            },
            metadata_={
                "client_ip": client_ip,
                "notes": notes,
            },
            ip_address=client_ip,
        )
        db.add(audit)

        try:
            db.commit()
            db.refresh(event)
        except Exception:
            db.rollback()
            raise

        response = AttendancePunchResponse.model_validate(event)
        response.notes = notes
        return response

    @staticmethod
    def _get_attendance_day_boundaries(target_date: date) -> tuple[datetime, datetime]:
        """Compute authoritative UTC timestamp boundaries for a given calendar date."""
        dt_start = datetime(target_date.year, target_date.month, target_date.day, 0, 0, 0, 0, tzinfo=timezone.utc)
        dt_end = datetime(target_date.year, target_date.month, target_date.day, 23, 59, 59, 999999, tzinfo=timezone.utc)
        return dt_start, dt_end

    @staticmethod
    def _parse_filter_datetime(val: datetime | str | None, is_end: bool = False) -> datetime | None:
        if val is None:
            return None
        if isinstance(val, datetime):
            if val.tzinfo is None:
                return val.replace(tzinfo=timezone.utc)
            return val
        s = str(val).strip()
        if not s:
            return None
        if " " in s:
            parts = s.split(" ")
            if len(parts) == 2 and len(parts[1]) in (5, 6) and parts[1].count(":") == 1 and ("T" in parts[0] or parts[0].count(":") >= 2):
                s = parts[0] + "+" + parts[1]
        try:
            dt = datetime.fromisoformat(s)
            if len(s) == 10:  # Date only YYYY-MM-DD
                if is_end:
                    dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
                else:
                    dt = dt.replace(hour=0, minute=0, second=0, microsecond=0)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid datetime format: {val}. Expected ISO 8601 format.",
            )

    @staticmethod
    def get_attendance_records(
        db: Session,
        current_user: User,
        employee_id: int | None = None,
        office_id: int | None = None,
        device_id: int | None = None,
        punch_type: str | None = None,
        start_date: datetime | str | None = None,
        end_date: datetime | str | None = None,
        is_roaming: bool | None = None,
        limit: int = 50,
        offset: int = 0,
        scope: str | None = None,
    ) -> AttendanceListResponse:
        """Query paginated attendance events with role-based visibility and practical filters."""
        safe_limit = max(1, min(limit, 100))
        safe_offset = max(0, offset)
        parsed_start = AttendanceService._parse_filter_datetime(start_date, is_end=False)
        parsed_end = AttendanceService._parse_filter_datetime(end_date, is_end=True)

        # 1. Role-based visibility enforcement
        target_employee_id: int | None = None
        team_department: str | None = None

        if scope == "team":
            if current_user.role == "EMPLOYEE":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Operation not permitted for the current user role.",
                )
            if current_user.role == "MANAGER":
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
                team_department = manager_emp.department

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
                            detail="Employee not found",
                        )
                    if target_emp.department != team_department:
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail="Access forbidden: You may only view attendance for employees within your authorized team.",
                        )
                    target_employee_id = employee_id
            elif current_user.role == "ADMIN":
                target_employee_id = employee_id
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized role for team attendance queries.",
                )
        else:
            if current_user.role == "EMPLOYEE":
                if current_user.employee_id is None:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="User account is not linked to an employee profile.",
                    )
                if employee_id is not None and employee_id != current_user.employee_id:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Employees may only query their own attendance records.",
                    )
                target_employee_id = current_user.employee_id
            elif current_user.role in ("ADMIN", "MANAGER"):
                target_employee_id = employee_id
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized role for attendance queries.",
                )

        # 2. Base query with joins for enriched employee, device, and office attributes
        base_query = (
            select(
                AttendanceEvent,
                Employee.employee_code.label("employee_code"),
                (Employee.first_name + " " + Employee.last_name).label("employee_name"),
                Employee.department.label("department"),
                Device.name.label("device_name"),
                Device.device_code.label("device_code"),
                Office.name.label("office_name"),
                Office.code.label("office_code"),
            )
            .outerjoin(Employee, AttendanceEvent.employee_id == Employee.id)
            .outerjoin(Device, AttendanceEvent.device_id == Device.id)
            .outerjoin(Office, AttendanceEvent.office_id == Office.id)
        )
        count_query = select(func.count(AttendanceEvent.id))

        if team_department is not None and target_employee_id is None:
            base_query = base_query.where(Employee.department == team_department)
            count_query = count_query.join(Employee, AttendanceEvent.employee_id == Employee.id).where(
                Employee.department == team_department
            )

        if target_employee_id is not None:
            base_query = base_query.where(AttendanceEvent.employee_id == target_employee_id)
            count_query = count_query.where(AttendanceEvent.employee_id == target_employee_id)

        if office_id is not None:
            base_query = base_query.where(AttendanceEvent.office_id == office_id)
            count_query = count_query.where(AttendanceEvent.office_id == office_id)

        if device_id is not None:
            base_query = base_query.where(AttendanceEvent.device_id == device_id)
            count_query = count_query.where(AttendanceEvent.device_id == device_id)

        if punch_type and punch_type.strip():
            norm_punch = punch_type.strip().upper()
            base_query = base_query.where(AttendanceEvent.punch_type == norm_punch)
            count_query = count_query.where(AttendanceEvent.punch_type == norm_punch)

        if parsed_start is not None:
            base_query = base_query.where(AttendanceEvent.event_timestamp >= parsed_start)
            count_query = count_query.where(AttendanceEvent.event_timestamp >= parsed_start)

        if parsed_end is not None:
            base_query = base_query.where(AttendanceEvent.event_timestamp <= parsed_end)
            count_query = count_query.where(AttendanceEvent.event_timestamp <= parsed_end)

        if is_roaming is not None:
            base_query = base_query.where(AttendanceEvent.is_roaming == is_roaming)
            count_query = count_query.where(AttendanceEvent.is_roaming == is_roaming)

        total = db.scalar(count_query) or 0

        # Apply deterministic sorting and pagination
        paginated_query = (
            base_query
            .order_by(AttendanceEvent.event_timestamp.desc(), AttendanceEvent.id.desc())
            .offset(safe_offset)
            .limit(safe_limit)
        )

        rows = db.execute(paginated_query).all()

        items = [
            AttendanceEventDetail(
                id=event.id,
                employee_id=event.employee_id,
                employee_code=emp_code,
                employee_name=emp_name,
                department=dept,
                device_id=event.device_id,
                device_name=dev_name,
                device_code=dev_code,
                office_id=event.office_id,
                office_name=off_name,
                office_code=off_code,
                punch_type=event.punch_type,
                event_timestamp=event.event_timestamp,
                is_roaming=event.is_roaming,
                idempotency_key=event.idempotency_key,
                actor_user_id=event.actor_user_id,
                created_at=event.created_at,
                notes="Roaming punch under GOV-08" if event.is_roaming else "In-assignment punch",
            )
            for event, emp_code, emp_name, dept, dev_name, dev_code, off_name, off_code in rows
        ]

        return AttendanceListResponse(
            items=items,
            total=total,
            limit=safe_limit,
            offset=safe_offset,
        )

    @staticmethod
    def get_daily_operations(
        db: Session,
        current_user: User,
        date_str: str | None = None,
        office_id: int | None = None,
        employee_id: int | None = None,
        limit: int = 50,
        offset: int = 0,
        scope: str | None = None,
    ) -> DailyAttendanceOperationsResponse:
        """Query Daily Attendance Operations and summary metrics with role-based visibility."""
        safe_limit = max(1, min(limit, 100))
        safe_offset = max(0, offset)

        # 1. Parse and validate date
        if date_str is None or not str(date_str).strip():
            target_date = datetime.now(timezone.utc).date()
            date_str = target_date.strftime("%Y-%m-%d")
        else:
            s = str(date_str).strip()
            try:
                target_date = datetime.strptime(s, "%Y-%m-%d").date()
                date_str = s
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"Invalid date format: '{date_str}'. Expected YYYY-MM-DD.",
                )

        dt_start, dt_end = AttendanceService._get_attendance_day_boundaries(target_date)
        day_range = Range(dt_start, dt_end, bounds="[]")

        # 2. Validate office existence if filtered
        if office_id is not None:
            target_office = db.get(Office, office_id)
            if target_office is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Office not found",
                )

        # 3. Role-based scoping
        target_employee_id: int | None = None
        team_department: str | None = None

        if scope == "team":
            if current_user.role == "EMPLOYEE":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Operation not permitted for the current user role.",
                )
            if current_user.role == "MANAGER":
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
                team_department = manager_emp.department

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
                            detail="Employee not found",
                        )
                    if target_emp.department != team_department:
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail="Access forbidden: You may only view attendance for employees within your authorized team.",
                        )
                    target_employee_id = employee_id
            elif current_user.role == "ADMIN":
                target_employee_id = employee_id
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized role for team attendance queries.",
                )
        else:
            if current_user.role == "EMPLOYEE":
                if current_user.employee_id is None:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="User account is not linked to an employee profile.",
                    )
                if employee_id is not None and employee_id != current_user.employee_id:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Employees may only query their own attendance records.",
                    )
                target_employee_id = current_user.employee_id
            elif current_user.role in ("ADMIN", "MANAGER"):
                target_employee_id = employee_id
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unauthorized role for attendance queries.",
                )

        # 4. Fetch all attendance events for the day matching filters
        events_query = (
            select(
                AttendanceEvent,
                Device.name.label("device_name"),
                Device.device_code.label("device_code"),
                Office.name.label("office_name"),
                Office.code.label("office_code"),
            )
            .outerjoin(Device, AttendanceEvent.device_id == Device.id)
            .outerjoin(Office, AttendanceEvent.office_id == Office.id)
            .where(
                AttendanceEvent.event_timestamp >= dt_start,
                AttendanceEvent.event_timestamp <= dt_end,
            )
        )

        if office_id is not None:
            events_query = events_query.where(AttendanceEvent.office_id == office_id)

        if target_employee_id is not None:
            events_query = events_query.where(AttendanceEvent.employee_id == target_employee_id)
        elif team_department is not None:
            events_query = events_query.join(Employee, AttendanceEvent.employee_id == Employee.id).where(
                Employee.department == team_department
            )

        events_query = events_query.order_by(AttendanceEvent.event_timestamp.asc())
        event_rows = db.execute(events_query).all()

        # Group punches by employee
        punches_by_employee: dict[int, list[DailyPunchDetail]] = {}
        total_events = len(event_rows)
        total_roaming_punches = 0

        for ev, dev_name, dev_code, off_name, off_code in event_rows:
            if ev.is_roaming:
                total_roaming_punches += 1

            punch_detail = DailyPunchDetail(
                id=ev.id,
                punch_type=ev.punch_type,
                event_timestamp=ev.event_timestamp,
                device_id=ev.device_id,
                device_name=dev_name,
                device_code=dev_code,
                office_id=ev.office_id,
                office_name=off_name,
                office_code=off_code,
                is_roaming=ev.is_roaming,
            )
            punches_by_employee.setdefault(ev.employee_id, []).append(punch_detail)

        # 5. Establish eligible employee population
        # Base criteria: active, not soft-deleted, OR recorded a punch today
        emp_query = select(Employee).where(
            (Employee.is_active.is_(True) & Employee.deleted_at.is_(None))
            | (Employee.id.in_(list(punches_by_employee.keys())))
        )

        if team_department is not None:
            emp_query = emp_query.where(Employee.department == team_department)

        if target_employee_id is not None:
            emp_query = emp_query.where(Employee.id == target_employee_id)
        elif office_id is not None:
            assigned_emp_subq = select(EmployeeOfficeAssignment.employee_id).where(
                EmployeeOfficeAssignment.office_id == office_id,
                EmployeeOfficeAssignment.validity_range.overlaps(day_range),
            )
            punched_emp_ids = list(punches_by_employee.keys())
            emp_query = emp_query.where(
                (Employee.id.in_(assigned_emp_subq)) | (Employee.id.in_(punched_emp_ids))
            )

        emp_query = emp_query.order_by(Employee.employee_code.asc())
        eligible_employees = list(db.scalars(emp_query).all())
        eligible_emp_ids = [e.id for e in eligible_employees]

        # 6. Fetch effective office assignments for eligible employees on this date
        assigned_offices: dict[int, tuple[int, str, str, str | None]] = {}
        if eligible_emp_ids:
            assignments_query = (
                select(
                    EmployeeOfficeAssignment.employee_id,
                    Office.id.label("office_id"),
                    Office.name.label("office_name"),
                    Office.code.label("office_code"),
                    Office.timezone.label("office_timezone"),
                )
                .join(Office, EmployeeOfficeAssignment.office_id == Office.id)
                .where(
                    EmployeeOfficeAssignment.employee_id.in_(eligible_emp_ids),
                    EmployeeOfficeAssignment.validity_range.overlaps(day_range),
                )
            )
            for emp_id, off_id, off_name, off_code, off_tz in db.execute(assignments_query).all():
                assigned_offices[emp_id] = (off_id, off_name, off_code, off_tz)

        # 7. Query approved attendance corrections and merge effective punches (Phase 2)
        approved_corrections = db.scalars(
            select(AttendanceCorrection)
            .where(
                AttendanceCorrection.attendance_date == target_date,
                AttendanceCorrection.status == "APPROVED",
                AttendanceCorrection.employee_id.in_(eligible_emp_ids),
            )
            .order_by(AttendanceCorrection.proposed_timestamp.asc())
        ).all()

        for corr in approved_corrections:
            emp_punches = punches_by_employee.setdefault(corr.employee_id, [])
            off_info = assigned_offices.get(corr.employee_id)
            if corr.correction_type == "TIMESTAMP_ADJUSTMENT" and corr.original_event_id is not None:
                adjusted = False
                for p in emp_punches:
                    if p.id == corr.original_event_id:
                        p.event_timestamp = corr.proposed_timestamp
                        p.is_corrected = True
                        p.correction_id = corr.id
                        adjusted = True
                        break
                if not adjusted:
                    emp_punches.append(
                        DailyPunchDetail(
                            id=-corr.id,
                            punch_type=corr.original_event.punch_type if corr.original_event else "CHECK_IN",
                            event_timestamp=corr.proposed_timestamp,
                            device_id=None,
                            device_name="Manual Correction",
                            device_code="CORRECTION",
                            office_id=off_info[0] if off_info else None,
                            office_name=off_info[1] if off_info else None,
                            office_code=off_info[2] if off_info else None,
                            is_roaming=False,
                            is_corrected=True,
                            correction_id=corr.id,
                        )
                    )
            else:
                p_type = "CHECK_IN" if corr.correction_type == "MISSING_CHECK_IN" else "CHECK_OUT"
                emp_punches.append(
                    DailyPunchDetail(
                        id=-corr.id,
                        punch_type=p_type,
                        event_timestamp=corr.proposed_timestamp,
                        device_id=None,
                        device_name="Manual Correction",
                        device_code="CORRECTION",
                        office_id=off_info[0] if off_info else None,
                        office_name=off_info[1] if off_info else None,
                        office_code=off_info[2] if off_info else None,
                        is_roaming=False,
                        is_corrected=True,
                        correction_id=corr.id,
                    )
                )

        # 8. Query approved leaves and official holidays for target date
        approved_leaves = db.scalars(
            select(LeaveRequest.employee_id).where(
                LeaveRequest.employee_id.in_(eligible_emp_ids),
                LeaveRequest.status == "APPROVED",
                LeaveRequest.start_date <= target_date,
                LeaveRequest.end_date >= target_date,
            )
        ).all()
        emp_leave_set = set(approved_leaves)

        official_holidays = db.scalars(
            select(Holiday).where(
                Holiday.holiday_date == target_date,
                Holiday.is_optional.is_(False),
            )
        ).all()

        # 9. Query latest attendance reviews for eligible employees on target date
        latest_reviews_by_emp: dict[int, AttendanceReview] = {}
        if eligible_employees:
            emp_ids = [e.id for e in eligible_employees]
            reviews_query = (
                select(AttendanceReview)
                .where(
                    AttendanceReview.attendance_date == target_date,
                    AttendanceReview.employee_id.in_(emp_ids),
                )
                .order_by(
                    AttendanceReview.employee_id,
                    AttendanceReview.created_at.desc(),
                    AttendanceReview.id.desc(),
                )
            )
            for rev in db.scalars(reviews_query).all():
                if rev.employee_id not in latest_reviews_by_emp:
                    latest_reviews_by_emp[rev.employee_id] = rev

        # 10. Build employee-wise attendance records and calculate summary counters
        employee_items: list[EmployeeDailyAttendanceItem] = []
        employees_with_punches = 0
        employees_without_punches = 0
        requires_review_count = 0

        for emp in eligible_employees:
            emp_punches = punches_by_employee.get(emp.id, [])
            emp_punches.sort(key=lambda p: p.event_timestamp)
            punch_count = len(emp_punches)
            roaming_count = sum(1 for p in emp_punches if p.is_roaming)
            has_roaming = roaming_count > 0

            first_punch = emp_punches[0].event_timestamp if punch_count > 0 else None
            last_punch = emp_punches[-1].event_timestamp if punch_count > 0 else None

            off_info = assigned_offices.get(emp.id)
            off_tz_name = off_info[3] if off_info and len(off_info) > 3 else "Asia/Kolkata"
            try:
                off_tz = zoneinfo.ZoneInfo(off_tz_name or "Asia/Kolkata")
            except Exception:
                off_tz = zoneinfo.ZoneInfo("Asia/Kolkata")

            now_local = datetime.now(timezone.utc).astimezone(off_tz)
            today_local = now_local.date()
            is_past_day = target_date < today_local
            is_weekend = target_date.weekday() in (5, 6)

            # Leave / Holiday exemption
            has_approved_leave = emp.id in emp_leave_set
            has_holiday = any(
                (h.office_id is None or (off_info and h.office_id == off_info[0]))
                for h in official_holidays
            )
            is_excused = has_approved_leave or has_holiday

            # Look up latest review action if present
            latest_rev = latest_reviews_by_emp.get(emp.id)
            latest_review_resp = None
            if latest_rev:
                latest_review_resp = AttendanceReviewResponse(
                    id=latest_rev.id,
                    employee_id=latest_rev.employee_id,
                    attendance_date=latest_rev.attendance_date,
                    reviewed_by_user_id=latest_rev.reviewed_by_user_id,
                    reviewer_name=latest_rev.reviewer.full_name if latest_rev.reviewer else "Manager",
                    reviewer_email=latest_rev.reviewer.email if latest_rev.reviewer else "",
                    review_status=latest_rev.review_status,
                    review_notes=latest_rev.review_notes,
                    idempotency_key=latest_rev.idempotency_key,
                    created_at=latest_rev.created_at,
                )

            # Check punch completeness
            has_check_in = any(p.punch_type == "CHECK_IN" for p in emp_punches)
            has_check_out = any(p.punch_type == "CHECK_OUT" for p in emp_punches)

            missing_punch_reason: str | None = None
            if not is_excused and punch_count > 0:
                if not has_check_in and not has_check_out:
                    if is_weekend:
                        missing_punch_reason = "Unscheduled attendance: Irregular punches recorded on non-working day (requires review)"
                    else:
                        missing_punch_reason = "Incomplete attendance: Missing CHECK_IN and CHECK_OUT"
                elif not has_check_in:
                    if is_weekend:
                        missing_punch_reason = "Unscheduled attendance: Single punch recorded on non-working day (requires review)"
                    else:
                        missing_punch_reason = "Incomplete attendance: Missing CHECK_IN"
                elif not has_check_out and is_past_day:
                    if is_weekend:
                        missing_punch_reason = "Unscheduled attendance: Single punch recorded on non-working day (requires review)"
                    else:
                        missing_punch_reason = "Incomplete attendance: Missing CHECK_OUT"

            # Determine attendance review status
            if punch_count == 0:
                review_status = "NO_PUNCH"
                review_reason = None
                employees_without_punches += 1
            elif missing_punch_reason:
                review_status = "REQUIRES_REVIEW"
                requires_review_count += 1
                employees_with_punches += 1
                if has_roaming:
                    if latest_rev and latest_rev.review_status == "ACKNOWLEDGED":
                        reviewer_display = latest_rev.reviewer.full_name if latest_rev.reviewer else "Manager"
                        review_reason = f"{missing_punch_reason} | Roaming punches recorded ({roaming_count}) - Acknowledged by {reviewer_display}"
                    else:
                        review_reason = f"{missing_punch_reason} | Roaming punches recorded ({roaming_count})"
                else:
                    review_reason = missing_punch_reason
            elif has_roaming:
                if latest_rev and latest_rev.review_status == "ACKNOWLEDGED":
                    review_status = "ACKNOWLEDGED"
                    reviewer_display = latest_rev.reviewer.full_name if latest_rev.reviewer else "Manager"
                    review_reason = f"Roaming punches recorded ({roaming_count}) - Acknowledged by {reviewer_display}"
                else:
                    review_status = "REQUIRES_REVIEW"
                    review_reason = f"Roaming punches recorded ({roaming_count})"
                    requires_review_count += 1
                employees_with_punches += 1
            else:
                review_status = "NORMAL"
                review_reason = None
                employees_with_punches += 1

            off_info = assigned_offices.get(emp.id)

            item = EmployeeDailyAttendanceItem(
                employee_id=emp.id,
                employee_code=emp.employee_code,
                employee_name=f"{emp.first_name} {emp.last_name}",
                department=emp.department,
                assigned_office_id=off_info[0] if off_info else None,
                assigned_office_name=off_info[1] if off_info else None,
                assigned_office_code=off_info[2] if off_info else None,
                punch_count=punch_count,
                first_punch=first_punch,
                last_punch=last_punch,
                has_roaming=has_roaming,
                roaming_count=roaming_count,
                review_status=review_status,
                review_reason=review_reason,
                latest_review=latest_review_resp,
                punches=emp_punches,
            )
            employee_items.append(item)

        # 9. Deterministic sort: REQUIRES_REVIEW first, then ACKNOWLEDGED, then NORMAL (with punches), then NO_PUNCH
        status_priority = {"REQUIRES_REVIEW": 0, "ACKNOWLEDGED": 1, "NORMAL": 2, "NO_PUNCH": 3}
        employee_items.sort(key=lambda x: (status_priority.get(x.review_status, 9), x.employee_code))

        # 9. Pagination
        total_employees = len(employee_items)
        paged_employees = employee_items[safe_offset : safe_offset + safe_limit]

        summary = DailyAttendanceSummary(
            date=date_str,
            total_events=total_events,
            employees_with_punches=employees_with_punches,
            employees_without_punches=employees_without_punches,
            requires_review_count=requires_review_count,
            roaming_punch_count=total_roaming_punches,
            eligible_employee_count=total_employees,
        )

        return DailyAttendanceOperationsResponse(
            summary=summary,
            employees=paged_employees,
            total_employees=total_employees,
            limit=safe_limit,
            offset=safe_offset,
        )

    @staticmethod
    def _parse_and_validate_date_range(
        start_date_str: str | None,
        end_date_str: str | None,
        max_days: int = 31,
    ) -> tuple[datetime, datetime, str, str]:
        """Validate date-range format, ordering, and maximum span limit."""
        today_utc = datetime.now(timezone.utc).date()

        if end_date_str is None or not str(end_date_str).strip():
            end_date = today_utc
            end_str = end_date.strftime("%Y-%m-%d")
        else:
            s_end = str(end_date_str).strip()
            try:
                end_date = datetime.strptime(s_end, "%Y-%m-%d").date()
                end_str = s_end
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"Invalid date format: '{end_date_str}'. Expected YYYY-MM-DD.",
                )

        if start_date_str is None or not str(start_date_str).strip():
            start_date = end_date - timedelta(days=6)
            start_str = start_date.strftime("%Y-%m-%d")
        else:
            s_start = str(start_date_str).strip()
            try:
                start_date = datetime.strptime(s_start, "%Y-%m-%d").date()
                start_str = s_start
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"Invalid date format: '{start_date_str}'. Expected YYYY-MM-DD.",
                )

        if end_date < start_date:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="end_date must be on or after start_date.",
            )

        span_days = (end_date - start_date).days
        if span_days > max_days:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Date range cannot exceed {max_days} days. Please select a shorter range.",
            )

        dt_start = datetime(start_date.year, start_date.month, start_date.day, 0, 0, 0, 0, tzinfo=timezone.utc)
        dt_end = datetime(end_date.year, end_date.month, end_date.day, 23, 59, 59, 999999, tzinfo=timezone.utc)
        return dt_start, dt_end, start_str, end_str

    @staticmethod
    def _sanitize_csv_cell(val: Any) -> str:
        """Sanitize field value for CSV export and neutralize formula injection triggers."""
        if val is None:
            return ""
        if isinstance(val, datetime):
            if val.tzinfo is None:
                val = val.replace(tzinfo=timezone.utc)
            return val.strftime("%Y-%m-%d %H:%M:%S UTC")
        s = str(val).strip()
        # Neutralize formula characters (=, +, -, @, \t, \r)
        if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
            return f"'{s}"
        return s

    @staticmethod
    def _calculate_daily_worked_duration(punches: list[Any]) -> tuple[int | None, str | None]:
        """Calculate daily worked duration in minutes and formatted string from chronological punches.

        Returns (minutes, formatted_string) if all punches form complete, valid (CHECK_IN, CHECK_OUT)
        pairs with no unmatched punches. If any punch remains unmatched or invalid, returns (None, None).
        """
        if not punches or len(punches) % 2 != 0:
            return None, None

        total_seconds = 0.0
        for i in range(0, len(punches), 2):
            p_in = punches[i]
            p_out = punches[i + 1]

            if p_in.punch_type != "CHECK_IN" or p_out.punch_type != "CHECK_OUT":
                return None, None

            delta = (p_out.event_timestamp - p_in.event_timestamp).total_seconds()
            if delta <= 0:
                return None, None

            total_seconds += delta

        total_minutes = int(total_seconds // 60)
        hours = total_minutes // 60
        mins = total_minutes % 60
        return total_minutes, f"{hours}h {mins}m"

    @staticmethod
    def _resolve_report_items(
        db: Session,
        current_user: User,
        start_date_str: str | None = None,
        end_date_str: str | None = None,
        office_id: int | None = None,
        employee_id: int | None = None,
        department: str | None = None,
    ) -> tuple[list[AttendanceReportItem], AttendanceReportSummary]:
        """Shared internal computation for date-range attendance reports and CSV export."""
        dt_start, dt_end, start_str, end_str = AttendanceService._parse_and_validate_date_range(
            start_date_str, end_date_str, max_days=31
        )
        date_range = Range(dt_start, dt_end, bounds="[]")

        # 1. Office existence check
        if office_id is not None:
            office = db.get(Office, office_id)
            if office is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Office not found",
                )

        # 2. Role scoping & Department filter validation
        dept_clean = department.strip() if department and department.strip() else None
        manager_dept: str | None = None
        target_employee_id: int | None = None
        filter_department: str | None = None

        if current_user.role == "EMPLOYEE":
            if current_user.employee_id is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User account is not linked to an employee profile.",
                )
            if employee_id is not None and employee_id != current_user.employee_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Employees may only access their own attendance data.",
                )
            target_employee_id = current_user.employee_id

            if dept_clean is not None:
                emp = db.scalar(
                    select(Employee).where(
                        Employee.id == current_user.employee_id,
                        Employee.deleted_at.is_(None),
                    )
                )
                if not emp or emp.department != dept_clean:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Access forbidden: You may only view attendance for your authorized department.",
                    )
                filter_department = dept_clean

        elif current_user.role == "MANAGER":
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
            manager_dept = manager_emp.department

            if dept_clean is not None and dept_clean != manager_dept:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access forbidden: You may only view attendance for employees within your authorized team.",
                )
            filter_department = manager_dept

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
                        detail="Employee not found",
                    )
                if target_emp.department != manager_dept:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Access forbidden: You may only view attendance for employees within your authorized team.",
                    )
                target_employee_id = employee_id

        elif current_user.role == "ADMIN":
            target_employee_id = employee_id
            filter_department = dept_clean
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized role for attendance queries.",
            )

        # 3. Query raw events within bounded date range
        events_query = (
            select(
                AttendanceEvent,
                Office.name.label("office_name"),
                Office.code.label("office_code"),
            )
            .join(Employee, AttendanceEvent.employee_id == Employee.id)
            .outerjoin(Office, AttendanceEvent.office_id == Office.id)
            .where(
                AttendanceEvent.event_timestamp >= dt_start,
                AttendanceEvent.event_timestamp <= dt_end,
            )
        )

        if office_id is not None:
            events_query = events_query.where(AttendanceEvent.office_id == office_id)
        if target_employee_id is not None:
            events_query = events_query.where(AttendanceEvent.employee_id == target_employee_id)
        if filter_department is not None:
            events_query = events_query.where(Employee.department == filter_department)

        events_query = events_query.order_by(AttendanceEvent.event_timestamp.asc())
        event_rows = db.execute(events_query).all()

        raw_punched_emp_ids = {ev.employee_id for ev, _, _ in event_rows}

        # 4. Query established eligible employee population
        emp_query = select(Employee).where(
            (Employee.is_active.is_(True) & Employee.deleted_at.is_(None))
            | (Employee.id.in_(list(raw_punched_emp_ids)))
        )

        if target_employee_id is not None:
            emp_query = emp_query.where(Employee.id == target_employee_id)
        elif office_id is not None:
            assigned_emp_subq = select(EmployeeOfficeAssignment.employee_id).where(
                EmployeeOfficeAssignment.office_id == office_id,
                EmployeeOfficeAssignment.validity_range.overlaps(date_range),
            )
            emp_query = emp_query.where(
                (Employee.id.in_(assigned_emp_subq)) | (Employee.id.in_(list(raw_punched_emp_ids)))
            )

        if filter_department is not None:
            emp_query = emp_query.where(Employee.department == filter_department)

        emp_query = emp_query.order_by(Employee.employee_code.asc())
        eligible_employees = list(db.scalars(emp_query).all())
        eligible_emp_ids = [e.id for e in eligible_employees]

        # 5. Resolve primary office assignments and timezones for eligible employees in range
        assigned_offices: dict[int, tuple[int, str, str, str | None]] = {}
        if eligible_emp_ids:
            asgn_q = (
                select(
                    EmployeeOfficeAssignment.employee_id,
                    Office.id.label("office_id"),
                    Office.name.label("office_name"),
                    Office.code.label("office_code"),
                    Office.timezone.label("office_timezone"),
                )
                .join(Office, EmployeeOfficeAssignment.office_id == Office.id)
                .where(
                    EmployeeOfficeAssignment.employee_id.in_(eligible_emp_ids),
                    EmployeeOfficeAssignment.validity_range.overlaps(date_range),
                )
            )
            for e_id, o_id, o_name, o_code, o_tz in db.execute(asgn_q).all():
                assigned_offices[e_id] = (o_id, o_name, o_code, o_tz)

        # 6. Fetch approved corrections for eligible employees in date range
        p_start_date = dt_start.date()
        p_end_date = dt_end.date()

        approved_corrections: list[AttendanceCorrection] = []
        if eligible_emp_ids:
            approved_corrections = list(
                db.scalars(
                    select(AttendanceCorrection)
                    .where(
                        AttendanceCorrection.employee_id.in_(eligible_emp_ids),
                        AttendanceCorrection.attendance_date >= p_start_date,
                        AttendanceCorrection.attendance_date <= p_end_date,
                        AttendanceCorrection.status == "APPROVED",
                    )
                    .order_by(AttendanceCorrection.proposed_timestamp.asc())
                ).all()
            )

        corrections_by_emp: dict[int, list[AttendanceCorrection]] = {}
        for corr in approved_corrections:
            corrections_by_emp.setdefault(corr.employee_id, []).append(corr)

        # 7. Index raw events by employee
        class _ReportPunch:
            def __init__(
                self,
                id: int | None,
                punch_type: str,
                event_timestamp: datetime,
                is_roaming: bool,
                office_id: int | None,
                office_name: str | None,
                office_code: str | None,
            ):
                self.id = id
                self.punch_type = punch_type
                self.event_timestamp = event_timestamp
                self.is_roaming = is_roaming
                self.office_id = office_id
                self.office_name = office_name
                self.office_code = office_code

        raw_punches_by_emp: dict[int, list[_ReportPunch]] = {}
        for ev, off_name, off_code in event_rows:
            raw_punches_by_emp.setdefault(ev.employee_id, []).append(
                _ReportPunch(
                    id=ev.id,
                    punch_type=ev.punch_type,
                    event_timestamp=ev.event_timestamp,
                    is_roaming=ev.is_roaming,
                    office_id=ev.office_id,
                    office_name=off_name,
                    office_code=off_code,
                )
            )

        # 8. Build effective line items per employee and date
        report_items: list[AttendanceReportItem] = []
        effective_punched_emp_ids: set[int] = set()
        total_events = 0
        total_roaming_punches = 0
        employees_without_punches = 0

        for emp in eligible_employees:
            off_info = assigned_offices.get(emp.id)
            off_tz_name = off_info[3] if off_info else None
            try:
                emp_tz = zoneinfo.ZoneInfo(off_tz_name or "Asia/Kolkata")
            except Exception:
                emp_tz = zoneinfo.ZoneInfo("Asia/Kolkata")

            # Copy raw punches for this employee without mutating raw models
            emp_punches = list(raw_punches_by_emp.get(emp.id, []))

            # Merge approved corrections
            emp_corrs = corrections_by_emp.get(emp.id, [])
            for corr in emp_corrs:
                if corr.correction_type == "TIMESTAMP_ADJUSTMENT" and corr.original_event_id is not None:
                    adjusted = False
                    for p in emp_punches:
                        if p.id == corr.original_event_id:
                            p.event_timestamp = corr.proposed_timestamp
                            adjusted = True
                            break
                    if not adjusted:
                        orig_type = corr.original_event.punch_type if corr.original_event else "CHECK_IN"
                        emp_punches.append(
                            _ReportPunch(
                                id=-corr.id,
                                punch_type=orig_type,
                                event_timestamp=corr.proposed_timestamp,
                                is_roaming=False,
                                office_id=off_info[0] if off_info else None,
                                office_name=off_info[1] if off_info else None,
                                office_code=off_info[2] if off_info else None,
                            )
                        )
                else:
                    corr_type = "CHECK_IN" if corr.correction_type == "MISSING_CHECK_IN" else "CHECK_OUT"
                    emp_punches.append(
                        _ReportPunch(
                            id=-corr.id,
                            punch_type=corr_type,
                            event_timestamp=corr.proposed_timestamp,
                            is_roaming=False,
                            office_id=off_info[0] if off_info else None,
                            office_name=off_info[1] if off_info else None,
                            office_code=off_info[2] if off_info else None,
                        )
                    )

            # Chronological sort
            emp_punches.sort(key=lambda p: p.event_timestamp)

            # Group punches by employee office-local date string
            date_groups: dict[str, list[_ReportPunch]] = {}
            for p in emp_punches:
                d_str = p.event_timestamp.astimezone(emp_tz).strftime("%Y-%m-%d")
                date_groups.setdefault(d_str, []).append(p)

            # Keep only date groups within the requested [start_str, end_str] range
            active_date_groups = {
                d: plist for d, plist in date_groups.items() if start_str <= d <= end_str
            }

            if active_date_groups:
                effective_punched_emp_ids.add(emp.id)
                for d_str, plist in active_date_groups.items():
                    p_count = len(plist)
                    total_events += p_count
                    roam_count = sum(1 for p in plist if p.is_roaming)
                    total_roaming_punches += roam_count
                    has_roam = roam_count > 0
                    first_p = plist[0].event_timestamp
                    last_p = plist[-1].event_timestamp

                    # Office for this punch day: office of first punch, or assigned office
                    punch_off_id = plist[0].office_id
                    punch_off_name = plist[0].office_name or (off_info[1] if off_info else None)
                    punch_off_code = plist[0].office_code or (off_info[2] if off_info else None)

                    status_str = "REQUIRES_REVIEW" if has_roam else "NORMAL"
                    duration_mins, duration_fmt = AttendanceService._calculate_daily_worked_duration(plist)

                    report_items.append(
                        AttendanceReportItem(
                            employee_id=emp.id,
                            employee_code=emp.employee_code,
                            employee_name=f"{emp.first_name} {emp.last_name}",
                            department=emp.department,
                            office_id=punch_off_id,
                            office_name=punch_off_name,
                            office_code=punch_off_code,
                            attendance_date=d_str,
                            punch_count=p_count,
                            first_punch=first_p,
                            last_punch=last_p,
                            has_roaming=has_roam,
                            roaming_count=roam_count,
                            status=status_str,
                            work_duration_minutes=duration_mins,
                            work_duration_formatted=duration_fmt,
                        )
                    )
            else:
                # Employee has no punches in entire date range -> neutral label row
                employees_without_punches += 1
                neutral_date_label = start_str if start_str == end_str else f"{start_str} to {end_str}"
                report_items.append(
                    AttendanceReportItem(
                        employee_id=emp.id,
                        employee_code=emp.employee_code,
                        employee_name=f"{emp.first_name} {emp.last_name}",
                        department=emp.department,
                        office_id=off_info[0] if off_info else None,
                        office_name=off_info[1] if off_info else None,
                        office_code=off_info[2] if off_info else None,
                        attendance_date=neutral_date_label,
                        punch_count=0,
                        first_punch=None,
                        last_punch=None,
                        has_roaming=False,
                        roaming_count=0,
                        status="NO_PUNCH",
                        work_duration_minutes=None,
                        work_duration_formatted=None,
                    )
                )

        # 9. Deterministic sort: date desc, employee_code asc
        report_items.sort(key=lambda x: (x.attendance_date, x.employee_code), reverse=True)

        complete_durations = [it.work_duration_minutes for it in report_items if it.work_duration_minutes is not None]
        total_worked_hours = round(sum(complete_durations) / 60.0, 2)
        avg_worked_hours = (
            round(sum(complete_durations) / len(complete_durations) / 60.0, 2)
            if complete_durations
            else None
        )

        summary = AttendanceReportSummary(
            start_date=start_str,
            end_date=end_str,
            total_events=total_events,
            employees_with_punches=len(effective_punched_emp_ids),
            employees_without_punches=employees_without_punches,
            roaming_punch_count=total_roaming_punches,
            total_records=len(report_items),
            eligible_employee_count=len(eligible_employees),
            total_worked_hours=total_worked_hours,
            average_daily_worked_hours=avg_worked_hours,
        )

        return report_items, summary

    @staticmethod
    def get_attendance_report(
        db: Session,
        current_user: User,
        start_date: str | None = None,
        end_date: str | None = None,
        office_id: int | None = None,
        department: str | None = None,
        employee_id: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> AttendanceReportResponse:
        """Query paginated attendance report items and aggregated summary for the date range."""
        safe_limit = max(1, min(limit, 100))
        safe_offset = max(0, offset)

        items, summary = AttendanceService._resolve_report_items(
            db=db,
            current_user=current_user,
            start_date_str=start_date,
            end_date_str=end_date,
            office_id=office_id,
            employee_id=employee_id,
            department=department,
        )

        total_items = len(items)
        paged_items = items[safe_offset : safe_offset + safe_limit]

        return AttendanceReportResponse(
            summary=summary,
            items=paged_items,
            total_items=total_items,
            limit=safe_limit,
            offset=safe_offset,
        )

    @staticmethod
    def export_attendance_report_csv(
        db: Session,
        current_user: User,
        start_date: str | None = None,
        end_date: str | None = None,
        office_id: int | None = None,
        department: str | None = None,
        employee_id: int | None = None,
    ) -> tuple[bytes, str]:
        """Generate UTF-8 with BOM CSV export with formula neutralization."""
        items, summary = AttendanceService._resolve_report_items(
            db=db,
            current_user=current_user,
            start_date_str=start_date,
            end_date_str=end_date,
            office_id=office_id,
            employee_id=employee_id,
            department=department,
        )

        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")

        # CSV Header
        headers = [
            "Employee Code",
            "Employee Name",
            "Department",
            "Office",
            "Attendance Date",
            "Punch Count",
            "First Punch",
            "Last Punch",
            "Roaming Status",
            "Work Duration",
        ]
        writer.writerow(headers)

        for item in items:
            if item.has_roaming:
                roaming_desc = f"Roaming ({item.roaming_count})"
            elif item.punch_count > 0:
                roaming_desc = "In-Assignment"
            else:
                roaming_desc = "No punch recorded"

            row = [
                AttendanceService._sanitize_csv_cell(item.employee_code),
                AttendanceService._sanitize_csv_cell(item.employee_name),
                AttendanceService._sanitize_csv_cell(item.department or "—"),
                AttendanceService._sanitize_csv_cell(item.office_name or "—"),
                AttendanceService._sanitize_csv_cell(item.attendance_date),
                AttendanceService._sanitize_csv_cell(item.punch_count),
                AttendanceService._sanitize_csv_cell(item.first_punch) if item.first_punch else "—",
                AttendanceService._sanitize_csv_cell(item.last_punch) if item.last_punch else "—",
                AttendanceService._sanitize_csv_cell(roaming_desc),
                AttendanceService._sanitize_csv_cell(item.work_duration_formatted or "—"),
            ]
            writer.writerow(row)

        csv_bytes = output.getvalue().encode("utf-8-sig")
        filename = f"attendance_report_{summary.start_date}_{summary.end_date}.csv"
        return csv_bytes, filename

    @staticmethod
    def _handle_idempotent_review(
        existing: AttendanceReview,
        payload: AttendanceReviewCreate,
        current_user: User,
    ) -> AttendanceReviewResponse:
        """Verify parameter equality on idempotency collision and handle safe replay or conflict rejection."""
        is_identical = (
            existing.employee_id == payload.employee_id
            and existing.attendance_date == payload.attendance_date
            and existing.review_status == payload.review_status
            and (existing.review_notes or None) == (payload.review_notes or None)
            and existing.reviewed_by_user_id == current_user.id
        )
        if is_identical:
            reviewer_name = existing.reviewer.full_name if existing.reviewer else current_user.full_name
            reviewer_email = existing.reviewer.email if existing.reviewer else current_user.email
            return AttendanceReviewResponse(
                id=existing.id,
                employee_id=existing.employee_id,
                attendance_date=existing.attendance_date,
                reviewed_by_user_id=existing.reviewed_by_user_id,
                reviewer_name=reviewer_name,
                reviewer_email=reviewer_email,
                review_status=existing.review_status,
                review_notes=existing.review_notes,
                idempotency_key=existing.idempotency_key,
                created_at=existing.created_at,
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Idempotency key reuse with mismatched parameters",
        )

    @staticmethod
    def acknowledge_exception(
        db: Session,
        payload: AttendanceReviewCreate,
        current_user: User,
        client_ip: str | None = None,
    ) -> AttendanceReviewResponse:
        """Submit an auditable manager acknowledgement for an attendance exception."""
        # 1. Role verification
        if current_user.role == "EMPLOYEE":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operation not permitted for the current user role.",
            )

        # 2. Manager department authorization check (precedes all queries and writes)
        target_emp = db.scalar(
            select(Employee).where(
                Employee.id == payload.employee_id,
                Employee.deleted_at.is_(None),
            )
        )
        if not target_emp:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employee not found",
            )

        manager_dept: str | None = None
        if current_user.role == "MANAGER":
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
            manager_dept = manager_emp.department
            if target_emp.department != manager_dept:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access forbidden: You may only review attendance for employees within your authorized team.",
                )
        elif current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized role for attendance review operations.",
            )

        # 3. Verify presence of authoritative roaming punch exception on target attendance date
        dt_start, dt_end = AttendanceService._get_attendance_day_boundaries(payload.attendance_date)
        has_roaming_exception = db.scalar(
            select(
                exists().where(
                    AttendanceEvent.employee_id == target_emp.id,
                    AttendanceEvent.event_timestamp >= dt_start,
                    AttendanceEvent.event_timestamp <= dt_end,
                    AttendanceEvent.is_roaming.is_(True),
                )
            )
        )
        if not has_roaming_exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No eligible attendance exception (such as a roaming punch) found for this employee on the specified date.",
            )

        # 4. Check for existing identical idempotency key before attempting insert
        existing = db.scalar(
            select(AttendanceReview).where(
                AttendanceReview.idempotency_key == payload.idempotency_key
            )
        )
        if existing:
            return AttendanceService._handle_idempotent_review(existing, payload, current_user)

        # 5. Atomic insertion of review decision and audit trail log
        review = AttendanceReview(
            employee_id=target_emp.id,
            attendance_date=payload.attendance_date,
            reviewed_by_user_id=current_user.id,
            review_status="ACKNOWLEDGED",
            review_notes=payload.review_notes,
            idempotency_key=payload.idempotency_key,
        )
        db.add(review)

        try:
            db.flush()
            # Construct audit log with populated review.id (audit_logs table has immutable trigger preventing UPDATE)
            audit = AuditLog(
                actor_user_id=current_user.id,
                action="ATTENDANCE_EXCEPTION_ACKNOWLEDGED",
                target_type="attendance_review",
                target_id=str(review.id),
                before_state={
                    "review_status": "REQUIRES_REVIEW",
                    "has_roaming": True,
                },
                after_state={
                    "review_status": "ACKNOWLEDGED",
                    "employee_id": target_emp.id,
                    "attendance_date": payload.attendance_date.isoformat(),
                    "idempotency_key": payload.idempotency_key,
                    "review_notes": payload.review_notes,
                },
                metadata_={
                    "client_ip": client_ip,
                    "department": manager_dept or target_emp.department,
                },
                ip_address=client_ip,
            )
            db.add(audit)
            db.commit()
            db.refresh(review)
            return AttendanceReviewResponse(
                id=review.id,
                employee_id=review.employee_id,
                attendance_date=review.attendance_date,
                reviewed_by_user_id=review.reviewed_by_user_id,
                reviewer_name=current_user.full_name,
                reviewer_email=current_user.email,
                review_status=review.review_status,
                review_notes=review.review_notes,
                idempotency_key=review.idempotency_key,
                created_at=review.created_at,
            )
        except IntegrityError:
            # Roll back failed transaction before querying existing record
            db.rollback()
            existing_after_conflict = db.scalar(
                select(AttendanceReview).where(
                    AttendanceReview.idempotency_key == payload.idempotency_key
                )
            )
            if existing_after_conflict:
                return AttendanceService._handle_idempotent_review(
                    existing_after_conflict, payload, current_user
                )
            raise
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def get_attendance_reviews(
        db: Session,
        current_user: User,
        employee_id: int,
        attendance_date: date | str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> AttendanceReviewHistoryResponse:
        """Retrieve auditable review history for an employee."""
        # 1. Role verification
        if current_user.role == "EMPLOYEE":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operation not permitted for the current user role.",
            )

        # 2. Target employee lookup and department authorization
        target_emp = db.scalar(
            select(Employee).where(
                Employee.id == employee_id,
                Employee.deleted_at.is_(None),
            )
        )
        if not target_emp:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employee not found",
            )

        if current_user.role == "MANAGER":
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
            if target_emp.department != manager_emp.department:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access forbidden: You may only view review history for employees within your authorized team.",
                )
        elif current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized role for attendance review queries.",
            )

        # 3. Query reviews
        query = (
            select(AttendanceReview)
            .where(AttendanceReview.employee_id == employee_id)
            .order_by(
                AttendanceReview.attendance_date.desc(),
                AttendanceReview.created_at.desc(),
                AttendanceReview.id.desc(),
            )
        )
        if attendance_date is not None:
            if isinstance(attendance_date, str):
                try:
                    parsed_date = datetime.strptime(attendance_date.strip(), "%Y-%m-%d").date()
                except ValueError:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail=f"Invalid date format: '{attendance_date}'. Expected YYYY-MM-DD.",
                    )
            else:
                parsed_date = attendance_date
            query = query.where(AttendanceReview.attendance_date == parsed_date)

        total_count = db.scalar(select(func.count()).select_from(query.subquery())) or 0
        safe_limit = max(1, min(limit, 100))
        safe_offset = max(0, offset)
        reviews = db.scalars(query.offset(safe_offset).limit(safe_limit)).all()

        items = [
            AttendanceReviewResponse(
                id=r.id,
                employee_id=r.employee_id,
                attendance_date=r.attendance_date,
                reviewed_by_user_id=r.reviewed_by_user_id,
                reviewer_name=r.reviewer.full_name if r.reviewer else "Manager",
                reviewer_email=r.reviewer.email if r.reviewer else "",
                review_status=r.review_status,
                review_notes=r.review_notes,
                idempotency_key=r.idempotency_key,
                created_at=r.created_at,
            )
            for r in reviews
        ]
        return AttendanceReviewHistoryResponse(
            employee_id=employee_id,
            items=items,
            total_items=total_count,
        )

    @staticmethod
    def get_attendance_exceptions(
        db: Session,
        current_user: User,
        date_str: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> AttendanceExceptionListResponse:
        """Retrieve list of attendance exceptions scoped to caller's authorization."""
        if current_user.role == "EMPLOYEE":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operation not permitted for the current user role.",
            )
        scope = "team" if current_user.role == "MANAGER" else "all"
        daily_ops = AttendanceService.get_daily_operations(
            db=db,
            current_user=current_user,
            date_str=date_str,
            limit=1000,
            offset=0,
            scope=scope,
        )

        exception_items: list[AttendanceExceptionItem] = []
        for emp in daily_ops.employees:
            if emp.review_status == "REQUIRES_REVIEW" or emp.has_roaming:
                exception_items.append(
                    AttendanceExceptionItem(
                        employee_id=emp.employee_id,
                        employee_code=emp.employee_code,
                        employee_name=emp.employee_name,
                        department=emp.department,
                        assigned_office_id=emp.assigned_office_id,
                        assigned_office_name=emp.assigned_office_name,
                        attendance_date=daily_ops.summary.date,
                        punch_count=emp.punch_count,
                        first_punch=emp.first_punch,
                        last_punch=emp.last_punch,
                        has_roaming=emp.has_roaming,
                        roaming_count=emp.roaming_count,
                        review_status=emp.review_status,
                        review_reason=emp.review_reason,
                        latest_review=emp.latest_review,
                        punches=emp.punches,
                    )
                )

        total_exceptions = len(exception_items)
        safe_offset = max(0, offset)
        safe_limit = max(1, min(limit, 100))
        paged_items = exception_items[safe_offset : safe_offset + safe_limit]

        return AttendanceExceptionListResponse(
            date=daily_ops.summary.date,
            total_exceptions=total_exceptions,
            items=paged_items,
        )

    @staticmethod
    def _build_correction_response(corr: AttendanceCorrection) -> AttendanceCorrectionResponse:
        """Map AttendanceCorrection model to response schema with denormalized fields."""
        return AttendanceCorrectionResponse(
            id=corr.id,
            employee_id=corr.employee_id,
            employee_name=f"{corr.employee.first_name} {corr.employee.last_name}" if corr.employee else None,
            employee_code=corr.employee.employee_code if corr.employee else None,
            department=corr.employee.department if corr.employee else None,
            attendance_date=corr.attendance_date,
            correction_type=corr.correction_type,
            proposed_timestamp=corr.proposed_timestamp,
            original_event_id=corr.original_event_id,
            reason=corr.reason,
            status=corr.status,
            requested_by_user_id=corr.requested_by_user_id,
            requester_name=corr.requester.full_name if corr.requester else None,
            requester_email=corr.requester.email if corr.requester else None,
            reviewed_by_user_id=corr.reviewed_by_user_id,
            reviewer_name=corr.reviewer.full_name if corr.reviewer else None,
            reviewer_email=corr.reviewer.email if corr.reviewer else None,
            review_notes=corr.review_notes,
            reviewed_at=corr.reviewed_at,
            idempotency_key=corr.idempotency_key,
            created_at=corr.created_at,
            updated_at=corr.updated_at,
        )

    @staticmethod
    def create_correction(
        db: Session,
        payload: AttendanceCorrectionCreate,
        current_user: User,
        client_ip: str | None = None,
    ) -> AttendanceCorrectionResponse:
        """Submit an attendance correction request.

        - Authenticated access required (EMPLOYEE for self, MANAGER for department, ADMIN for all).
        - Validates target employee, timezone, attendance date alignment, and prevents future timestamps.
        - Strictly prevents duplicate missing-punch corrections if punch of that type already exists.
        - Strictly prevents duplicate pending requests of the same type for the same date.
        - Idempotency key protected with atomic audit recording.
        """
        # 1. Role verification & Scoping
        if current_user.role == "EMPLOYEE":
            if current_user.employee_id is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User account is not linked to an employee profile.",
                )
            if payload.employee_id != current_user.employee_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Employees may only submit correction requests for themselves.",
                )
        elif current_user.role == "MANAGER":
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
            target_emp_check = db.scalar(
                select(Employee).where(
                    Employee.id == payload.employee_id,
                    Employee.deleted_at.is_(None),
                )
            )
            if not target_emp_check or target_emp_check.department != manager_emp.department:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access forbidden: You may only submit corrections for employees within your authorized team.",
                )
        elif current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized role for attendance correction creation.",
            )

        # 2. Target Employee Verification
        target_emp = db.scalar(
            select(Employee).where(
                Employee.id == payload.employee_id,
                Employee.deleted_at.is_(None),
                Employee.is_active.is_(True),
            )
        )
        if not target_emp:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Target employee not found or inactive.",
            )

        # 3. Timezone & Office Assignment Resolution
        dt_start, dt_end = AttendanceService._get_attendance_day_boundaries(payload.attendance_date)
        day_range = Range(dt_start, dt_end, bounds="[]")
        assignment = db.scalar(
            select(EmployeeOfficeAssignment).where(
                EmployeeOfficeAssignment.employee_id == target_emp.id,
                EmployeeOfficeAssignment.validity_range.overlaps(day_range),
            )
        )
        office = db.get(Office, assignment.office_id) if assignment else None
        off_tz_name = office.timezone if office and office.timezone else "Asia/Kolkata"
        try:
            emp_tz = zoneinfo.ZoneInfo(off_tz_name)
        except Exception:
            emp_tz = zoneinfo.ZoneInfo("Asia/Kolkata")

        # 4. Validate Proposed Timestamp
        proposed_dt = payload.proposed_timestamp
        if proposed_dt.tzinfo is None:
            proposed_dt = proposed_dt.replace(tzinfo=timezone.utc)

        now_utc = datetime.now(timezone.utc)
        if proposed_dt > now_utc + timedelta(minutes=5):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="proposed_timestamp cannot be in the future.",
            )

        proposed_local_date = proposed_dt.astimezone(emp_tz).date()
        if proposed_local_date != payload.attendance_date:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"proposed_timestamp ({proposed_local_date}) does not match attendance_date ({payload.attendance_date}) in the employee's office timezone.",
            )

        # 5. Type-specific validation
        if payload.correction_type == "TIMESTAMP_ADJUSTMENT":
            if payload.original_event_id is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="original_event_id is required for TIMESTAMP_ADJUSTMENT.",
                )
            orig_event = db.get(AttendanceEvent, payload.original_event_id)
            if not orig_event or orig_event.employee_id != target_emp.id:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Original attendance event not found for this employee.",
                )

        # 6. Duplicate Prevention (Requirement 2)
        if payload.correction_type in ("MISSING_CHECK_IN", "MISSING_CHECK_OUT"):
            target_punch_type = "CHECK_IN" if payload.correction_type == "MISSING_CHECK_IN" else "CHECK_OUT"
            dt_local_start = datetime.combine(payload.attendance_date, time.min).replace(tzinfo=emp_tz)
            dt_local_end = datetime.combine(payload.attendance_date, time.max).replace(tzinfo=emp_tz)

            raw_punch_exists = db.scalar(
                select(AttendanceEvent).where(
                    AttendanceEvent.employee_id == target_emp.id,
                    AttendanceEvent.punch_type == target_punch_type,
                    AttendanceEvent.event_timestamp >= dt_local_start,
                    AttendanceEvent.event_timestamp <= dt_local_end,
                )
            )
            if raw_punch_exists:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Cannot request missing {target_punch_type}: A {target_punch_type} punch already exists for this employee on this date.",
                )

            approved_correction_exists = db.scalar(
                select(AttendanceCorrection).where(
                    AttendanceCorrection.employee_id == target_emp.id,
                    AttendanceCorrection.attendance_date == payload.attendance_date,
                    AttendanceCorrection.correction_type == payload.correction_type,
                    AttendanceCorrection.status == "APPROVED",
                )
            )
            if approved_correction_exists:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Cannot request missing {target_punch_type}: An approved {payload.correction_type} correction already exists for this employee on this date.",
                )

        # 7. Idempotency Check
        idemp_key = payload.idempotency_key.strip()
        existing_by_key = db.scalar(
            select(AttendanceCorrection).where(
                AttendanceCorrection.idempotency_key == idemp_key
            )
        )
        if existing_by_key:
            is_identical = (
                existing_by_key.employee_id == payload.employee_id
                and existing_by_key.attendance_date == payload.attendance_date
                and existing_by_key.correction_type == payload.correction_type
                and existing_by_key.proposed_timestamp == proposed_dt
                and existing_by_key.reason.strip() == payload.reason.strip()
                and existing_by_key.requested_by_user_id == current_user.id
            )
            if is_identical:
                return AttendanceService._build_correction_response(existing_by_key)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Idempotency key reuse with mismatched parameters.",
            )

        # 8. Check pending duplicate request
        existing_pending = db.scalar(
            select(AttendanceCorrection).where(
                AttendanceCorrection.employee_id == target_emp.id,
                AttendanceCorrection.attendance_date == payload.attendance_date,
                AttendanceCorrection.correction_type == payload.correction_type,
                AttendanceCorrection.status == "PENDING",
            )
        )
        if existing_pending:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A pending correction request of type '{payload.correction_type}' already exists for this date.",
            )

        # 9. Create correction & atomic audit log
        correction = AttendanceCorrection(
            employee_id=target_emp.id,
            attendance_date=payload.attendance_date,
            correction_type=payload.correction_type,
            proposed_timestamp=proposed_dt,
            original_event_id=payload.original_event_id if payload.correction_type == "TIMESTAMP_ADJUSTMENT" else None,
            reason=payload.reason.strip(),
            status="PENDING",
            requested_by_user_id=current_user.id,
            idempotency_key=idemp_key,
        )
        db.add(correction)

        try:
            db.flush()
            audit = AuditLog(
                actor_user_id=current_user.id,
                action="ATTENDANCE_CORRECTION_REQUESTED",
                target_type="attendance_correction",
                target_id=str(correction.id),
                before_state=None,
                after_state={
                    "correction_id": correction.id,
                    "employee_id": correction.employee_id,
                    "attendance_date": correction.attendance_date.isoformat(),
                    "correction_type": correction.correction_type,
                    "proposed_timestamp": correction.proposed_timestamp.isoformat(),
                    "status": "PENDING",
                    "reason": correction.reason,
                    "idempotency_key": correction.idempotency_key,
                },
                metadata_={
                    "client_ip": client_ip,
                    "requester_role": current_user.role,
                },
                ip_address=client_ip,
            )
            db.add(audit)
            db.commit()
            db.refresh(correction)
            return AttendanceService._build_correction_response(correction)
        except IntegrityError:
            db.rollback()
            collided = db.scalar(
                select(AttendanceCorrection).where(
                    AttendanceCorrection.idempotency_key == idemp_key
                )
            )
            if collided:
                is_identical = (
                    collided.employee_id == payload.employee_id
                    and collided.attendance_date == payload.attendance_date
                    and collided.correction_type == payload.correction_type
                    and collided.proposed_timestamp == proposed_dt
                    and collided.reason.strip() == payload.reason.strip()
                    and collided.requested_by_user_id == current_user.id
                )
                if is_identical:
                    return AttendanceService._build_correction_response(collided)
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Idempotency key reuse with mismatched parameters.",
                )
            raise
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def list_corrections(
        db: Session,
        current_user: User,
        employee_id: int | None = None,
        attendance_date: date | str | None = None,
        status_filter: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> AttendanceCorrectionListResponse:
        """Query paginated attendance corrections with role-based scoping and filters."""
        safe_limit = max(1, min(limit, 100))
        safe_offset = max(0, offset)

        query = select(AttendanceCorrection)

        if current_user.role == "EMPLOYEE":
            if current_user.employee_id is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User account is not linked to an employee profile.",
                )
            if employee_id is not None and employee_id != current_user.employee_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Employees may only view their own correction requests.",
                )
            query = query.where(AttendanceCorrection.employee_id == current_user.employee_id)
        elif current_user.role == "MANAGER":
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
            query = query.join(Employee, AttendanceCorrection.employee_id == Employee.id).where(
                Employee.department == manager_emp.department
            )
            if employee_id is not None:
                target_emp = db.scalar(
                    select(Employee).where(
                        Employee.id == employee_id,
                        Employee.deleted_at.is_(None),
                    )
                )
                if not target_emp or target_emp.department != manager_emp.department:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Access forbidden: You may only view corrections for employees within your authorized team.",
                    )
                query = query.where(AttendanceCorrection.employee_id == employee_id)
        elif current_user.role == "ADMIN":
            if employee_id is not None:
                query = query.where(AttendanceCorrection.employee_id == employee_id)
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized role for viewing corrections.",
            )

        if attendance_date:
            if isinstance(attendance_date, str):
                try:
                    att_d = datetime.strptime(attendance_date.strip(), "%Y-%m-%d").date()
                except ValueError:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"Invalid date format: '{attendance_date}'. Expected YYYY-MM-DD.",
                    )
            else:
                att_d = attendance_date
            query = query.where(AttendanceCorrection.attendance_date == att_d)

        if status_filter and status_filter.upper() != "ALL":
            st_clean = status_filter.strip().upper()
            if st_clean not in ("PENDING", "APPROVED", "REJECTED"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Invalid status filter: '{status_filter}'. Allowed: PENDING, APPROVED, REJECTED, ALL.",
                )
            query = query.where(AttendanceCorrection.status == st_clean)

        total_count = db.scalar(select(func.count()).select_from(query.subquery())) or 0
        corrections = db.scalars(
            query.order_by(AttendanceCorrection.created_at.desc(), AttendanceCorrection.id.desc())
            .offset(safe_offset)
            .limit(safe_limit)
        ).all()

        return AttendanceCorrectionListResponse(
            items=[AttendanceService._build_correction_response(c) for c in corrections],
            total=total_count,
            limit=safe_limit,
            offset=safe_offset,
        )

    @staticmethod
    def review_correction(
        db: Session,
        correction_id: int,
        payload: AttendanceCorrectionReview,
        current_user: User,
        client_ip: str | None = None,
    ) -> AttendanceCorrectionResponse:
        """Review (approve or reject) an attendance correction with anti-self-approval enforcement, approval-time revalidation, and audit logging."""
        # 1. Role verification
        if current_user.role == "EMPLOYEE":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Employees are not authorized to review attendance corrections.",
            )
        if current_user.role not in ("ADMIN", "MANAGER"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized role for attendance correction review.",
            )

        correction = db.scalar(
            select(AttendanceCorrection)
            .where(AttendanceCorrection.id == correction_id)
            .with_for_update(of=AttendanceCorrection)
        )
        if not correction:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attendance correction request not found.",
            )

        # 2. Manager department scoping
        if current_user.role == "MANAGER":
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
            target_emp = correction.employee
            if not target_emp or target_emp.department != manager_emp.department:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access forbidden: You may only review corrections for employees within your authorized team.",
                )

        # 3. Anti-Self-Approval Enforcement
        if current_user.id == correction.requested_by_user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Self-approval is strictly forbidden. The requester cannot review or approve their own correction request.",
            )
        if current_user.employee_id is not None and current_user.employee_id == correction.employee_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Self-approval is strictly forbidden. An employee cannot review or approve their own attendance correction.",
            )

        # 4. Status Check
        if correction.status != "PENDING":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Correction request has already been reviewed (current status: {correction.status}).",
            )

        # 5. Revalidate duplicate punches at approval time with transactional locking (Requirement 2)
        if payload.status == "APPROVED" and correction.correction_type in ("MISSING_CHECK_IN", "MISSING_CHECK_OUT"):
            target_punch_type = "CHECK_IN" if correction.correction_type == "MISSING_CHECK_IN" else "CHECK_OUT"

            # Resolve target employee timezone
            dt_start, dt_end = AttendanceService._get_attendance_day_boundaries(correction.attendance_date)
            day_range = Range(dt_start, dt_end, bounds="[]")
            assignment = db.scalar(
                select(EmployeeOfficeAssignment).where(
                    EmployeeOfficeAssignment.employee_id == correction.employee_id,
                    EmployeeOfficeAssignment.validity_range.overlaps(day_range),
                )
            )
            office = db.get(Office, assignment.office_id) if assignment else None
            off_tz_name = office.timezone if office and office.timezone else "Asia/Kolkata"
            try:
                emp_tz = zoneinfo.ZoneInfo(off_tz_name)
            except Exception:
                emp_tz = zoneinfo.ZoneInfo("Asia/Kolkata")

            dt_local_start = datetime.combine(correction.attendance_date, time.min).replace(tzinfo=emp_tz)
            dt_local_end = datetime.combine(correction.attendance_date, time.max).replace(tzinfo=emp_tz)

            raw_punch_exists = db.scalar(
                select(AttendanceEvent).where(
                    AttendanceEvent.employee_id == correction.employee_id,
                    AttendanceEvent.punch_type == target_punch_type,
                    AttendanceEvent.event_timestamp >= dt_local_start,
                    AttendanceEvent.event_timestamp <= dt_local_end,
                )
            )
            if raw_punch_exists:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Cannot approve correction: A {target_punch_type} punch already exists for this employee on this date.",
                )

            # Concurrent duplicate protection using with_for_update(of=AttendanceCorrection)
            approved_correction_exists = db.scalar(
                select(AttendanceCorrection).where(
                    AttendanceCorrection.employee_id == correction.employee_id,
                    AttendanceCorrection.attendance_date == correction.attendance_date,
                    AttendanceCorrection.correction_type == correction.correction_type,
                    AttendanceCorrection.status == "APPROVED",
                    AttendanceCorrection.id != correction.id,
                ).with_for_update(of=AttendanceCorrection)
            )
            if approved_correction_exists:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Cannot approve correction: An approved {correction.correction_type} correction already exists for this employee on this date.",
                )

        # 6. Apply review decision & atomic audit logging
        before_state = {
            "status": correction.status,
            "reviewed_by_user_id": correction.reviewed_by_user_id,
            "review_notes": correction.review_notes,
            "reviewed_at": correction.reviewed_at.isoformat() if correction.reviewed_at else None,
        }

        now_utc = datetime.now(timezone.utc)
        correction.status = payload.status
        correction.review_notes = payload.review_notes
        correction.reviewed_by_user_id = current_user.id
        correction.reviewed_at = now_utc

        action_name = (
            "ATTENDANCE_CORRECTION_APPROVED"
            if payload.status == "APPROVED"
            else "ATTENDANCE_CORRECTION_REJECTED"
        )

        audit = AuditLog(
            actor_user_id=current_user.id,
            action=action_name,
            target_type="attendance_correction",
            target_id=str(correction.id),
            before_state=before_state,
            after_state={
                "status": correction.status,
                "reviewed_by_user_id": current_user.id,
                "review_notes": correction.review_notes,
                "reviewed_at": correction.reviewed_at.isoformat(),
            },
            metadata_={
                "client_ip": client_ip,
                "employee_id": correction.employee_id,
                "attendance_date": correction.attendance_date.isoformat(),
                "correction_type": correction.correction_type,
            },
            ip_address=client_ip,
        )
        db.add(audit)

        try:
            db.commit()
            db.refresh(correction)
            return AttendanceService._build_correction_response(correction)
        except Exception:
            db.rollback()
            raise
