from collections.abc import Callable
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import TokenExpiredError, TokenInvalidError, decode_access_token
from app.db.session import get_db
from app.models.user import User

settings = get_settings()

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/login",
    auto_error=True,
)


def get_token_payload(token: str = Depends(oauth2_scheme)) -> dict[str, Any]:
    """Validate bearer token signature, expiration, issuer, and claims."""
    try:
        return decode_access_token(token)
    except TokenExpiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except TokenInvalidError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def get_current_user(
    token_payload: dict[str, Any] = Depends(get_token_payload),
    db: Session = Depends(get_db),
) -> User:
    """Resolve and return the current active user from PostgreSQL.
    
    Verifies that subject is a valid integer, the user exists in PostgreSQL,
    and the user account is active.
    """
    try:
        user_id = int(token_payload["sub"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate user identity.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account no longer exists.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive.",
        )
    return user


def require_role(*allowed_roles: str) -> Callable[..., Any]:
    """Dependency factory checking whether the authenticated user has an authorized role."""

    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        role = getattr(current_user, "role", None)
        if not role or role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operation not permitted for the current user role.",
            )
        return current_user

    return role_checker
