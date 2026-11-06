from datetime import datetime, timedelta, timezone
from pydantic import BaseModel, ConfigDict, Field, field_validator


class AttendancePunchCreate(BaseModel):
    """Payload schema for normalized attendance punch ingestion."""

    employee_id: int | None = Field(
        default=None,
        description="Target employee ID (required for admin/manager, defaults to user's profile for employees)",
    )
    device_id: int = Field(
        gt=0,
        description="Physical biometric terminal device ID recording the punch",
    )
    punch_type: str = Field(
        description="Punch classification: CHECK_IN or CHECK_OUT",
    )
    punch_time: datetime | None = Field(
        default=None,
        description="Timestamp of the physical punch (optional; defaults to server current time)",
    )
    idempotency_key: str | None = Field(
        default=None,
        max_length=100,
        description="Optional client-supplied idempotency key for duplicate prevention",
    )

    @field_validator("punch_type")
    @classmethod
    def validate_punch_type(cls, v: str) -> str:
        norm = v.strip().upper()
        if norm not in ("CHECK_IN", "CHECK_OUT"):
            raise ValueError("punch_type must be either 'CHECK_IN' or 'CHECK_OUT'")
        return norm

    @field_validator("punch_time")
    @classmethod
    def validate_punch_time(cls, v: datetime | None) -> datetime | None:
        if v is not None:
            now = datetime.now(timezone.utc)
            if v.tzinfo is None:
                v = v.replace(tzinfo=timezone.utc)
            # Allow at most 5 minutes clock skew into the future
            if v > now + timedelta(minutes=5):
                raise ValueError("punch_time cannot be in the future")
        return v


class AttendancePunchResponse(BaseModel):
    """Normalized attendance punch response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    device_id: int
    office_id: int
    punch_type: str
    event_timestamp: datetime
    is_roaming: bool
    idempotency_key: str | None = None
    actor_user_id: int
    created_at: datetime
    notes: str | None = None


class AttendanceEventDetail(BaseModel):
    """Rich attendance event item for UI display including denormalized descriptors."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    employee_code: str | None = None
    employee_name: str | None = None
    department: str | None = None
    device_id: int
    device_name: str | None = None
    device_code: str | None = None
    office_id: int
    office_name: str | None = None
    office_code: str | None = None
    punch_type: str
    event_timestamp: datetime
    is_roaming: bool
    idempotency_key: str | None = None
    actor_user_id: int
    created_at: datetime
    notes: str | None = None


class AttendanceListResponse(BaseModel):
    """Paginated response envelope for attendance record queries."""

    items: list[AttendanceEventDetail]
    total: int = Field(ge=0, description="Total count matching applied filters")
    limit: int = Field(ge=1, le=100, description="Page size limit")
    offset: int = Field(ge=0, description="Pagination offset")


class DailyPunchDetail(BaseModel):
    """Individual punch event for daily inspection."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    punch_type: str
    event_timestamp: datetime
    device_id: int
    device_name: str | None = None
    device_code: str | None = None
    office_id: int
    office_name: str | None = None
    office_code: str | None = None
    is_roaming: bool


class EmployeeDailyAttendanceItem(BaseModel):
    """Employee-wise aggregated attendance item on the selected date."""

    model_config = ConfigDict(from_attributes=True)

    employee_id: int
    employee_code: str
    employee_name: str
    department: str | None = None
    assigned_office_id: int | None = None
    assigned_office_name: str | None = None
    assigned_office_code: str | None = None
    punch_count: int = Field(ge=0, description="Total punch count recorded on selected date")
    first_punch: datetime | None = None
    last_punch: datetime | None = None
    has_roaming: bool = False
    roaming_count: int = Field(ge=0, description="Count of roaming punches on selected date")
    review_status: str = Field(
        description="Attendance status: 'NO_PUNCH', 'NORMAL', or 'REQUIRES_REVIEW'"
    )
    review_reason: str | None = None
    punches: list[DailyPunchDetail] = []


class DailyAttendanceSummary(BaseModel):
    """Aggregated daily metrics for the operations overview."""

    date: str = Field(description="Selected operational date (YYYY-MM-DD)")
    total_events: int = Field(ge=0, description="Total recorded punch events on the selected date")
    employees_with_punches: int = Field(ge=0, description="Unique employees with at least one punch recorded")
    employees_without_punches: int = Field(
        ge=0,
        description="Eligible employees with no punch recorded (neutral label 'No punch recorded')",
    )
    requires_review_count: int = Field(
        ge=0,
        description="Employees whose attendance requires review (e.g., roaming punches)",
    )
    roaming_punch_count: int = Field(ge=0, description="Total roaming punch events on the selected date")
    eligible_employee_count: int = Field(ge=0, description="Total established eligible employee population")


class DailyAttendanceOperationsResponse(BaseModel):
    """Complete response envelope for Daily Attendance Operations."""

    summary: DailyAttendanceSummary
    employees: list[EmployeeDailyAttendanceItem]
    total_employees: int = Field(ge=0, description="Total employee rows in the established population")
    limit: int = Field(ge=1, le=100, description="Page size limit")
    offset: int = Field(ge=0, description="Records offset for pagination")


class AttendanceReportItem(BaseModel):
    """Line item in attendance date-range report."""

    model_config = ConfigDict(from_attributes=True)

    employee_id: int
    employee_code: str
    employee_name: str
    department: str | None = None
    office_id: int | None = None
    office_name: str | None = None
    office_code: str | None = None
    attendance_date: str = Field(description="Attendance date (YYYY-MM-DD or date range for non-punched employees)")
    punch_count: int = Field(ge=0, description="Number of recorded punches on this date")
    first_punch: datetime | None = None
    last_punch: datetime | None = None
    has_roaming: bool = False
    roaming_count: int = Field(ge=0, description="Number of roaming punches on this date")
    status: str = Field(description="Attendance status: 'NORMAL', 'REQUIRES_REVIEW', or 'NO_PUNCH'")


class AttendanceReportSummary(BaseModel):
    """Aggregate statistics for the selected report period."""

    start_date: str = Field(description="Report period start date (YYYY-MM-DD)")
    end_date: str = Field(description="Report period end date (YYYY-MM-DD)")
    total_events: int = Field(ge=0, description="Total punch events recorded during the period")
    employees_with_punches: int = Field(ge=0, description="Unique employees with recorded punches during the period")
    employees_without_punches: int = Field(
        ge=0,
        description="Eligible employees with no recorded punches during the period (neutral label)",
    )
    roaming_punch_count: int = Field(ge=0, description="Total roaming punch events recorded during the period")
    total_records: int = Field(ge=0, description="Total report line items generated")
    eligible_employee_count: int = Field(ge=0, description="Total eligible employee population in scope")


class AttendanceReportResponse(BaseModel):
    """Response envelope for attendance date-range reports."""

    summary: AttendanceReportSummary
    items: list[AttendanceReportItem]
    total_items: int = Field(ge=0, description="Total report items matching filters")
    limit: int = Field(ge=1, le=100, description="Page size limit")
    offset: int = Field(ge=0, description="Records offset for pagination")
