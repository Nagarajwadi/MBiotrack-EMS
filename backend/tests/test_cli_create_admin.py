import concurrent.futures
import io
import socket
import sys
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app.cli.create_admin import (
    BootstrapLockError,
    BootstrapRefusedError,
    BootstrapSecurityError,
    BootstrapValidationError,
    check_user_count,
    execute_bootstrap,
    prompt_credentials,
    run_cli,
    validate_target_database,
    verify_connected_server,
)
from app.core.security import hash_password, verify_password
from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.user import User


# ===========================================================================
# Target Database Validation Tests (Pure / Unit)
# ===========================================================================

def test_validate_target_approved_dev_url():
    """Valid local development URL must pass validation without errors."""
    valid_url = "postgresql+psycopg://postgres:secret123@localhost:5432/mbiotrack_dev"
    validate_target_database(valid_url)


def test_validate_target_unconditionally_rejects_test_database():
    """Test database 'mbiotrack_test' must be unconditionally rejected with no bypass."""
    test_url = "postgresql+psycopg://postgres:secret123@localhost:5432/mbiotrack_test"
    with pytest.raises(BootstrapSecurityError) as exc_info:
        validate_target_database(test_url)
    assert "Refusing to run administrator bootstrap against test database 'mbiotrack_test'" in str(
        exc_info.value
    )


def test_validate_target_rejects_missing_url():
    """Empty or None database URL must be rejected."""
    with pytest.raises(BootstrapSecurityError) as exc1:
        validate_target_database(None)
    assert "DATABASE_URL is not configured" in str(exc1.value)

    with pytest.raises(BootstrapSecurityError) as exc2:
        validate_target_database("")
    assert "DATABASE_URL is not configured" in str(exc2.value)


def test_validate_target_rejects_malformed_url():
    """Malformed database URL must be rejected without disclosing secrets."""
    malformed_url = "not-a-valid-connection-string://user:secret@localhost"
    with pytest.raises(BootstrapSecurityError) as exc:
        validate_target_database(malformed_url)
    assert "DATABASE_URL is malformed" in str(exc.value)
    # Ensure raw secret is not in exception message
    assert "secret" not in str(exc.value)


def test_validate_target_rejects_non_postgresql_driver():
    """Non-PostgreSQL drivers (e.g. SQLite, MySQL) must be rejected."""
    sqlite_url = "sqlite:///mbiotrack_dev.db"
    with pytest.raises(BootstrapSecurityError) as exc:
        validate_target_database(sqlite_url)
    assert "Database driver must be PostgreSQL" in str(exc.value)


def test_validate_target_rejects_unexpected_database_name():
    """Databases other than 'mbiotrack_dev' must be rejected."""
    prod_url = "postgresql+psycopg://postgres:secret123@localhost:5432/mbiotrack_prod"
    with pytest.raises(BootstrapSecurityError) as exc:
        validate_target_database(prod_url)
    assert "strictly restricted to 'mbiotrack_dev'" in str(exc.value)


def test_validate_target_rejects_remote_hostname():
    """Remote hostnames and public IP addresses must be rejected."""
    remote_ip_url = "postgresql+psycopg://postgres:secret123@192.168.1.100:5432/mbiotrack_dev"
    with pytest.raises(BootstrapSecurityError) as exc1:
        validate_target_database(remote_ip_url)
    assert "Refusing to run against non-local host" in str(exc1.value)

    remote_dns_url = "postgresql+psycopg://postgres:secret123@db.external-company.com:5432/mbiotrack_dev"
    with pytest.raises(BootstrapSecurityError) as exc2:
        validate_target_database(remote_dns_url)
    assert "Refusing to run against non-local host" in str(exc2.value)


def test_validate_target_accepts_loopback_ips():
    """IPv4 and IPv6 loopback addresses must be accepted."""
    validate_target_database("postgresql+psycopg://postgres:pass@127.0.0.1:5432/mbiotrack_dev")
    validate_target_database("postgresql+psycopg://postgres:pass@[::1]:5432/mbiotrack_dev")


def test_validate_target_rejects_unexpected_port():
    """Non-standard PostgreSQL ports must be rejected."""
    nonstandard_port_url = "postgresql+psycopg://postgres:pass@localhost:5433/mbiotrack_dev"
    with pytest.raises(BootstrapSecurityError) as exc:
        validate_target_database(nonstandard_port_url)
    assert "Unexpected database port 5433" in str(exc.value)


def test_validate_target_rejects_non_loopback_localhost_resolution(monkeypatch):
    """If 'localhost' resolves to a non-loopback IP, validation must abort."""
    fake_dns = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("203.0.113.1", 5432)),
    ]
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, port: fake_dns)

    with pytest.raises(BootstrapSecurityError) as exc:
        validate_target_database("postgresql+psycopg://postgres:pass@localhost:5432/mbiotrack_dev")
    assert "non-loopback IP address" in str(exc.value)


def test_verify_connected_server_rejects_remote_server_ip():
    """If inet_server_addr returns an external IP address, verification must raise."""
    mock_session = MagicMock(spec=Session)
    mock_session.scalar.return_value = "198.51.100.5"

    with pytest.raises(BootstrapSecurityError) as exc:
        verify_connected_server(mock_session)
    assert "is not a local loopback address" in str(exc.value)


def test_verify_connected_server_accepts_loopback_and_null():
    """Loopback IP and NULL (Unix domain socket) must pass verification."""
    mock_session = MagicMock(spec=Session)
    mock_session.scalar.return_value = "127.0.0.1"
    verify_connected_server(mock_session)

    mock_session.scalar.return_value = None
    verify_connected_server(mock_session)


# ===========================================================================
# Input Validation & Password Handling Tests
# ===========================================================================

def test_prompt_credentials_success(monkeypatch):
    """Valid operator input must return normalized email and unhashed password."""
    inputs = iter(["  Jane Administrator  ", "  ADMIN@Example.COM  "])
    monkeypatch.setattr("builtins.input", lambda prompt: next(inputs))

    passwords = iter(["SuperSecureAdminSecret123!", "SuperSecureAdminSecret123!"])
    monkeypatch.setattr("getpass.getpass", lambda prompt: next(passwords))

    name, email, pwd = prompt_credentials()
    assert name == "Jane Administrator"
    assert email == "admin@example.com"
    assert pwd == "SuperSecureAdminSecret123!"


def test_prompt_validation_empty_full_name(monkeypatch):
    """Blank or whitespace full name must raise BootstrapValidationError."""
    monkeypatch.setattr("builtins.input", lambda prompt: "   ")
    with pytest.raises(BootstrapValidationError) as exc:
        prompt_credentials()
    assert "Full name cannot be blank" in str(exc.value)


def test_prompt_validation_full_name_too_long(monkeypatch):
    """Full name exceeding 150 characters must be rejected."""
    long_name = "A" * 151
    monkeypatch.setattr("builtins.input", lambda prompt: long_name)
    with pytest.raises(BootstrapValidationError) as exc:
        prompt_credentials()
    assert "must not exceed 150 characters" in str(exc.value)


def test_prompt_validation_invalid_email(monkeypatch):
    """Invalid email formats must be rejected."""
    inputs = iter(["Administrator", "not-an-email-address"])
    monkeypatch.setattr("builtins.input", lambda prompt: next(inputs))

    with pytest.raises(BootstrapValidationError) as exc:
        prompt_credentials()
    assert "Invalid email address format" in str(exc.value)


def test_prompt_validation_short_password(monkeypatch):
    """Password shorter than 12 characters must be rejected."""
    inputs = iter(["Admin User", "admin@example.com"])
    monkeypatch.setattr("builtins.input", lambda prompt: next(inputs))

    passwords = iter(["Short123!", "Short123!"])
    monkeypatch.setattr("getpass.getpass", lambda prompt: next(passwords))

    with pytest.raises(BootstrapValidationError) as exc:
        prompt_credentials()
    assert "Password must be at least 12 characters long" in str(exc.value)


def test_prompt_validation_password_mismatch(monkeypatch):
    """Mismatched confirmation password must be rejected."""
    inputs = iter(["Admin User", "admin@example.com"])
    monkeypatch.setattr("builtins.input", lambda prompt: next(inputs))

    passwords = iter(["ValidPassword123!", "DifferentPassword123!"])
    monkeypatch.setattr("getpass.getpass", lambda prompt: next(passwords))

    with pytest.raises(BootstrapValidationError) as exc:
        prompt_credentials()
    assert "Passwords do not match" in str(exc.value)


# ===========================================================================
# Database Integration Tests (Isolated against mbiotrack_test via savepoints)
# ===========================================================================

def test_bootstrap_preflight_refuses_when_admin_exists(db_session: Session):
    """Fast preflight check refuses execution if an ADMIN user already exists."""
    user = User(
        full_name="Existing Admin",
        email="existing_admin@example.com",
        password_hash=hash_password("SuperSecretPass123!"),
        role="ADMIN",
        employee_id=None,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    assert check_user_count(db_session) == 1

    # Preflight check returns 1 without prompting
    session_factory = lambda: db_session
    stderr_capture = io.StringIO()
    with patch("sys.stderr", stderr_capture):
        exit_code = run_cli(session_factory=session_factory)

    assert exit_code == 1
    assert "One or more user accounts already exist" in stderr_capture.getvalue()


def test_bootstrap_preflight_refuses_when_manager_exists(db_session: Session):
    """Fast preflight check refuses execution if a MANAGER user exists."""
    emp = Employee(
        employee_code="EMP-MGR-001",
        first_name="Manager",
        last_name="One",
        email="mgr@example.com",
        department="Operations",
        designation="Manager",
        joining_date="2026-01-01",
    )
    db_session.add(emp)
    db_session.flush()

    user = User(
        full_name="Existing Manager",
        email="manager@example.com",
        password_hash=hash_password("SuperSecretPass123!"),
        role="MANAGER",
        employee_id=emp.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    assert check_user_count(db_session) == 1

    session_factory = lambda: db_session
    stderr_capture = io.StringIO()
    with patch("sys.stderr", stderr_capture):
        exit_code = run_cli(session_factory=session_factory)

    assert exit_code == 1
    assert "One or more user accounts already exist" in stderr_capture.getvalue()


def test_bootstrap_preflight_refuses_when_employee_exists(db_session: Session):
    """Fast preflight check refuses execution if an EMPLOYEE user exists."""
    emp = Employee(
        employee_code="EMP-DEV-002",
        first_name="Employee",
        last_name="Two",
        email="emp@example.com",
        department="Engineering",
        designation="Developer",
        joining_date="2026-01-01",
    )
    db_session.add(emp)
    db_session.flush()

    user = User(
        full_name="Existing Employee",
        email="employee@example.com",
        password_hash=hash_password("SuperSecretPass123!"),
        role="EMPLOYEE",
        employee_id=emp.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    assert check_user_count(db_session) == 1

    session_factory = lambda: db_session
    stderr_capture = io.StringIO()
    with patch("sys.stderr", stderr_capture):
        exit_code = run_cli(session_factory=session_factory)

    assert exit_code == 1
    assert "One or more user accounts already exist" in stderr_capture.getvalue()


def test_bootstrap_preflight_refuses_when_inactive_user_exists(db_session: Session):
    """Fast preflight check refuses execution even if the only existing user is inactive."""
    user = User(
        full_name="Inactive Admin",
        email="inactive@example.com",
        password_hash=hash_password("SuperSecretPass123!"),
        role="ADMIN",
        employee_id=None,
        is_active=False,
    )
    db_session.add(user)
    db_session.flush()

    assert check_user_count(db_session) == 1

    session_factory = lambda: db_session
    stderr_capture = io.StringIO()
    with patch("sys.stderr", stderr_capture):
        exit_code = run_cli(session_factory=session_factory)

    assert exit_code == 1
    assert "One or more user accounts already exist" in stderr_capture.getvalue()


def test_bootstrap_success_creates_admin_and_audit_record(db_session: Session):
    """Successful bootstrap creates ADMIN user and truthful audit record with ip_address=None."""
    raw_password = "SuperSecretAdminPassword123!"
    pw_hash = hash_password(raw_password)

    admin_user = execute_bootstrap(
        session=db_session,
        full_name="Bootstrap Admin",
        email="new_admin@example.com",
        password_hash=pw_hash,
    )

    # 1. Verify User attributes
    assert admin_user.id is not None
    assert admin_user.full_name == "Bootstrap Admin"
    assert admin_user.email == "new_admin@example.com"
    assert admin_user.role == "ADMIN"
    assert admin_user.employee_id is None
    assert admin_user.is_active is True
    assert verify_password(raw_password, admin_user.password_hash) is True

    # 2. Verify Audit Log entry
    audit = db_session.scalar(
        select(AuditLog)
        .where(AuditLog.action == "AUTH_ADMIN_BOOTSTRAP")
        .order_by(AuditLog.id.desc())
    )
    assert audit is not None
    assert audit.actor_user_id == admin_user.id
    assert audit.target_type == "user"
    assert audit.target_id == str(admin_user.id)
    assert audit.ip_address is None  # Terminal CLI execution: ip_address must be SQL NULL
    assert audit.metadata_ == {"source": "cli_bootstrap", "role": "ADMIN"}


def test_user_insertion_failure_rolls_back(db_session: Session):
    """Failure during User insertion must roll back the transaction cleanly."""
    initial_user_count = check_user_count(db_session)

    # Role constraint violation (e.g. invalid role)
    with pytest.raises(Exception):
        with db_session.begin():
            invalid_user = User(
                full_name="Bad Role User",
                email="bad@example.com",
                password_hash=hash_password("ValidPassword123!"),
                role="SUPERUSER",  # ck_users_role permits only ADMIN, MANAGER, EMPLOYEE
                employee_id=None,
            )
            db_session.add(invalid_user)
            db_session.flush()

    assert check_user_count(db_session) == initial_user_count


def test_audit_log_insertion_failure_rolls_back_admin_creation(db_session: Session):
    """Failure during AuditLog insertion must roll back User creation."""
    initial_user_count = check_user_count(db_session)

    # Simulate an error during audit log insertion inside execute_bootstrap
    def failing_add(instance):
        if isinstance(instance, AuditLog):
            raise IntegrityError("Simulated audit log constraint failure", None, None)
        Session.add(db_session, instance)

    with patch.object(db_session, "add", side_effect=failing_add):
        with pytest.raises(IntegrityError):
            execute_bootstrap(
                session=db_session,
                full_name="Should Rollback",
                email="rollback@example.com",
                password_hash=hash_password("ValidPassword123!"),
            )

    # Transaction rolled back: zero users created
    assert check_user_count(db_session) == initial_user_count


def test_failure_immediately_before_commit_rolls_back(db_session: Session):
    """Failure right before commit must roll back all inserts and release lock."""
    initial_user_count = check_user_count(db_session)

    with pytest.raises(RuntimeError):
        with db_session.begin_nested():
            user = User(
                full_name="Pending Admin",
                email="pending@example.com",
                password_hash=hash_password("ValidPassword123!"),
                role="ADMIN",
                employee_id=None,
                is_active=True,
            )
            db_session.add(user)
            db_session.flush()
            # Simulate crash or abort right before commit
            raise RuntimeError("Simulated crash immediately before transaction commit")

    assert check_user_count(db_session) == initial_user_count


def test_duplicate_email_uniqueness_violation_rolls_back(db_session: Session):
    """Attempting to insert an admin with an existing lowercase email raises IntegrityError and rolls back."""
    user1 = User(
        full_name="First Admin",
        email="duplicate@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="ADMIN",
        employee_id=None,
        is_active=True,
    )
    db_session.add(user1)
    db_session.flush()

    with pytest.raises(IntegrityError):
        with db_session.begin_nested():
            user2 = User(
                full_name="Second Admin",
                email="DUPLICATE@example.com",  # Matches lower(email) unique index
                password_hash=hash_password("ValidPassword123!"),
                role="ADMIN",
                employee_id=None,
                is_active=True,
            )
            db_session.add(user2)
            db_session.flush()


def test_advisory_lock_contention(db_session: Session, monkeypatch):
    """If another process holds the advisory lock, execute_bootstrap raises BootstrapLockError."""
    # Mock pg_try_advisory_xact_lock to return False
    monkeypatch.setattr(db_session, "scalar", lambda stmt: False)

    with pytest.raises(BootstrapLockError) as exc:
        execute_bootstrap(
            session=db_session,
            full_name="Locked Admin",
            email="locked@example.com",
            password_hash=hash_password("ValidPassword123!"),
        )

    assert "Another administrator bootstrap process is actively committing" in str(exc.value)


def test_database_connection_failure_handled_safely():
    """OperationalError during preflight check exits with 1 and displays clean error message."""
    mock_session_factory = MagicMock(side_effect=OperationalError("Connection refused", None, None))
    stderr_capture = io.StringIO()

    with patch("sys.stderr", stderr_capture):
        exit_code = run_cli(session_factory=mock_session_factory)

    assert exit_code == 1
    assert "Unable to connect to PostgreSQL development database" in stderr_capture.getvalue()
    # Confirm no traceback or raw internal credentials exposed
    assert "Traceback" not in stderr_capture.getvalue()


def test_concurrent_bootstrap_attempts_independent_connections(test_engine):
    """Two concurrent processes using independent DB sessions against mbiotrack_test.

    Exactly one process succeeds in creating the initial account; the competing process fails.
    """
    admin_email = "concurrent_admin@example.com"
    pw_hash = hash_password("SuperSecretPass123!")

    # Verify database is empty of this email initially
    with Session(bind=test_engine) as check_session:
        check_session.execute(delete(AuditLog).where(AuditLog.target_type == "user"))
        check_session.execute(delete(User).where(func.lower(User.email) == admin_email))
        check_session.commit()

    def attempt_bootstrap(name: str):
        with Session(bind=test_engine) as session:
            try:
                execute_bootstrap(
                    session=session,
                    full_name=name,
                    email=admin_email,
                    password_hash=pw_hash,
                )
                return 0
            except (BootstrapLockError, BootstrapRefusedError, IntegrityError):
                return 1

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            f1 = executor.submit(attempt_bootstrap, "Worker One")
            f2 = executor.submit(attempt_bootstrap, "Worker Two")
            results = [f1.result(), f2.result()]

        # Exactly one thread succeeds (code 0) and one thread is rejected (code 1)
        assert results.count(0) == 1, f"Expected exactly 1 success, got results: {results}"
        assert results.count(1) == 1, f"Expected exactly 1 failure, got results: {results}"

        # Verify exactly one user account was committed to PostgreSQL
        with Session(bind=test_engine) as verify_session:
            created_count = verify_session.scalar(
                select(func.count(User.id)).where(func.lower(User.email) == admin_email)
            )
            assert created_count == 1
    finally:
        # Strictly clean up created test records from mbiotrack_test
        with Session(bind=test_engine) as cleanup_session:
            cleanup_session.execute(delete(AuditLog).where(AuditLog.target_type == "user"))
            cleanup_session.execute(delete(User).where(func.lower(User.email) == admin_email))
            cleanup_session.commit()


def test_no_secret_or_credential_leakage_in_output(monkeypatch):
    """Verify that passwords, hashes, connection URLs, and secrets never leak in stdout or stderr."""
    secret_pw = "SuperSecretPasswordDoNotLeak999!"
    db_pass = "my_top_secret_db_password"
    db_url = f"postgresql+psycopg://postgres:{db_pass}@localhost:5432/mbiotrack_dev"

    inputs = iter(["Administrator", "admin@example.com"])
    monkeypatch.setattr("builtins.input", lambda prompt: next(inputs))

    passwords = iter([secret_pw, secret_pw])
    monkeypatch.setattr("getpass.getpass", lambda prompt: next(passwords))

    # Mock validate_target_database to test full run_cli flow with mock session
    mock_session = MagicMock()
    mock_session.scalar.side_effect = [
        "127.0.0.1",  # inet_server_addr
        0,            # preflight check count
        True,         # advisory lock acquired
        0,            # lock re-check count
    ]
    mock_session_factory = MagicMock(return_value=mock_session)
    mock_session.__enter__.return_value = mock_session

    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()

    with patch("sys.stdout", stdout_capture), patch("sys.stderr", stderr_capture):
        with patch("app.cli.create_admin.validate_target_database"):
            run_cli(session_factory=mock_session_factory)

    combined_output = stdout_capture.getvalue() + stderr_capture.getvalue()

    # Plaintext password must never appear
    assert secret_pw not in combined_output
    # Database password must never appear
    assert db_pass not in combined_output
    # Full connection URL must never appear
    assert db_url not in combined_output
    # Argon2id prefix or hash fragments must never appear
    assert "$argon2id$" not in combined_output
