from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    DateTime,
    FetchedValue,
    ForeignKey,
    Index,
    JSON,
    PrimaryKeyConstraint,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AuditLog(Base):
    """Append-only, immutable audit trail for security and sensitive data modifications."""

    __tablename__ = "audit_logs"
    __mapper_args__ = {"eager_defaults": False}

    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
    )
    actor_user_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "users.id",
            name="fk_audit_logs_actor_user_id",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    target_type: Mapped[str] = mapped_column(String(50), nullable=False)
    target_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Rich structured telemetry state columns (Slice 3 evolution)
    # Marked deferred=True and server_default=FetchedValue() to ensure seamless backward
    # compatibility when operating against earlier migration baselines (e.g. mbiotrack_test at 0002).
    before_state: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB,
        nullable=True,
        deferred=True,
    )
    after_state: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB,
        nullable=True,
        deferred=True,
    )
    db_session_user: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        server_default=FetchedValue(),
        deferred=True,
    )

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

    @property
    def entity_name(self) -> str:
        """Alias target_type for backward-compatible architectural specification."""
        return self.target_type

    @property
    def entity_id(self) -> str | None:
        """Alias target_id for backward-compatible architectural specification."""
        return self.target_id

    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_audit_logs"),
        Index("ix_audit_logs_target", "target_type", "target_id"),
        Index("ix_audit_logs_after_state_gin", "after_state", postgresql_using="gin"),
    )
