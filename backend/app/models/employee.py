
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Employee(Base, TimestampMixin):
    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    employee_code: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        index=True,
    )
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )
    department: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )
    designation: Mapped[str] = mapped_column(String(100), nullable=False)
    joining_date: Mapped[date] = mapped_column(Date, nullable=False)

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default=text("true"),
        nullable=False,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        default=None,
        nullable=True,
    )

    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_employees"),
        Index(
            "uq_employees_lower_employee_code",
            func.lower(employee_code),
            unique=True,
        ),
        Index(
            "uq_employees_lower_email",
            func.lower(email),
            unique=True,
        ),
    )
