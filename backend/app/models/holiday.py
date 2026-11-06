from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
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
    from app.models.office import Office
    from app.models.user import User


class Holiday(Base):
    """Holiday calendar domain model for organization-wide or office-specific dates."""

    __tablename__ = "holidays"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    holiday_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    office_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey(
            "offices.id",
            name="fk_holidays_office_id",
            ondelete="RESTRICT",
        ),
        nullable=True,
        index=True,
    )
    is_optional: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    created_by_user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "users.id",
            name="fk_holidays_created_by_user_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
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
    office: Mapped["Office | None"] = relationship(
        "Office",
        lazy="selectin",
    )
    created_by_user: Mapped["User"] = relationship(
        "User",
        foreign_keys=[created_by_user_id],
        lazy="selectin",
    )

    __table_args__ = (
        Index(
            "uq_holidays_org_wide_date",
            "holiday_date",
            unique=True,
            postgresql_where=text("office_id IS NULL"),
        ),
        Index(
            "uq_holidays_office_date",
            "holiday_date",
            "office_id",
            unique=True,
            postgresql_where=text("office_id IS NOT NULL"),
        ),
    )
