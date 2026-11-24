from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.attendance_event import AttendanceEvent
    from app.models.employee import Employee
    from app.models.user import User


class AttendanceCorrection(Base):
    """Auditable attendance correction requests and review determinations."""

    __tablename__ = "attendance_corrections"

    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
    )
    employee_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "employees.id",
            name="fk_attendance_corrections_employee_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )
    attendance_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
        index=True,
    )
    correction_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )
    proposed_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    original_event_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "attendance_events.id",
            name="fk_attendance_corrections_original_event_id",
            ondelete="RESTRICT",
        ),
        nullable=True,
        index=True,
    )
    reason: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="PENDING",
        server_default=text("'PENDING'"),
    )
    requested_by_user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "users.id",
            name="fk_attendance_corrections_requester_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    reviewed_by_user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "users.id",
            name="fk_attendance_corrections_reviewer_id",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )
    review_notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    idempotency_key: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    employee: Mapped["Employee"] = relationship("Employee")
    requester: Mapped["User"] = relationship("User", foreign_keys=[requested_by_user_id])
    reviewer: Mapped["User | None"] = relationship("User", foreign_keys=[reviewed_by_user_id])
    original_event: Mapped["AttendanceEvent | None"] = relationship("AttendanceEvent", foreign_keys=[original_event_id])

    __table_args__ = (
        CheckConstraint(
            "correction_type IN ('MISSING_CHECK_IN', 'MISSING_CHECK_OUT', 'TIMESTAMP_ADJUSTMENT')",
            name="ck_attendance_corrections_type",
        ),
        CheckConstraint(
            "status IN ('PENDING', 'APPROVED', 'REJECTED')",
            name="ck_attendance_corrections_status",
        ),
        UniqueConstraint(
            "idempotency_key",
            name="uq_attendance_corrections_idempotency_key",
        ),
        Index(
            "ix_attendance_corrections_emp_date",
            "employee_id",
            "attendance_date",
        ),
        Index(
            "ix_attendance_corrections_status",
            "status",
        ),
        Index(
            "uq_attendance_corrections_pending_request",
            "employee_id",
            "attendance_date",
            "correction_type",
            unique=True,
            postgresql_where=text("status = 'PENDING'"),
        ),
    )
