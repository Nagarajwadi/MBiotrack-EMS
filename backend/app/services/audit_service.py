from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.audit_log import AuditLogListResponse, AuditLogResponse


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

        # Base query joining AuditLog with User
        base_query = (
            select(AuditLog, User.email.label("actor_email"))
            .outerjoin(User, AuditLog.actor_user_id == User.id)
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

