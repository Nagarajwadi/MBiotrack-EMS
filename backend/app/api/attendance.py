from datetime import datetime
from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.schemas.attendance import (
    AttendanceListResponse,
    AttendancePunchCreate,
    AttendancePunchResponse,
    AttendanceReportResponse,
    DailyAttendanceOperationsResponse,
)
from app.api.auth import get_client_ip
from app.services.attendance_service import AttendanceService

router = APIRouter(prefix="/api/v1/attendance", tags=["Attendance Ingestion"])


def _extract_client_ip(request: Request) -> str:
    """Extract client IP address defensively using centralized resolver."""
    return get_client_ip(request)


@router.post("/punch", response_model=AttendancePunchResponse, status_code=status.HTTP_201_CREATED)
def record_punch(
    payload: AttendancePunchCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ingest and record a normalized attendance punch event with strict server-side validation.

    - Authenticated access required (ADMIN, MANAGER, or EMPLOYEE).
    - Employees can only punch for themselves.
    - Server verifies active status of employee, device, and office.
    - Evaluates effective employee-office assignment and flags out-of-assignment roaming under GOV-08.
    - Strictly server-controls actor attribution and event timestamp.
    - Enforces duplicate/idempotency protection and writes atomic audit telemetry.
    """
    client_ip = _extract_client_ip(request)
    return AttendanceService.record_punch(
        db=db,
        payload=payload,
        current_user=current_user,
        client_ip=client_ip,
    )


@router.get("", response_model=AttendanceListResponse)
@router.get("/events", response_model=AttendanceListResponse)
def get_attendance(
    employee_id: int | None = Query(default=None, description="Filter by employee ID (restricted for EMPLOYEE role)"),
    office_id: int | None = Query(default=None, description="Filter by office ID"),
    device_id: int | None = Query(default=None, description="Filter by device ID"),
    punch_type: str | None = Query(default=None, description="Filter by punch type (CHECK_IN, CHECK_OUT)"),
    start_date: str | None = Query(default=None, description="Filter events on or after this timestamp (ISO 8601 or YYYY-MM-DD)"),
    end_date: str | None = Query(default=None, description="Filter events on or before this timestamp (ISO 8601 or YYYY-MM-DD)"),
    is_roaming: bool | None = Query(default=None, description="Filter by roaming status"),
    limit: int = Query(default=50, ge=1, le=100, description="Max records to return"),
    offset: int = Query(default=0, ge=0, description="Records offset for pagination"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Query paginated attendance records with role-based visibility and practical filters.

    - EMPLOYEE: Can view only their own attendance records.
    - MANAGER: Can view attendance records across employees they are authorized to manage.
    - ADMIN: Organization-wide attendance visibility.
    """
    return AttendanceService.get_attendance_records(
        db=db,
        current_user=current_user,
        employee_id=employee_id,
        office_id=office_id,
        device_id=device_id,
        punch_type=punch_type,
        start_date=start_date,
        end_date=end_date,
        is_roaming=is_roaming,
        limit=limit,
        offset=offset,
    )


@router.get("/daily-summary", response_model=DailyAttendanceOperationsResponse)
@router.get("/daily-operations", response_model=DailyAttendanceOperationsResponse)
def get_daily_operations(
    date: str | None = Query(default=None, description="Operational date (YYYY-MM-DD); defaults to current date"),
    office_id: int | None = Query(default=None, description="Filter by physical or assigned office ID"),
    employee_id: int | None = Query(default=None, description="Filter by employee ID (restricted for EMPLOYEE role)"),
    limit: int = Query(default=50, ge=1, le=100, description="Max employee rows to return"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve Daily Attendance Operations view including high-level summary metrics and employee-level punch aggregates.

    - EMPLOYEE: Can view only their own daily attendance.
    - MANAGER: Can view daily attendance across authorized employee population.
    - ADMIN: Organization-wide daily operations and summary metrics.
    """
    return AttendanceService.get_daily_operations(
        db=db,
        current_user=current_user,
        date_str=date,
        office_id=office_id,
        employee_id=employee_id,
        limit=limit,
        offset=offset,
    )


@router.get("/report", response_model=AttendanceReportResponse)
def get_attendance_report(
    start_date: str | None = Query(default=None, description="Start date (YYYY-MM-DD); defaults to 6 days prior to end_date"),
    end_date: str | None = Query(default=None, description="End date (YYYY-MM-DD); defaults to current UTC date"),
    office_id: int | None = Query(default=None, description="Filter by office ID"),
    employee_id: int | None = Query(default=None, description="Filter by employee ID (restricted for EMPLOYEE role)"),
    limit: int = Query(default=50, ge=1, le=100, description="Max report rows to return"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate date-range attendance report with summary metrics and employee-level punch records.

    - Range is limited to a maximum of 31 days to ensure predictable query bounds.
    - EMPLOYEE: Can view only their own attendance data.
    - MANAGER: Organization-wide read-only attendance view across active employees.
    - ADMIN: Full administrative attendance reporting access.
    """
    return AttendanceService.get_attendance_report(
        db=db,
        current_user=current_user,
        start_date=start_date,
        end_date=end_date,
        office_id=office_id,
        employee_id=employee_id,
        limit=limit,
        offset=offset,
    )


@router.get("/report/export-csv")
@router.get("/export")
def export_attendance_report_csv(
    start_date: str | None = Query(default=None, description="Start date (YYYY-MM-DD)"),
    end_date: str | None = Query(default=None, description="End date (YYYY-MM-DD)"),
    office_id: int | None = Query(default=None, description="Filter by office ID"),
    employee_id: int | None = Query(default=None, description="Filter by employee ID (restricted for EMPLOYEE role)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download attendance date-range report as a UTF-8 with BOM formatted CSV with formula neutralization.

    - Protects against formula injection by prefixing formula triggers with a single quote.
    - Enforces identical role permissions and date-range limits as the JSON report.
    """
    csv_bytes, filename = AttendanceService.export_attendance_report_csv(
        db=db,
        current_user=current_user,
        start_date=start_date,
        end_date=end_date,
        office_id=office_id,
        employee_id=employee_id,
    )
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
