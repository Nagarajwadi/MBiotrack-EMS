import argparse
import getpass
import ipaddress
import sys
import urllib.parse
from typing import Callable

from sqlalchemy import func, select
from sqlalchemy.engine import create_engine, make_url
from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError
from sqlalchemy.orm import Session, lazyload, sessionmaker

from app.core.config import get_settings
from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.auth import EMAIL_REGEX

# Specific constants for Day-0 administrator email correction
TARGET_USER_ID: int = 1
EXPECTED_CURRENT_EMAIL: str = "nagraj.official@gamil.com"
CORRECTED_EMAIL: str = "nagraj.official@gmail.com"
CONFIRMATION_PHRASE: str = "CONFIRM UPDATE PRODUCTION ADMIN EMAIL"
ADMIN_EMAIL_UPDATE_LOCK_NAME: str = "mbiotrack_admin_email_update"


class EmailUpdateSecurityError(Exception):
    """Raised when database target validation fails security constraints."""

    pass


class EmailUpdateValidationError(Exception):
    """Raised when operator input validation fails or is cancelled."""

    pass


class EmailUpdateLockError(Exception):
    """Raised when advisory lock contention prevents exclusive update."""

    pass


class EmailUpdateRefusedError(Exception):
    """Raised when the target account cannot be updated (wrong ID, wrong email, non-admin, inactive, duplicate)."""

    pass


def normalize_db_url(raw_url: str) -> str:
    """Normalize postgresql URL scheme to postgresql+psycopg."""
    trimmed = raw_url.strip()
    if trimmed.startswith("postgres://"):
        return "postgresql+psycopg://" + trimmed[len("postgres://"):]
    if trimmed.startswith("postgresql://") and not trimmed.startswith("postgresql+"):
        return "postgresql+psycopg://" + trimmed[len("postgresql://"):]
    return trimmed


def validate_target_database(
    database_url: str | None,
    is_production: bool = True,
) -> tuple[str, str]:
    """Validate database target against strict security and production constraints.

    In production mode (default):
    - Unconditionally rejects missing or empty connection URLs
    - Normalizes driver to PostgreSQL (postgresql+psycopg)
    - Unconditionally rejects test databases ('mbiotrack_test' and '*_test')
    - Requires host to end with '.neon.tech'
    - Strictly rejects pooled endpoints containing '-pooler'
    - Requires database name to be 'neondb'
    - Requires SSL mode in query string (sslmode=require or verify-full)
    - Strictly rejects loopback addresses (localhost, 127.0.0.1, ::1)
    - Strictly rejects development databases ('mbiotrack_dev')

    In non-production mode (development testing):
    - Allows 'mbiotrack_dev' on loopback hosts
    - Unconditionally rejects production URLs
    """
    if not database_url or not database_url.strip():
        raise EmailUpdateSecurityError(
            "DATABASE_URL is not configured or was not provided on STDIN."
        )

    norm_url = normalize_db_url(database_url)

    try:
        url = make_url(norm_url)
    except Exception:
        raise EmailUpdateSecurityError(
            "Database connection URL is malformed and cannot be parsed."
        ) from None

    driver = (url.drivername or "").lower()
    if not (driver == "postgresql" or driver.startswith("postgresql+")):
        raise EmailUpdateSecurityError(
            "Database driver must be PostgreSQL (postgresql+psycopg)."
        )

    db_name = (url.database or "").strip()
    if not db_name:
        raise EmailUpdateSecurityError("Database name is missing in connection URL.")

    db_name_lower = db_name.lower()
    if db_name_lower == "mbiotrack_test" or db_name_lower.endswith("_test"):
        raise EmailUpdateSecurityError(
            f"Refusing to run administrator email update against test database '{db_name}'."
        )

    host = (url.host or "").strip().lower()
    if not host:
        raise EmailUpdateSecurityError("Missing database host in connection URL.")

    if is_production:
        if db_name_lower == "mbiotrack_dev":
            raise EmailUpdateSecurityError(
                "Refusing to run production update against development database 'mbiotrack_dev'."
            )

        # Reject loopback addresses
        if host in ("localhost", "127.0.0.1", "::1", "[::1]"):
            raise EmailUpdateSecurityError(
                "Loopback hosts are strictly forbidden in production mode."
            )
        try:
            ip_obj = ipaddress.ip_address(host.strip("[]"))
            if ip_obj.is_loopback:
                raise EmailUpdateSecurityError(
                    "Loopback hosts are strictly forbidden in production mode."
                )
        except ValueError:
            pass

        if not host.endswith(".neon.tech"):
            raise EmailUpdateSecurityError(
                f"Production database host '{host}' is not an approved Neon host (*.neon.tech)."
            )

        if "-pooler" in host:
            raise EmailUpdateSecurityError(
                f"Production database host '{host}' is a pooled endpoint (-pooler). "
                "Transactional administrator updates require a direct Neon endpoint."
            )

        if db_name != "neondb":
            raise EmailUpdateSecurityError(
                f"Unexpected production database name '{db_name}'. Target must be 'neondb'."
            )

        query = url.query or {}
        sslmode = query.get("sslmode", "")
        if sslmode not in ("require", "verify-full", "verify-ca"):
            raise EmailUpdateSecurityError(
                "SSL is required for Neon production connections (sslmode=require or verify-full)."
            )
    else:
        if db_name_lower != "mbiotrack_dev":
            raise EmailUpdateSecurityError(
                f"Refusing to run administrator email update against database '{db_name}'. "
                "In non-production mode, target database must be 'mbiotrack_dev'."
            )

    return db_name, host


def read_connection_url_from_stdin(stream=None) -> str:
    """Read target database connection URL strictly from STDIN.

    Never accepts connection strings via command-line arguments to prevent
    credential exposure in process listings, history, or logs.
    """
    if stream is None:
        stream = sys.stdin

    try:
        if hasattr(stream, "isatty") and stream.isatty():
            url = getpass.getpass("Enter Neon Direct Connection String (hidden input): ").strip()
        else:
            line = stream.readline()
            url = line.strip() if line else ""
    except (EOFError, KeyboardInterrupt):
        raise EmailUpdateValidationError(
            "Interactive input unavailable or cancelled."
        ) from None

    if not url:
        raise EmailUpdateValidationError(
            "Database connection URL was not provided on STDIN."
        )

    return url


def prompt_operator_confirmation(
    target_id: int,
    current_email: str,
    new_email: str,
) -> None:
    """Require operator to verify target details and type the exact confirmation phrase."""
    print("=" * 65)
    print("   MBiotrack-EMS: Production Administrator Email Correction     ")
    print("=" * 65)
    print(f"  Target User ID:   {target_id}")
    print(f"  Target Role:      ADMIN")
    print(f"  Current Email:    {current_email}")
    print(f"  Corrected Email:  {new_email}")
    print("=" * 65)
    print("WARNING: This command will modify the primary administrator email")
    print("on the target database.")
    print(f"To proceed, type exactly: {CONFIRMATION_PHRASE}")
    try:
        confirm_input = input("Enter confirmation: ").strip()
    except (EOFError, KeyboardInterrupt):
        raise EmailUpdateValidationError(
            "Interactive input unavailable or cancelled. Aborting update."
        ) from None

    if confirm_input != CONFIRMATION_PHRASE:
        raise EmailUpdateValidationError(
            "Confirmation phrase mismatch. Operation cancelled."
        )


def execute_email_update(
    session: Session,
    new_email: str = CORRECTED_EMAIL,
    target_user_id: int = TARGET_USER_ID,
    expected_current_email: str = EXPECTED_CURRENT_EMAIL,
) -> User:
    """Atomically update administrator email and commit audit log record under advisory lock.

    Guarantees:
    - Transaction-scoped PostgreSQL advisory lock
    - Row-level SELECT ... FOR UPDATE locking on User
    - Validates target exists, has ID 1, has role ADMIN, and is active
    - Validates current email exactly matches expected typo
    - Validates and normalizes replacement email with application regex
    - Validates case-insensitive email uniqueness
    - Mutates ONLY email and updated_at
    - Preserves password_hash, id, role, is_active, employee_id
    - Emits immutable AUTH_ADMIN_EMAIL_UPDATE audit record in same transaction
    - Rolls back entire transaction on any failure
    """
    norm_new_email = new_email.strip().lower()
    if not EMAIL_REGEX.match(norm_new_email):
        raise EmailUpdateValidationError(
            f"Invalid replacement email address format: '{norm_new_email}'."
        )
    if len(norm_new_email) > 255:
        raise EmailUpdateValidationError("Replacement email address exceeds 255 characters.")

    trans = session.begin_nested() if session.in_transaction() else session.begin()
    with trans:
        # 1. Acquire transaction-scoped advisory lock if PostgreSQL
        bind = session.get_bind()
        if getattr(bind.dialect, "name", "") == "postgresql":
            lock_acquired = session.scalar(
                select(
                    func.pg_try_advisory_xact_lock(
                        func.hashtextextended(ADMIN_EMAIL_UPDATE_LOCK_NAME, 0)
                    )
                )
            )
            if not lock_acquired:
                raise EmailUpdateLockError(
                    "Another administrative email update process is actively committing. Exiting."
                )

        # 2. Select and row-lock target administrator row
        admin_user = session.scalar(
            select(User)
            .options(lazyload(User.employee))
            .where(User.id == target_user_id)
            .with_for_update()
        )
        if admin_user is None:
            raise EmailUpdateRefusedError(
                f"Target administrator with User ID {target_user_id} was not found."
            )
        if admin_user.role != "ADMIN":
            raise EmailUpdateRefusedError(
                f"User ID {target_user_id} has role '{admin_user.role}'. "
                "Email update CLI is strictly restricted to administrator accounts."
            )
        if not admin_user.is_active:
            raise EmailUpdateRefusedError(
                f"Administrator account '{admin_user.email}' is deactivated (is_active=False). "
                "Cannot update email for an inactive account."
            )

        # 3. Verify current email exactly matches expected typo
        current_lower = admin_user.email.strip().lower()
        if current_lower != expected_current_email.lower():
            raise EmailUpdateRefusedError(
                f"Administrator email mismatch. Expected '{expected_current_email}', "
                f"but found '{admin_user.email}'."
            )

        # 4. Verify new email is not identical to current
        if norm_new_email == current_lower:
            raise EmailUpdateValidationError(
                "Replacement email is identical to the current email."
            )

        # 5. Check case-insensitive email uniqueness across all other accounts
        duplicate_id = session.scalar(
            select(User.id).where(
                func.lower(User.email) == norm_new_email,
                User.id != target_user_id,
            )
        )
        if duplicate_id is not None:
            raise EmailUpdateRefusedError(
                f"Email address '{norm_new_email}' is already in use by another user account (ID {duplicate_id})."
            )

        # 6. Capture original attributes to verify preservation
        original_id = admin_user.id
        original_password_hash = admin_user.password_hash
        original_role = admin_user.role
        original_is_active = admin_user.is_active
        original_employee_id = admin_user.employee_id
        original_created_at = admin_user.created_at

        # 7. Update ONLY email and updated_at
        admin_user.email = norm_new_email
        admin_user.updated_at = func.now()
        session.flush()

        # 8. Create immutable audit log entry in the same transaction
        audit_entry = AuditLog(
            actor_user_id=admin_user.id,
            action="AUTH_ADMIN_EMAIL_UPDATE",
            target_type="user",
            target_id=str(admin_user.id),
            ip_address=None,
            metadata_={
                "source": "cli_update_admin_email",
                "old_email": expected_current_email,
                "new_email": norm_new_email,
                "role": admin_user.role,
            },
        )
        session.add(audit_entry)
        session.flush()

        # 9. Verify critical invariant preservation
        assert admin_user.id == original_id, "User ID mutated unexpectedly."
        assert admin_user.password_hash == original_password_hash, "Password hash mutated unexpectedly."
        assert admin_user.role == original_role, "Role mutated unexpectedly."
        assert admin_user.is_active == original_is_active, "Active status mutated unexpectedly."
        assert admin_user.employee_id == original_employee_id, "Employee link mutated unexpectedly."
        assert admin_user.created_at == original_created_at, "Created timestamp mutated unexpectedly."

    return admin_user


def run_cli(
    args: list[str] | None = None,
    session_factory: Callable[[], Session] | None = None,
    connection_url: str | None = None,
    input_stream=None,
    target_user_id: int = TARGET_USER_ID,
    expected_current_email: str = EXPECTED_CURRENT_EMAIL,
    new_email: str = CORRECTED_EMAIL,
) -> int:
    """Execute the production administrator email correction workflow.

    Returns exit code (0 for success, 1 for failure).
    """
    parser = argparse.ArgumentParser(
        description="One-time administrator email correction for MBiotrack-EMS."
    )
    parser.add_argument(
        "--production",
        action="store_true",
        default=False,
        help="Explicitly permit execution against the approved Neon production database.",
    )
    if args is None:
        if sys.argv and any("pytest" in a.lower() for a in sys.argv):
            args = []
        else:
            args = sys.argv[1:]
    parsed_args = parser.parse_args(args)

    settings = get_settings()
    env_lower = (settings.ENVIRONMENT or "").strip().lower()
    is_production_mode = parsed_args.production

    # --- Phase 1: Environment and production guard validation ---
    if not is_production_mode:
        print(
            "Error: Running administrator email update requires the explicit '--production' flag.",
            file=sys.stderr,
        )
        return 1

    if env_lower not in ("production", "prod"):
        print(
            "Error: --production flag can only be used when ENVIRONMENT is configured as 'production'.",
            file=sys.stderr,
        )
        return 1

    engine = None
    if session_factory is None:
        # Read connection URL strictly through STDIN
        try:
            raw_url = connection_url or read_connection_url_from_stdin(stream=input_stream)
            validate_target_database(raw_url, is_production=True)
            norm_url = normalize_db_url(raw_url)
            engine = create_engine(
                norm_url,
                pool_pre_ping=True,
                pool_size=1,
                max_overflow=0,
                connect_args={"connect_timeout": 15},
            )
            session_factory = sessionmaker(
                autocommit=False,
                autoflush=False,
                bind=engine,
                expire_on_commit=False,
            )
        except EmailUpdateSecurityError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
        except EmailUpdateValidationError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
        except Exception as exc:
            print(f"Error: Database engine initialization failed: {type(exc).__name__}", file=sys.stderr)
            return 1

    try:
        # --- Phase 2: Preflight target user check (session closed before prompt) ---
        try:
            with session_factory() as preflight_session:
                admin_user = preflight_session.scalar(
                    select(User)
                    .options(lazyload(User.employee))
                    .where(User.id == target_user_id)
                )
                if admin_user is None:
                    print(
                        f"Error: Target administrator with User ID {target_user_id} was not found.",
                        file=sys.stderr,
                    )
                    return 1
                if admin_user.role != "ADMIN":
                    print(
                        f"Error: User ID {target_user_id} has role '{admin_user.role}'. "
                        "Email update CLI is strictly restricted to administrator accounts.",
                        file=sys.stderr,
                    )
                    return 1
                if not admin_user.is_active:
                    print(
                        f"Error: Administrator account '{admin_user.email}' is deactivated.",
                        file=sys.stderr,
                    )
                    return 1
                if admin_user.email.strip().lower() != expected_current_email.lower():
                    print(
                        f"Error: Administrator email mismatch. Expected '{expected_current_email}', "
                        f"but found '{admin_user.email}'.",
                        file=sys.stderr,
                    )
                    return 1
                target_full_name = admin_user.full_name
        except (OperationalError, DBAPIError):
            print(
                "Error: Unable to connect to PostgreSQL production database.",
                file=sys.stderr,
            )
            return 1
        except Exception as exc:
            print(
                f"Error: Preflight database check failed: {type(exc).__name__}",
                file=sys.stderr,
            )
            return 1

        # --- Phase 3: Interactive operator confirmation gate (no open DB session) ---
        try:
            prompt_operator_confirmation(
                target_id=target_user_id,
                current_email=expected_current_email,
                new_email=new_email,
            )
        except EmailUpdateValidationError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
        except (KeyboardInterrupt, EOFError):
            print("\nError: Interactive input unavailable or cancelled. Aborting update.", file=sys.stderr)
            return 1

        # --- Phase 4: Transactional atomic email update ---
        try:
            with session_factory() as update_session:
                updated_user = execute_email_update(
                    session=update_session,
                    new_email=new_email,
                    target_user_id=target_user_id,
                    expected_current_email=expected_current_email,
                )
                print("\n[SUCCESS] Administrator email corrected successfully.")
                print(f"  User ID:   {updated_user.id}")
                print(f"  Full Name: {target_full_name}")
                print(f"  Email:     {updated_user.email}")
                print(f"  Role:      {updated_user.role}")
                print(f"  Active:    {updated_user.is_active}")
                print("  Status:    Email updated and audit event logged.")
                sys.stdout.flush()
                return 0
        except (EmailUpdateLockError, EmailUpdateRefusedError, EmailUpdateValidationError) as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
        except IntegrityError:
            print(
                "Error: Database integrity violation occurred during administrator email update.",
                file=sys.stderr,
            )
            return 1
        except (OperationalError, DBAPIError):
            print(
                "Error: Database connection or operation failed during administrator email update.",
                file=sys.stderr,
            )
            return 1
        except (KeyboardInterrupt, EOFError):
            print("\nError: Operation interrupted. Transaction rolled back.", file=sys.stderr)
            return 1
        except Exception as exc:
            print(
                f"Error: Unexpected error during email update: {type(exc).__name__}",
                file=sys.stderr,
            )
            return 1
    finally:
        if engine is not None:
            try:
                engine.dispose()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(run_cli())
