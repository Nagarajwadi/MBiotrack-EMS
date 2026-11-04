from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict, Field, field_validator

SENSITIVE_KEY_PATTERNS = {
    "password",
    "password_hash",
    "token",
    "secret",
    "access_token",
    "key",
    "authorization",
    "cookie",
    "credential",
    "private",
}


def sanitize_audit_metadata(meta: Any) -> dict[str, Any] | None:
    """Recursively scrub sensitive keys from audit log metadata."""
    if not isinstance(meta, dict):
        return None
    sanitized: dict[str, Any] = {}
    for k, v in meta.items():
        k_str = str(k)
        k_lower = k_str.lower()
        if any(pattern in k_lower for pattern in SENSITIVE_KEY_PATTERNS):
            sanitized[k_str] = "[REDACTED]"
        elif isinstance(v, dict):
            sanitized[k_str] = sanitize_audit_metadata(v)
        elif isinstance(v, list):
            sanitized[k_str] = [
                sanitize_audit_metadata(item) if isinstance(item, dict) else item
                for item in v
            ]
        else:
            sanitized[k_str] = v
    return sanitized


class AuditLogResponse(BaseModel):
    """Sanitized audit log entry representation for administrators."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    actor_user_id: int | None = None
    actor_email: str | None = None
    action: str
    target_type: str
    target_id: str | None = None
    metadata: dict[str, Any] | None = None
    ip_address: str | None = None
    created_at: datetime

    @field_validator("metadata", mode="before")
    @classmethod
    def scrub_metadata(cls, v: Any) -> dict[str, Any] | None:
        return sanitize_audit_metadata(v)


class AuditLogListResponse(BaseModel):
    """Paginated list envelope for audit log queries."""

    items: list[AuditLogResponse]
    total: int = Field(ge=0, description="Total count of records matching filters")
    limit: int = Field(ge=1, le=100, description="Applied page size limit")
    offset: int = Field(ge=0, description="Applied pagination offset")

