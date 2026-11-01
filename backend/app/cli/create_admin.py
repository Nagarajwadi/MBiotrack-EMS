import getpass
import ipaddress
import socket
import sys
from typing import Callable

from sqlalchemy import func, select
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import get_engine, get_sessionmaker
from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.auth import EMAIL_REGEX


class BootstrapSecurityError(Exception):
    """Raised when database target validation fails security constraints."""

    pass


class BootstrapValidationError(Exception):
    """Raised when operator input validation fails."""

    pass


class BootstrapLockError(Exception):
    """Raised when advisory lock contention prevents exclusive bootstrap."""

    pass


class BootstrapRefusedError(Exception):
    """Raised when user accounts already exist in the database."""

    pass


def validate_target_database(database_url: str | None) -> None:
    """Validate that the database connection target is an approved local development database.

    Strictly and unconditionally rejects:
    - Missing or empty connection URLs
    - Non-PostgreSQL database drivers
    - The dedicated test database 'mbiotrack_test'
    - Any database name other than 'mbiotrack_dev'
    - Remote hostnames or non-loopback IP addresses
    - Hostnames that resolve to non-loopback addresses
    - Non-standard database ports (port must be 5432 or default)
    """
    if not database_url:
        raise BootstrapSecurityError(
            "DATABASE_URL is not configured in environment or .env file."
        )

    try:
        url = make_url(database_url)
    except Exception:
        raise BootstrapSecurityError(
            "DATABASE_URL is malformed and cannot be parsed."
        ) from None

    driver = (url.drivername or "").lower()
    if not (driver == "postgresql" or driver.startswith("postgresql+")):
        raise BootstrapSecurityError(
            "Database driver must be PostgreSQL (postgresql+psycopg)."
        )

    db_name = (url.database or "").strip().lower()
    if db_name == "mbiotrack_test" or db_name.endswith("_test"):
        raise BootstrapSecurityError(
            "Refusing to run administrator bootstrap against test database 'mbiotrack_test'."
        )
    if db_name != "mbiotrack_dev":
        raise BootstrapSecurityError(
            f"Refusing to run administrator bootstrap against database '{db_name}'. "
            "CLI is strictly restricted to 'mbiotrack_dev'."
        )

    if url.port is not None and url.port != 5432:
        raise BootstrapSecurityError(
            f"Unexpected database port {url.port}. Local PostgreSQL must be configured on port 5432."
        )

    host = (url.host or "").strip().lower()
    if not host:
        raise BootstrapSecurityError(
            "Missing database host in DATABASE_URL. Database host must be 'localhost' or '127.0.0.1'."
        )

    allowed_literals = {"localhost", "127.0.0.1", "::1", "[::1]"}
    if host not in allowed_literals:
        try:
            ip_obj = ipaddress.ip_address(host.strip("[]"))
            if not ip_obj.is_loopback:
                raise BootstrapSecurityError(
                    f"Refusing to run against non-local host '{host}'. Database host must be a loopback address."
                )
        except ValueError:
            raise BootstrapSecurityError(
                f"Refusing to run against non-local host '{host}'. Database host must be 'localhost' or '127.0.0.1'."
            )

    if host == "localhost":
        try:
            addr_infos = socket.getaddrinfo("localhost", None)
            for addr in addr_infos:
                sock_ip = addr[4][0]
                ip_obj = ipaddress.ip_address(sock_ip.strip("[]"))
                if not ip_obj.is_loopback:
                    raise BootstrapSecurityError(
                        "DNS resolution for 'localhost' returned a non-loopback IP address. Aborting for security."
                    )
        except BootstrapSecurityError:
            raise
        except Exception as exc:
            raise BootstrapSecurityError(
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
                raise BootstrapSecurityError(
                    f"Connected PostgreSQL server address '{ip_str}' is not a local loopback address."
                )
        except ValueError:
            raise BootstrapSecurityError(
                f"Could not parse connected PostgreSQL server address '{ip_str}'."
            )


def check_user_count(session: Session) -> int:
    """Return the total number of existing user accounts in the database."""
    return session.scalar(select(func.count(User.id))) or 0


def prompt_credentials() -> tuple[str, str, str]:
    """Interactively prompt operator for administrator name, email, and password."""
    full_name = input("Administrator full name: ").strip()
    if not full_name:
        raise BootstrapValidationError("Full name cannot be blank.")
    if len(full_name) > 150:
        raise BootstrapValidationError("Full name must not exceed 150 characters.")

    email_input = input("Administrator email address: ").strip()
    if not email_input:
        raise BootstrapValidationError("Email address cannot be blank.")
    if not EMAIL_REGEX.match(email_input):
        raise BootstrapValidationError("Invalid email address format.")
    if len(email_input) > 255:
        raise BootstrapValidationError("Email address must not exceed 255 characters.")
    norm_email = email_input.lower()

    password = getpass.getpass("Administrator password (min 12 characters): ")
    if len(password) < 12:
        raise BootstrapValidationError("Password must be at least 12 characters long.")

    confirm_password = getpass.getpass("Confirm administrator password: ")
    if password != confirm_password:
        raise BootstrapValidationError("Passwords do not match.")

    return full_name, norm_email, password


def execute_bootstrap(
    session: Session,
    full_name: str,
    email: str,
    password_hash: str,
) -> User:
    """Atomically create initial administrator user and audit log record under advisory lock."""
    trans = session.begin_nested() if session.in_transaction() else session.begin()
    with trans:
        # 1. Acquire transaction-scoped advisory lock (non-blocking)
        lock_acquired = session.scalar(
            select(
                func.pg_try_advisory_xact_lock(
                    func.hashtextextended("mbiotrack_admin_bootstrap", 0)
                )
            )
        )
        if not lock_acquired:
            raise BootstrapLockError(
                "Another administrator bootstrap process is actively committing. Exiting."
            )

        # 2. Re-check user count under advisory lock
        count = check_user_count(session)
        if count > 0:
            raise BootstrapRefusedError(
                "Administrator bootstrap refused. One or more user accounts already exist in the database."
            )

        # 3. Create active ADMIN user with employee_id=None
        admin_user = User(
            full_name=full_name,
            email=email,
            password_hash=password_hash,
            role="ADMIN",
            employee_id=None,
            is_active=True,
        )
        session.add(admin_user)
        session.flush()

        # 4. Create immutable audit log entry
        audit_entry = AuditLog(
            actor_user_id=admin_user.id,
            action="AUTH_ADMIN_BOOTSTRAP",
            target_type="user",
            target_id=str(admin_user.id),
            ip_address=None,
            metadata_={"source": "cli_bootstrap", "role": "ADMIN"},
        )
        session.add(audit_entry)

    return admin_user


def run_cli(session_factory: Callable[[], Session] | None = None) -> int:
    """Execute the initial administrator creation workflow.

    Returns exit code (0 for success, 1 for failure).
    """
    settings = get_settings()

    if session_factory is None:
        try:
            validate_target_database(settings.DATABASE_URL)
        except BootstrapSecurityError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1

        get_engine()
        session_factory = get_sessionmaker()

    # --- Phase 1: Fast preflight check (session closed before prompting) ---
    try:
        with session_factory() as preflight_session:
            verify_connected_server(preflight_session)
            count = check_user_count(preflight_session)
            if count > 0:
                print(
                    "Error: Administrator bootstrap refused. One or more user accounts already exist in the database.",
                    file=sys.stderr,
                )
                return 1
    except BootstrapSecurityError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except (OperationalError, DBAPIError):
        print(
            "Error: Unable to connect to PostgreSQL development database. Verify PostgreSQL 18 is running on localhost:5432.",
            file=sys.stderr,
        )
        return 1
    except Exception as exc:
        print(
            f"Error: Database check failed: {type(exc).__name__}",
            file=sys.stderr,
        )
        return 1

    # --- Phase 2: Interactive credential prompt & hashing (no open DB session) ---
    try:
        full_name, norm_email, password = prompt_credentials()
        password_hash = hash_password(password)
    except BootstrapValidationError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Error: Credential processing failed: {type(exc).__name__}", file=sys.stderr)
        return 1

    # --- Phase 3: Transactional atomic bootstrap ---
    try:
        with session_factory() as bootstrap_session:
            admin_user = execute_bootstrap(
                session=bootstrap_session,
                full_name=full_name,
                email=norm_email,
                password_hash=password_hash,
            )
            print("\n[SUCCESS] Initial administrator created successfully.")
            print(f"  User ID:   {admin_user.id}")
            print(f"  Full Name: {admin_user.full_name}")
            print(f"  Email:     {admin_user.email}")
            print(f"  Role:      {admin_user.role}")
            print(f"  Active:    {admin_user.is_active}")
            sys.stdout.flush()
            return 0
    except (BootstrapLockError, BootstrapRefusedError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except IntegrityError:
        print(
            "Error: Database integrity violation occurred during administrator creation.",
            file=sys.stderr,
        )
        return 1
    except (OperationalError, DBAPIError):
        print(
            "Error: Database connection or operation failed during administrator creation.",
            file=sys.stderr,
        )
        return 1
    except Exception as exc:
        print(
            f"Error: Unexpected error during bootstrap: {type(exc).__name__}",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    sys.exit(run_cli())
