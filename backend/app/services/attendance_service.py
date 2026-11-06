import csv
from datetime import datetime, timedelta, timezone
import io
from typing import Any
from fastapi import HTTPException, status
from psycopg.types.range import Range
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.attendance_event import AttendanceEvent
from app.models.audit_log import AuditLog
from app.models.device import Device
from app.models.employee import Employee
from app.models.office import EmployeeOfficeAssignment, Office
from app.models.user import User
from app.schemas.attendance import (
    AttendanceEventDetail,
    AttendanceListResponse,
    AttendancePunchCreate,
    AttendancePunchResponse,
    AttendanceReportItem,
    AttendanceReportResponse,
    AttendanceReportSummary,
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
    ) -> AttendanceListResponse:
        """Query paginated attendance events with role-based visibility and practical filters."""
        safe_limit = max(1, min(limit, 100))
        safe_offset = max(0, offset)
        parsed_start = AttendanceService._parse_filter_datetime(start_date, is_end=False)
        parsed_end = AttendanceService._parse_filter_datetime(end_date, is_end=True)

        # 1. Role-based visibility enforcement
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

        dt_start = datetime(target_date.year, target_date.month, target_date.day, 0, 0, 0, 0, tzinfo=timezone.utc)
        dt_end = datetime(target_date.year, target_date.month, target_date.day, 23, 59, 59, 999999, tzinfo=timezone.utc)
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
        assigned_offices: dict[int, tuple[int, str, str]] = {}
        if eligible_emp_ids:
            assignments_query = (
                select(
                    EmployeeOfficeAssignment.employee_id,
                    Office.id.label("office_id"),
                    Office.name.label("office_name"),
                    Office.code.label("office_code"),
                )
                .join(Office, EmployeeOfficeAssignment.office_id == Office.id)
                .where(
                    EmployeeOfficeAssignment.employee_id.in_(eligible_emp_ids),
                    EmployeeOfficeAssignment.validity_range.overlaps(day_range),
                )
            )
            for emp_id, off_id, off_name, off_code in db.execute(assignments_query).all():
                assigned_offices[emp_id] = (off_id, off_name, off_code)

        # 7. Build employee-wise attendance records and calculate summary counters
        employee_items: list[EmployeeDailyAttendanceItem] = []
        employees_with_punches = 0
        employees_without_punches = 0
        requires_review_count = 0

        for emp in eligible_employees:
            emp_punches = punches_by_employee.get(emp.id, [])
            punch_count = len(emp_punches)
            roaming_count = sum(1 for p in emp_punches if p.is_roaming)
            has_roaming = roaming_count > 0

            first_punch = emp_punches[0].event_timestamp if punch_count > 0 else None
            last_punch = emp_punches[-1].event_timestamp if punch_count > 0 else None

            # Determine attendance review status
            if punch_count == 0:
                review_status = "NO_PUNCH"
                review_reason = None
                employees_without_punches += 1
            elif has_roaming:
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
                punches=emp_punches,
            )
            employee_items.append(item)

        # 8. Deterministic sort: REQUIRES_REVIEW first, then NORMAL (with punches), then NO_PUNCH
        status_priority = {"REQUIRES_REVIEW": 0, "NORMAL": 1, "NO_PUNCH": 2}
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
    def _resolve_report_items(
        db: Session,
        current_user: User,
        start_date_str: str | None = None,
        end_date_str: str | None = None,
        office_id: int | None = None,
        employee_id: int | None = None,
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

        # 2. Role scoping
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
                    detail="Employees may only access their own attendance data.",
                )
            target_employee_id = current_user.employee_id
        elif current_user.role in ("ADMIN", "MANAGER"):
            target_employee_id = employee_id
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized role for attendance queries.",
            )

        # 3. Query events within bounded date range
        events_query = (
            select(
                AttendanceEvent,
                Office.name.label("office_name"),
                Office.code.label("office_code"),
            )
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

        events_query = events_query.order_by(AttendanceEvent.event_timestamp.asc())
        event_rows = db.execute(events_query).all()

        # Group punches by (employee_id, date_str)
        punches_by_emp_date: dict[tuple[int, str], list[tuple[AttendanceEvent, str, str]]] = {}
        punched_emp_ids: set[int] = set()
        total_events = len(event_rows)
        total_roaming_punches = 0

        for ev, off_name, off_code in event_rows:
            if ev.is_roaming:
                total_roaming_punches += 1
            punched_emp_ids.add(ev.employee_id)
            d_str = ev.event_timestamp.strftime("%Y-%m-%d")
            punches_by_emp_date.setdefault((ev.employee_id, d_str), []).append((ev, off_name, off_code))

        # 4. Query established eligible employee population
        emp_query = select(Employee).where(
            (Employee.is_active.is_(True) & Employee.deleted_at.is_(None))
            | (Employee.id.in_(list(punched_emp_ids)))
        )

        if target_employee_id is not None:
            emp_query = emp_query.where(Employee.id == target_employee_id)
        elif office_id is not None:
            assigned_emp_subq = select(EmployeeOfficeAssignment.employee_id).where(
                EmployeeOfficeAssignment.office_id == office_id,
                EmployeeOfficeAssignment.validity_range.overlaps(date_range),
            )
            emp_query = emp_query.where(
                (Employee.id.in_(assigned_emp_subq)) | (Employee.id.in_(list(punched_emp_ids)))
            )

        emp_query = emp_query.order_by(Employee.employee_code.asc())
        eligible_employees = list(db.scalars(emp_query).all())
        eligible_emp_ids = [e.id for e in eligible_employees]

        # 5. Resolve primary office assignments for eligible employees in range
        assigned_offices: dict[int, tuple[int, str, str]] = {}
        if eligible_emp_ids:
            asgn_q = (
                select(
                    EmployeeOfficeAssignment.employee_id,
                    Office.id.label("office_id"),
                    Office.name.label("office_name"),
                    Office.code.label("office_code"),
                )
                .join(Office, EmployeeOfficeAssignment.office_id == Office.id)
                .where(
                    EmployeeOfficeAssignment.employee_id.in_(eligible_emp_ids),
                    EmployeeOfficeAssignment.validity_range.overlaps(date_range),
                )
            )
            for e_id, o_id, o_name, o_code in db.execute(asgn_q).all():
                assigned_offices[e_id] = (o_id, o_name, o_code)

        # 6. Build report items
        report_items: list[AttendanceReportItem] = []
        employees_with_punches = len(punched_emp_ids.intersection(eligible_emp_ids))
        employees_without_punches = 0

        for emp in eligible_employees:
            # Find all date punch groups for this employee
            emp_date_groups = [
                (d_str, group) for (e_id, d_str), group in punches_by_emp_date.items() if e_id == emp.id
            ]

            off_info = assigned_offices.get(emp.id)

            if emp_date_groups:
                # Add a report row for each date activity
                for d_str, group in emp_date_groups:
                    p_count = len(group)
                    roam_count = sum(1 for (ev, _, _) in group if ev.is_roaming)
                    has_roam = roam_count > 0
                    first_p = group[0][0].event_timestamp
                    last_p = group[-1][0].event_timestamp

                    # Office for this punch day: office of first punch, or assigned office
                    punch_off_id = group[0][0].office_id
                    punch_off_name = group[0][1] or (off_info[1] if off_info else None)
                    punch_off_code = group[0][2] or (off_info[2] if off_info else None)

                    status_str = "REQUIRES_REVIEW" if has_roam else "NORMAL"

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
                    )
                )

        # 7. Deterministic sort: date desc, employee_code asc
        report_items.sort(key=lambda x: (x.attendance_date, x.employee_code), reverse=True)

        summary = AttendanceReportSummary(
            start_date=start_str,
            end_date=end_str,
            total_events=total_events,
            employees_with_punches=employees_with_punches,
            employees_without_punches=employees_without_punches,
            roaming_punch_count=total_roaming_punches,
            total_records=len(report_items),
            eligible_employee_count=len(eligible_employees),
        )

        return report_items, summary

    @staticmethod
    def get_attendance_report(
        db: Session,
        current_user: User,
        start_date: str | None = None,
        end_date: str | None = None,
        office_id: int | None = None,
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
            ]
            writer.writerow(row)

        csv_bytes = output.getvalue().encode("utf-8-sig")
        filename = f"attendance_report_{summary.start_date}_{summary.end_date}.csv"
        return csv_bytes, filename
