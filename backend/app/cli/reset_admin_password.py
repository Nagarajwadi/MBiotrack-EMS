import getpass
import ipaddress
import socket
import sys
from typing import Callable

from sqlalchemy import func, select
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError
from sqlalchemy.orm import Session, lazyload

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import get_engine, get_sessionmaker
from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.auth import EMAIL_REGEX


class RecoverySecurityError(Exception):
    """Raised when database target validation fails security constraints."""

    pass


class RecoveryValidationError(Exception):
    """Raised when operator input validation fails or is cancelled."""

    pass


class RecoveryLockError(Exception):
    """Raised when advisory lock contention prevents exclusive password reset."""

    pass


class RecoveryRefusedError(Exception):
    """Raised when the target account cannot be reset (not found, inactive, or non-admin)."""

    pass


def validate_target_database(
    database_url: str | None,
    environment: str | None = None,
) -> None:
    """Validate that the database connection target is strictly local development.

    Strictly and unconditionally rejects:
    - Production and staging environments
    - Missing or empty connection URLs
    - Non-PostgreSQL database drivers
    - The dedicated test database 'mbiotrack_test' and any '*_test' database
    - Any database name other than 'mbiotrack_dev'
    - Remote hostnames or non-loopback IP addresses
    - Hostnames that resolve to non-loopback addresses
    - Non-standard database ports (port must be 5432 or default)
    """
    if environment is not None:
        env_lower = environment.strip().lower()
        if env_lower in ("production", "prod", "staging", "stage"):
            raise RecoverySecurityError(
                f"Refusing to run password reset in '{environment}' environment. "
                "CLI is strictly restricted to development."
            )

    if not database_url:
        raise RecoverySecurityError(
            "DATABASE_URL is not configured in environment or .env file."
        )

    try:
        url = make_url(database_url)
    except Exception:
        raise RecoverySecurityError(
            "DATABASE_URL is malformed and cannot be parsed."
        ) from None

    driver = (url.drivername or "").lower()
    if not (driver == "postgresql" or driver.startswith("postgresql+")):
        raise RecoverySecurityError(
            "Database driver must be PostgreSQL (postgresql+psycopg)."
        )

    db_name = (url.database or "").strip().lower()
    if db_name == "mbiotrack_test" or db_name.endswith("_test"):
        raise RecoverySecurityError(
            "Refusing to run administrator password reset against test database 'mbiotrack_test'."
        )
    if db_name != "mbiotrack_dev":
        raise RecoverySecurityError(
            f"Refusing to run administrator password reset against database '{db_name}'. "
            "CLI is strictly restricted to 'mbiotrack_dev'."
        )

    if url.port is not None and url.port != 5432:
        raise RecoverySecurityError(
            f"Unexpected database port {url.port}. Local PostgreSQL must be configured on port 5432."
        )

    host = (url.host or "").strip().lower()
    if not host:
        raise RecoverySecurityError(
            "Missing database host in DATABASE_URL. Database host must be 'localhost' or '127.0.0.1'."
        )

    allowed_literals = {"localhost", "127.0.0.1", "::1", "[::1]"}
    if host not in allowed_literals:
        try:
            ip_obj = ipaddress.ip_address(host.strip("[]"))
            if not ip_obj.is_loopback:
                raise RecoverySecurityError(
                    f"Refusing to run against non-local host '{host}'. "
                    "Database host must be a loopback address."
                )
        except ValueError:
            raise RecoverySecurityError(
                f"Refusing to run against non-local host '{host}'. "
                "Database host must be 'localhost' or '127.0.0.1'."
            )

    if host == "localhost":
        try:
            addr_infos = socket.getaddrinfo("localhost", None)
            for addr in addr_infos:
                sock_ip = addr[4][0]
                ip_obj = ipaddress.ip_address(sock_ip.strip("[]"))
                if not ip_obj.is_loopback:
                    raise RecoverySecurityError(
                        "DNS resolution for 'localhost' returned a non-loopback IP address. "
                        "Aborting for security."
                    )
        except RecoverySecurityError:
            raise
        except Exception as exc:
            raise RecoverySecurityError(
                f"Failed to verify 'localhost' DNS resolution: {exc}"
            ) from None


def verify_connected_server(session: Session) -> None:
    """Verify that the active PostgreSQL connection is bound to a local loopback server."""
    server_ip = session.scalar(select(func.inet_server_addr()))
    if server_ip is not None:
        ip_str = str(server_ip).strip("[]")
        try:
            ip_obj = ipaddress.ip_address(ip_str)
            if not ip_obj.is_loopback:
                raise RecoverySecurityError(
                    f"Connected PostgreSQL server address '{ip_str}' is not a local loopback address."
                )
        except ValueError:
            raise RecoverySecurityError(
                f"Could not parse connected PostgreSQL server address '{ip_str}'."
            )


def find_and_validate_admin(session: Session, email: str) -> User:
    """Find and validate target administrator user account."""
    norm_email = email.strip().lower()
    user = session.scalar(
        select(User)
        .options(lazyload(User.employee))
        .where(func.lower(User.email) == norm_email)
    )
    if user is None:
        raise RecoveryRefusedError(
            f"No user account found matching email '{norm_email}'."
        )
    if user.role != "ADMIN":
        raise RecoveryRefusedError(
            f"User '{user.email}' has role '{user.role}'. "
            "Password recovery CLI is strictly restricted to administrator accounts."
        )
    if not user.is_active:
        raise RecoveryRefusedError(
            f"Administrator account '{user.email}' is deactivated (is_active=False). "
            "Cannot reset password for an inactive account."
        )
    return user


def prompt_operator_confirmation(target_email: str) -> None:
    """Require operator to explicitly confirm target and type 'RESET'."""
    print("=" * 64)
    print("MBiotrack-EMS: Development Administrator Password Recovery")
    print("=" * 64)
    print(f"  Target User:     {target_email} (Role: ADMIN)")
    print("  Target Database: mbiotrack_dev (PostgreSQL on localhost:5432)")
    print("=" * 64)
    print("WARNING: This will overwrite the existing password for this administrator.")
    print("To confirm this operation, type 'RESET' exactly as shown.")
    confirmation = input("Confirmation: ").strip()
    if confirmation != "RESET":
        raise RecoveryValidationError("Confirmation word did not match 'RESET'. Reset cancelled.")


def prompt_new_password() -> str:
    """Prompt operator for new password with confirmation and enforce 12-char policy."""
    password = getpass.getpass("New administrator password (min 12 characters): ")
    if len(password) < 12:
        raise RecoveryValidationError("Password must be at least 12 characters long.")

    confirm_password = getpass.getpass("Confirm new administrator password: ")
    if password != confirm_password:
        raise RecoveryValidationError("Passwords do not match.")

    return password


def execute_password_reset(
    session: Session,
    email: str,
    new_password_hash: str,
) -> User:
    """Atomically update administrator password hash and commit audit log record under lock."""
    norm_email = email.strip().lower()
    trans = session.begin_nested() if session.in_transaction() else session.begin()
    with trans:
        # 1. Acquire transaction-scoped advisory lock (non-blocking)
        lock_acquired = session.scalar(
            select(
                func.pg_try_advisory_xact_lock(
                    func.hashtextextended("mbiotrack_admin_password_reset", 0)
                )
            )
        )
        if not lock_acquired:
            raise RecoveryLockError(
                "Another administrator password reset process is actively committing. Exiting."
            )

        # 2. Select and lock the target user row under advisory lock
        admin_user = session.scalar(
            select(User)
            .options(lazyload(User.employee))
            .where(func.lower(User.email) == norm_email)
            .with_for_update()
        )
        if admin_user is None:
            raise RecoveryRefusedError(
                f"No user account found matching email '{norm_email}'."
            )
        if admin_user.role != "ADMIN":
            raise RecoveryRefusedError(
                f"User '{admin_user.email}' has role '{admin_user.role}'. "
                "Password recovery CLI is strictly restricted to administrator accounts."
            )
        if not admin_user.is_active:
            raise RecoveryRefusedError(
                f"Administrator account '{admin_user.email}' is deactivated."
            )

        # 3. Update password hash and updated_at timestamp
        admin_user.password_hash = new_password_hash
        admin_user.updated_at = func.now()
        session.flush()

        # 4. Create immutable audit log entry
        audit_entry = AuditLog(
            actor_user_id=admin_user.id,
            action="AUTH_ADMIN_PASSWORD_RESET",
            target_type="user",
            target_id=str(admin_user.id),
            ip_address="127.0.0.1",
            metadata_={"source": "cli_dev_reset", "role": "ADMIN"},
        )
        session.add(audit_entry)

    return admin_user


def run_cli(
    session_factory: Callable[[], Session] | None = None,
    target_email: str | None = None,
) -> int:
    """Execute the development administrator password recovery workflow.

    Returns exit code (0 for success, 1 for failure).
    """
    settings = get_settings()

    # --- Phase 1: Target database and environment validation ---
    try:
        validate_target_database(
            database_url=settings.DATABASE_URL,
            environment=settings.ENVIRONMENT,
        )
    except RecoverySecurityError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    if session_factory is None:
        get_engine()
        session_factory = get_sessionmaker()

    # --- Phase 2: Resolve target email ---
    if not target_email:
        default_email = "admin@mbiotrack.local"
        try:
            email_input = input(f"Administrator email address [{default_email}]: ").strip()
            resolved_email = email_input if email_input else default_email
        except (KeyboardInterrupt, EOFError):
            print("\nOperation cancelled by user.", file=sys.stderr)
            return 1
    else:
        resolved_email = target_email.strip()

    if not EMAIL_REGEX.match(resolved_email):
        print(f"Error: Invalid email address format: '{resolved_email}'", file=sys.stderr)
        return 1

    # --- Phase 3: Preflight target user verification (session closed before prompt) ---
    try:
        with session_factory() as preflight_session:
            verify_connected_server(preflight_session)
            admin_user = find_and_validate_admin(preflight_session, resolved_email)
            target_full_name = admin_user.full_name
            target_id = admin_user.id
    except (RecoverySecurityError, RecoveryRefusedError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except (OperationalError, DBAPIError):
        print(
            "Error: Unable to connect to PostgreSQL development database. "
            "Verify PostgreSQL 18 is running on localhost:5432.",
            file=sys.stderr,
        )
        return 1
    except Exception as exc:
        print(f"Error: Preflight database check failed: {type(exc).__name__}", file=sys.stderr)
        return 1

    # --- Phase 4: Interactive operator confirmation & password prompt (no open DB session) ---
    try:
        prompt_operator_confirmation(resolved_email)
        new_password = prompt_new_password()
        password_hash = hash_password(new_password)
    except RecoveryValidationError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print("\nOperation cancelled by user.", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Error: Credential processing failed: {type(exc).__name__}", file=sys.stderr)
        return 1

    # --- Phase 5: Transactional atomic reset ---
    try:
        with session_factory() as reset_session:
            updated_user = execute_password_reset(
                session=reset_session,
                email=resolved_email,
                new_password_hash=password_hash,
            )
            print("\n[SUCCESS] Administrator password reset successfully.")
            print(f"  User ID:   {updated_user.id}")
            print(f"  Full Name: {target_full_name}")
            print(f"  Email:     {updated_user.email}")
            print(f"  Role:      {updated_user.role}")
            print("  Status:    Password updated and audit event logged.")
            sys.stdout.flush()
            return 0
    except (RecoveryLockError, RecoveryRefusedError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except IntegrityError:
        print(
            "Error: Database integrity violation occurred during password reset.",
            file=sys.stderr,
        )
        return 1
    except (OperationalError, DBAPIError):
        print(
            "Error: Database connection or operation failed during password reset.",
            file=sys.stderr,
        )
        return 1
    except (KeyboardInterrupt, EOFError):
        print("\nOperation interrupted. Transaction rolled back.", file=sys.stderr)
        return 1
    except Exception as exc:
        print(
            f"Error: Unexpected error during password reset: {type(exc).__name__}",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    target = sys.argv[1].strip() if len(sys.argv) > 1 else None
    sys.exit(run_cli(target_email=target))
