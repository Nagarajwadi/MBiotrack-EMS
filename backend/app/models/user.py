from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.employee import Employee


class User(Base, TimestampMixin):
    """User account model for authentication and role-based access control."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    employee_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "employees.id",
            name="fk_users_employees_id",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default=text("true"),
        nullable=False,
    )

    # Relationships
    employee: Mapped["Employee | None"] = relationship("Employee", lazy="joined")

    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_users"),
        CheckConstraint(
            "role IN ('ADMIN', 'MANAGER', 'EMPLOYEE')",
            name="ck_users_role",
        ),
        CheckConstraint(
            "role = 'ADMIN' OR employee_id IS NOT NULL",
            name="ck_users_role_employee_link",
        ),
        # Functional unique index for case-insensitive email authentication
        Index(
            "uq_users_lower_email",
            func.lower(email),
            unique=True,
        ),
        # Partial unique index enforcing 1 account per employee
        Index(
            "uq_users_employee_id",
            employee_id,
            unique=True,
            postgresql_where=employee_id.isnot(None),
        ),
    )

