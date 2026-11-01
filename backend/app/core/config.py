from functools import lru_cache
from pathlib import Path
from typing import Any, ClassVar, Literal, Self

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(REPO_ROOT / ".env"), ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    PROJECT_NAME: str = "MBiotrack-EMS"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Authentication & Security
    DEV_SECRET_KEY_PLACEHOLDER: ClassVar[str] = (
        "dev-insecure-secret-key-change-in-production-min-32-chars"
    )
    SECRET_KEY: str = DEV_SECRET_KEY_PLACEHOLDER
    ALGORITHM: Literal["HS256"] = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    TOKEN_ISSUER: str = "mbiotrack-ems"

    # Audit Pseudonymization Secret (strictly separate from SECRET_KEY)
    AUDIT_HMAC_SECRET: str | None = None

    # Reverse Proxy & Client IP Trust (Disabled by default)
    TRUST_PROXY_HEADERS: bool = False
    TRUSTED_PROXIES: list[str] = []

    @field_validator("ALGORITHM", mode="before")
    @classmethod
    def validate_algorithm(cls, v: str) -> str:
        if v != "HS256":
            raise ValueError("Only 'HS256' algorithm is permitted.")
        return v

    @model_validator(mode="after")
    def validate_security_settings(self) -> Self:
        trimmed_key = (self.SECRET_KEY or "").strip()
        if len(trimmed_key) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters long.")

        if self.AUDIT_HMAC_SECRET and self.SECRET_KEY:
            if self.AUDIT_HMAC_SECRET.strip() == self.SECRET_KEY.strip():
                raise ValueError("AUDIT_HMAC_SECRET must not be identical to SECRET_KEY.")

        env_lower = (self.ENVIRONMENT or "").strip().lower()
        if env_lower in ("production", "prod"):
            if trimmed_key == self.DEV_SECRET_KEY_PLACEHOLDER:
                raise ValueError(
                    "Cannot use development placeholder SECRET_KEY in production. "
                    "A secure, high-entropy SECRET_KEY must be configured in environment."
                )
        return self

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug(cls, v: Any) -> bool:
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.strip().lower() in ("true", "1", "yes", "on", "debug", "dev", "development")
        return bool(v)

    # Explicit list of origins permitted to make cross-origin requests
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    # Database connection URLs; defaults to None so credentials/passwords are never hardcoded
    DATABASE_URL: str | None = None
    TEST_DATABASE_URL: str | None = None

    # Database connection pooling parameters (for PostgreSQL)
    DB_POOL_PRE_PING: bool = True
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_TIMEOUT: int = 30
    DB_ECHO: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
