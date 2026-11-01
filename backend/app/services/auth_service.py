import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, hash_password, verify_password
from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse, UserResponse

settings = get_settings()

# Syntactically valid Argon2id hash derived once at module load for constant-time dummy verification
_DUMMY_ARGON2ID_HASH: str = hash_password("DummyNonExistentUserSecret123!")

RATE_LIMIT_WINDOW_MINUTES = 15
RATE_LIMIT_MAX_ATTEMPTS = 5


def _pseudonymize_email(email: str) -> str | None:
    """Derive privacy-preserving HMAC-SHA256 fingerprint if AUDIT_HMAC_SECRET is set.
    
    If AUDIT_HMAC_SECRET is not configured, returns None to avoid storing raw emails.
    """
    if not settings.AUDIT_HMAC_SECRET:
        return None
    return hmac.new(
        settings.AUDIT_HMAC_SECRET.encode("utf-8"),
        email.strip().lower().encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:32]


class AuthService:
    """Service handling authentication, atomic rate limiting, and audit trail integration."""

    @staticmethod
    def _acquire_ip_advisory_lock(db: Session, client_ip: str) -> None:
        """Acquire a 64-bit transaction-scoped PostgreSQL advisory lock on the client IP."""
        db.execute(
            select(func.pg_advisory_xact_lock(func.hashtextextended(client_ip, 0)))
        )

    @staticmethod
    def _check_rate_limit(db: Session, client_ip: str) -> None:
        """Evaluate failed attempts under lock; rollback to release lock if limit is reached."""
        window_start = datetime.now(timezone.utc) - timedelta(minutes=RATE_LIMIT_WINDOW_MINUTES)

        failed_count = (
            db.scalar(
                select(func.count(AuditLog.id)).where(
                    AuditLog.action == "AUTH_LOGIN_FAILED",
                    AuditLog.ip_address == client_ip,
                    AuditLog.created_at >= window_start,
                )
            )
            or 0
        )

        if failed_count >= RATE_LIMIT_MAX_ATTEMPTS:
            oldest_in_window = db.scalar(
                select(AuditLog.created_at)
                .where(
                    AuditLog.action == "AUTH_LOGIN_FAILED",
                    AuditLog.ip_address == client_ip,
                    AuditLog.created_at >= window_start,
                )
                .order_by(AuditLog.created_at.asc())
                .limit(1)
            )
            retry_after = RATE_LIMIT_WINDOW_MINUTES * 60
            if oldest_in_window:
                elapsed = (datetime.now(timezone.utc) - oldest_in_window).total_seconds()
                retry_after = max(1, int((RATE_LIMIT_WINDOW_MINUTES * 60) - elapsed))

            # Rollback ends read transaction and immediately releases advisory lock
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed login attempts. Please try again later.",
                headers={"Retry-After": str(retry_after)},
            )

    @staticmethod
    def _record_failed_attempt(
        db: Session, client_ip: str, email: str, reason: str = "invalid_credentials"
    ) -> None:
        """Commit failed login audit entry, persisting event and releasing advisory lock."""
        audit_entry = AuditLog(
            actor_user_id=None,
            action="AUTH_LOGIN_FAILED",
            target_type="auth",
            target_id=_pseudonymize_email(email),
            ip_address=client_ip,
            metadata_={"reason": reason},
        )
        db.add(audit_entry)
        db.commit()

    @staticmethod
    def _record_successful_login(db: Session, client_ip: str, user: User) -> None:
        """Commit successful login audit entry, persisting event and releasing advisory lock."""
        audit_entry = AuditLog(
            actor_user_id=user.id,
            action="AUTH_LOGIN_SUCCESS",
            target_type="user",
            target_id=str(user.id),
            ip_address=client_ip,
            metadata_={"role": user.role},
        )
        db.add(audit_entry)
        db.commit()

    @staticmethod
    def authenticate_user(db: Session, payload: LoginRequest, client_ip: str) -> TokenResponse:
        """Authenticate user under atomic advisory lock and issue JWT access token."""
        norm_email = payload.email.strip().lower()

        try:
            # 1. Acquire 64-bit advisory lock on client IP
            AuthService._acquire_ip_advisory_lock(db, client_ip)

            # 2. Check rate limit under lock
            AuthService._check_rate_limit(db, client_ip)

            # 3. Query user case-insensitively using functional index
            user = db.scalar(
                select(User).where(func.lower(User.email) == norm_email)
            )

            # 4. Nonexistent user: execute dummy Argon2id hash and record failure
            if user is None:
                verify_password(payload.password, _DUMMY_ARGON2ID_HASH)
                AuthService._record_failed_attempt(
                    db, client_ip, norm_email, reason="user_not_found"
                )
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid email or password.",
                    headers={"WWW-Authenticate": "Bearer"},
                )

            # 5. Incorrect password: record failure
            if not verify_password(payload.password, user.password_hash):
                AuthService._record_failed_attempt(
                    db, client_ip, norm_email, reason="incorrect_password"
                )
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid email or password.",
                    headers={"WWW-Authenticate": "Bearer"},
                )

            # 6. Inactive account: account enumeration protection (generic 401 response)
            if not user.is_active:
                AuthService._record_failed_attempt(
                    db, client_ip, norm_email, reason="account_inactive"
                )
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid email or password.",
                    headers={"WWW-Authenticate": "Bearer"},
                )

            # 7. Successful login: commit audit log FIRST
            AuthService._record_successful_login(db, client_ip, user)

            # 8. Issue token ONLY after audit write succeeds
            token = create_access_token(subject=user.id)

            return TokenResponse(
                access_token=token,
                token_type="bearer",
                expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            )
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def get_current_user_profile(user: User) -> UserResponse:
        """Return sanitized user profile excluding password_hash."""
        return UserResponse.model_validate(user)

