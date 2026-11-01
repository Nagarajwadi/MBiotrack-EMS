import re
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator

# Practical application-level email format validation (not fully RFC 5322 compliant)
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")


class LoginRequest(BaseModel):
    """Payload for user authentication."""

    email: str = Field(max_length=255, description="User login email address")
    password: str = Field(min_length=1, max_length=128, description="User plaintext password")

    @field_validator("email")
    @classmethod
    def validate_and_normalize_email(cls, v: str) -> str:
        trimmed = v.strip()
        if not EMAIL_REGEX.match(trimmed):
            raise ValueError("Invalid email format.")
        return trimmed.lower()


class TokenResponse(BaseModel):
    """Access token response payload."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int = 900  # 15 minutes in seconds


class LogoutResponse(BaseModel):
    """Stateless logout confirmation."""

    message: str = "Logged out successfully. Discard token on client."


class UserResponse(BaseModel):
    """Sanitized user profile response. Explicitly excludes password_hash and secrets."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int | None
    full_name: str
    email: str
    role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

