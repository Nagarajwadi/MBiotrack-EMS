from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    PrimaryKeyConstraint,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AuditLog(Base):
    """Append-only, immutable audit trail for security and sensitive data modifications."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    actor_user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "users.id",
            name="fk_audit_logs_actor_user_id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    target_type: Mapped[str] = mapped_column(String(50), nullable=False)
    target_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Mapped directly to the database column 'metadata'
    # Uses metadata_ in Python to avoid shadowing DeclarativeBase.metadata
    metadata_: Mapped[dict[str, Any] | None] = mapped_column(
        "metadata",
        JSON,
        nullable=True,
    )

    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_audit_logs"),
        Index("ix_audit_logs_target", "target_type", "target_id"),
    )

