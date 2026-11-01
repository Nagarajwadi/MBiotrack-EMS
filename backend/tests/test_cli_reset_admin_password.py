import io
import socket
import sys
from datetime import date
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.cli.reset_admin_password import (
    RecoveryLockError,
    RecoveryRefusedError,
    RecoverySecurityError,
    RecoveryValidationError,
    execute_password_reset,
    find_and_validate_admin,
    prompt_new_password,
    prompt_operator_confirmation,
    run_cli,
    validate_target_database,
    verify_connected_server,
)
from app.core.security import hash_password, verify_password
from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.user import User


# ===========================================================================
# 1. Target Database & Environment Validation Tests (Pure / Unit)
# ===========================================================================

def test_validate_target_approved_dev_url():
    """Valid local development URL and development environment must pass validation."""
    valid_url = "postgresql+psycopg://postgres:secret123@localhost:5432/mbiotrack_dev"
    validate_target_database(valid_url, environment="development")
    validate_target_database(valid_url, environment="dev")
    validate_target_database(valid_url, environment=None)


def test_validate_target_unconditionally_rejects_test_database():
    """Test databases ending in '_test' or named 'mbiotrack_test' must be rejected."""
    test_url = "postgresql+psycopg://postgres:secret123@localhost:5432/mbiotrack_test"
    with pytest.raises(RecoverySecurityError) as exc:
        validate_target_database(test_url, environment="development")
    assert "Refusing to run administrator password reset against test database 'mbiotrack_test'" in str(exc.value)

    other_test_url = "postgresql+psycopg://postgres:secret123@localhost:5432/custom_test"
    with pytest.raises(RecoverySecurityError) as exc2:
        validate_target_database(other_test_url, environment="development")
    assert "Refusing to run administrator password reset against test database" in str(exc2.value)


def test_validate_target_rejects_production_environment():
    """Production and staging environments must be unconditionally rejected."""
    valid_url = "postgresql+psycopg://postgres:secret123@localhost:5432/mbiotrack_dev"

    for env in ("production", "PROD", "staging", "STAGE"):
        with pytest.raises(RecoverySecurityError) as exc:
            validate_target_database(valid_url, environment=env)
        assert "Refusing to run password reset in" in str(exc.value)
        assert "strictly restricted to development" in str(exc.value)


def test_validate_target_rejects_missing_url():
    """Missing or empty DATABASE_URL must be rejected."""
    with pytest.raises(RecoverySecurityError) as exc1:
        validate_target_database(None, environment="development")
    assert "DATABASE_URL is not configured" in str(exc1.value)

    with pytest.raises(RecoverySecurityError) as exc2:
        validate_target_database("", environment="development")
    assert "DATABASE_URL is not configured" in str(exc2.value)


def test_validate_target_rejects_malformed_url():
    """Malformed database URL must be rejected without disclosing secrets."""
    malformed_url = "not-a-valid-connection-string://user:secret@localhost"
    with pytest.raises(RecoverySecurityError) as exc:
        validate_target_database(malformed_url, environment="development")
    assert "DATABASE_URL is malformed" in str(exc.value)
    assert "secret" not in str(exc.value)


def test_validate_target_rejects_non_postgresql_driver():
    """Non-PostgreSQL drivers (e.g. SQLite, MySQL) must be rejected."""
    sqlite_url = "sqlite:///mbiotrack_dev.db"
    with pytest.raises(RecoverySecurityError) as exc:
        validate_target_database(sqlite_url, environment="development")
    assert "Database driver must be PostgreSQL" in str(exc.value)


def test_validate_target_rejects_non_dev_database():
    """Databases other than 'mbiotrack_dev' must be rejected."""
    prod_url = "postgresql+psycopg://postgres:secret123@localhost:5432/mbiotrack_prod"
    with pytest.raises(RecoverySecurityError) as exc:
        validate_target_database(prod_url, environment="development")
    assert "strictly restricted to 'mbiotrack_dev'" in str(exc.value)


def test_validate_target_rejects_remote_hostname_and_ip():
    """Remote hostnames and public IP addresses must be rejected."""
    remote_ip_url = "postgresql+psycopg://postgres:secret123@192.168.1.100:5432/mbiotrack_dev"
    with pytest.raises(RecoverySecurityError) as exc1:
        validate_target_database(remote_ip_url, environment="development")
    assert "Refusing to run against non-local host" in str(exc1.value)

    remote_dns_url = "postgresql+psycopg://postgres:secret123@db.external-company.com:5432/mbiotrack_dev"
    with pytest.raises(RecoverySecurityError) as exc2:
        validate_target_database(remote_dns_url, environment="development")
    assert "Refusing to run against non-local host" in str(exc2.value)


def test_validate_target_rejects_non_5432_port():
    """Unexpected database ports must be rejected."""
    alt_port_url = "postgresql+psycopg://postgres:secret123@localhost:5433/mbiotrack_dev"
    with pytest.raises(RecoverySecurityError) as exc:
        validate_target_database(alt_port_url, environment="development")
    assert "Unexpected database port 5433" in str(exc.value)


def test_validate_target_accepts_loopback_ips():
    """Standard loopback representations must pass validation."""
    for host in ("127.0.0.1", "localhost", "[::1]"):
        url = f"postgresql+psycopg://postgres:secret123@{host}:5432/mbiotrack_dev"
        validate_target_database(url, environment="development")


def test_validate_target_rejects_non_loopback_dns_for_localhost(monkeypatch):
    """If 'localhost' resolves to a non-loopback IP, validation must abort."""
    fake_addrinfo = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.1.50", 5432))]
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, port: fake_addrinfo)

    dev_url = "postgresql+psycopg://postgres:secret123@localhost:5432/mbiotrack_dev"
    with pytest.raises(RecoverySecurityError) as exc:
        validate_target_database(dev_url, environment="development")
    assert "DNS resolution for 'localhost' returned a non-loopback IP address" in str(exc.value)


# ===========================================================================
# 2. Connected Server Verification Tests
# ===========================================================================

def test_verify_connected_server_accepts_loopback():
    """verify_connected_server passes when inet_server_addr returns a loopback IP."""
    mock_session = MagicMock()
    mock_session.scalar.return_value = "127.0.0.1"
    verify_connected_server(mock_session)

    mock_session.scalar.return_value = "::1"
    verify_connected_server(mock_session)


def test_verify_connected_server_rejects_remote_ip():
    """verify_connected_server raises RecoverySecurityError when server IP is non-loopback."""
    mock_session = MagicMock()
    mock_session.scalar.return_value = "10.0.1.50"

    with pytest.raises(RecoverySecurityError) as exc:
        verify_connected_server(mock_session)
    assert "is not a local loopback address" in str(exc.value)


# ===========================================================================
# 3. Target Admin User Validation Tests
# ===========================================================================

def test_find_and_validate_admin_nonexistent_email(db_session: Session):
    """Attempting to find an email that does not exist raises RecoveryRefusedError."""
    with pytest.raises(RecoveryRefusedError) as exc:
        find_and_validate_admin(db_session, "nonexistent@example.com")
    assert "No user account found matching email" in str(exc.value)


def test_find_and_validate_admin_rejects_manager_or_employee(db_session: Session):
    """Attempting to reset a MANAGER or EMPLOYEE account raises RecoveryRefusedError."""
    emp = Employee(
        employee_code="EMP-MGR-99",
        first_name="Manager",
        last_name="Test",
        email="manager_emp@example.com",
        department="Operations",
        designation="Manager",
        joining_date=date(2026, 1, 1),
        is_active=True,
    )
    db_session.add(emp)
    db_session.flush()

    user = User(
        full_name="Manager User",
        email="manager_test@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="MANAGER",
        employee_id=emp.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    with pytest.raises(RecoveryRefusedError) as exc:
        find_and_validate_admin(db_session, "manager_test@example.com")
    assert "has role 'MANAGER'" in str(exc.value)
    assert "strictly restricted to administrator accounts" in str(exc.value)


def test_find_and_validate_admin_rejects_inactive_admin(db_session: Session):
    """Deactivated administrator account raises RecoveryRefusedError."""
    user = User(
        full_name="Inactive Admin",
        email="inactive_admin@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="ADMIN",
        employee_id=None,
        is_active=False,
    )
    db_session.add(user)
    db_session.flush()

    with pytest.raises(RecoveryRefusedError) as exc:
        find_and_validate_admin(db_session, "inactive_admin@example.com")
    assert "is deactivated" in str(exc.value)


def test_find_and_validate_admin_accepts_active_admin(db_session: Session):
    """Valid, active ADMIN user is found and returned."""
    user = User(
        full_name="Active Admin",
        email="active_admin@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="ADMIN",
        employee_id=None,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    found = find_and_validate_admin(db_session, "ACTIVE_ADMIN@EXAMPLE.COM")
    assert found.id == user.id
    assert found.email == "active_admin@example.com"
    assert found.role == "ADMIN"


# ===========================================================================
# 4. Confirmation & Password Input Validation Tests
# ===========================================================================

def test_prompt_operator_confirmation_accepts_exact_reset(monkeypatch):
    """Entering exact word 'RESET' succeeds without error."""
    monkeypatch.setattr("builtins.input", lambda prompt: "RESET")
    prompt_operator_confirmation("admin@example.com")


def test_prompt_operator_confirmation_rejects_mismatch(monkeypatch):
    """Entering lowercase 'reset', 'yes', or other words raises RecoveryValidationError."""
    for wrong in ("reset", "yes", "Y", "CANCEL", ""):
        monkeypatch.setattr("builtins.input", lambda prompt, w=wrong: w)
        with pytest.raises(RecoveryValidationError) as exc:
            prompt_operator_confirmation("admin@example.com")
        assert "Confirmation word did not match 'RESET'" in str(exc.value)


def test_prompt_new_password_rejects_short_password(monkeypatch):
    """Passwords shorter than 12 characters are rejected."""
    passwords = iter(["Short1!", "Short1!"])
    monkeypatch.setattr("getpass.getpass", lambda prompt: next(passwords))

    with pytest.raises(RecoveryValidationError) as exc:
        prompt_new_password()
    assert "Password must be at least 12 characters long" in str(exc.value)


def test_prompt_new_password_rejects_mismatched_confirmation(monkeypatch):
    """Mismatched confirmation password raises RecoveryValidationError."""
    passwords = iter(["LongPassword123!", "DifferentLongPassword123!"])
    monkeypatch.setattr("getpass.getpass", lambda prompt: next(passwords))

    with pytest.raises(RecoveryValidationError) as exc:
        prompt_new_password()
    assert "Passwords do not match" in str(exc.value)


def test_prompt_new_password_accepts_valid_password(monkeypatch):
    """Valid, matching 12+ character password succeeds."""
    passwords = iter(["CorrectPassword123!", "CorrectPassword123!"])
    monkeypatch.setattr("getpass.getpass", lambda prompt: next(passwords))

    pw = prompt_new_password()
    assert pw == "CorrectPassword123!"


# ===========================================================================
# 5. Atomic Password Reset & Audit Log Invariants
# ===========================================================================

def test_execute_password_reset_success(db_session: Session):
    """Successful reset updates password hash, updated_at, and commits audit log entry."""
    old_pw = "OldSecretPassword123!"
    new_pw = "NewSecretPassword123!"

    user = User(
        full_name="Target Admin",
        email="target_admin@example.com",
        password_hash=hash_password(old_pw),
        role="ADMIN",
        employee_id=None,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    assert verify_password(old_pw, user.password_hash) is True
    assert verify_password(new_pw, user.password_hash) is False

    new_hash = hash_password(new_pw)
    updated_user = execute_password_reset(
        session=db_session,
        email="target_admin@example.com",
        new_password_hash=new_hash,
    )

    # 1. Password verification
    assert verify_password(new_pw, updated_user.password_hash) is True
    assert verify_password(old_pw, updated_user.password_hash) is False

    # 2. Audit log entry created in same transaction
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.actor_user_id == updated_user.id,
            AuditLog.action == "AUTH_ADMIN_PASSWORD_RESET",
        )
    )
    assert audit is not None
    assert audit.target_type == "user"
    assert audit.target_id == str(updated_user.id)
    assert audit.metadata_ == {"source": "cli_dev_reset", "role": "ADMIN"}


def test_execute_password_reset_rolls_back_if_audit_fails(db_session: Session):
    """If audit log insertion fails, the password update must be completely rolled back."""
    old_pw = "OriginalPassword123!"
    user = User(
        full_name="Rollback Admin",
        email="rollback_admin@example.com",
        password_hash=hash_password(old_pw),
        role="ADMIN",
        employee_id=None,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    new_hash = hash_password("NewAttemptPassword123!")

    # Intercept session.add to simulate failure when adding AuditLog
    def failing_add(instance):
        if isinstance(instance, AuditLog):
            raise IntegrityError("Simulated audit log constraint failure", None, None)
        Session.add(db_session, instance)

    with patch.object(db_session, "add", side_effect=failing_add):
        with pytest.raises(IntegrityError):
            execute_password_reset(
                session=db_session,
                email="rollback_admin@example.com",
                new_password_hash=new_hash,
            )

    # Refresh user from database session; password must remain the old password
    db_session.refresh(user)
    assert verify_password(old_pw, user.password_hash) is True


def test_execute_password_reset_lock_contention(db_session: Session, monkeypatch):
    """If another process holds the advisory lock, execute_password_reset raises RecoveryLockError."""
    monkeypatch.setattr(db_session, "scalar", lambda stmt: False)

    with pytest.raises(RecoveryLockError) as exc:
        execute_password_reset(
            session=db_session,
            email="locked@example.com",
            new_password_hash=hash_password("ValidPassword123!"),
        )
    assert "Another administrator password reset process is actively committing" in str(exc.value)


# ===========================================================================
# 6. CLI Execution Workflow & Leakage Tests
# ===========================================================================

def test_run_cli_aborts_on_confirmation_mismatch(monkeypatch):
    """Mismatched confirmation input in run_cli exits with code 1."""
    mock_session = MagicMock()
    mock_session.scalar.side_effect = [
        "127.0.0.1",  # inet_server_addr
        User(id=1, email="admin@mbiotrack.local", role="ADMIN", is_active=True, full_name="Admin"),
    ]
    mock_session_factory = MagicMock(return_value=mock_session)
    mock_session.__enter__.return_value = mock_session

    inputs = iter(["NOPE"])
    monkeypatch.setattr("builtins.input", lambda prompt: next(inputs))

    stderr_capture = io.StringIO()
    with patch("sys.stderr", stderr_capture):
        with patch("app.cli.reset_admin_password.validate_target_database"):
            exit_code = run_cli(
                session_factory=mock_session_factory,
                target_email="admin@mbiotrack.local",
            )

    assert exit_code == 1
    assert "Confirmation word did not match 'RESET'" in stderr_capture.getvalue()


def test_run_cli_handles_keyboard_interrupt(monkeypatch):
    """KeyboardInterrupt at confirmation prompt cleanly exits with code 1."""
    mock_session = MagicMock()
    mock_session.scalar.side_effect = [
        "127.0.0.1",  # inet_server_addr
        User(id=1, email="admin@mbiotrack.local", role="ADMIN", is_active=True, full_name="Admin"),
    ]
    mock_session_factory = MagicMock(return_value=mock_session)
    mock_session.__enter__.return_value = mock_session

    def raise_interrupt(prompt):
        raise KeyboardInterrupt()

    monkeypatch.setattr("builtins.input", raise_interrupt)

    stderr_capture = io.StringIO()
    with patch("sys.stderr", stderr_capture):
        with patch("app.cli.reset_admin_password.validate_target_database"):
            exit_code = run_cli(
                session_factory=mock_session_factory,
                target_email="admin@mbiotrack.local",
            )

    assert exit_code == 1
    assert "Operation cancelled by user" in stderr_capture.getvalue()


def test_no_secret_or_credential_leakage_in_output(monkeypatch):
    """Verify that passwords, hashes, connection URLs, and secrets never leak in stdout or stderr."""
    secret_pw = "TopSecretNewPassword123!"
    db_pass = "hidden_db_password"
    db_url = f"postgresql+psycopg://postgres:{db_pass}@localhost:5432/mbiotrack_dev"

    mock_admin = User(
        id=1,
        email="admin@mbiotrack.local",
        full_name="System Administrator",
        role="ADMIN",
        is_active=True,
        password_hash=hash_password("OldPassword12345!"),
    )

    inputs = iter(["RESET"])
    monkeypatch.setattr("builtins.input", lambda prompt: next(inputs))

    passwords = iter([secret_pw, secret_pw])
    monkeypatch.setattr("getpass.getpass", lambda prompt: next(passwords))

    mock_session = MagicMock()
    mock_session.scalar.side_effect = [
        "127.0.0.1",  # inet_server_addr
        mock_admin,    # find_and_validate_admin
        True,          # advisory lock acquired
        mock_admin,    # select user FOR UPDATE
    ]
    mock_session_factory = MagicMock(return_value=mock_session)
    mock_session.__enter__.return_value = mock_session

    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()

    with patch("sys.stdout", stdout_capture), patch("sys.stderr", stderr_capture):
        with patch("app.cli.reset_admin_password.validate_target_database"):
            exit_code = run_cli(
                session_factory=mock_session_factory,
                target_email="admin@mbiotrack.local",
            )

    assert exit_code == 0
    combined_output = stdout_capture.getvalue() + stderr_capture.getvalue()

    # Plaintext password must never appear
    assert secret_pw not in combined_output
    # Database password must never appear
    assert db_pass not in combined_output
    # Full connection URL must never appear
    assert db_url not in combined_output
    # Argon2id prefix or hash fragments must never appear
    assert "$argon2id$" not in combined_output
    # Confirmation of success message
    assert "Administrator password reset successfully" in combined_output
