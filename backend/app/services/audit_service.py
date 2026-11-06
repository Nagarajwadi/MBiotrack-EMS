from sqlalchemy import func, inspect, select
from sqlalchemy.orm import Session, undefer

from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.audit_log import AuditLogListResponse, AuditLogResponse

_evolved_audit_support: dict[str, bool] = {}


def _db_supports_evolved_audit(db: Session) -> bool:
    """Inspect whether the active database session supports evolved audit columns (Slice 3+)."""
    try:
        bind = db.get_bind()
        engine = getattr(bind, "engine", bind)
        url_key = str(getattr(engine, "url", ""))
        if url_key not in _evolved_audit_support:
            insp = inspect(bind)
            cols = {c["name"] for c in insp.get_columns("audit_logs")}
            _evolved_audit_support[url_key] = "before_state" in cols
        return _evolved_audit_support[url_key]
    except Exception:
        return False


class AuditService:
    """Read-only service for querying system audit trail logs."""

    @staticmethod
    def get_audit_logs(
        db: Session,
        limit: int = 50,
        offset: int = 0,
        action: str | None = None,
        target_type: str | None = None,
        actor_user_id: int | None = None,
    ) -> AuditLogListResponse:
        """Query paginated audit logs with optional filters and actor email attribution.

        Uses an outer join to resolve actor email addresses without N+1 query overhead.
        Enforces deterministic ordering: created_at DESC, id DESC.
        """
        # Validate and clamp pagination parameters defensively
        safe_limit = max(1, min(limit, 100))
        safe_offset = max(0, offset)

        has_evolved = _db_supports_evolved_audit(db)

        # Base query joining AuditLog with User
        base_query = (
            select(AuditLog, User.email.label("actor_email"))
            .outerjoin(User, AuditLog.actor_user_id == User.id)
        )
        if has_evolved:
            base_query = base_query.options(
                undefer(AuditLog.before_state),
                undefer(AuditLog.after_state),
                undefer(AuditLog.db_session_user),
            )

        count_query = select(func.count(AuditLog.id))

        # Apply filters uniformly to both data and count queries
        if action and action.strip():
            norm_action = action.strip()
            base_query = base_query.where(AuditLog.action == norm_action)
            count_query = count_query.where(AuditLog.action == norm_action)

        if target_type and target_type.strip():
            norm_target_type = target_type.strip()
            base_query = base_query.where(AuditLog.target_type == norm_target_type)
            count_query = count_query.where(AuditLog.target_type == norm_target_type)

        if actor_user_id is not None:
            base_query = base_query.where(AuditLog.actor_user_id == actor_user_id)
            count_query = count_query.where(AuditLog.actor_user_id == actor_user_id)

        # Total count reflecting all applied filters
        total = db.scalar(count_query) or 0

        # Apply deterministic sorting and pagination
        paginated_query = (
            base_query
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .offset(safe_offset)
            .limit(safe_limit)
        )

        rows = db.execute(paginated_query).all()

        items = [
            AuditLogResponse(
                id=log.id,
                actor_user_id=log.actor_user_id,
                actor_email=actor_email,
                action=log.action,
                target_type=log.target_type,
                target_id=log.target_id,
                entity_name=log.entity_name,
                entity_id=log.entity_id,
                before_state=log.before_state if has_evolved else None,
                after_state=log.after_state if has_evolved else None,
                db_session_user=log.db_session_user if has_evolved else None,
                metadata=log.metadata_,
                ip_address=log.ip_address,
                created_at=log.created_at,
            )
            for log, actor_email in rows
        ]

        return AuditLogListResponse(
            items=items,
            total=total,
            limit=safe_limit,
            offset=safe_offset,
        )
