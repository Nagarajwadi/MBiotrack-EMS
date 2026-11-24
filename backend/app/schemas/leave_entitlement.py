from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


VALID_PAID_LEAVE_TYPES = {"ANNUAL", "SICK", "CASUAL"}
ALL_LEAVE_TYPES = {"ANNUAL", "SICK", "CASUAL", "UNPAID"}


class LeaveEntitlementDefaultCreate(BaseModel):
    year: int = Field(..., ge=2000, le=2100, description="Calendar year (Jan 1 - Dec 31)")
    leave_type: str = Field(..., description="One of: ANNUAL, SICK, CASUAL")
    allocated_days: int = Field(..., ge=0, description="Annual allocated working days (must be >= 0)")

    @field_validator("leave_type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        cleaned = v.strip().upper()
        if cleaned not in VALID_PAID_LEAVE_TYPES:
            raise ValueError(
                f"Invalid leave_type: '{v}'. Must be one of: {', '.join(sorted(VALID_PAID_LEAVE_TYPES))}."
            )
        return cleaned


class LeaveEntitlementDefaultUpdate(BaseModel):
    allocated_days: int = Field(..., ge=0, description="Updated annual allocated working days")


class LeaveEntitlementDefaultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    year: int
    leave_type: str
    allocated_days: int
    created_by_user_id: int | None = None
    created_at: datetime
    updated_at: datetime


class EmployeeLeaveEntitlementCreate(BaseModel):
    employee_id: int = Field(..., description="Target employee database ID")
    year: int = Field(..., ge=2000, le=2100, description="Calendar year (Jan 1 - Dec 31)")
    leave_type: str = Field(..., description="One of: ANNUAL, SICK, CASUAL")
    allocated_days: int = Field(..., ge=0, description="Annual override allocated working days (must be >= 0)")

    @field_validator("leave_type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        cleaned = v.strip().upper()
        if cleaned not in VALID_PAID_LEAVE_TYPES:
            raise ValueError(
                f"Invalid leave_type: '{v}'. Must be one of: {', '.join(sorted(VALID_PAID_LEAVE_TYPES))}."
            )
        return cleaned


class EmployeeLeaveEntitlementUpdate(BaseModel):
    allocated_days: int = Field(..., ge=0, description="Updated annual override allocated working days")


class EmployeeLeaveEntitlementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    employee_code: str | None = None
    employee_name: str | None = None
    department: str | None = None
    year: int
    leave_type: str
    allocated_days: int
    created_by_user_id: int | None = None
    created_at: datetime
    updated_at: datetime


class LeaveTypeBalance(BaseModel):
    leave_type: str
    is_enforced: bool
    allocated_days: int | None = None
    used_days: int
    pending_days: int
    available_days: int | None = None
    is_override: bool = False


class EmployeeLeaveBalanceSummary(BaseModel):
    employee_id: int
    employee_code: str | None = None
    employee_name: str | None = None
    department: str | None = None
    year: int
    balances: list[LeaveTypeBalance]


class LeaveBalanceLedgerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    leave_request_id: int
    employee_id: int
    year: int
    leave_type: str
    transaction_type: str
    days: int
    created_by_user_id: int | None = None
    created_at: datetime
