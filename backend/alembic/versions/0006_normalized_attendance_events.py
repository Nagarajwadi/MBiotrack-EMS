"""Add normalized attendance_events table for attendance punch ingestion

Revision ID: 0006_normalized_attendance_events
Revises: 0005_audit_log_evolution
Create Date: 2026-11-05 22:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006_normalized_attendance_events"
down_revision: Union[str, None] = "0005_audit_log_evolution"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create table attendance_events
    op.create_table(
        "attendance_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("office_id", sa.Integer(), nullable=False),
        sa.Column("punch_type", sa.String(length=20), nullable=False),
        sa.Column("event_timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "is_roaming",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("idempotency_key", sa.String(length=100), nullable=True),
        sa.Column("actor_user_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_attendance_events"),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["employees.id"],
            name="fk_attendance_events_employee_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["devices.id"],
            name="fk_attendance_events_device_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["office_id"],
            ["offices.id"],
            name="fk_attendance_events_office_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name="fk_attendance_events_actor_user_id",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "punch_type IN ('CHECK_IN', 'CHECK_OUT')",
            name="ck_attendance_events_punch_type",
        ),
    )

    # 2. Foreign key and filtering indexes
    op.create_index(
        "ix_attendance_events_employee_id",
        "attendance_events",
        ["employee_id"],
    )
    op.create_index(
        "ix_attendance_events_device_id",
        "attendance_events",
        ["device_id"],
    )
    op.create_index(
        "ix_attendance_events_office_id",
        "attendance_events",
        ["office_id"],
    )
    op.create_index(
        "ix_attendance_events_event_timestamp",
        "attendance_events",
        ["event_timestamp"],
    )

    # 3. Deduplication and idempotency unique indexes
    op.create_index(
        "uq_attendance_events_idempotency_key",
        "attendance_events",
        ["idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )
    op.create_index(
        "uq_attendance_events_natural_dedup",
        "attendance_events",
        ["employee_id", "device_id", "punch_type", "event_timestamp"],
        unique=True,
    )


def downgrade() -> None:
    # 1. Drop indexes
    op.drop_index("uq_attendance_events_natural_dedup", table_name="attendance_events")
    op.drop_index("uq_attendance_events_idempotency_key", table_name="attendance_events")
    op.drop_index("ix_attendance_events_event_timestamp", table_name="attendance_events")
    op.drop_index("ix_attendance_events_office_id", table_name="attendance_events")
    op.drop_index("ix_attendance_events_device_id", table_name="attendance_events")
    op.drop_index("ix_attendance_events_employee_id", table_name="attendance_events")

    # 2. Drop table
    op.drop_table("attendance_events")
