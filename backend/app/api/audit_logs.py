from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import require_role
from app.models.user import User
from app.schemas.audit_log import AuditLogListResponse
from app.services.audit_service import AuditService

router = APIRouter(prefix="/api/v1/audit-logs", tags=["Audit Trail"])


@router.get(
    "",
    response_model=AuditLogListResponse,
    status_code=status.HTTP_200_OK,
    summary="Query audit trail logs (Administrator only)",
)
def get_audit_logs(
    limit: int = Query(default=50, ge=1, le=100, description="Page size limit (1-100)"),
    offset: int = Query(default=0, ge=0, description="Pagination offset (>= 0)"),
    action: str | None = Query(default=None, description="Filter by audit action name"),
    target_type: str | None = Query(default=None, description="Filter by target resource type"),
    actor_user_id: int | None = Query(default=None, description="Filter by actor user ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
) -> AuditLogListResponse:
    """Retrieve paginated, read-only audit trail logs.

    Strictly restricted to users with the ADMIN role.
    Supports deterministic descending chronological ordering and filtering by
    action, target_type, and actor_user_id.
    """
    return AuditService.get_audit_logs(
        db=db,
        limit=limit,
        offset=offset,
        action=action,
        target_type=target_type,
        actor_user_id=actor_user_id,
    )

