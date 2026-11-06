"""Add leave_requests and holidays domain tables

Revision ID: 0007_leave_and_holiday_domain
Revises: 0006_normalized_attendance_events
Create Date: 2026-11-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0007_leave_and_holiday_domain"
down_revision: Union[str, None] = "0006_normalized_attendance_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create table leave_requests
    op.create_table(
        "leave_requests",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("leave_type", sa.String(length=30), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'PENDING'"),
        ),
        sa.Column("decision_by_user_id", sa.Integer(), nullable=True),
        sa.Column("decision_notes", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_leave_requests"),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["employees.id"],
            name="fk_leave_requests_employee_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["decision_by_user_id"],
            ["users.id"],
            name="fk_leave_requests_decision_by_user_id",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "end_date >= start_date",
            name="ck_leave_requests_date_order",
        ),
        sa.CheckConstraint(
            "leave_type IN ('ANNUAL', 'SICK', 'CASUAL', 'UNPAID')",
            name="ck_leave_requests_leave_type",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')",
            name="ck_leave_requests_status",
        ),
    )

    op.create_index(
        "ix_leave_requests_employee_id",
        "leave_requests",
        ["employee_id"],
        unique=False,
    )
    op.create_index(
        "ix_leave_requests_dates",
        "leave_requests",
        ["start_date", "end_date"],
        unique=False,
    )
    op.create_index(
        "ix_leave_requests_status",
        "leave_requests",
        ["status"],
        unique=False,
    )

    # 2. Create table holidays
    op.create_table(
        "holidays",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("holiday_date", sa.Date(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("office_id", sa.Integer(), nullable=True),
        sa.Column(
            "is_optional",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_holidays"),
        sa.ForeignKeyConstraint(
            ["office_id"],
            ["offices.id"],
            name="fk_holidays_office_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name="fk_holidays_created_by_user_id",
            ondelete="RESTRICT",
        ),
    )

    # Partial unique index for organization-wide holidays (office_id IS NULL)
    op.create_index(
        "uq_holidays_org_wide_date",
        "holidays",
        ["holiday_date"],
        unique=True,
        postgresql_where=sa.text("office_id IS NULL"),
    )

    # Partial unique index for office-specific holidays (office_id IS NOT NULL)
    op.create_index(
        "uq_holidays_office_date",
        "holidays",
        ["holiday_date", "office_id"],
        unique=True,
        postgresql_where=sa.text("office_id IS NOT NULL"),
    )

    op.create_index(
        "ix_holidays_date",
        "holidays",
        ["holiday_date"],
        unique=False,
    )
    op.create_index(
        "ix_holidays_office_id",
        "holidays",
        ["office_id"],
        unique=False,
    )


def downgrade() -> None:
    # 1. Drop holidays indexes and table
    op.drop_index("ix_holidays_office_id", table_name="holidays")
    op.drop_index("ix_holidays_date", table_name="holidays")
    op.drop_index("uq_holidays_office_date", table_name="holidays")
    op.drop_index("uq_holidays_org_wide_date", table_name="holidays")
    op.drop_table("holidays")

    # 2. Drop leave_requests indexes and table
    op.drop_index("ix_leave_requests_status", table_name="leave_requests")
    op.drop_index("ix_leave_requests_dates", table_name="leave_requests")
    op.drop_index("ix_leave_requests_employee_id", table_name="leave_requests")
    op.drop_table("leave_requests")
