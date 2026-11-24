from datetime import datetime
from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.schemas.attendance import (
    AttendanceCorrectionCreate,
    AttendanceCorrectionListResponse,
    AttendanceCorrectionResponse,
    AttendanceCorrectionReview,
    AttendanceExceptionListResponse,
    AttendanceListResponse,
    AttendancePunchCreate,
    AttendancePunchResponse,
    AttendanceReportResponse,
    AttendanceReviewCreate,
    AttendanceReviewHistoryResponse,
    AttendanceReviewResponse,
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
    scope: str | None = Query(default=None, description="Scope filter ('team' scopes to manager's authorized department team)"),
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
        scope=scope,
    )


@router.get("/daily-summary", response_model=DailyAttendanceOperationsResponse)
@router.get("/daily-operations", response_model=DailyAttendanceOperationsResponse)
def get_daily_operations(
    date: str | None = Query(default=None, description="Operational date (YYYY-MM-DD); defaults to current date"),
    office_id: int | None = Query(default=None, description="Filter by physical or assigned office ID"),
    employee_id: int | None = Query(default=None, description="Filter by employee ID (restricted for EMPLOYEE role)"),
    limit: int = Query(default=50, ge=1, le=100, description="Max employee rows to return"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    scope: str | None = Query(default=None, description="Scope filter ('team' scopes to manager's authorized department team)"),
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
        scope=scope,
    )


@router.get("/team-summary", response_model=DailyAttendanceOperationsResponse)
@router.get("/team-operations", response_model=DailyAttendanceOperationsResponse)
def get_team_attendance(
    date: str | None = Query(default=None, description="Operational date (YYYY-MM-DD); defaults to current date"),
    office_id: int | None = Query(default=None, description="Filter by physical or assigned office ID"),
    employee_id: int | None = Query(default=None, description="Filter by employee ID within manager's authorized team"),
    limit: int = Query(default=50, ge=1, le=100, description="Max employee rows to return"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve Manager Team Attendance Overview scoped strictly to the manager's authorized department team.

    - MANAGER: Strictly scoped to employees in manager's linked department. Cross-team queries return HTTP 403.
    - ADMIN: Organization-wide team attendance visibility.
    - EMPLOYEE: Forbidden (HTTP 403).
    """
    return AttendanceService.get_daily_operations(
        db=db,
        current_user=current_user,
        date_str=date,
        office_id=office_id,
        employee_id=employee_id,
        limit=limit,
        offset=offset,
        scope="team",
    )


@router.get("/report", response_model=AttendanceReportResponse)
def get_attendance_report(
    start_date: str | None = Query(default=None, description="Start date (YYYY-MM-DD); defaults to 6 days prior to end_date"),
    end_date: str | None = Query(default=None, description="End date (YYYY-MM-DD); defaults to current UTC date"),
    office_id: int | None = Query(default=None, description="Filter by office ID"),
    department: str | None = Query(default=None, description="Filter by department name"),
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
        department=department,
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
    department: str | None = Query(default=None, description="Filter by department name"),
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
        department=department,
        employee_id=employee_id,
    )
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/exceptions", response_model=AttendanceExceptionListResponse)
def get_attendance_exceptions(
    date: str | None = Query(default=None, description="Operational date (YYYY-MM-DD); defaults to current date"),
    limit: int = Query(default=50, ge=1, le=100, description="Max exception rows to return"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve list of attendance exceptions requiring manager attention.

    - MANAGER: Scoped strictly to roaming exceptions within manager's authorized team department.
    - ADMIN: Organization-wide attendance exception visibility.
    - EMPLOYEE: Forbidden (HTTP 403).
    """
    return AttendanceService.get_attendance_exceptions(
        db=db,
        current_user=current_user,
        date_str=date,
        limit=limit,
        offset=offset,
    )


@router.post("/reviews", response_model=AttendanceReviewResponse, status_code=status.HTTP_201_CREATED)
def acknowledge_exception(
    payload: AttendanceReviewCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit an auditable manager acknowledgement for an attendance exception.

    - MANAGER: Scoped strictly to employees in manager's linked department.
    - ADMIN: Organization-wide review authority.
    - EMPLOYEE / Unlinked MANAGER: Forbidden (HTTP 403).
    - Requires presence of an authoritative roaming punch exception on the target attendance date.
    - Enforces idempotent retry safety and records atomic audit log entry.
    """
    client_ip = _extract_client_ip(request)
    return AttendanceService.acknowledge_exception(
        db=db,
        payload=payload,
        current_user=current_user,
        client_ip=client_ip,
    )


@router.get("/reviews", response_model=AttendanceReviewHistoryResponse)
def get_attendance_reviews(
    employee_id: int = Query(..., gt=0, description="Target employee ID"),
    date: str | None = Query(default=None, description="Filter by attendance date (YYYY-MM-DD)"),
    limit: int = Query(default=50, ge=1, le=100, description="Max review history rows"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve historical review actions for a specific employee.

    - MANAGER: Authorized only for employees within manager's linked department team.
    - ADMIN: Organization-wide review history visibility.
    - EMPLOYEE: Forbidden (HTTP 403).
    """
    return AttendanceService.get_attendance_reviews(
        db=db,
        current_user=current_user,
        employee_id=employee_id,
        attendance_date=date,
        limit=limit,
        offset=offset,
    )


@router.post("/corrections", response_model=AttendanceCorrectionResponse, status_code=status.HTTP_201_CREATED)
def create_attendance_correction(
    payload: AttendanceCorrectionCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit an attendance correction request.

    - Authenticated access required (EMPLOYEE for self, MANAGER for department, ADMIN for all).
    - Validates target employee, timezone, attendance date alignment, and prevents future timestamps.
    - Strictly prevents duplicate pending requests of the same type for the same date.
    - Idempotency key protected with atomic audit recording.
    """
    client_ip = _extract_client_ip(request)
    return AttendanceService.create_correction(
        db=db,
        payload=payload,
        current_user=current_user,
        client_ip=client_ip,
    )


@router.get("/corrections", response_model=AttendanceCorrectionListResponse)
def list_attendance_corrections(
    employee_id: int | None = Query(default=None, description="Filter by employee ID (restricted for EMPLOYEE role)"),
    date: str | None = Query(default=None, description="Filter by attendance date (YYYY-MM-DD)"),
    status: str | None = Query(default=None, description="Filter by status (PENDING, APPROVED, REJECTED, or ALL)"),
    limit: int = Query(default=50, ge=1, le=100, description="Max records to return"),
    offset: int = Query(default=0, ge=0, description="Records offset for pagination"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Query paginated attendance corrections with role-based scoping and filters.

    - EMPLOYEE: Can view only their own correction requests.
    - MANAGER: Can view correction requests for employees in their assigned department.
    - ADMIN: Organization-wide visibility across all correction requests.
    """
    return AttendanceService.list_corrections(
        db=db,
        current_user=current_user,
        employee_id=employee_id,
        attendance_date=date,
        status_filter=status,
        limit=limit,
        offset=offset,
    )


@router.post("/corrections/{correction_id}/review", response_model=AttendanceCorrectionResponse)
def review_attendance_correction(
    correction_id: int,
    payload: AttendanceCorrectionReview,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Review (approve or reject) an attendance correction request.

    - Accessible only by MANAGER (for department employees) or ADMIN.
    - Strictly enforces anti-self-approval: requester cannot approve own request, and employee cannot approve own correction.
    - Applies decision and writes atomic audit telemetry.
    """
    client_ip = _extract_client_ip(request)
    return AttendanceService.review_correction(
        db=db,
        correction_id=correction_id,
        payload=payload,
        current_user=current_user,
        client_ip=client_ip,
    )
