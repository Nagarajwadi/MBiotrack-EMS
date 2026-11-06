from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import TSTZRANGE, ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Office(Base, TimestampMixin):
    """Office / location physical domain model."""

    __tablename__ = "offices"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    timezone: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="Asia/Kolkata",
        server_default=text("'Asia/Kolkata'"),
    )
    address: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        default=None,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default=text("true"),
        nullable=False,
    )

    # Relationships
    assignments: Mapped[list["EmployeeOfficeAssignment"]] = relationship(
        "EmployeeOfficeAssignment",
        back_populates="office",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_offices"),
        Index("uq_offices_lower_code", func.lower(code), unique=True),
    )


class EmployeeOfficeAssignment(Base, TimestampMixin):
    """Employee to office temporal assignment with GiST non-overlap protection."""

    __tablename__ = "employee_office_assignments"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    employee_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "employees.id",
            name="fk_employee_office_assignments_employee_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )
    office_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "offices.id",
            name="fk_employee_office_assignments_office_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )
    validity_range: Mapped[Any] = mapped_column(
        TSTZRANGE,
        nullable=False,
    )
    is_primary: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default=text("true"),
        nullable=False,
    )

    # Relationships
    office: Mapped["Office"] = relationship(
        "Office",
        back_populates="assignments",
    )
    employee: Mapped["Employee"] = relationship(  # type: ignore[name-defined]
        "Employee",
        foreign_keys=[employee_id],
    )

    @property
    def valid_from(self) -> datetime | None:
        """Return the lower bound (inclusive) of the validity range."""
        if self.validity_range is not None:
            return getattr(self.validity_range, "lower", None)
        return None

    @property
    def valid_to(self) -> datetime | None:
        """Return the upper bound (exclusive) of the validity range."""
        if self.validity_range is not None:
            return getattr(self.validity_range, "upper", None)
        return None

    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_employee_office_assignments"),
        ForeignKeyConstraint(
            ["employee_id"],
            ["employees.id"],
            name="fk_employee_office_assignments_employee_id",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["office_id"],
            ["offices.id"],
            name="fk_employee_office_assignments_office_id",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "validity_range IS NOT NULL "
            "AND NOT isempty(validity_range) "
            "AND lower_inc(validity_range) = TRUE "
            "AND upper_inc(validity_range) = FALSE "
            "AND lower_inf(validity_range) = FALSE "
            "AND upper_inf(validity_range) = FALSE "
            "AND isfinite(lower(validity_range)) "
            "AND isfinite(upper(validity_range))",
            name="ck_assignment_range_finite_and_valid",
        ),
        ExcludeConstraint(
            ("employee_id", "="),
            ("validity_range", "&&"),
            name="ex_employee_office_assignment_no_overlap",
            using="gist",
        ),
        Index("ix_employee_office_assignments_employee_id", "employee_id"),
        Index("ix_employee_office_assignments_office_id", "office_id"),
    )
