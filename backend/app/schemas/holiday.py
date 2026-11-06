from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class HolidayCreate(BaseModel):
    """Schema for registering a new holiday."""

    holiday_date: date
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=1000)
    office_id: int | None = Field(
        default=None,
        description="Office ID for branch-specific holiday, or null for organization-wide",
    )
    is_optional: bool = Field(default=False)

    @field_validator("name")
    @classmethod
    def sanitize_name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Holiday name cannot be blank.")
        return cleaned

    @field_validator("description")
    @classmethod
    def sanitize_desc(cls, v: str | None) -> str | None:
        if v is not None:
            cleaned = v.strip()
            return cleaned if cleaned else None
        return None


class HolidayUpdate(BaseModel):
    """Schema for updating an existing holiday."""

    holiday_date: date | None = None
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=1000)
    office_id: int | None = None
    is_optional: bool | None = None

    @field_validator("name")
    @classmethod
    def sanitize_name(cls, v: str | None) -> str | None:
        if v is not None:
            cleaned = v.strip()
            if not cleaned:
                raise ValueError("Holiday name cannot be blank.")
            return cleaned
        return None

    @field_validator("description")
    @classmethod
    def sanitize_desc(cls, v: str | None) -> str | None:
        if v is not None:
            cleaned = v.strip()
            return cleaned if cleaned else None
        return None


class HolidayDetail(BaseModel):
    """Detailed holiday response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    holiday_date: date
    name: str
    description: str | None = None
    office_id: int | None = None
    office_name: str | None = None
    office_code: str | None = None
    is_optional: bool
    created_by_user_id: int
    created_at: datetime
    updated_at: datetime


class HolidayListResponse(BaseModel):
    """List response for holiday calendar."""

    items: list[HolidayDetail]
    total: int
