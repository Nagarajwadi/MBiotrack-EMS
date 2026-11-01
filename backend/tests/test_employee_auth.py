from datetime import date, datetime, timezone
from unittest.mock import patch
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password
from app.dependencies.auth import get_current_user
from app.main import app
from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.user import User
from app.schemas.employee import EmployeeUpdate
from app.services.employee_service import EmployeeService


# ---------------------------------------------------------------------------
# Fixtures & Helpers
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_employee_1(db_session: Session) -> Employee:
    emp = Employee(
        employee_code="EMP101",
        first_name="Alice",
        last_name="Smith",
        email="alice.smith@example.com",
        department="Engineering",
        designation="Software Engineer",
        joining_date=date(2026, 1, 10),
        is_active=True,
    )
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)
    return emp


@pytest.fixture
def sample_employee_2(db_session: Session) -> Employee:
    emp = Employee(
        employee_code="EMP102",
        first_name="Bob",
        last_name="Jones",
        email="bob.jones@example.com",
        department="Product",
        designation="Product Manager",
        joining_date=date(2026, 2, 1),
        is_active=True,
    )
    db_session.add(emp)
    db_session.commit()
    db_session.refresh(emp)
    return emp


@pytest.fixture
def admin_user(db_session: Session) -> User:
    admin = User(
        full_name="System Administrator",
        email="admin@testcorp.com",
        password_hash=hash_password("ValidAdminPass123!"),
        role="ADMIN",
        employee_id=None,
        is_active=True,
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)
    return admin


@pytest.fixture
def manager_user(db_session: Session, sample_employee_2: Employee) -> User:
    manager = User(
        full_name="Team Manager",
        email="manager@testcorp.com",
        password_hash=hash_password("ValidManagerPass123!"),
        role="MANAGER",
        employee_id=sample_employee_2.id,
        is_active=True,
    )
    db_session.add(manager)
    db_session.commit()
    db_session.refresh(manager)
    return manager


@pytest.fixture
def employee_user(db_session: Session, sample_employee_1: Employee) -> User:
    user = User(
        full_name="Alice Smith",
        email="alice.user@testcorp.com",
        password_hash=hash_password("ValidEmployeePass123!"),
        role="EMPLOYEE",
        employee_id=sample_employee_1.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def inactive_user(db_session: Session) -> User:
    user = User(
        full_name="Deactivated Admin",
        email="inactive_admin@testcorp.com",
        password_hash=hash_password("ValidPass123!"),
        role="ADMIN",
        employee_id=None,
        is_active=False,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def auth_header(user: User) -> dict[str, str]:
    token = create_access_token(subject=user.id)
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# 1. Unauthenticated & Inactive Access Tests
# ---------------------------------------------------------------------------

def test_unauthenticated_requests_return_401(client: TestClient, sample_employee_1: Employee):
    assert client.get("/api/v1/employees").status_code == 401
    assert client.post("/api/v1/employees", json={}).status_code == 401
    assert client.get(f"/api/v1/employees/{sample_employee_1.id}").status_code == 401
    assert client.patch(f"/api/v1/employees/{sample_employee_1.id}", json={}).status_code == 401
    assert client.delete(f"/api/v1/employees/{sample_employee_1.id}").status_code == 401


def test_inactive_user_token_returns_403(client: TestClient, inactive_user: User, sample_employee_1: Employee):
    headers = auth_header(inactive_user)
    assert client.get("/api/v1/employees", headers=headers).status_code == 403
    assert client.post("/api/v1/employees", json={}, headers=headers).status_code == 403
    assert client.get(f"/api/v1/employees/{sample_employee_1.id}", headers=headers).status_code == 403
    assert client.patch(f"/api/v1/employees/{sample_employee_1.id}", json={}, headers=headers).status_code == 403
    assert client.delete(f"/api/v1/employees/{sample_employee_1.id}", headers=headers).status_code == 403


# ---------------------------------------------------------------------------
# 2. Administrator Full Lifecycle & Audit Logging Tests
# ---------------------------------------------------------------------------

def test_admin_can_create_employee_with_audit_log(
    client: TestClient,
    admin_user: User,
    db_session: Session,
):
    headers = auth_header(admin_user)
    payload = {
        "employee_code": "EMP200",
        "first_name": "Charlie",
        "last_name": "Brown",
        "email": "charlie@testcorp.com",
        "department": "Operations",
        "designation": "Ops Lead",
        "joining_date": "2026-03-01",
        "is_active": True,
    }
    response = client.post("/api/v1/employees", json=payload, headers=headers)
    assert response.status_code == 201
    data = response.json()
    emp_id = data["id"]
    assert data["employee_code"] == "EMP200"

    # Verify atomic audit log
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "EMPLOYEE_CREATE",
            AuditLog.target_id == str(emp_id),
        )
    )
    assert audit is not None
    assert audit.actor_user_id == admin_user.id
    assert audit.target_type == "employee"
    assert audit.metadata_["employee_code"] == "EMP200"
    assert audit.metadata_["role"] == "ADMIN"


def test_admin_can_list_and_view_any_employee(
    client: TestClient,
    admin_user: User,
    sample_employee_1: Employee,
):
    headers = auth_header(admin_user)
    list_res = client.get("/api/v1/employees", headers=headers)
    assert list_res.status_code == 200
    ids = [e["id"] for e in list_res.json()]
    assert sample_employee_1.id in ids

    get_res = client.get(f"/api/v1/employees/{sample_employee_1.id}", headers=headers)
    assert get_res.status_code == 200
    assert get_res.json()["employee_code"] == sample_employee_1.employee_code


def test_admin_can_update_any_field_with_audit_log(
    client: TestClient,
    admin_user: User,
    sample_employee_1: Employee,
    db_session: Session,
):
    headers = auth_header(admin_user)
    update_payload = {
        "department": "Infrastructure",
        "designation": "Staff Engineer",
        "first_name": "Alicia",
    }
    response = client.patch(
        f"/api/v1/employees/{sample_employee_1.id}",
        json=update_payload,
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["department"] == "Infrastructure"
    assert data["first_name"] == "Alicia"

    # Verify atomic audit log
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "EMPLOYEE_UPDATE",
            AuditLog.target_id == str(sample_employee_1.id),
        )
    )
    assert audit is not None
    assert audit.actor_user_id == admin_user.id
    assert audit.metadata_["role"] == "ADMIN"
    assert sorted(audit.metadata_["updated_fields"]) == ["department", "designation", "first_name"]


def test_admin_can_deactivate_via_delete_endpoint(
    client: TestClient,
    admin_user: User,
    sample_employee_1: Employee,
    db_session: Session,
):
    headers = auth_header(admin_user)
    del_res = client.delete(f"/api/v1/employees/{sample_employee_1.id}", headers=headers)
    assert del_res.status_code == 204

    # Verify soft-deletion: row still exists in DB
    db_session.expire_all()
    emp = db_session.get(Employee, sample_employee_1.id)
    assert emp is not None
    assert emp.is_active is False
    assert emp.deleted_at is not None

    # Verify atomic audit log
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "EMPLOYEE_DEACTIVATE",
            AuditLog.target_id == str(sample_employee_1.id),
        )
    )
    assert audit is not None
    assert audit.actor_user_id == admin_user.id
    assert audit.metadata_["employee_code"] == sample_employee_1.employee_code


# ---------------------------------------------------------------------------
# 3. Manager Permissions & Prohibitions Tests
# ---------------------------------------------------------------------------

def test_manager_can_list_and_create_employee(
    client: TestClient,
    manager_user: User,
    sample_employee_1: Employee,
    db_session: Session,
):
    headers = auth_header(manager_user)

    # Manager can list
    list_res = client.get("/api/v1/employees", headers=headers)
    assert list_res.status_code == 200
    ids = [e["id"] for e in list_res.json()]
    assert sample_employee_1.id in ids

    # Manager can create
    payload = {
        "employee_code": "EMP300",
        "first_name": "Diana",
        "last_name": "Prince",
        "email": "diana@testcorp.com",
        "department": "Security",
        "designation": "Security Architect",
        "joining_date": "2026-04-01",
        "is_active": True,
    }
    create_res = client.post("/api/v1/employees", json=payload, headers=headers)
    assert create_res.status_code == 201
    new_id = create_res.json()["id"]

    # Verify audit record reflects MANAGER role
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "EMPLOYEE_CREATE",
            AuditLog.target_id == str(new_id),
        )
    )
    assert audit is not None
    assert audit.actor_user_id == manager_user.id
    assert audit.metadata_["role"] == "MANAGER"


def test_manager_can_update_regular_fields(
    client: TestClient,
    manager_user: User,
    sample_employee_1: Employee,
):
    headers = auth_header(manager_user)
    update_res = client.patch(
        f"/api/v1/employees/{sample_employee_1.id}",
        json={"department": "Core Platform", "is_active": True},
        headers=headers,
    )
    assert update_res.status_code == 200
    assert update_res.json()["department"] == "Core Platform"


def test_manager_cannot_deactivate_employee_via_delete(
    client: TestClient,
    manager_user: User,
    sample_employee_1: Employee,
):
    headers = auth_header(manager_user)
    del_res = client.delete(f"/api/v1/employees/{sample_employee_1.id}", headers=headers)
    assert del_res.status_code == 403
    assert del_res.json()["detail"] == "Operation not permitted for the current user role."


def test_manager_cannot_deactivate_employee_via_patch(
    client: TestClient,
    manager_user: User,
    sample_employee_1: Employee,
):
    headers = auth_header(manager_user)
    patch_res = client.patch(
        f"/api/v1/employees/{sample_employee_1.id}",
        json={"is_active": False},
        headers=headers,
    )
    assert patch_res.status_code == 403
    assert "Managers are not authorized to deactivate employees" in patch_res.json()["detail"]


# ---------------------------------------------------------------------------
# 4. Employee Self-Service & Restrictions Tests
# ---------------------------------------------------------------------------

def test_employee_cannot_list_directory(client: TestClient, employee_user: User):
    headers = auth_header(employee_user)
    res = client.get("/api/v1/employees", headers=headers)
    assert res.status_code == 403
    assert res.json()["detail"] == "Operation not permitted for the current user role."


def test_employee_cannot_create_employee(client: TestClient, employee_user: User):
    headers = auth_header(employee_user)
    payload = {
        "employee_code": "EMP400",
        "first_name": "Eve",
        "last_name": "Tester",
        "email": "eve@testcorp.com",
        "department": "QA",
        "designation": "QA Engineer",
        "joining_date": "2026-05-01",
        "is_active": True,
    }
    res = client.post("/api/v1/employees", json=payload, headers=headers)
    assert res.status_code == 403
    assert res.json()["detail"] == "Operation not permitted for the current user role."


def test_employee_cannot_delete_employee(
    client: TestClient,
    employee_user: User,
    sample_employee_1: Employee,
):
    headers = auth_header(employee_user)
    res = client.delete(f"/api/v1/employees/{sample_employee_1.id}", headers=headers)
    assert res.status_code == 403
    assert res.json()["detail"] == "Operation not permitted for the current user role."


def test_employee_can_view_own_record_only(
    client: TestClient,
    employee_user: User,
    sample_employee_1: Employee,
    sample_employee_2: Employee,
):
    headers = auth_header(employee_user)

    # Own record -> 200
    own_res = client.get(f"/api/v1/employees/{sample_employee_1.id}", headers=headers)
    assert own_res.status_code == 200
    assert own_res.json()["id"] == sample_employee_1.id

    # Other employee's record -> 403
    other_res = client.get(f"/api/v1/employees/{sample_employee_2.id}", headers=headers)
    assert other_res.status_code == 403
    assert "You may only view your own employee record" in other_res.json()["detail"]


def test_employee_can_update_own_names_only(
    client: TestClient,
    employee_user: User,
    sample_employee_1: Employee,
    db_session: Session,
):
    headers = auth_header(employee_user)
    patch_res = client.patch(
        f"/api/v1/employees/{sample_employee_1.id}",
        json={"first_name": "Ally", "last_name": "Smyth"},
        headers=headers,
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["first_name"] == "Ally"
    assert patch_res.json()["last_name"] == "Smyth"

    # Verify audit log reflects self-service EMPLOYEE update
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "EMPLOYEE_UPDATE",
            AuditLog.target_id == str(sample_employee_1.id),
        )
    )
    assert audit is not None
    assert audit.actor_user_id == employee_user.id
    assert audit.metadata_["role"] == "EMPLOYEE"
    assert sorted(audit.metadata_["updated_fields"]) == ["first_name", "last_name"]


@pytest.mark.parametrize(
    "forbidden_payload",
    [
        {"email": "new.email@testcorp.com"},
        {"department": "Executive"},
        {"designation": "Director"},
        {"joining_date": "2020-01-01"},
        {"is_active": False},
        {"first_name": "Ally", "email": "new.email@testcorp.com"},
    ],
)
def test_employee_cannot_update_restricted_fields(
    client: TestClient,
    employee_user: User,
    sample_employee_1: Employee,
    forbidden_payload: dict,
):
    headers = auth_header(employee_user)
    patch_res = client.patch(
        f"/api/v1/employees/{sample_employee_1.id}",
        json=forbidden_payload,
        headers=headers,
    )
    assert patch_res.status_code == 403
    assert "Employees are only permitted to update first_name and last_name" in patch_res.json()["detail"]


def test_employee_cannot_update_other_record(
    client: TestClient,
    employee_user: User,
    sample_employee_2: Employee,
):
    headers = auth_header(employee_user)
    patch_res = client.patch(
        f"/api/v1/employees/{sample_employee_2.id}",
        json={"first_name": "Hacked"},
        headers=headers,
    )
    assert patch_res.status_code == 403
    assert "You may only update your own employee record" in patch_res.json()["detail"]


def test_unlinked_employee_user_rejected_on_self_service(
    client: TestClient,
    sample_employee_1: Employee,
    db_session: Session,
):
    # Construct an in-memory EMPLOYEE user with employee_id=None
    unlinked_user = User(
        id=999,
        full_name="Unlinked Employee",
        email="unlinked@testcorp.com",
        password_hash="fake",
        role="EMPLOYEE",
        employee_id=None,
        is_active=True,
    )

    # 1. Test via API route dependency override
    app.dependency_overrides[get_current_user] = lambda: unlinked_user
    try:
        # Self-service view rejected
        get_res = client.get(
            f"/api/v1/employees/{sample_employee_1.id}",
            headers={"Authorization": "Bearer fake_token"},
        )
        assert get_res.status_code == 403
        assert "User account is not linked to an employee record" in get_res.json()["detail"]

        # Self-service patch rejected
        patch_res = client.patch(
            f"/api/v1/employees/{sample_employee_1.id}",
            json={"first_name": "Attempt"},
            headers={"Authorization": "Bearer fake_token"},
        )
        assert patch_res.status_code == 403
        assert "User account is not linked to an employee record" in patch_res.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    # 2. Test directly against EmployeeService methods
    with pytest.raises(HTTPException) as exc_get:
        EmployeeService.get_employee_by_id(
            db=db_session,
            employee_id=sample_employee_1.id,
            current_user=unlinked_user,
        )
    assert exc_get.value.status_code == 403
    assert exc_get.value.detail == "User account is not linked to an employee record."

    with pytest.raises(HTTPException) as exc_patch:
        EmployeeService.update_employee(
            db=db_session,
            employee_id=sample_employee_1.id,
            payload=EmployeeUpdate(first_name="Attempt"),
            current_user=unlinked_user,
        )
    assert exc_patch.value.status_code == 403
    assert exc_patch.value.detail == "User account is not linked to an employee record."


# ---------------------------------------------------------------------------
# 5. Soft-Delete Exclusion & Inaccessibility Tests
# ---------------------------------------------------------------------------

def test_soft_deleted_employee_is_inaccessible(
    client: TestClient,
    admin_user: User,
    sample_employee_1: Employee,
    db_session: Session,
):
    headers = auth_header(admin_user)

    # Soft-delete the employee
    del_res = client.delete(f"/api/v1/employees/{sample_employee_1.id}", headers=headers)
    assert del_res.status_code == 204

    # 1. Omitted from list_employees
    list_res = client.get("/api/v1/employees", headers=headers)
    assert list_res.status_code == 200
    ids = [e["id"] for e in list_res.json()]
    assert sample_employee_1.id not in ids

    # 2. Inaccessible via GET -> 404
    get_res = client.get(f"/api/v1/employees/{sample_employee_1.id}", headers=headers)
    assert get_res.status_code == 404
    assert get_res.json()["detail"] == "Employee not found"

    # 3. Inaccessible via PATCH -> 404
    patch_res = client.patch(
        f"/api/v1/employees/{sample_employee_1.id}",
        json={"first_name": "Ghost"},
        headers=headers,
    )
    assert patch_res.status_code == 404
    assert patch_res.json()["detail"] == "Employee not found"

    # 4. Inaccessible via repeated DELETE -> 404
    del_res_repeat = client.delete(f"/api/v1/employees/{sample_employee_1.id}", headers=headers)
    assert del_res_repeat.status_code == 404
    assert del_res_repeat.json()["detail"] == "Employee not found"


# ---------------------------------------------------------------------------
# 6. Audit Failure Rollback Verification Tests
# ---------------------------------------------------------------------------

def test_audit_failure_rolls_back_employee_create(
    client: TestClient,
    admin_user: User,
    db_session: Session,
):
    headers = auth_header(admin_user)
    payload = {
        "employee_code": "EMP_FAIL_ROLLBACK",
        "first_name": "Fail",
        "last_name": "Create",
        "email": "fail_create@testcorp.com",
        "department": "Engineering",
        "designation": "Tester",
        "joining_date": "2026-06-01",
        "is_active": True,
    }

    with patch("app.services.employee_service.AuditLog", side_effect=RuntimeError("Simulated audit creation failure")):
        with pytest.raises(RuntimeError, match="Simulated audit creation failure"):
            client.post("/api/v1/employees", json=payload, headers=headers)

    # Verify employee was NOT created in DB due to atomic rollback
    emp = db_session.scalar(
        select(Employee).where(Employee.employee_code == "EMP_FAIL_ROLLBACK")
    )
    assert emp is None


def test_audit_failure_rolls_back_employee_update(
    client: TestClient,
    admin_user: User,
    sample_employee_1: Employee,
    db_session: Session,
):
    headers = auth_header(admin_user)
    original_department = sample_employee_1.department

    with patch("app.services.employee_service.AuditLog", side_effect=RuntimeError("Simulated audit update failure")):
        with pytest.raises(RuntimeError, match="Simulated audit update failure"):
            client.patch(
                f"/api/v1/employees/{sample_employee_1.id}",
                json={"department": "Corrupted Department"},
                headers=headers,
            )

    # Verify employee department was NOT changed in DB
    db_session.expire_all()
    emp = db_session.get(Employee, sample_employee_1.id)
    assert emp is not None
    assert emp.department == original_department


def test_audit_failure_rolls_back_employee_deactivation(
    client: TestClient,
    admin_user: User,
    sample_employee_1: Employee,
    db_session: Session,
):
    headers = auth_header(admin_user)

    with patch("app.services.employee_service.AuditLog", side_effect=RuntimeError("Simulated audit deactivation failure")):
        with pytest.raises(RuntimeError, match="Simulated audit deactivation failure"):
            client.delete(f"/api/v1/employees/{sample_employee_1.id}", headers=headers)

    # Verify employee was NOT deactivated in DB
    db_session.expire_all()
    emp = db_session.get(Employee, sample_employee_1.id)
    assert emp is not None
    assert emp.is_active is True
    assert emp.deleted_at is None
