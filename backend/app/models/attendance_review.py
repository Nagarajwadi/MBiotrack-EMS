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
    from app.models.employee import Employee
    from app.models.user import User


class AttendanceReview(Base):
    """Auditable manager review actions for attendance exceptions."""

    __tablename__ = "attendance_reviews"

    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
    )
    employee_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "employees.id",
            name="fk_attendance_reviews_employee_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    attendance_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )
    reviewed_by_user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "users.id",
            name="fk_attendance_reviews_reviewed_by_user_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    review_status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )
    review_notes: Mapped[str | None] = mapped_column(
        Text,
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

    # Relationships
    employee: Mapped["Employee"] = relationship("Employee", lazy="joined")
    reviewer: Mapped["User"] = relationship("User", lazy="joined")

    __table_args__ = (
        CheckConstraint(
            "review_status IN ('ACKNOWLEDGED')",
            name="ck_attendance_reviews_status",
        ),
        UniqueConstraint(
            "idempotency_key",
            name="uq_attendance_reviews_idempotency_key",
        ),
        Index(
            "ix_attendance_reviews_date_emp_created",
            "attendance_date",
            "employee_id",
            text("created_at DESC"),
        ),
        Index(
            "ix_attendance_reviews_emp_date_created",
            "employee_id",
            text("attendance_date DESC"),
            text("created_at DESC"),
        ),
        Index(
            "ix_attendance_reviews_reviewer",
            "reviewed_by_user_id",
        ),
    )
