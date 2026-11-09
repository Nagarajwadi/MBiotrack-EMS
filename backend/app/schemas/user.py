import re
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")


class UserCreate(BaseModel):
    employee_id: int = Field(gt=0, description="Target employee ID to link account to")
    role: Literal["EMPLOYEE", "MANAGER"] = Field(
        description="Assigned role: EMPLOYEE or MANAGER (ADMIN not permitted through standard provisioning)"
    )
    initial_password: str = Field(
        min_length=8, max_length=128, description="Initial plaintext password"
    )
    email: str | None = Field(
        default=None, max_length=255, description="Optional override email address"
    )

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str | None) -> str | None:
        if v is None:
            return None
        trimmed = v.strip()
        if not trimmed:
            return None
        if not EMAIL_REGEX.match(trimmed):
            raise ValueError("Invalid email format.")
        return trimmed.lower()


class UserStatusUpdate(BaseModel):
    is_active: bool = Field(description="Desired account active state")


class PasswordResetRequest(BaseModel):
    new_password: str = Field(
        min_length=12,
        max_length=128,
        description="New temporary plaintext password (minimum 12 characters for Argon2id)",
    )


class UserAccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int | None
    full_name: str
    email: str
    role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    employee_code: str | None = None
    department: str | None = None
