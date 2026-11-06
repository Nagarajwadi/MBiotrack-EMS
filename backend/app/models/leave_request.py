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
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.employee import Employee
    from app.models.user import User


class LeaveRequest(Base):
    """Employee leave request domain model."""

    __tablename__ = "leave_requests"

    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
    )
    employee_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "employees.id",
            name="fk_leave_requests_employee_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )
    start_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )
    end_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )
    leave_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )
    reason: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default=text("'PENDING'"),
        index=True,
    )
    decision_by_user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "users.id",
            name="fk_leave_requests_decision_by_user_id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )
    decision_notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    employee: Mapped["Employee"] = relationship(
        "Employee",
        lazy="selectin",
    )
    decision_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[decision_by_user_id],
        lazy="selectin",
    )

    __table_args__ = (
        CheckConstraint(
            "end_date >= start_date",
            name="ck_leave_requests_date_order",
        ),
        CheckConstraint(
            "leave_type IN ('ANNUAL', 'SICK', 'CASUAL', 'UNPAID')",
            name="ck_leave_requests_leave_type",
        ),
        CheckConstraint(
            "status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')",
            name="ck_leave_requests_status",
        ),
        Index("ix_leave_requests_dates", "start_date", "end_date"),
    )
