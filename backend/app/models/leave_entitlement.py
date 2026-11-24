from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.employee import Employee
    from app.models.leave_request import LeaveRequest
    from app.models.user import User


class LeaveEntitlementDefault(Base):
    """Organization-wide default leave entitlement per calendar year and leave type."""

    __tablename__ = "leave_entitlement_defaults"

    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
    )
    year: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        index=True,
    )
    leave_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )
    allocated_days: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "users.id",
            name="fk_leave_entitlement_defaults_created_by",
            ondelete="SET NULL",
        ),
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

    created_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by_user_id],
        lazy="selectin",
    )

    __table_args__ = (
        UniqueConstraint(
            "year",
            "leave_type",
            name="uq_leave_entitlement_defaults_year_type",
        ),
        CheckConstraint(
            "leave_type IN ('ANNUAL', 'SICK', 'CASUAL')",
            name="ck_leave_entitlement_defaults_leave_type",
        ),
        CheckConstraint(
            "allocated_days >= 0",
            name="ck_leave_entitlement_defaults_allocated_days",
        ),
        CheckConstraint(
            "year >= 2000 AND year <= 2100",
            name="ck_leave_entitlement_defaults_year_range",
        ),
    )


class EmployeeLeaveEntitlement(Base):
    """Employee-specific override for leave entitlement per calendar year and leave type."""

    __tablename__ = "employee_leave_entitlements"

    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
    )
    employee_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "employees.id",
            name="fk_employee_leave_entitlements_employee_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )
    year: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        index=True,
    )
    leave_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )
    allocated_days: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "users.id",
            name="fk_employee_leave_entitlements_created_by",
            ondelete="SET NULL",
        ),
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

    employee: Mapped["Employee"] = relationship(
        "Employee",
        foreign_keys=[employee_id],
        lazy="selectin",
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by_user_id],
        lazy="selectin",
    )

    __table_args__ = (
        UniqueConstraint(
            "employee_id",
            "year",
            "leave_type",
            name="uq_employee_leave_entitlements_emp_year_type",
        ),
        CheckConstraint(
            "leave_type IN ('ANNUAL', 'SICK', 'CASUAL')",
            name="ck_employee_leave_entitlements_leave_type",
        ),
        CheckConstraint(
            "allocated_days >= 0",
            name="ck_employee_leave_entitlements_allocated_days",
        ),
        CheckConstraint(
            "year >= 2000 AND year <= 2100",
            name="ck_employee_leave_entitlements_year_range",
        ),
        Index(
            "ix_employee_leave_entitlements_emp_year",
            "employee_id",
            "year",
        ),
    )


class LeaveBalanceLedger(Base):
    """Transactional accounting ledger for leave reservations, consumptions, and releases."""

    __tablename__ = "leave_balance_ledger"

    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
    )
    leave_request_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "leave_requests.id",
            name="fk_leave_balance_ledger_leave_request_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )
    employee_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "employees.id",
            name="fk_leave_balance_ledger_employee_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )
    year: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    leave_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )
    transaction_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )
    days: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "users.id",
            name="fk_leave_balance_ledger_created_by",
            ondelete="SET NULL",
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    leave_request: Mapped["LeaveRequest"] = relationship(
        "LeaveRequest",
        foreign_keys=[leave_request_id],
        lazy="selectin",
    )
    employee: Mapped["Employee"] = relationship(
        "Employee",
        foreign_keys=[employee_id],
        lazy="selectin",
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by_user_id],
        lazy="selectin",
    )

    __table_args__ = (
        UniqueConstraint(
            "leave_request_id",
            "transaction_type",
            name="uq_leave_balance_ledger_request_trans",
        ),
        CheckConstraint(
            "transaction_type IN ('RESERVATION', 'CONSUMPTION', 'RESERVATION_RELEASE', 'CONSUMPTION_RELEASE')",
            name="ck_leave_balance_ledger_trans_type",
        ),
        CheckConstraint(
            "days > 0",
            name="ck_leave_balance_ledger_days_positive",
        ),
        CheckConstraint(
            "leave_type IN ('ANNUAL', 'SICK', 'CASUAL')",
            name="ck_leave_balance_ledger_leave_type",
        ),
        Index(
            "ix_leave_balance_ledger_emp_year_type",
            "employee_id",
            "year",
            "leave_type",
        ),
    )
