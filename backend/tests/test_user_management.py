from datetime import date
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import (
    create_access_token,
    derive_pwd_fingerprint,
    hash_password,
    verify_password,
)
from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.user import User


@pytest.fixture
def um_admin(db_session: Session) -> User:
    admin = User(
        full_name="User Management Admin",
        email="um_admin@example.com",
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
def um_manager(db_session: Session) -> tuple[User, Employee]:
    emp = Employee(
        employee_code="MGR-UM-01",
        first_name="Alice",
        last_name="Manager",
        email="alice.mgr@example.com",
        department="Engineering",
        designation="Engineering Lead",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)

    user = User(
        full_name="Alice Manager",
        email="alice.mgr@example.com",
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
def um_employee(db_session: Session) -> tuple[User, Employee]:
    emp = Employee(
        employee_code="EMP-UM-01",
        first_name="Bob",
        last_name="Staff",
        email="bob.staff@example.com",
        department="Engineering",
        designation="Software Engineer",
        joining_date=date(2025, 2, 1),
        is_active=True,
    )
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)

    user = User(
        full_name="Bob Staff",
        email="bob.staff@example.com",
        password_hash=hash_password("EmployeePass123!"),
        role="EMPLOYEE",
        employee_id=emp.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user, emp


@pytest.fixture
def unprovisioned_employee(db_session: Session) -> Employee:
    emp = Employee(
        employee_code="EMP-UM-99",
        first_name="Charlie",
        last_name="Newhire",
        email="charlie.newhire@example.com",
        department="Sales",
        designation="Sales Representative",
        joining_date=date(2025, 5, 1),
        is_active=True,
    )
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)
    return emp


def auth_header(user: User) -> dict[str, str]:
    token = create_access_token(
        subject=user.id,
        extra_claims={"pwd": derive_pwd_fingerprint(user.password_hash)},
    )
    return {"Authorization": f"Bearer {token}"}


def test_admin_can_list_users(
    client: TestClient,
    um_admin: User,
    um_manager: tuple[User, Employee],
    um_employee: tuple[User, Employee],
):
    """Admin can list all user accounts with enriched employee metadata."""
    headers = auth_header(um_admin)
    res = client.get("/api/v1/users", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 3

    emails = [u["email"] for u in data]
    assert "um_admin@example.com" in emails
    assert "alice.mgr@example.com" in emails
    assert "bob.staff@example.com" in emails

    # Excludes password hash
    for u in data:
        assert "password_hash" not in u
        assert "password" not in u


def test_non_admin_forbidden_from_users_endpoints(
    client: TestClient,
    um_manager: tuple[User, Employee],
    um_employee: tuple[User, Employee],
    unprovisioned_employee: Employee,
):
    """Managers and Employees receive 403 on user management endpoints."""
    mgr_user, _ = um_manager
    emp_user, _ = um_employee

    # Manager listing -> 403
    res_mgr = client.get("/api/v1/users", headers=auth_header(mgr_user))
    assert res_mgr.status_code == 403

    # Employee listing -> 403
    res_emp = client.get("/api/v1/users", headers=auth_header(emp_user))
    assert res_emp.status_code == 403

    # Manager creating -> 403
    payload = {
        "employee_id": unprovisioned_employee.id,
        "role": "EMPLOYEE",
        "initial_password": "InitialPass123!",
    }
    res_create_mgr = client.post("/api/v1/users", json=payload, headers=auth_header(mgr_user))
    assert res_create_mgr.status_code == 403

    # Employee status update -> 403
    res_patch_emp = client.patch(
        f"/api/v1/users/{emp_user.id}/status",
        json={"is_active": False},
        headers=auth_header(emp_user),
    )
    assert res_patch_emp.status_code == 403


def test_create_user_success_and_login_flow(
    client: TestClient,
    um_admin: User,
    unprovisioned_employee: Employee,
    db_session: Session,
):
    """Admin provisions an account for an active employee, who can then authenticate."""
    headers = auth_header(um_admin)
    payload = {
        "employee_id": unprovisioned_employee.id,
        "role": "EMPLOYEE",
        "initial_password": "NewEmployeePassword123!",
    }

    res = client.post("/api/v1/users", json=payload, headers=headers)
    assert res.status_code == 201
    data = res.json()
    assert data["employee_id"] == unprovisioned_employee.id
    assert data["email"] == unprovisioned_employee.email
    assert data["full_name"] == f"{unprovisioned_employee.first_name} {unprovisioned_employee.last_name}"
    assert data["role"] == "EMPLOYEE"
    assert data["is_active"] is True
    assert data["employee_code"] == unprovisioned_employee.employee_code
    assert data["department"] == unprovisioned_employee.department
    assert "password_hash" not in data

    # Verify atomic audit log
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "USER_CREATE",
            AuditLog.target_id == str(data["id"]),
        )
    )
    assert audit is not None
    assert audit.actor_user_id == um_admin.id
    assert audit.metadata_["role"] == "EMPLOYEE"
    assert audit.metadata_["employee_code"] == unprovisioned_employee.employee_code

    # Verify new user can immediately log in
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": unprovisioned_employee.email, "password": "NewEmployeePassword123!"},
    )
    assert login_res.status_code == 200
    assert "access_token" in login_res.json()


def test_create_user_duplicate_employee_conflict(
    client: TestClient,
    um_admin: User,
    um_employee: tuple[User, Employee],
):
    """Creating another account for an employee who already has one returns 409 Conflict."""
    headers = auth_header(um_admin)
    _, emp = um_employee

    payload = {
        "employee_id": emp.id,
        "role": "EMPLOYEE",
        "initial_password": "AnotherPassword123!",
    }
    res = client.post("/api/v1/users", json=payload, headers=headers)
    assert res.status_code == 409
    assert "already exists for this employee" in res.json()["detail"]


def test_create_user_duplicate_email_conflict(
    client: TestClient,
    um_admin: User,
    unprovisioned_employee: Employee,
):
    """Creating an account with an existing email returns 409 Conflict."""
    headers = auth_header(um_admin)
    payload = {
        "employee_id": unprovisioned_employee.id,
        "role": "EMPLOYEE",
        "initial_password": "ValidPassword123!",
        "email": "um_admin@example.com",  # Conflict with admin email
    }
    res = client.post("/api/v1/users", json=payload, headers=headers)
    assert res.status_code == 409
    assert "email address already exists" in res.json()["detail"]


def test_create_user_for_inactive_employee_rejected(
    client: TestClient,
    um_admin: User,
    unprovisioned_employee: Employee,
    db_session: Session,
):
    """Attempting to provision an account for a deactivated employee returns 400."""
    headers = auth_header(um_admin)

    # Deactivate the employee first
    unprovisioned_employee.is_active = False
    db_session.commit()

    payload = {
        "employee_id": unprovisioned_employee.id,
        "role": "EMPLOYEE",
        "initial_password": "ValidPassword123!",
    }
    res = client.post("/api/v1/users", json=payload, headers=headers)
    assert res.status_code == 400
    assert "inactive or deactivated employee" in res.json()["detail"]


def test_create_user_admin_role_rejected(
    client: TestClient,
    um_admin: User,
    unprovisioned_employee: Employee,
):
    """Assigning ADMIN role is rejected by validation."""
    headers = auth_header(um_admin)
    payload = {
        "employee_id": unprovisioned_employee.id,
        "role": "ADMIN",
        "initial_password": "ValidPassword123!",
    }
    res = client.post("/api/v1/users", json=payload, headers=headers)
    assert res.status_code == 422  # Pydantic Literal validation


def test_update_user_status_independent_of_employee(
    client: TestClient,
    um_admin: User,
    um_employee: tuple[User, Employee],
    db_session: Session,
):
    """Admin can disable and re-enable a user account without altering the Employee model."""
    headers = auth_header(um_admin)
    user, emp = um_employee

    # 1. Disable user
    res_disable = client.patch(
        f"/api/v1/users/{user.id}/status",
        json={"is_active": False},
        headers=headers,
    )
    assert res_disable.status_code == 200
    assert res_disable.json()["is_active"] is False

    # Verify Employee is completely untouched and still active
    db_session.expire_all()
    emp_db = db_session.get(Employee, emp.id)
    assert emp_db.is_active is True
    assert emp_db.deleted_at is None

    # Verify login is rejected
    login_fail = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": "EmployeePass123!"},
    )
    assert login_fail.status_code == 401

    # Verify audit log for status update
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "USER_STATUS_UPDATE",
            AuditLog.target_id == str(user.id),
        )
    )
    assert audit is not None
    assert audit.metadata_["new_is_active"] is False

    # 2. Re-enable user
    res_enable = client.patch(
        f"/api/v1/users/{user.id}/status",
        json={"is_active": True},
        headers=headers,
    )
    assert res_enable.status_code == 200
    assert res_enable.json()["is_active"] is True

    # Verify login succeeds again
    login_success = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": "EmployeePass123!"},
    )
    assert login_success.status_code == 200


def test_admin_cannot_disable_self(
    client: TestClient,
    um_admin: User,
):
    """Admin cannot disable their own account."""
    headers = auth_header(um_admin)
    res = client.patch(
        f"/api/v1/users/{um_admin.id}/status",
        json={"is_active": False},
        headers=headers,
    )
    assert res.status_code == 400
    assert "Administrators cannot disable their own account" in res.json()["detail"]
