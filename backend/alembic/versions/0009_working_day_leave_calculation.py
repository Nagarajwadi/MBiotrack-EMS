"""Add working_days column to leave_requests table

Revision ID: 0009_working_day_leave_calculation
Revises: 0008_attendance_reviews
Create Date: 2026-11-22 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0009_working_day_leave_calculation"
down_revision: Union[str, None] = "0008_attendance_reviews"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add nullable working_days column
    op.add_column(
        "leave_requests",
        sa.Column("working_days", sa.Integer(), nullable=True),
    )

    # 2. Add check constraint ensuring working_days is either NULL (for legacy records) or > 0
    op.create_check_constraint(
        "ck_leave_requests_working_days_positive",
        "leave_requests",
        "working_days IS NULL OR working_days > 0",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_leave_requests_working_days_positive",
        "leave_requests",
        type_="check",
    )
    op.drop_column("leave_requests", "working_days")
