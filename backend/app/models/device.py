from sqlalchemy import (
    Boolean,
    CheckConstraint,
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

from app.models.base import Base, TimestampMixin


class Device(Base, TimestampMixin):
    """Biometric terminal device registry physical model."""

    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    office_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "offices.id",
            name="fk_devices_office_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    device_code: Mapped[str] = mapped_column(String(50), nullable=False)
    serial_number: Mapped[str] = mapped_column(String(100), nullable=False)
    model_name: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        default=None,
    )
    ip_address: Mapped[str | None] = mapped_column(
        String(45),
        nullable=True,
        default=None,
    )
    mac_address: Mapped[str | None] = mapped_column(
        String(17),
        nullable=True,
        default=None,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="ACTIVE",
        server_default=text("'ACTIVE'"),
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default=text("true"),
        nullable=False,
        index=True,
    )

    # Relationships
    office: Mapped["Office"] = relationship("Office")  # type: ignore[name-defined]

    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_devices"),
        ForeignKeyConstraint(
            ["office_id"],
            ["offices.id"],
            name="fk_devices_office_id",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "status IN ('ACTIVE', 'INACTIVE', 'DECOMMISSIONED')",
            name="ck_devices_status",
        ),
        Index("uq_devices_lower_device_code", func.lower(device_code), unique=True),
        Index("uq_devices_lower_serial_number", func.lower(serial_number), unique=True),
        Index("ix_devices_office_id", "office_id"),
        Index("ix_devices_is_active", "is_active"),
        Index("ix_devices_status", "status"),
    )
