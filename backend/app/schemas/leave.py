from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


VALID_LEAVE_TYPES = {"ANNUAL", "SICK", "CASUAL", "UNPAID"}
VALID_LEAVE_STATUSES = {"PENDING", "APPROVED", "REJECTED", "CANCELLED"}


class LeaveRequestCreate(BaseModel):
    """Schema for submitting a leave request."""

    start_date: date
    end_date: date
    leave_type: str = Field(description="One of: ANNUAL, SICK, CASUAL, UNPAID")
    reason: str | None = Field(default=None, max_length=1000)
    employee_id: int | None = Field(
        default=None,
        description="Optional for Admin/Manager; ignored/enforced for Employee",
    )

    @field_validator("leave_type")
    @classmethod
    def validate_leave_type(cls, v: str) -> str:
        cleaned = v.strip().upper()
        if cleaned not in VALID_LEAVE_TYPES:
            raise ValueError(
                f"Invalid leave_type: '{v}'. Must be one of: {', '.join(sorted(VALID_LEAVE_TYPES))}."
            )
        return cleaned

    @field_validator("reason")
    @classmethod
    def sanitize_reason(cls, v: str | None) -> str | None:
        if v is not None:
            cleaned = v.strip()
            return cleaned if cleaned else None
        return None

    @model_validator(mode="after")
    def validate_date_order(self) -> "LeaveRequestCreate":
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date.")
        return self


class LeaveRequestReview(BaseModel):
    """Schema for approving or rejecting a pending leave request."""

    decision: Literal["APPROVED", "REJECTED"]
    decision_notes: str | None = Field(default=None, max_length=1000)

    @field_validator("decision_notes")
    @classmethod
    def sanitize_notes(cls, v: str | None) -> str | None:
        if v is not None:
            cleaned = v.strip()
            return cleaned if cleaned else None
        return None


class LeaveRequestDetail(BaseModel):
    """Detailed leave request response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    employee_code: str | None = None
    employee_name: str | None = None
    department: str | None = None
    start_date: date
    end_date: date
    leave_type: str
    reason: str | None = None
    status: str
    decision_by_user_id: int | None = None
    decision_by_user_name: str | None = None
    decision_notes: str | None = None
    decided_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class LeaveRequestListResponse(BaseModel):
    """Paginated list response for leave requests."""

    items: list[LeaveRequestDetail]
    total: int
    limit: int
    offset: int
