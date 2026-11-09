from datetime import date
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, derive_pwd_fingerprint, hash_password
from app.main import app
from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.user import User


@pytest.fixture
def lifecycle_admin(db_session: Session) -> User:
    admin = User(
        full_name="Lifecycle Admin",
        email="lifecycle_admin@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="ADMIN",
        employee_id=None,
        is_active=True,
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)
    return admin


@pytest.fixture
def lifecycle_manager(db_session: Session) -> tuple[User, Employee]:
    emp = Employee(
        employee_code="MGR-LC-01",
        first_name="Marcus",
        last_name="Manager",
        email="marcus.mgr@example.com",
        department="Engineering",
        designation="Engineering Manager",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)

    user = User(
        full_name="Marcus Manager",
        email="marcus.mgr@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="MANAGER",
        employee_id=emp.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user, emp


@pytest.fixture
def lifecycle_employee(db_session: Session) -> tuple[User, Employee]:
    emp = Employee(
        employee_code="EMP-LC-01",
        first_name="Edward",
        last_name="Employee",
        email="edward.emp@example.com",
        department="Engineering",
        designation="Software Engineer",
        joining_date=date(2025, 6, 1),
        is_active=True,
    )
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)

    user = User(
        full_name="Edward Employee",
        email="edward.emp@example.com",
        password_hash=hash_password("ValidPassword123!"),
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


def test_deactivate_and_list_inactive(
    client: TestClient,
    lifecycle_admin: User,
    lifecycle_employee: tuple[User, Employee],
):
    """Test soft deactivation and retrieval via status filter."""
    headers = auth_header(lifecycle_admin)
    _, target_emp = lifecycle_employee

    # 1. Default listing includes active employee
    res_default = client.get("/api/v1/employees", headers=headers)
    assert res_default.status_code == 200
    active_ids = [e["id"] for e in res_default.json()]
    assert target_emp.id in active_ids

    # 2. Deactivate employee
    res_del = client.delete(f"/api/v1/employees/{target_emp.id}", headers=headers)
    assert res_del.status_code == 204

    # 3. Default listing no longer includes deactivated employee
    res_after_del = client.get("/api/v1/employees", headers=headers)
    assert res_after_del.status_code == 200
    after_ids = [e["id"] for e in res_after_del.json()]
    assert target_emp.id not in after_ids

    # 4. Status=INACTIVE includes the deactivated employee
    res_inactive = client.get("/api/v1/employees?status=INACTIVE", headers=headers)
    assert res_inactive.status_code == 200
    inactive_ids = [e["id"] for e in res_inactive.json()]
    assert target_emp.id in inactive_ids
    inactive_emp = next(e for e in res_inactive.json() if e["id"] == target_emp.id)
    assert inactive_emp["is_active"] is False
    assert inactive_emp["deleted_at"] is not None

    # 5. Status=ALL includes both active and inactive employees
    res_all = client.get("/api/v1/employees?status=ALL", headers=headers)
    assert res_all.status_code == 200
    all_ids = [e["id"] for e in res_all.json()]
    assert target_emp.id in all_ids


def test_reactivate_employee_success(
    client: TestClient,
    lifecycle_admin: User,
    lifecycle_employee: tuple[User, Employee],
    db_session: Session,
):
    """Test Admin can reactivate a deactivated employee with atomic audit logging."""
    headers = auth_header(lifecycle_admin)
    _, target_emp = lifecycle_employee

    # Deactivate
    client.delete(f"/api/v1/employees/{target_emp.id}", headers=headers)

    # Reactivate
    res_reactivate = client.post(f"/api/v1/employees/{target_emp.id}/reactivate", headers=headers)
    assert res_reactivate.status_code == 200
    data = res_reactivate.json()
    assert data["id"] == target_emp.id
    assert data["is_active"] is True
    assert data["deleted_at"] is None

    # Verify audit log was recorded
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "EMPLOYEE_REACTIVATE",
            AuditLog.target_id == str(target_emp.id),
        )
    )
    assert audit is not None
    assert audit.actor_user_id == lifecycle_admin.id
    assert audit.metadata_["role"] == "ADMIN"
    assert audit.metadata_["employee_code"] == target_emp.employee_code

    # Verify employee appears in default active list again
    res_list = client.get("/api/v1/employees", headers=headers)
    assert res_list.status_code == 200
    assert target_emp.id in [e["id"] for e in res_list.json()]


def test_reactivate_already_active_conflict(
    client: TestClient,
    lifecycle_admin: User,
    lifecycle_employee: tuple[User, Employee],
):
    """Reactivating an already active employee returns 409 Conflict."""
    headers = auth_header(lifecycle_admin)
    _, target_emp = lifecycle_employee

    res = client.post(f"/api/v1/employees/{target_emp.id}/reactivate", headers=headers)
    assert res.status_code == 409
    assert res.json()["detail"] == "Employee is already active."


def test_reactivate_nonexistent_returns_404(
    client: TestClient,
    lifecycle_admin: User,
):
    """Reactivating a non-existent employee returns 404 Not Found."""
    headers = auth_header(lifecycle_admin)
    res = client.post("/api/v1/employees/99999/reactivate", headers=headers)
    assert res.status_code == 404
    assert res.json()["detail"] == "Employee not found"


def test_non_admin_forbidden_from_reactivating(
    client: TestClient,
    lifecycle_admin: User,
    lifecycle_manager: tuple[User, Employee],
    lifecycle_employee: tuple[User, Employee],
):
    """Manager and Employee roles are forbidden from reactivating employees."""
    admin_headers = auth_header(lifecycle_admin)
    mgr_user, _ = lifecycle_manager
    emp_user, target_emp = lifecycle_employee

    # Deactivate via admin
    client.delete(f"/api/v1/employees/{target_emp.id}", headers=admin_headers)

    # Manager attempt
    mgr_res = client.post(f"/api/v1/employees/{target_emp.id}/reactivate", headers=auth_header(mgr_user))
    assert mgr_res.status_code == 403

    # Employee attempt
    emp_res = client.post(f"/api/v1/employees/{target_emp.id}/reactivate", headers=auth_header(emp_user))
    assert emp_res.status_code == 403


def test_manager_forbidden_from_inactive_status_queries(
    client: TestClient,
    lifecycle_manager: tuple[User, Employee],
):
    """Managers cannot query inactive or all employees via status filter."""
    mgr_user, _ = lifecycle_manager
    headers = auth_header(mgr_user)

    # Regular query works
    res_ok = client.get("/api/v1/employees", headers=headers)
    assert res_ok.status_code == 200

    # Inactive query forbidden
    res_inact = client.get("/api/v1/employees?status=INACTIVE", headers=headers)
    assert res_inact.status_code == 403

    # All query forbidden
    res_all = client.get("/api/v1/employees?status=ALL", headers=headers)
    assert res_all.status_code == 403


def test_admin_get_employee_include_deleted_flag(
    client: TestClient,
    lifecycle_admin: User,
    lifecycle_employee: tuple[User, Employee],
):
    """Single employee lookup respects include_deleted flag for Admin."""
    headers = auth_header(lifecycle_admin)
    _, target_emp = lifecycle_employee

    # Deactivate
    client.delete(f"/api/v1/employees/{target_emp.id}", headers=headers)

    # Standard lookup returns 404
    res_standard = client.get(f"/api/v1/employees/{target_emp.id}", headers=headers)
    assert res_standard.status_code == 404

    # Lookup with include_deleted=true succeeds
    res_included = client.get(f"/api/v1/employees/{target_emp.id}?include_deleted=true", headers=headers)
    assert res_included.status_code == 200
    assert res_included.json()["id"] == target_emp.id
    assert res_included.json()["is_active"] is False


# ---------------------------------------------------------------------------
# Authentication & Session Invalidation After Employee Deactivation
# ---------------------------------------------------------------------------

def test_active_employee_user_can_login(
    client: TestClient,
    lifecycle_employee: tuple[User, Employee],
):
    """1. Active employee and active user can successfully log in."""
    _, emp = lifecycle_employee
    res = client.post(
        "/api/v1/auth/login",
        json={"email": emp.email, "password": "ValidPassword123!"},
    )
    assert res.status_code == 200
    assert "access_token" in res.json()


def test_login_rejected_after_delete_deactivation(
    client: TestClient,
    lifecycle_admin: User,
    lifecycle_employee: tuple[User, Employee],
    db_session: Session,
):
    """2. Login is rejected after DELETE /api/v1/employees/{id} deactivation."""
    admin_headers = auth_header(lifecycle_admin)
    _, emp = lifecycle_employee

    # Deactivate employee via DELETE
    del_res = client.delete(f"/api/v1/employees/{emp.id}", headers=admin_headers)
    assert del_res.status_code == 204

    # Login attempt must fail with generic 401
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": emp.email, "password": "ValidPassword123!"},
    )
    assert login_res.status_code == 401
    assert login_res.json()["detail"] == "Invalid email or password."

    # Audit log recorded with reason="account_inactive"
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "AUTH_LOGIN_FAILED",
        ).order_by(AuditLog.id.desc())
    )
    assert audit is not None
    assert audit.metadata_["reason"] == "account_inactive"


def test_login_rejected_after_patch_deactivation(
    client: TestClient,
    lifecycle_admin: User,
    lifecycle_employee: tuple[User, Employee],
    db_session: Session,
):
    """3. Login is rejected after PATCH /api/v1/employees/{id} with is_active=false."""
    admin_headers = auth_header(lifecycle_admin)
    _, emp = lifecycle_employee

    # Deactivate employee via PATCH is_active=false
    patch_res = client.patch(
        f"/api/v1/employees/{emp.id}",
        json={"is_active": False},
        headers=admin_headers,
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["is_active"] is False

    # Login attempt must fail with generic 401
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": emp.email, "password": "ValidPassword123!"},
    )
    assert login_res.status_code == 401
    assert login_res.json()["detail"] == "Invalid email or password."


def test_existing_jwt_works_before_deactivation_and_rejected_after_delete(
    client: TestClient,
    lifecycle_admin: User,
    lifecycle_employee: tuple[User, Employee],
):
    """4, 5, 7. Existing JWT works before deactivation and is rejected after DELETE deactivation on /api/v1/auth/me."""
    admin_headers = auth_header(lifecycle_admin)
    user, emp = lifecycle_employee

    # Issue token before deactivation
    token = create_access_token(
        subject=user.id,
        extra_claims={"pwd": derive_pwd_fingerprint(user.password_hash)},
    )
    emp_headers = {"Authorization": f"Bearer {token}"}

    # 4. Works before deactivation
    res_before = client.get("/api/v1/auth/me", headers=emp_headers)
    assert res_before.status_code == 200
    assert res_before.json()["id"] == user.id

    # Deactivate employee via DELETE
    del_res = client.delete(f"/api/v1/employees/{emp.id}", headers=admin_headers)
    assert del_res.status_code == 204

    # 5, 7. Existing JWT is now rejected with 403 Forbidden
    res_after = client.get("/api/v1/auth/me", headers=emp_headers)
    assert res_after.status_code == 403
    assert res_after.json()["detail"] == "User account is inactive."


def test_existing_jwt_rejected_after_patch_deactivation(
    client: TestClient,
    lifecycle_admin: User,
    lifecycle_employee: tuple[User, Employee],
):
    """6. Existing JWT is rejected after PATCH is_active=false deactivation on /api/v1/auth/me."""
    admin_headers = auth_header(lifecycle_admin)
    user, emp = lifecycle_employee

    # Issue token before deactivation
    token = create_access_token(
        subject=user.id,
        extra_claims={"pwd": derive_pwd_fingerprint(user.password_hash)},
    )
    emp_headers = {"Authorization": f"Bearer {token}"}

    res_before = client.get("/api/v1/auth/me", headers=emp_headers)
    assert res_before.status_code == 200

    # Deactivate employee via PATCH is_active=false
    patch_res = client.patch(
        f"/api/v1/employees/{emp.id}",
        json={"is_active": False},
        headers=admin_headers,
    )
    assert patch_res.status_code == 200

    # Existing JWT is rejected with 403
    res_after = client.get("/api/v1/auth/me", headers=emp_headers)
    assert res_after.status_code == 403
    assert res_after.json()["detail"] == "User account is inactive."


def test_reactivation_permits_login_again_when_user_active(
    client: TestClient,
    lifecycle_admin: User,
    lifecycle_employee: tuple[User, Employee],
):
    """8. Reactivation permits login again when User.is_active remains True."""
    admin_headers = auth_header(lifecycle_admin)
    _, emp = lifecycle_employee

    # Deactivate
    client.delete(f"/api/v1/employees/{emp.id}", headers=admin_headers)

    # Login fails while deactivated
    res_fail = client.post(
        "/api/v1/auth/login",
        json={"email": emp.email, "password": "ValidPassword123!"},
    )
    assert res_fail.status_code == 401

    # Reactivate employee
    react_res = client.post(f"/api/v1/employees/{emp.id}/reactivate", headers=admin_headers)
    assert react_res.status_code == 200

    # Login succeeds again
    res_success = client.post(
        "/api/v1/auth/login",
        json={"email": emp.email, "password": "ValidPassword123!"},
    )
    assert res_success.status_code == 200
    assert "access_token" in res_success.json()


def test_reactivation_does_not_restore_independently_disabled_user(
    client: TestClient,
    lifecycle_admin: User,
    lifecycle_employee: tuple[User, Employee],
    db_session: Session,
):
    """9. Reactivation does not restore login when User.is_active was independently set to False."""
    admin_headers = auth_header(lifecycle_admin)
    user, emp = lifecycle_employee

    # Independently disable the User account (e.g. security suspension)
    user.is_active = False
    db_session.commit()

    # Deactivate employee
    client.delete(f"/api/v1/employees/{emp.id}", headers=admin_headers)

    # Reactivate employee
    react_res = client.post(f"/api/v1/employees/{emp.id}/reactivate", headers=admin_headers)
    assert react_res.status_code == 200

    # Verify User.is_active is still False
    db_session.refresh(user)
    assert user.is_active is False

    # Login must still fail because the user account is independently suspended
    res_login = client.post(
        "/api/v1/auth/login",
        json={"email": emp.email, "password": "ValidPassword123!"},
    )
    assert res_login.status_code == 401
    assert res_login.json()["detail"] == "Invalid email or password."


def test_standalone_admin_without_employee_can_login_and_access_me(
    client: TestClient,
    lifecycle_admin: User,
):
    """10. Standalone ADMIN without an Employee record (employee_id is None) can log in and access /auth/me."""
    assert lifecycle_admin.employee_id is None

    # Login succeeds
    res_login = client.post(
        "/api/v1/auth/login",
        json={"email": lifecycle_admin.email, "password": "ValidPassword123!"},
    )
    assert res_login.status_code == 200
    token = res_login.json()["access_token"]

    # Access /auth/me succeeds
    res_me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res_me.status_code == 200
    assert res_me.json()["email"] == lifecycle_admin.email
    assert res_me.json()["employee_id"] is None

