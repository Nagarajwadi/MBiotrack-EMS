from datetime import date
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, derive_pwd_fingerprint, hash_password, verify_password
from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.user import User


@pytest.fixture
def pwd_admin(db_session: Session) -> User:
    admin = User(
        full_name="Password Test Admin",
        email="pwd_admin@example.com",
        password_hash=hash_password("AdminPass123!"),
        role="ADMIN",
        employee_id=None,
        is_active=True,
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)
    return admin


@pytest.fixture
def pwd_manager(db_session: Session) -> tuple[User, Employee]:
    emp = Employee(
        employee_code="MGR-PWD-01",
        first_name="Paul",
        last_name="Manager",
        email="paul.mgr@example.com",
        department="Engineering",
        designation="Engineering Manager",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)

    user = User(
        full_name="Paul Manager",
        email="paul.mgr@example.com",
        password_hash=hash_password("ManagerPass123!"),
        role="MANAGER",
        employee_id=emp.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user, emp


@pytest.fixture
def pwd_employee(db_session: Session) -> tuple[User, Employee]:
    emp = Employee(
        employee_code="EMP-PWD-01",
        first_name="Eva",
        last_name="Employee",
        email="eva.emp@example.com",
        department="Operations",
        designation="Operations Specialist",
        joining_date=date(2025, 2, 1),
        is_active=True,
    )
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)

    user = User(
        full_name="Eva Employee",
        email="eva.emp@example.com",
        password_hash=hash_password("EmployeePass123!"),
        role="EMPLOYEE",
        employee_id=emp.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user, emp


def auth_header(user: User) -> dict[str, str]:
    token = create_access_token(
        subject=user.id,
        extra_claims={"pwd": derive_pwd_fingerprint(user.password_hash)},
    )
    return {"Authorization": f"Bearer {token}"}


def test_self_service_password_change_success(
    client: TestClient,
    db_session: Session,
    pwd_employee: tuple[User, Employee],
):
    """Authenticated user successfully changes their password with valid credentials."""
    user, _ = pwd_employee
    headers = auth_header(user)

    payload = {
        "current_password": "EmployeePass123!",
        "new_password": "BrandNewPass456!",
    }

    res = client.post("/api/v1/auth/change-password", headers=headers, json=payload)
    assert res.status_code == 200
    assert res.json() == {"message": "Password changed successfully."}

    # Verify user password_hash in DB
    db_session.refresh(user)
    assert verify_password("BrandNewPass456!", user.password_hash) is True
    assert verify_password("EmployeePass123!", user.password_hash) is False

    # Verify AuditLog
    audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "AUTH_PASSWORD_CHANGE",
            AuditLog.actor_user_id == user.id,
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit is not None
    assert audit.target_type == "user"
    assert audit.target_id == str(user.id)
    assert audit.metadata_ == {"user_id": user.id, "role": "EMPLOYEE"}


def test_self_service_password_change_incorrect_current_password(
    client: TestClient,
    db_session: Session,
    pwd_employee: tuple[User, Employee],
):
    """Incorrect current password must return 400 and preserve existing hash."""
    user, _ = pwd_employee
    headers = auth_header(user)

    payload = {
        "current_password": "WrongCurrentPass123!",
        "new_password": "BrandNewPass456!",
    }

    res = client.post("/api/v1/auth/change-password", headers=headers, json=payload)
    assert res.status_code == 400
    assert "Incorrect current password." in res.json()["detail"]

    # Password hash in DB must remain unchanged
    db_session.refresh(user)
    assert verify_password("EmployeePass123!", user.password_hash) is True


def test_self_service_password_change_short_new_password_rejected(
    client: TestClient,
    pwd_employee: tuple[User, Employee],
):
    """New password shorter than 12 characters must return 422 Unprocessable Entity."""
    user, _ = pwd_employee
    headers = auth_header(user)

    payload = {
        "current_password": "EmployeePass123!",
        "new_password": "ShortPass1!",  # 11 chars
    }

    res = client.post("/api/v1/auth/change-password", headers=headers, json=payload)
    assert res.status_code == 422


def test_login_with_new_password_succeeds_and_old_fails(
    client: TestClient,
    pwd_employee: tuple[User, Employee],
):
    """After password change, authenticating with old password fails (401), new succeeds (200)."""
    user, _ = pwd_employee
    headers = auth_header(user)

    # Change password
    change_res = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={
            "current_password": "EmployeePass123!",
            "new_password": "UpdatedSecurePass123!",
        },
    )
    assert change_res.status_code == 200

    # Login with old password fails
    fail_res = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": "EmployeePass123!"},
    )
    assert fail_res.status_code == 401

    # Login with new password succeeds
    success_res = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": "UpdatedSecurePass123!"},
    )
    assert success_res.status_code == 200
    assert "access_token" in success_res.json()


def test_admin_reset_password_success(
    client: TestClient,
    db_session: Session,
    pwd_admin: User,
    pwd_employee: tuple[User, Employee],
):
    """Admin can reset a user account password with audit logging."""
    user, emp = pwd_employee
    headers = auth_header(pwd_admin)

    res = client.post(
        f"/api/v1/users/{user.id}/reset-password",
        headers=headers,
        json={"new_password": "TempAdminPass123!"},
    )
    assert res.status_code == 200
    assert res.json() == {"message": "Password reset successfully."}

    # Verify password hash updated
    db_session.refresh(user)
    assert verify_password("TempAdminPass123!", user.password_hash) is True
    assert verify_password("EmployeePass123!", user.password_hash) is False

    # Verify audit log
    audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "AUTH_PASSWORD_RESET",
            AuditLog.actor_user_id == pwd_admin.id,
        )
        .order_by(AuditLog.id.desc())
    )
    assert audit is not None
    assert audit.target_type == "user"
    assert audit.target_id == str(user.id)
    assert audit.metadata_ == {
        "target_user_id": user.id,
        "target_role": "EMPLOYEE",
        "target_email": user.email,
    }

    # Employee record untouched
    db_session.refresh(emp)
    assert emp.is_active is True
    assert emp.deleted_at is None


def test_admin_reset_password_non_admin_forbidden(
    client: TestClient,
    pwd_manager: tuple[User, Employee],
    pwd_employee: tuple[User, Employee],
):
    """Non-admin roles are forbidden from resetting user passwords."""
    mgr_user, _ = pwd_manager
    emp_user, _ = pwd_employee
    headers = auth_header(mgr_user)

    res = client.post(
        f"/api/v1/users/{emp_user.id}/reset-password",
        headers=headers,
        json={"new_password": "TempAdminPass123!"},
    )
    assert res.status_code == 403


def test_admin_reset_password_target_not_found(
    client: TestClient,
    pwd_admin: User,
):
    """Resetting password for a non-existent user returns 404."""
    headers = auth_header(pwd_admin)

    res = client.post(
        "/api/v1/users/999999/reset-password",
        headers=headers,
        json={"new_password": "TempAdminPass123!"},
    )
    assert res.status_code == 404
    assert "User account not found." in res.json()["detail"]


def test_admin_reset_password_short_password_rejected(
    client: TestClient,
    pwd_admin: User,
    pwd_employee: tuple[User, Employee],
):
    """Admin reset with password shorter than 12 characters returns 422."""
    user, _ = pwd_employee
    headers = auth_header(pwd_admin)

    res = client.post(
        f"/api/v1/users/{user.id}/reset-password",
        headers=headers,
        json={"new_password": "Short1!"},
    )
    assert res.status_code == 422


def test_jwt_session_invalidation_after_self_service_change(
    client: TestClient,
    pwd_employee: tuple[User, Employee],
):
    """Existing JWT token is immediately rejected with 401 after self-service password change."""
    user, _ = pwd_employee

    # 1. Log in via official endpoint to obtain JWT with embedded fingerprint
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": "EmployeePass123!"},
    )
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    old_headers = {"Authorization": f"Bearer {token}"}

    # 2. Token works initially
    me_res = client.get("/api/v1/auth/me", headers=old_headers)
    assert me_res.status_code == 200

    # 3. Change password using the active session
    change_res = client.post(
        "/api/v1/auth/change-password",
        headers=old_headers,
        json={
            "current_password": "EmployeePass123!",
            "new_password": "BrandNewSecretPass123!",
        },
    )
    assert change_res.status_code == 200

    # 4. Old token is now rejected with 401 on subsequent requests
    revoked_res = client.get("/api/v1/auth/me", headers=old_headers)
    assert revoked_res.status_code == 401
    assert "revoked" in revoked_res.json()["detail"].lower()

    # 5. New login with new password yields a fresh valid token
    new_login_res = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": "BrandNewSecretPass123!"},
    )
    assert new_login_res.status_code == 200
    new_token = new_login_res.json()["access_token"]
    new_headers = {"Authorization": f"Bearer {new_token}"}

    new_me_res = client.get("/api/v1/auth/me", headers=new_headers)
    assert new_me_res.status_code == 200
    assert new_me_res.json()["email"] == user.email


def test_jwt_session_invalidation_after_admin_reset(
    client: TestClient,
    pwd_admin: User,
    pwd_employee: tuple[User, Employee],
):
    """User's existing JWT token is invalidated when an administrator resets their password."""
    user, _ = pwd_employee

    # 1. User logs in
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": "EmployeePass123!"},
    )
    assert login_res.status_code == 200
    user_token = login_res.json()["access_token"]
    user_headers = {"Authorization": f"Bearer {user_token}"}

    # 2. User token works
    assert client.get("/api/v1/auth/me", headers=user_headers).status_code == 200

    # 3. Admin resets user password
    admin_headers = auth_header(pwd_admin)
    reset_res = client.post(
        f"/api/v1/users/{user.id}/reset-password",
        headers=admin_headers,
        json={"new_password": "AdminAssignedPass123!"},
    )
    assert reset_res.status_code == 200

    # 4. User's prior token is immediately rejected with 401
    revoked_res = client.get("/api/v1/auth/me", headers=user_headers)
    assert revoked_res.status_code == 401
    assert "revoked" in revoked_res.json()["detail"].lower()

    # 5. User logs in with admin-assigned password
    fresh_login_res = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": "AdminAssignedPass123!"},
    )
    assert fresh_login_res.status_code == 200


def test_password_and_hash_never_exposed(
    client: TestClient,
    db_session: Session,
    pwd_admin: User,
    pwd_employee: tuple[User, Employee],
):
    """Plaintext passwords and hash strings must never appear in responses or audit logs."""
    user, _ = pwd_employee
    secret_pass = "SuperSecretUnexposedPass123!"
    headers = auth_header(user)

    # 1. Self-service change
    change_res = client.post(
        "/api/v1/auth/change-password",
        headers=headers,
        json={
            "current_password": "EmployeePass123!",
            "new_password": secret_pass,
        },
    )
    response_text = change_res.text
    assert secret_pass not in response_text
    assert "argon2" not in response_text.lower()

    # Check change audit log
    change_audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "AUTH_PASSWORD_CHANGE",
            AuditLog.actor_user_id == user.id,
        )
        .order_by(AuditLog.id.desc())
    )
    assert change_audit is not None
    assert secret_pass not in str(change_audit.metadata_)
    assert "argon2" not in str(change_audit.metadata_).lower()

    # 2. Admin reset
    admin_headers = auth_header(pwd_admin)
    admin_secret = "AdminSecretResetPass123!"
    reset_res = client.post(
        f"/api/v1/users/{user.id}/reset-password",
        headers=admin_headers,
        json={"new_password": admin_secret},
    )
    reset_text = reset_res.text
    assert admin_secret not in reset_text
    assert "argon2" not in reset_text.lower()

    # Check reset audit log
    reset_audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "AUTH_PASSWORD_RESET",
            AuditLog.actor_user_id == pwd_admin.id,
        )
        .order_by(AuditLog.id.desc())
    )
    assert reset_audit is not None
    assert admin_secret not in str(reset_audit.metadata_)
    assert "argon2" not in str(reset_audit.metadata_).lower()


def test_all_authenticated_roles_can_change_password(
    client: TestClient,
    pwd_admin: User,
    pwd_manager: tuple[User, Employee],
    pwd_employee: tuple[User, Employee],
):
    """ADMIN, MANAGER, and EMPLOYEE can all execute self-service password changes."""
    mgr_user, _ = pwd_manager
    emp_user, _ = pwd_employee

    for role_user, curr_pwd in [
        (pwd_admin, "AdminPass123!"),
        (mgr_user, "ManagerPass123!"),
        (emp_user, "EmployeePass123!"),
    ]:
        res = client.post(
            "/api/v1/auth/change-password",
            headers=auth_header(role_user),
            json={
                "current_password": curr_pwd,
                "new_password": "NewRolePass123456!",
            },
        )
        assert res.status_code == 200, f"Role {role_user.role} failed to change password"


def test_jwt_missing_pwd_claim_rejected(
    client: TestClient,
    pwd_employee: tuple[User, Employee],
):
    """Token lacking the 'pwd' claim must be rejected with 401."""
    user, _ = pwd_employee
    # Create token without extra_claims
    token = create_access_token(subject=user.id)
    headers = {"Authorization": f"Bearer {token}"}

    res = client.get("/api/v1/auth/me", headers=headers)
    assert res.status_code == 401
    assert "revoked" in res.json()["detail"].lower()


def test_jwt_incorrect_pwd_fingerprint_rejected(
    client: TestClient,
    pwd_employee: tuple[User, Employee],
):
    """Token with mismatched 'pwd' claim must be rejected with 401."""
    user, _ = pwd_employee
    token = create_access_token(
        subject=user.id,
        extra_claims={"pwd": "tampered_bad_hex"},
    )
    headers = {"Authorization": f"Bearer {token}"}

    res = client.get("/api/v1/auth/me", headers=headers)
    assert res.status_code == 401
    assert "revoked" in res.json()["detail"].lower()


def test_jwt_valid_pwd_fingerprint_accepted(
    client: TestClient,
    pwd_employee: tuple[User, Employee],
):
    """Token with correct 'pwd' fingerprint claim is accepted with 200."""
    user, _ = pwd_employee
    headers = auth_header(user)

    res = client.get("/api/v1/auth/me", headers=headers)
    assert res.status_code == 200
    assert res.json()["id"] == user.id
