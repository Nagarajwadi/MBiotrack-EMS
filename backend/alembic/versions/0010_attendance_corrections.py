"""Add attendance_corrections table for attendance correction workflow

Revision ID: 0010_attendance_corrections
Revises: 0009_working_day_leave_calculation
Create Date: 2026-11-23 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0010_attendance_corrections"
down_revision: Union[str, None] = "0009_working_day_leave_calculation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create table attendance_corrections
    op.create_table(
        "attendance_corrections",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("attendance_date", sa.Date(), nullable=False),
        sa.Column("correction_type", sa.String(length=30), nullable=False),
        sa.Column("proposed_timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("original_event_id", sa.BigInteger(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'PENDING'"), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), nullable=False),
        sa.Column("reviewed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("review_notes", sa.Text(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("idempotency_key", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_attendance_corrections"),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["employees.id"],
            name="fk_attendance_corrections_employee_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["original_event_id"],
            ["attendance_events.id"],
            name="fk_attendance_corrections_original_event_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["requested_by_user_id"],
            ["users.id"],
            name="fk_attendance_corrections_requester_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_user_id"],
            ["users.id"],
            name="fk_attendance_corrections_reviewer_id",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "correction_type IN ('MISSING_CHECK_IN', 'MISSING_CHECK_OUT', 'TIMESTAMP_ADJUSTMENT')",
            name="ck_attendance_corrections_type",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING', 'APPROVED', 'REJECTED')",
            name="ck_attendance_corrections_status",
        ),
        sa.UniqueConstraint("idempotency_key", name="uq_attendance_corrections_idempotency_key"),
    )

    # 2. Indexes
    op.create_index(
        "ix_attendance_corrections_emp_date",
        "attendance_corrections",
        ["employee_id", "attendance_date"],
    )
    op.create_index(
        "ix_attendance_corrections_status",
        "attendance_corrections",
        ["status"],
    )
    op.create_index(
        "uq_attendance_corrections_pending_request",
        "attendance_corrections",
        ["employee_id", "attendance_date", "correction_type"],
        unique=True,
        postgresql_where=sa.text("status = 'PENDING'"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_attendance_corrections_pending_request",
        table_name="attendance_corrections",
        postgresql_where=sa.text("status = 'PENDING'"),
    )
    op.drop_index("ix_attendance_corrections_status", table_name="attendance_corrections")
    op.drop_index("ix_attendance_corrections_emp_date", table_name="attendance_corrections")
    op.drop_table("attendance_corrections")
