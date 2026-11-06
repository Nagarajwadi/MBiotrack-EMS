from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.device import Device
    from app.models.employee import Employee
    from app.models.office import Office
    from app.models.user import User


class AttendanceEvent(Base):
    """Normalized attendance punch physical event model."""

    __tablename__ = "attendance_events"

    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
    )
    employee_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "employees.id",
            name="fk_attendance_events_employee_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )
    device_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "devices.id",
            name="fk_attendance_events_device_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )
    office_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "offices.id",
            name="fk_attendance_events_office_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )
    punch_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )
    event_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
    )
    is_roaming: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=text("false"),
        nullable=False,
    )
    idempotency_key: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        default=None,
    )
    actor_user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "users.id",
            name="fk_attendance_events_actor_user_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    employee: Mapped["Employee"] = relationship("Employee")  # type: ignore[name-defined]
    device: Mapped["Device"] = relationship("Device")  # type: ignore[name-defined]
    office: Mapped["Office"] = relationship("Office")  # type: ignore[name-defined]
    actor: Mapped["User"] = relationship("User")  # type: ignore[name-defined]

    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_attendance_events"),
        ForeignKeyConstraint(
            ["employee_id"],
            ["employees.id"],
            name="fk_attendance_events_employee_id",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["device_id"],
            ["devices.id"],
            name="fk_attendance_events_device_id",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["office_id"],
            ["offices.id"],
            name="fk_attendance_events_office_id",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name="fk_attendance_events_actor_user_id",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "punch_type IN ('CHECK_IN', 'CHECK_OUT')",
            name="ck_attendance_events_punch_type",
        ),
        Index("ix_attendance_events_employee_id", "employee_id"),
        Index("ix_attendance_events_device_id", "device_id"),
        Index("ix_attendance_events_office_id", "office_id"),
        Index("ix_attendance_events_event_timestamp", "event_timestamp"),
        Index(
            "uq_attendance_events_idempotency_key",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
        Index(
            "uq_attendance_events_natural_dedup",
            "employee_id",
            "device_id",
            "punch_type",
            "event_timestamp",
            unique=True,
        ),
    )
