"""Add offices and employee_office_assignments domain tables

Revision ID: 0003_office_and_assignment_domain
Revises: 0002_authentication_and_audit
Create Date: 2026-11-05 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0003_office_and_assignment_domain"
down_revision: Union[str, None] = "0002_authentication_and_audit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Widen alembic_version.version_num from VARCHAR(32) to VARCHAR(64) to support descriptive revision IDs
    op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(64);")

    # 2. Enable btree_gist extension prerequisite for GiST scalar indexing
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist;")

    # 3. Create offices table
    op.create_table(
        "offices",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column(
            "timezone",
            sa.String(length=64),
            nullable=False,
            server_default=sa.text("'Asia/Kolkata'"),
        ),
        sa.Column("address", sa.Text(), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name="pk_offices"),
    )

    # 4. Create functional unique index on lower(code)
    op.execute(
        "CREATE UNIQUE INDEX uq_offices_lower_code ON offices (lower(code));"
    )

    # 5. Trigger-based IANA timezone validation
    op.execute("""
    CREATE OR REPLACE FUNCTION trg_validate_office_timezone()
    RETURNS TRIGGER LANGUAGE plpgsql STABLE AS $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
            RAISE EXCEPTION 'Invalid IANA timezone identifier: %', NEW.timezone
                USING ERRCODE = 'invalid_parameter_value'; -- 22023
        END IF;
        RETURN NEW;
    END;
    $$;
    """)

    op.execute("""
    CREATE TRIGGER trg_validate_office_timezone_before_write
    BEFORE INSERT OR UPDATE OF timezone ON offices
    FOR EACH ROW EXECUTE FUNCTION trg_validate_office_timezone();
    """)

    # 6. Create employee_office_assignments table
    op.create_table(
        "employee_office_assignments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("office_id", sa.Integer(), nullable=False),
        sa.Column(
            "validity_range",
            postgresql.TSTZRANGE(),
            nullable=False,
        ),
        sa.Column(
            "is_primary",
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
        sa.PrimaryKeyConstraint("id", name="pk_employee_office_assignments"),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["employees.id"],
            name="fk_employee_office_assignments_employee_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["office_id"],
            ["offices.id"],
            name="fk_employee_office_assignments_office_id",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "validity_range IS NOT NULL "
            "AND NOT isempty(validity_range) "
            "AND lower_inc(validity_range) = TRUE "
            "AND upper_inc(validity_range) = FALSE "
            "AND lower_inf(validity_range) = FALSE "
            "AND upper_inf(validity_range) = FALSE "
            "AND isfinite(lower(validity_range)) "
            "AND isfinite(upper(validity_range))",
            name="ck_assignment_range_finite_and_valid",
        ),
    )

    # 7. GiST exclusion constraint preventing overlapping assignments for the same employee
    op.create_exclude_constraint(
        "ex_employee_office_assignment_no_overlap",
        "employee_office_assignments",
        ("employee_id", "="),
        ("validity_range", "&&"),
        using="gist",
    )

    # 8. Foreign key query performance indexes
    op.create_index(
        "ix_employee_office_assignments_employee_id",
        "employee_office_assignments",
        ["employee_id"],
        unique=False,
    )
    op.create_index(
        "ix_employee_office_assignments_office_id",
        "employee_office_assignments",
        ["office_id"],
        unique=False,
    )


def downgrade() -> None:
    # 1. Drop employee_office_assignments indexes and table
    op.drop_index(
        "ix_employee_office_assignments_office_id",
        table_name="employee_office_assignments",
    )
    op.drop_index(
        "ix_employee_office_assignments_employee_id",
        table_name="employee_office_assignments",
    )
    op.drop_constraint(
        "ex_employee_office_assignment_no_overlap",
        "employee_office_assignments",
        type_="exclude",
    )
    op.drop_table("employee_office_assignments")

    # 2. Drop timezone validation trigger and function
    op.execute(
        "DROP TRIGGER IF EXISTS trg_validate_office_timezone_before_write ON offices;"
    )
    op.execute("DROP FUNCTION IF EXISTS trg_validate_office_timezone();")

    # 3. Drop offices unique index and table
    op.execute("DROP INDEX IF EXISTS uq_offices_lower_code;")
    op.drop_table("offices")
