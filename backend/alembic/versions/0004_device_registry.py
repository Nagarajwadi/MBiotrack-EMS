"""Add devices registry table

Revision ID: 0004_device_registry
Revises: 0003_office_and_assignment_domain
Create Date: 2026-11-05 21:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004_device_registry"
down_revision: Union[str, None] = "0003_office_and_assignment_domain"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create devices table
    op.create_table(
        "devices",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("office_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("device_code", sa.String(length=50), nullable=False),
        sa.Column("serial_number", sa.String(length=100), nullable=False),
        sa.Column("model_name", sa.String(length=100), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("mac_address", sa.String(length=17), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'ACTIVE'"),
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_devices"),
        sa.ForeignKeyConstraint(
            ["office_id"],
            ["offices.id"],
            name="fk_devices_office_id",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "status IN ('ACTIVE', 'INACTIVE', 'DECOMMISSIONED')",
            name="ck_devices_status",
        ),
    )

    # 2. Case-insensitive unique indexes on natural keys
    op.execute(
        "CREATE UNIQUE INDEX uq_devices_lower_device_code ON devices (lower(device_code));"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_devices_lower_serial_number ON devices (lower(serial_number));"
    )

    # 3. Foreign key and status query performance indexes
    op.create_index("ix_devices_office_id", "devices", ["office_id"], unique=False)
    op.create_index("ix_devices_is_active", "devices", ["is_active"], unique=False)
    op.create_index("ix_devices_status", "devices", ["status"], unique=False)


def downgrade() -> None:
    # 1. Drop indexes
    op.drop_index("ix_devices_status", table_name="devices")
    op.drop_index("ix_devices_is_active", table_name="devices")
    op.drop_index("ix_devices_office_id", table_name="devices")
    op.execute("DROP INDEX IF EXISTS uq_devices_lower_serial_number;")
    op.execute("DROP INDEX IF EXISTS uq_devices_lower_device_code;")

    # 2. Drop table
    op.drop_table("devices")
