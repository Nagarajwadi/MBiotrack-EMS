"""Add users, audit_logs and employee soft-deletion

Revision ID: 0002_authentication_and_audit
Revises: 0001_initial_employee_table
Create Date: 2026-10-31 18:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002_authentication_and_audit"
down_revision: Union[str, None] = "0001_initial_employee_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add soft-deletion timestamp column to employees
    op.add_column(
        "employees",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )

    # 2. Create users table
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=True),
        sa.Column("full_name", sa.String(length=150), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
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
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["employees.id"],
            name="fk_users_employees_id",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "role IN ('ADMIN', 'MANAGER', 'EMPLOYEE')",
            name="ck_users_role",
        ),
        sa.CheckConstraint(
            "role = 'ADMIN' OR employee_id IS NOT NULL",
            name="ck_users_role_employee_link",
        ),
    )

    # 3. Create minimal required unique indexes on users
    op.execute(
        "CREATE UNIQUE INDEX uq_users_lower_email ON users (lower(email));"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_users_employee_id ON users (employee_id) WHERE employee_id IS NOT NULL;"
    )

    # 4. Create audit_logs table
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("target_type", sa.String(length=50), nullable=False),
        sa.Column("target_id", sa.String(length=100), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_audit_logs"),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name="fk_audit_logs_actor_user_id",
            ondelete="SET NULL",
        ),
    )

    # 5. Create indexes on audit_logs
    op.create_index(
        "ix_audit_logs_created_at",
        "audit_logs",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "ix_audit_logs_target",
        "audit_logs",
        ["target_type", "target_id"],
        unique=False,
    )


def downgrade() -> None:
    # DESTRUCTIVE OPERATION: Drops all audit logs, users, and soft-delete marks
    op.drop_index("ix_audit_logs_target", table_name="audit_logs")
    op.drop_index("ix_audit_logs_created_at", table_name="audit_logs")
    op.drop_table("audit_logs")

    op.execute("DROP INDEX IF EXISTS uq_users_employee_id;")
    op.execute("DROP INDEX IF EXISTS uq_users_lower_email;")
    op.drop_table("users")

    op.drop_column("employees", "deleted_at")

