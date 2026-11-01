import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
from pwdlib import PasswordHash

from app.core.config import get_settings

settings = get_settings()

# Initialize Argon2id password hash via pwdlib recommended configuration
_password_hash = PasswordHash.recommended()


class SecurityError(Exception):
    """Base exception for security and authentication failures."""

    pass


class TokenExpiredError(SecurityError):
    """Raised when an access token has expired."""

    pass


class TokenInvalidError(SecurityError):
    """Raised when an access token signature, issuer, or claim is invalid or malformed."""

    pass


def hash_password(password: str) -> str:
    """Hash a plaintext password using Argon2id with recommended parameters.

    Requires a minimum password length of 12 characters.
    """
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters long.")
    return _password_hash.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against an Argon2id hash."""
    if not plain_password or not hashed_password:
        return False
    try:
        return _password_hash.verify(plain_password, hashed_password)
    except Exception:
        return False


def create_access_token(
    subject: str | int,
    expires_delta: timedelta | None = None,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    """Generate an HS256-signed JWT access token.

    Claims:
    - sub: subject (user ID)
    - iat: issued-at timestamp (UTC)
    - exp: expiration timestamp (UTC, default 15 minutes)
    - jti: unique token identifier (UUID4)
    - iss: token issuer
    """
    now = datetime.now(timezone.utc)
    if expires_delta is not None:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    payload: dict[str, Any] = {
        "sub": str(subject),
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "jti": str(uuid.uuid4()),
        "iss": settings.TOKEN_ISSUER,
    }

    if extra_claims:
        # Prevent overriding critical standard claims
        protected_claims = {"sub", "iat", "exp", "jti", "iss"}
        for k, v in extra_claims.items():
            if k not in protected_claims:
                payload[k] = v

    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and validate a JWT access token.

    Validates signature, expiration, issuer, and required standard claims.
    Raises TokenExpiredError or TokenInvalidError on validation failure.
    """
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=["HS256"],
            issuer=settings.TOKEN_ISSUER,
            options={"require": ["sub", "exp", "iat", "jti", "iss"]},
        )
        return payload
    except ExpiredSignatureError as exc:
        raise TokenExpiredError("Token has expired.") from exc
    except InvalidTokenError as exc:
        raise TokenInvalidError(f"Invalid token: {exc}") from exc

