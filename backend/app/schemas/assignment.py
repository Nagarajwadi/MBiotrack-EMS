from datetime import datetime, timezone
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class AssignmentCreate(BaseModel):
    employee_id: int = Field(gt=0, description="Target employee surrogate key")
    office_id: int = Field(gt=0, description="Target office surrogate key")
    valid_from: datetime = Field(description="Inclusive start timestamp (half-open lower bound)")
    valid_to: datetime = Field(description="Exclusive end timestamp (half-open upper bound)")
    is_primary: bool = Field(default=True, description="Whether this is the primary office assignment")

    @field_validator("valid_from", "valid_to")
    @classmethod
    def ensure_timezone_aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v

    @model_validator(mode="after")
    def validate_range_ordering(self) -> Self:
        if self.valid_to <= self.valid_from:
            raise ValueError("valid_to must be strictly greater than valid_from.")
        return self


class AssignmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    office_id: int
    valid_from: datetime
    valid_to: datetime
    is_primary: bool
    created_at: datetime
    updated_at: datetime
