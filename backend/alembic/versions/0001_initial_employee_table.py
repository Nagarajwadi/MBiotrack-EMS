"""Initial employee table with functional unique indexes

Revision ID: 0001_initial_employee_table
Revises: None
Create Date: 2026-10-30 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001_initial_employee_table"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "employees",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("employee_code", sa.String(length=30), nullable=False),
        sa.Column("first_name", sa.String(length=100), nullable=False),
        sa.Column("last_name", sa.String(length=100), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("department", sa.String(length=100), nullable=False),
        sa.Column("designation", sa.String(length=100), nullable=False),
        sa.Column("joining_date", sa.Date(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
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
        sa.PrimaryKeyConstraint("id", name="pk_employees"),
    )

    # Standard lookup and filter indexes
    op.create_index(
        "ix_employees_employee_code",
        "employees",
        ["employee_code"],
        unique=False,
    )
    op.create_index(
        "ix_employees_email",
        "employees",
        ["email"],
        unique=False,
    )
    op.create_index(
        "ix_employees_department",
        "employees",
        ["department"],
        unique=False,
    )

    # Functional unique indexes for case-insensitive uniqueness at PostgreSQL level
    op.execute(
        "CREATE UNIQUE INDEX uq_employees_lower_employee_code ON employees (lower(employee_code));"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_employees_lower_email ON employees (lower(email));"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_employees_lower_email;")
    op.execute("DROP INDEX IF EXISTS uq_employees_lower_employee_code;")
    op.drop_index("ix_employees_department", table_name="employees")
    op.drop_index("ix_employees_email", table_name="employees")
    op.drop_index("ix_employees_employee_code", table_name="employees")
    op.drop_table("employees")

