"""Evolve audit_logs with before/after state and database-level immutability

Revision ID: 0005_audit_log_evolution
Revises: 0004_device_registry
Create Date: 2026-11-05 22:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0005_audit_log_evolution"
down_revision: Union[str, None] = "0004_device_registry"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Primary key column and sequence widening (int4 -> int8 / bigint)
    op.alter_column(
        "audit_logs",
        "id",
        type_=sa.BigInteger(),
        existing_type=sa.Integer(),
        existing_nullable=False,
        autoincrement=True,
    )
    op.execute(
        "ALTER SEQUENCE public.audit_logs_id_seq AS bigint MAXVALUE 9223372036854775807;"
    )
    op.execute(
        "ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;"
    )

    # 2. Add rich structured telemetry state columns
    op.add_column(
        "audit_logs",
        sa.Column("before_state", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "audit_logs",
        sa.Column("after_state", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "audit_logs",
        sa.Column(
            "db_session_user",
            sa.String(length=64),
            nullable=True,
            server_default=sa.text("CURRENT_USER"),
        ),
    )

    # 3. GIN index for high-performance JSONB querying
    op.create_index(
        "ix_audit_logs_after_state_gin",
        "audit_logs",
        ["after_state"],
        postgresql_using="gin",
    )

    # 4. Align FK constraint with immutability: ON DELETE RESTRICT
    op.drop_constraint("fk_audit_logs_actor_user_id", "audit_logs", type_="foreignkey")
    op.create_foreign_key(
        "fk_audit_logs_actor_user_id",
        "audit_logs",
        "users",
        ["actor_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    # 5. Database-level statement trigger enforcing physical immutability
    op.execute("""
    CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        RAISE EXCEPTION 'audit_logs entries are append-only and immutable. % operation is strictly prohibited.', TG_OP
            USING ERRCODE = '42501'; -- insufficient_privilege
    END;
    $$;
    """)

    op.execute("""
    DROP TRIGGER IF EXISTS trg_audit_logs_prevent_mutation ON public.audit_logs;
    CREATE TRIGGER trg_audit_logs_prevent_mutation
    BEFORE UPDATE OR DELETE OR TRUNCATE ON public.audit_logs
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.prevent_audit_log_mutation();
    """)


def downgrade() -> None:
    # 1. Drop immutability statement trigger and function
    op.execute(
        "DROP TRIGGER IF EXISTS trg_audit_logs_prevent_mutation ON public.audit_logs;"
    )
    op.execute("DROP FUNCTION IF EXISTS public.prevent_audit_log_mutation();")

    # 2. Revert foreign key constraint to ON DELETE SET NULL
    op.drop_constraint("fk_audit_logs_actor_user_id", "audit_logs", type_="foreignkey")
    op.create_foreign_key(
        "fk_audit_logs_actor_user_id",
        "audit_logs",
        "users",
        ["actor_user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # 3. Drop GIN index and additive columns
    op.drop_index("ix_audit_logs_after_state_gin", table_name="audit_logs")
    op.drop_column("audit_logs", "db_session_user")
    op.drop_column("audit_logs", "after_state")
    op.drop_column("audit_logs", "before_state")

    # 4. Revert primary key column and sequence to INTEGER
    op.alter_column(
        "audit_logs",
        "id",
        type_=sa.Integer(),
        existing_type=sa.BigInteger(),
        existing_nullable=False,
        autoincrement=True,
    )
    op.execute(
        "ALTER SEQUENCE public.audit_logs_id_seq AS integer MAXVALUE 2147483647;"
    )
