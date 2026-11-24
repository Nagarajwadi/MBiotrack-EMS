"""Add leave entitlement defaults, employee overrides, and balance ledger

Revision ID: 0011_leave_entitlements_and_balances
Revises: 0010_attendance_corrections
Create Date: 2026-11-23 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0011_leave_entitlements_and_balances"
down_revision: Union[str, None] = "0010_attendance_corrections"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create leave_entitlement_defaults table
    op.create_table(
        "leave_entitlement_defaults",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("leave_type", sa.String(length=30), nullable=False),
        sa.Column("allocated_days", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_leave_entitlement_defaults"),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name="fk_leave_entitlement_defaults_created_by",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint(
            "year", "leave_type", name="uq_leave_entitlement_defaults_year_type"
        ),
        sa.CheckConstraint(
            "leave_type IN ('ANNUAL', 'SICK', 'CASUAL')",
            name="ck_leave_entitlement_defaults_leave_type",
        ),
        sa.CheckConstraint(
            "allocated_days >= 0",
            name="ck_leave_entitlement_defaults_allocated_days",
        ),
        sa.CheckConstraint(
            "year >= 2000 AND year <= 2100",
            name="ck_leave_entitlement_defaults_year_range",
        ),
    )
    op.create_index(
        "ix_leave_entitlement_defaults_year",
        "leave_entitlement_defaults",
        ["year"],
    )

    # 2. Create employee_leave_entitlements table
    op.create_table(
        "employee_leave_entitlements",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("leave_type", sa.String(length=30), nullable=False),
        sa.Column("allocated_days", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_employee_leave_entitlements"),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["employees.id"],
            name="fk_employee_leave_entitlements_employee_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name="fk_employee_leave_entitlements_created_by",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint(
            "employee_id",
            "year",
            "leave_type",
            name="uq_employee_leave_entitlements_emp_year_type",
        ),
        sa.CheckConstraint(
            "leave_type IN ('ANNUAL', 'SICK', 'CASUAL')",
            name="ck_employee_leave_entitlements_leave_type",
        ),
        sa.CheckConstraint(
            "allocated_days >= 0",
            name="ck_employee_leave_entitlements_allocated_days",
        ),
        sa.CheckConstraint(
            "year >= 2000 AND year <= 2100",
            name="ck_employee_leave_entitlements_year_range",
        ),
    )
    op.create_index(
        "ix_employee_leave_entitlements_emp_year",
        "employee_leave_entitlements",
        ["employee_id", "year"],
    )

    # 3. Create leave_balance_ledger table
    op.create_table(
        "leave_balance_ledger",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("leave_request_id", sa.BigInteger(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("leave_type", sa.String(length=30), nullable=False),
        sa.Column("transaction_type", sa.String(length=30), nullable=False),
        sa.Column("days", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_leave_balance_ledger"),
        sa.ForeignKeyConstraint(
            ["leave_request_id"],
            ["leave_requests.id"],
            name="fk_leave_balance_ledger_leave_request_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["employees.id"],
            name="fk_leave_balance_ledger_employee_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name="fk_leave_balance_ledger_created_by",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint(
            "leave_request_id",
            "transaction_type",
            name="uq_leave_balance_ledger_request_trans",
        ),
        sa.CheckConstraint(
            "transaction_type IN ('RESERVATION', 'CONSUMPTION', 'RESERVATION_RELEASE', 'CONSUMPTION_RELEASE')",
            name="ck_leave_balance_ledger_trans_type",
        ),
        sa.CheckConstraint(
            "days > 0",
            name="ck_leave_balance_ledger_days_positive",
        ),
        sa.CheckConstraint(
            "leave_type IN ('ANNUAL', 'SICK', 'CASUAL')",
            name="ck_leave_balance_ledger_leave_type",
        ),
    )
    op.create_index(
        "ix_leave_balance_ledger_emp_year_type",
        "leave_balance_ledger",
        ["employee_id", "year", "leave_type"],
    )
    op.create_index(
        "ix_leave_balance_ledger_request_id",
        "leave_balance_ledger",
        ["leave_request_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_leave_balance_ledger_request_id", table_name="leave_balance_ledger"
    )
    op.drop_index(
        "ix_leave_balance_ledger_emp_year_type", table_name="leave_balance_ledger"
    )
    op.drop_table("leave_balance_ledger")

    op.drop_index(
        "ix_employee_leave_entitlements_emp_year",
        table_name="employee_leave_entitlements",
    )
    op.drop_table("employee_leave_entitlements")

    op.drop_index(
        "ix_leave_entitlement_defaults_year",
        table_name="leave_entitlement_defaults",
    )
    op.drop_table("leave_entitlement_defaults")
