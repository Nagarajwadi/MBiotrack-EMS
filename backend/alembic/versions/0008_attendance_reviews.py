"""Add attendance_reviews table for manager attendance exception workflow

Revision ID: 0008_attendance_reviews
Revises: 0007_leave_and_holiday_domain
Create Date: 2026-11-08 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0008_attendance_reviews"
down_revision: Union[str, None] = "0007_leave_and_holiday_domain"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create table attendance_reviews
    op.create_table(
        "attendance_reviews",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("attendance_date", sa.Date(), nullable=False),
        sa.Column("reviewed_by_user_id", sa.Integer(), nullable=False),
        sa.Column("review_status", sa.String(length=30), nullable=False),
        sa.Column("review_notes", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=100), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_attendance_reviews"),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["employees.id"],
            name="fk_attendance_reviews_employee_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_user_id"],
            ["users.id"],
            name="fk_attendance_reviews_reviewed_by_user_id",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "review_status IN ('ACKNOWLEDGED')",
            name="ck_attendance_reviews_status",
        ),
        sa.UniqueConstraint(
            "idempotency_key",
            name="uq_attendance_reviews_idempotency_key",
        ),
    )

    # 2. Indexes supporting date-based operations, employee history, and reviewer foreign key
    op.create_index(
        "ix_attendance_reviews_date_emp_created",
        "attendance_reviews",
        ["attendance_date", "employee_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_attendance_reviews_emp_date_created",
        "attendance_reviews",
        ["employee_id", sa.text("attendance_date DESC"), sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_attendance_reviews_reviewer",
        "attendance_reviews",
        ["reviewed_by_user_id"],
    )


def downgrade() -> None:
    op.drop_table("attendance_reviews")
