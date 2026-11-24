import io
import sys
from datetime import date
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.cli.update_admin_email import (
    ADMIN_EMAIL_UPDATE_LOCK_NAME,
    CONFIRMATION_PHRASE,
    CORRECTED_EMAIL,
    EXPECTED_CURRENT_EMAIL,
    TARGET_USER_ID,
    EmailUpdateLockError,
    EmailUpdateRefusedError,
    EmailUpdateSecurityError,
    EmailUpdateValidationError,
    execute_email_update,
    normalize_db_url,
    prompt_operator_confirmation,
    read_connection_url_from_stdin,
    run_cli,
    validate_target_database,
)
from app.core.security import hash_password, verify_password
from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.user import User


# ===========================================================================
# 1. Target Database & Production Guard Validation Tests (Pure / Unit)
# ===========================================================================

def test_validate_target_approved_direct_neon_url():
    """Valid direct Neon connection URL passes production validation."""
    valid_url = (
        "postgresql+psycopg://user:secret123@"
        "ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb?sslmode=require"
    )
    db_name, host = validate_target_database(valid_url, is_production=True)
    assert db_name == "neondb"
    assert host == "ep-cool-fog-123456.us-east-2.aws.neon.tech"


def test_validate_target_accepts_verify_full_ssl():
    """Neon URL with sslmode=verify-full passes production validation."""
    valid_url = (
        "postgresql+psycopg://user:secret123@"
        "ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb?sslmode=verify-full"
    )
    db_name, host = validate_target_database(valid_url, is_production=True)
    assert db_name == "neondb"
    assert host == "ep-cool-fog-123456.us-east-2.aws.neon.tech"


def test_validate_target_rejects_missing_or_empty_url():
    """Missing or empty connection URLs must be rejected."""
    with pytest.raises(EmailUpdateSecurityError) as exc1:
        validate_target_database(None, is_production=True)
    assert "DATABASE_URL is not configured" in str(exc1.value)

    with pytest.raises(EmailUpdateSecurityError) as exc2:
        validate_target_database("   ", is_production=True)
    assert "DATABASE_URL is not configured" in str(exc2.value)


def test_validate_target_rejects_malformed_url():
    """Malformed connection strings must be rejected without disclosing secrets."""
    malformed = "not-a-valid-url://user:secret@localhost"
    with pytest.raises(EmailUpdateSecurityError) as exc:
        validate_target_database(malformed, is_production=True)
    assert "Database connection URL is malformed" in str(exc.value)
    assert "secret" not in str(exc.value)


def test_validate_target_unconditionally_rejects_test_database():
    """Test databases (mbiotrack_test and *_test) must be unconditionally rejected."""
    urls = [
        "postgresql+psycopg://user:pass@ep-cool-fog-123456.us-east-2.aws.neon.tech/mbiotrack_test?sslmode=require",
        "postgresql+psycopg://user:pass@ep-cool-fog-123456.us-east-2.aws.neon.tech/staging_test?sslmode=require",
    ]
    for url in urls:
        with pytest.raises(EmailUpdateSecurityError) as exc:
            validate_target_database(url, is_production=True)
        assert "Refusing to run administrator email update against test database" in str(exc.value)


def test_validate_target_rejects_dev_database_in_production():
    """mbiotrack_dev must be rejected in production mode."""
    dev_url = "postgresql+psycopg://user:pass@ep-cool-fog-123456.us-east-2.aws.neon.tech/mbiotrack_dev?sslmode=require"
    with pytest.raises(EmailUpdateSecurityError) as exc:
        validate_target_database(dev_url, is_production=True)
    assert "Refusing to run production update against development database" in str(exc.value)


def test_validate_target_rejects_non_neon_host():
    """Non-Neon hosts must be rejected in production mode."""
    foreign_url = "postgresql+psycopg://user:pass@db.external-corp.com/neondb?sslmode=require"
    with pytest.raises(EmailUpdateSecurityError) as exc:
        validate_target_database(foreign_url, is_production=True)
    assert "is not an approved Neon host" in str(exc.value)


def test_validate_target_rejects_pooled_endpoint():
    """Pooled endpoints containing '-pooler' must be strictly rejected."""
    pooled_url = (
        "postgresql+psycopg://user:pass@"
        "ep-cool-fog-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"
    )
    with pytest.raises(EmailUpdateSecurityError) as exc:
        validate_target_database(pooled_url, is_production=True)
    assert "is a pooled endpoint (-pooler)" in str(exc.value)


def test_validate_target_rejects_wrong_database_name():
    """Database name other than 'neondb' must be rejected in production mode."""
    wrong_db_url = (
        "postgresql+psycopg://user:pass@"
        "ep-cool-fog-123456.us-east-2.aws.neon.tech/customdb?sslmode=require"
    )
    with pytest.raises(EmailUpdateSecurityError) as exc:
        validate_target_database(wrong_db_url, is_production=True)
    assert "Unexpected production database name 'customdb'" in str(exc.value)


def test_validate_target_rejects_missing_sslmode():
    """URLs lacking required SSL parameters must be rejected."""
    no_ssl_url = (
        "postgresql+psycopg://user:pass@"
        "ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb"
    )
    with pytest.raises(EmailUpdateSecurityError) as exc:
        validate_target_database(no_ssl_url, is_production=True)
    assert "SSL is required for Neon production connections" in str(exc.value)


def test_validate_target_rejects_loopback_in_production():
    """Loopback addresses are strictly forbidden in production mode."""
    for host in ("localhost", "127.0.0.1", "[::1]"):
        loopback_url = f"postgresql+psycopg://user:pass@{host}/neondb?sslmode=require"
        with pytest.raises(EmailUpdateSecurityError) as exc:
            validate_target_database(loopback_url, is_production=True)
        assert "Loopback hosts are strictly forbidden in production mode." in str(exc.value)


def test_validate_target_rejects_non_postgresql_driver():
    """Non-PostgreSQL drivers must be rejected."""
    mysql_url = "mysql+pymysql://user:pass@ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb?sslmode=require"
    with pytest.raises(EmailUpdateSecurityError) as exc:
        validate_target_database(mysql_url, is_production=True)
    assert "Database driver must be PostgreSQL" in str(exc.value)


def test_normalize_db_url():
    """URL normalization correctly converts postgres:// and postgresql:// schemes."""
    assert normalize_db_url("postgres://u:p@h/d") == "postgresql+psycopg://u:p@h/d"
    assert normalize_db_url("postgresql://u:p@h/d") == "postgresql+psycopg://u:p@h/d"
    assert normalize_db_url("postgresql+psycopg://u:p@h/d") == "postgresql+psycopg://u:p@h/d"


# ===========================================================================
# 2. STDIN Input & Confirmation Phrase Validation Tests
# ===========================================================================

def test_read_connection_url_from_stdin_success():
    """read_connection_url_from_stdin parses URL from input stream and strips whitespace."""
    stream = io.StringIO("  postgresql+psycopg://user:pass@ep-1.neon.tech/neondb?sslmode=require  \n")
    url = read_connection_url_from_stdin(stream=stream)
    assert url == "postgresql+psycopg://user:pass@ep-1.neon.tech/neondb?sslmode=require"


def test_read_connection_url_from_stdin_empty_raises():
    """Empty STDIN raises EmailUpdateValidationError."""
    stream = io.StringIO("   \n")
    with pytest.raises(EmailUpdateValidationError) as exc:
        read_connection_url_from_stdin(stream=stream)
    assert "Database connection URL was not provided on STDIN" in str(exc.value)


def test_prompt_operator_confirmation_success(monkeypatch):
    """Typing the exact confirmation phrase proceeds without error."""
    monkeypatch.setattr("builtins.input", lambda prompt: CONFIRMATION_PHRASE)
    prompt_operator_confirmation(
        target_id=1,
        current_email=EXPECTED_CURRENT_EMAIL,
        new_email=CORRECTED_EMAIL,
    )


def test_prompt_operator_confirmation_mismatch_raises(monkeypatch):
    """Entering an incorrect confirmation phrase raises EmailUpdateValidationError."""
    monkeypatch.setattr("builtins.input", lambda prompt: "yes")
    with pytest.raises(EmailUpdateValidationError) as exc:
        prompt_operator_confirmation(
            target_id=1,
            current_email=EXPECTED_CURRENT_EMAIL,
            new_email=CORRECTED_EMAIL,
        )
    assert "Confirmation phrase mismatch" in str(exc.value)


def test_prompt_operator_confirmation_eof_raises(monkeypatch):
    """EOF on confirmation prompt raises EmailUpdateValidationError cleanly."""
    def raise_eof(prompt):
        raise EOFError("No interactive input")

    monkeypatch.setattr("builtins.input", raise_eof)
    with pytest.raises(EmailUpdateValidationError) as exc:
        prompt_operator_confirmation(
            target_id=1,
            current_email=EXPECTED_CURRENT_EMAIL,
            new_email=CORRECTED_EMAIL,
        )
    assert "Interactive input unavailable or cancelled" in str(exc.value)


# ===========================================================================
# 3. Transactional Database Update Tests (Against test_engine / db_session)
# ===========================================================================

@pytest.fixture
def target_admin_user(db_session: Session) -> User:
    """Fixture ensuring the production initial administrator exists with expected typo email."""
    # Avoid unsafe delete(User) which violates fk_audit_logs_actor_user_id ON DELETE RESTRICT
    # if immutable audit records reference this user. Instead, reassign any conflicting email
    # on other user records and reset the target administrator's attributes in-place.
    conflicts = list(db_session.scalars(
        select(User).where(
            func.lower(User.email).in_([EXPECTED_CURRENT_EMAIL.lower(), CORRECTED_EMAIL.lower()]),
            User.id != TARGET_USER_ID,
        )
    ).all())
    for c in conflicts:
        c.email = f"conflict_{c.id}@example.com"
    if conflicts:
        db_session.flush()

    admin = db_session.get(User, TARGET_USER_ID)
    if admin is None:
        admin = User(
            id=TARGET_USER_ID,
            full_name="Nagaraj Admin",
            email=EXPECTED_CURRENT_EMAIL,
            password_hash=hash_password("SuperSecretAdminPass123!"),
            role="ADMIN",
            employee_id=None,
            is_active=True,
        )
        db_session.add(admin)
    else:
        admin.full_name = "Nagaraj Admin"
        admin.email = EXPECTED_CURRENT_EMAIL
        admin.password_hash = hash_password("SuperSecretAdminPass123!")
        admin.role = "ADMIN"
        admin.employee_id = None
        admin.is_active = True

    db_session.flush()
    return admin


def test_successful_email_correction(db_session: Session, target_admin_user: User):
    """Successful email update from typo to corrected address with audit log."""
    original_pw_hash = target_admin_user.password_hash
    original_id = target_admin_user.id
    original_role = target_admin_user.role
    original_active = target_admin_user.is_active

    updated_admin = execute_email_update(
        session=db_session,
        new_email=CORRECTED_EMAIL,
        target_user_id=TARGET_USER_ID,
        expected_current_email=EXPECTED_CURRENT_EMAIL,
    )
    db_session.commit()

    # Verify User fields
    assert updated_admin.id == original_id
    assert updated_admin.email == CORRECTED_EMAIL
    assert updated_admin.role == original_role
    assert updated_admin.is_active == original_active
    assert updated_admin.password_hash == original_pw_hash
    assert verify_password("SuperSecretAdminPass123!", updated_admin.password_hash)

    # Verify atomic AuditLog record
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "AUTH_ADMIN_EMAIL_UPDATE",
            AuditLog.target_id == str(TARGET_USER_ID),
        )
    )
    assert audit is not None
    assert audit.actor_user_id == TARGET_USER_ID
    assert audit.target_type == "user"
    assert audit.metadata_["old_email"] == EXPECTED_CURRENT_EMAIL
    assert audit.metadata_["new_email"] == CORRECTED_EMAIL
    assert audit.metadata_["role"] == "ADMIN"
    assert audit.metadata_["source"] == "cli_update_admin_email"


def test_wrong_current_email_rejected(db_session: Session, target_admin_user: User):
    """If current email does not match the known typo, update is refused."""
    with pytest.raises(EmailUpdateRefusedError) as exc:
        execute_email_update(
            session=db_session,
            new_email=CORRECTED_EMAIL,
            target_user_id=TARGET_USER_ID,
            expected_current_email="different.email@example.com",
        )
    assert "Administrator email mismatch" in str(exc.value)


def test_wrong_user_id_rejected(db_session: Session, target_admin_user: User):
    """Non-existent user ID raises EmailUpdateRefusedError."""
    with pytest.raises(EmailUpdateRefusedError) as exc:
        execute_email_update(
            session=db_session,
            new_email=CORRECTED_EMAIL,
            target_user_id=9999,
            expected_current_email=EXPECTED_CURRENT_EMAIL,
        )
    assert "Target administrator with User ID 9999 was not found" in str(exc.value)


def test_non_admin_role_rejected(db_session: Session):
    """User account with non-ADMIN role is refused."""
    emp = Employee(
        employee_code="EMP_TEST_NON_ADMIN",
        first_name="Test",
        last_name="Manager",
        email="test_manager@example.com",
        department="Operations",
        designation="Manager",
        joining_date=date(2026, 1, 1),
        is_active=True,
    )
    db_session.add(emp)
    db_session.flush()

    mgr_user = User(
        id=2,
        full_name="Manager Account",
        email=EXPECTED_CURRENT_EMAIL,
        password_hash=hash_password("ValidPassword123!"),
        role="MANAGER",
        employee_id=emp.id,
        is_active=True,
    )
    db_session.add(mgr_user)
    db_session.commit()

    with pytest.raises(EmailUpdateRefusedError) as exc:
        execute_email_update(
            session=db_session,
            new_email=CORRECTED_EMAIL,
            target_user_id=2,
            expected_current_email=EXPECTED_CURRENT_EMAIL,
        )
    assert "Email update CLI is strictly restricted to administrator accounts" in str(exc.value)


def test_inactive_user_rejected(db_session: Session):
    """Deactivated administrator account is refused."""
    deactivated_admin = db_session.get(User, 3)
    if deactivated_admin is None:
        deactivated_admin = User(
            id=3,
            full_name="Deactivated Admin",
            email=EXPECTED_CURRENT_EMAIL,
            password_hash=hash_password("ValidPassword123!"),
            role="ADMIN",
            employee_id=None,
            is_active=False,
        )
        db_session.add(deactivated_admin)
    else:
        deactivated_admin.email = EXPECTED_CURRENT_EMAIL
        deactivated_admin.is_active = False
    db_session.flush()

    with pytest.raises(EmailUpdateRefusedError) as exc:
        execute_email_update(
            session=db_session,
            new_email=CORRECTED_EMAIL,
            target_user_id=3,
            expected_current_email=EXPECTED_CURRENT_EMAIL,
        )
    assert "Cannot update email for an inactive account" in str(exc.value)


def test_duplicate_email_rejected(db_session: Session, target_admin_user: User):
    """If another user already holds the new email, update is refused."""
    existing_emp = Employee(
        employee_code="EMP_DUP_CHECK",
        first_name="Duplicate",
        last_name="User",
        email="dup_check@example.com",
        department="Engineering",
        designation="Engineer",
        joining_date=date(2026, 1, 1),
        is_active=True,
    )
    db_session.add(existing_emp)
    db_session.flush()

    other_user = User(
        id=10,
        full_name="Existing User",
        email=CORRECTED_EMAIL,
        password_hash=hash_password("ValidPass123!"),
        role="EMPLOYEE",
        employee_id=existing_emp.id,
        is_active=True,
    )
    db_session.add(other_user)
    db_session.commit()

    with pytest.raises(EmailUpdateRefusedError) as exc:
        execute_email_update(
            session=db_session,
            new_email=CORRECTED_EMAIL,
            target_user_id=TARGET_USER_ID,
            expected_current_email=EXPECTED_CURRENT_EMAIL,
        )
    assert "is already in use by another user account" in str(exc.value)


def test_case_insensitive_duplicate_email_rejected(db_session: Session, target_admin_user: User):
    """Case-insensitive duplicate email across accounts is refused."""
    existing_emp = Employee(
        employee_code="EMP_CASE_DUP_CHECK",
        first_name="Case",
        last_name="Duplicate",
        email="case_dup@example.com",
        department="Engineering",
        designation="Engineer",
        joining_date=date(2026, 1, 1),
        is_active=True,
    )
    db_session.add(existing_emp)
    db_session.flush()

    other_user = User(
        id=11,
        full_name="Case User",
        email=CORRECTED_EMAIL.upper(),
        password_hash=hash_password("ValidPass123!"),
        role="EMPLOYEE",
        employee_id=existing_emp.id,
        is_active=True,
    )
    db_session.add(other_user)
    db_session.commit()

    with pytest.raises(EmailUpdateRefusedError) as exc:
        execute_email_update(
            session=db_session,
            new_email=CORRECTED_EMAIL.lower(),
            target_user_id=TARGET_USER_ID,
            expected_current_email=EXPECTED_CURRENT_EMAIL,
        )
    assert "is already in use by another user account" in str(exc.value)


def test_invalid_email_format_rejected(db_session: Session, target_admin_user: User):
    """Invalid email addresses trigger EmailUpdateValidationError."""
    invalid_emails = [
        "notanemail",
        "@missinguser.com",
        "missingdomain@",
        "spaces in email@domain.com",
    ]
    for bad_email in invalid_emails:
        with pytest.raises(EmailUpdateValidationError) as exc:
            execute_email_update(
                session=db_session,
                new_email=bad_email,
                target_user_id=TARGET_USER_ID,
                expected_current_email=EXPECTED_CURRENT_EMAIL,
            )
        assert "Invalid replacement email address format" in str(exc.value)


def test_identical_replacement_email_rejected(db_session: Session, target_admin_user: User):
    """Providing an email identical to the current one is rejected."""
    with pytest.raises(EmailUpdateValidationError) as exc:
        execute_email_update(
            session=db_session,
            new_email=EXPECTED_CURRENT_EMAIL,
            target_user_id=TARGET_USER_ID,
            expected_current_email=EXPECTED_CURRENT_EMAIL,
        )
    assert "Replacement email is identical to the current email" in str(exc.value)


def test_transaction_rollback_on_audit_failure(db_session: Session, target_admin_user: User):
    """If audit log generation fails, the entire transaction rolls back."""
    original_email = target_admin_user.email

    with patch("app.cli.update_admin_email.AuditLog", side_effect=RuntimeError("Simulated audit write failure")):
        with pytest.raises(RuntimeError, match="Simulated audit write failure"):
            execute_email_update(
                session=db_session,
                new_email=CORRECTED_EMAIL,
                target_user_id=TARGET_USER_ID,
                expected_current_email=EXPECTED_CURRENT_EMAIL,
            )

    db_session.expire_all()
    reloaded = db_session.get(User, TARGET_USER_ID)
    assert reloaded is not None
    # Email must remain the original typo email due to atomic rollback
    assert reloaded.email == original_email


# ===========================================================================
# 4. Full CLI Workflow & Safeguard Tests (Mocked / Pure Unit)
# ===========================================================================

def test_run_cli_missing_production_flag():
    """Running CLI without --production flag exits with code 1."""
    stderr_capture = io.StringIO()
    with patch("sys.stderr", stderr_capture):
        code = run_cli(args=[])
    assert code == 1
    assert "Running administrator email update requires the explicit '--production' flag" in stderr_capture.getvalue()


def test_run_cli_production_flag_mismatch_in_development(monkeypatch):
    """Running with --production in a development environment exits with code 1."""
    monkeypatch.setattr("app.cli.update_admin_email.get_settings", lambda: MagicMock(ENVIRONMENT="development"))
    stderr_capture = io.StringIO()
    with patch("sys.stderr", stderr_capture):
        code = run_cli(args=["--production"])
    assert code == 1
    assert "--production flag can only be used when ENVIRONMENT is configured as 'production'" in stderr_capture.getvalue()


def test_run_cli_confirmation_mismatch_aborts(monkeypatch):
    """Mismatched confirmation string aborts without executing email update."""
    mock_settings = MagicMock(ENVIRONMENT="production")
    monkeypatch.setattr("app.cli.update_admin_email.get_settings", lambda: mock_settings)

    mock_user = MagicMock(
        id=1,
        role="ADMIN",
        is_active=True,
        email=EXPECTED_CURRENT_EMAIL,
        full_name="Nagaraj Admin",
    )
    mock_session = MagicMock()
    mock_session.scalar.return_value = mock_user
    mock_session_factory = MagicMock(return_value=mock_session)
    mock_session.__enter__.return_value = mock_session

    monkeypatch.setattr("builtins.input", lambda prompt: "WRONG_PHRASE")
    update_mock = MagicMock()
    monkeypatch.setattr("app.cli.update_admin_email.execute_email_update", update_mock)

    stderr_capture = io.StringIO()
    with patch("sys.stderr", stderr_capture):
        code = run_cli(
            args=["--production"],
            session_factory=mock_session_factory,
        )

    assert code == 1
    assert "Confirmation phrase mismatch" in stderr_capture.getvalue()
    assert update_mock.call_count == 0


def test_run_cli_successful_workflow(monkeypatch):
    """Complete CLI execution succeeds cleanly with zero leaked secrets."""
    mock_settings = MagicMock(ENVIRONMENT="production")
    monkeypatch.setattr("app.cli.update_admin_email.get_settings", lambda: mock_settings)

    fake_admin = MagicMock(
        id=1,
        full_name="Nagaraj Admin",
        email=CORRECTED_EMAIL,
        role="ADMIN",
        is_active=True,
    )
    preflight_admin = MagicMock(
        id=1,
        full_name="Nagaraj Admin",
        email=EXPECTED_CURRENT_EMAIL,
        role="ADMIN",
        is_active=True,
    )

    mock_session = MagicMock()
    mock_session.scalar.return_value = preflight_admin
    mock_session_factory = MagicMock(return_value=mock_session)
    mock_session.__enter__.return_value = mock_session

    monkeypatch.setattr("builtins.input", lambda prompt: CONFIRMATION_PHRASE)
    monkeypatch.setattr("app.cli.update_admin_email.execute_email_update", lambda **kwargs: fake_admin)

    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()

    with patch("sys.stdout", stdout_capture), patch("sys.stderr", stderr_capture):
        code = run_cli(
            args=["--production"],
            session_factory=mock_session_factory,
        )

    assert code == 0
    output = stdout_capture.getvalue()
    assert "[SUCCESS] Administrator email corrected successfully." in output
    assert f"User ID:   1" in output
    assert f"Email:     {CORRECTED_EMAIL}" in output
    assert f"Role:      ADMIN" in output
    assert f"Active:    True" in output
    assert "Email updated and audit event logged." in output
