from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient
from psycopg.types.range import Range
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.session import get_db
from app.main import app
from app.models.employee import Employee
from app.models.office import EmployeeOfficeAssignment, Office
from app.models.user import User

settings = get_settings()


@pytest.fixture
def dev_db_session():
    """Provide a database session targeting mbiotrack_dev isolated in a transaction savepoint.

    All operations are rolled back on fixture teardown, guaranteeing zero persisted test data.
    """
    assert settings.DATABASE_URL is not None, "DATABASE_URL must be configured"
    engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)
    connection = engine.connect()
    transaction = connection.begin()

    session = Session(
        bind=connection,
        join_transaction_mode="create_savepoint",
        expire_on_commit=False,
    )

    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
        engine.dispose()


@pytest.fixture
def dev_client(dev_db_session):
    """FastAPI TestClient with get_db overridden to use dev_db_session."""
    def override_get_db():
        yield dev_db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def admin_user(dev_db_session) -> User:
    user = dev_db_session.scalar(select(User).where(User.role == "ADMIN", User.is_active.is_(True)))
    assert user is not None, "mbiotrack_dev must contain an active ADMIN user"
    return user


@pytest.fixture
def manager_user(dev_db_session) -> User:
    user = dev_db_session.scalar(select(User).where(User.role == "MANAGER", User.is_active.is_(True)))
    assert user is not None, "mbiotrack_dev must contain an active MANAGER user"
    return user


@pytest.fixture
def employee_user(dev_db_session) -> User:
    user = dev_db_session.scalar(select(User).where(User.role == "EMPLOYEE", User.is_active.is_(True)))
    assert user is not None, "mbiotrack_dev must contain an active EMPLOYEE user"
    return user


@pytest.fixture
def admin_headers(admin_user: User) -> dict[str, str]:
    token = create_access_token(subject=admin_user.id, extra_claims={"role": admin_user.role})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def manager_headers(manager_user: User) -> dict[str, str]:
    token = create_access_token(subject=manager_user.id, extra_claims={"role": manager_user.role})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def employee_headers(employee_user: User) -> dict[str, str]:
    token = create_access_token(subject=employee_user.id, extra_claims={"role": employee_user.role})
    return {"Authorization": f"Bearer {token}"}


# ============================================================================
# 1. OFFICE CRUD & VALIDATION TESTS
# ============================================================================

def test_admin_create_office_success(dev_client, admin_headers):
    payload = {
        "name": "Bangalore Headquarters",
        "code": "BLR-HQ",
        "timezone": "Asia/Kolkata",
        "address": "100 Outer Ring Road, Bengaluru",
        "is_active": True,
    }
    response = dev_client.post("/api/v1/offices", json=payload, headers=admin_headers)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Bangalore Headquarters"
    assert data["code"] == "BLR-HQ"
    assert data["timezone"] == "Asia/Kolkata"
    assert data["is_active"] is True
    assert "id" in data


def test_office_duplicate_code_rejected(dev_client, admin_headers):
    payload = {
        "name": "Mumbai Regional Office",
        "code": "BOM-01",
        "timezone": "Asia/Kolkata",
    }
    res1 = dev_client.post("/api/v1/offices", json=payload, headers=admin_headers)
    assert res1.status_code == 201

    # Attempt to insert identical code
    res2 = dev_client.post("/api/v1/offices", json=payload, headers=admin_headers)
    assert res2.status_code == 409
    assert "already exists" in res2.json()["detail"].lower()

    # Attempt case-insensitive duplicate: "bom-01"
    res3 = dev_client.post(
        "/api/v1/offices",
        json={**payload, "code": "bom-01", "name": "Duplicate Lowercase BOM"},
        headers=admin_headers,
    )
    assert res3.status_code == 409
    assert "already exists" in res3.json()["detail"].lower()


def test_office_invalid_timezone_rejected(dev_client, admin_headers):
    payload = {
        "name": "Invalid TZ Office",
        "code": "INV-TZ",
        "timezone": "Mars/Olympus_Mons",
    }
    response = dev_client.post("/api/v1/offices", json=payload, headers=admin_headers)
    assert response.status_code in (422, 400)


def test_office_rbac_create(dev_client, manager_headers, employee_headers):
    payload = {"name": "Unauthorized Office", "code": "UNAUTH-01", "timezone": "Asia/Kolkata"}

    # Manager receives 403 Forbidden
    res_mgr = dev_client.post("/api/v1/offices", json=payload, headers=manager_headers)
    assert res_mgr.status_code == 403

    # Employee receives 403 Forbidden
    res_emp = dev_client.post("/api/v1/offices", json=payload, headers=employee_headers)
    assert res_emp.status_code == 403


def test_office_list_and_get(dev_client, admin_headers, employee_headers):
    # Admin creates office
    create_res = dev_client.post(
        "/api/v1/offices",
        json={"name": "Chennai Branch", "code": "MAA-01", "timezone": "Asia/Kolkata"},
        headers=admin_headers,
    )
    assert create_res.status_code == 201
    office_id = create_res.json()["id"]

    # Employee can list offices
    list_res = dev_client.get("/api/v1/offices", headers=employee_headers)
    assert list_res.status_code == 200
    offices = list_res.json()
    assert any(o["id"] == office_id for o in offices)

    # Employee can get specific office
    get_res = dev_client.get(f"/api/v1/offices/{office_id}", headers=employee_headers)
    assert get_res.status_code == 200
    assert get_res.json()["code"] == "MAA-01"


def test_office_update_and_deactivate(dev_client, admin_headers, manager_headers):
    create_res = dev_client.post(
        "/api/v1/offices",
        json={"name": "Pune Tech Hub", "code": "PNQ-01", "timezone": "Asia/Kolkata"},
        headers=admin_headers,
    )
    office_id = create_res.json()["id"]

    # Manager cannot update office (403)
    patch_mgr = dev_client.patch(
        f"/api/v1/offices/{office_id}",
        json={"name": "Manager Edited Office"},
        headers=manager_headers,
    )
    assert patch_mgr.status_code == 403

    # Admin updates office
    patch_admin = dev_client.patch(
        f"/api/v1/offices/{office_id}",
        json={"name": "Pune Tech Center", "address": "Hinjawadi Phase 1"},
        headers=admin_headers,
    )
    assert patch_admin.status_code == 200
    assert patch_admin.json()["name"] == "Pune Tech Center"
    assert patch_admin.json()["address"] == "Hinjawadi Phase 1"

    # Admin deactivates office (soft-delete)
    del_admin = dev_client.delete(f"/api/v1/offices/{office_id}", headers=admin_headers)
    assert del_admin.status_code == 200
    assert del_admin.json()["is_active"] is False


# ============================================================================
# 2. EMPLOYEE OFFICE ASSIGNMENT & GIST OVERLAP PROTECTION TESTS
# ============================================================================

def test_create_assignment_success(dev_client, admin_headers, dev_db_session):
    # Setup test office
    off = Office(name="Hyderabad Hub", code="HYD-01", timezone="Asia/Kolkata")
    dev_db_session.add(off)
    dev_db_session.flush()

    emp = dev_db_session.scalar(select(Employee).where(Employee.is_active.is_(True)))
    assert emp is not None

    payload = {
        "employee_id": emp.id,
        "office_id": off.id,
        "valid_from": "2026-01-01T00:00:00Z",
        "valid_to": "2026-06-01T00:00:00Z",
        "is_primary": True,
    }
    response = dev_client.post("/api/v1/offices/assignments", json=payload, headers=admin_headers)
    assert response.status_code == 201
    data = response.json()
    assert data["employee_id"] == emp.id
    assert data["office_id"] == off.id
    assert data["is_primary"] is True


def test_adjacent_assignments_succeed_tc10_tc53(dev_client, admin_headers, dev_db_session):
    """TC-10 & TC-53: Adjacent date ranges [T1, T2) and [T2, T3) with microsecond touching bounds succeed."""
    off1 = Office(name="Office A", code="OFC-A", timezone="Asia/Kolkata")
    off2 = Office(name="Office B", code="OFC-B", timezone="Asia/Kolkata")
    dev_db_session.add_all([off1, off2])
    dev_db_session.flush()

    emp = dev_db_session.scalar(select(Employee).where(Employee.is_active.is_(True)))

    # Assignment 1: [2026-01-01 00:00:00, 2026-06-01 12:00:00.000000)
    p1 = {
        "employee_id": emp.id,
        "office_id": off1.id,
        "valid_from": "2026-01-01T00:00:00Z",
        "valid_to": "2026-06-01T12:00:00.000000Z",
        "is_primary": True,
    }
    res1 = dev_client.post("/api/v1/offices/assignments", json=p1, headers=admin_headers)
    assert res1.status_code == 201

    # Assignment 2: [2026-06-01 12:00:00.000000, 2026-12-31 23:59:59.999999) - touching microsecond boundary
    p2 = {
        "employee_id": emp.id,
        "office_id": off2.id,
        "valid_from": "2026-06-01T12:00:00.000000Z",
        "valid_to": "2026-12-31T23:59:59.999999Z",
        "is_primary": True,
    }
    res2 = dev_client.post("/api/v1/offices/assignments", json=p2, headers=admin_headers)
    assert res2.status_code == 201, f"Adjacent range failed unexpectedly: {res2.text}"


def test_overlapping_assignment_rejected_tc09_tc51(dev_client, admin_headers, dev_db_session):
    """TC-09 & TC-51: Overlapping date ranges for same employee abort with 23P01 -> HTTP 409 Conflict."""
    off1 = Office(name="Office C", code="OFC-C", timezone="Asia/Kolkata")
    off2 = Office(name="Office D", code="OFC-D", timezone="Asia/Kolkata")
    dev_db_session.add_all([off1, off2])
    dev_db_session.flush()

    emp = dev_db_session.scalar(select(Employee).where(Employee.is_active.is_(True)))

    # Assignment 1: Jan 1 to Jul 1
    p1 = {
        "employee_id": emp.id,
        "office_id": off1.id,
        "valid_from": "2026-01-01T00:00:00Z",
        "valid_to": "2026-07-01T00:00:00Z",
        "is_primary": True,
    }
    res1 = dev_client.post("/api/v1/offices/assignments", json=p1, headers=admin_headers)
    assert res1.status_code == 201

    # Overlapping Assignment: May 1 to Sep 1 (overlaps May-Jun)
    p2 = {
        "employee_id": emp.id,
        "office_id": off2.id,
        "valid_from": "2026-05-01T00:00:00Z",
        "valid_to": "2026-09-01T00:00:00Z",
        "is_primary": True,
    }
    res2 = dev_client.post("/api/v1/offices/assignments", json=p2, headers=admin_headers)
    assert res2.status_code == 409
    assert "overlapping" in res2.json()["detail"].lower()


def test_invalid_date_range_rejected(dev_client, admin_headers, dev_db_session):
    """valid_to must be strictly greater than valid_from."""
    off = Office(name="Office E", code="OFC-E", timezone="Asia/Kolkata")
    dev_db_session.add(off)
    dev_db_session.flush()

    emp = dev_db_session.scalar(select(Employee).where(Employee.is_active.is_(True)))

    # valid_to earlier than valid_from
    p_inverted = {
        "employee_id": emp.id,
        "office_id": off.id,
        "valid_from": "2026-10-01T00:00:00Z",
        "valid_to": "2026-05-01T00:00:00Z",
        "is_primary": True,
    }
    res = dev_client.post("/api/v1/offices/assignments", json=p_inverted, headers=admin_headers)
    assert res.status_code == 422

    # valid_to equal to valid_from (empty range)
    p_equal = {
        "employee_id": emp.id,
        "office_id": off.id,
        "valid_from": "2026-10-01T00:00:00Z",
        "valid_to": "2026-10-01T00:00:00Z",
        "is_primary": True,
    }
    res_eq = dev_client.post("/api/v1/offices/assignments", json=p_equal, headers=admin_headers)
    assert res_eq.status_code == 422


def test_assignment_inactive_target_rejected(dev_client, admin_headers, dev_db_session):
    active_off = Office(name="Active Office", code="ACT-01", timezone="Asia/Kolkata", is_active=True)
    inactive_off = Office(name="Inactive Office", code="INACT-01", timezone="Asia/Kolkata", is_active=False)
    dev_db_session.add_all([active_off, inactive_off])
    dev_db_session.flush()

    active_emp = dev_db_session.scalar(select(Employee).where(Employee.is_active.is_(True)))

    # Inactive office assignment rejected (400)
    p_inact_off = {
        "employee_id": active_emp.id,
        "office_id": inactive_off.id,
        "valid_from": "2026-01-01T00:00:00Z",
        "valid_to": "2026-12-31T00:00:00Z",
        "is_primary": True,
    }
    res = dev_client.post("/api/v1/offices/assignments", json=p_inact_off, headers=admin_headers)
    assert res.status_code == 400
    assert "inactive office" in res.json()["detail"].lower()

    # Non-existent employee rejected (404)
    p_no_emp = {
        "employee_id": 999999,
        "office_id": active_off.id,
        "valid_from": "2026-01-01T00:00:00Z",
        "valid_to": "2026-12-31T00:00:00Z",
        "is_primary": True,
    }
    res_no_emp = dev_client.post("/api/v1/offices/assignments", json=p_no_emp, headers=admin_headers)
    assert res_no_emp.status_code == 404


def test_assignment_rbac_matrix(
    dev_client,
    admin_headers,
    manager_headers,
    employee_headers,
    employee_user,
    dev_db_session,
):
    off = Office(name="RBAC Office", code="RBAC-01", timezone="Asia/Kolkata")
    dev_db_session.add(off)
    dev_db_session.flush()

    emp_id = employee_user.employee_id
    assert emp_id is not None

    payload = {
        "employee_id": emp_id,
        "office_id": off.id,
        "valid_from": "2026-01-01T00:00:00Z",
        "valid_to": "2026-06-01T00:00:00Z",
        "is_primary": True,
    }

    # 1. Employee cannot create assignments (403 Forbidden)
    res_emp_create = dev_client.post("/api/v1/offices/assignments", json=payload, headers=employee_headers)
    assert res_emp_create.status_code == 403

    # 2. Manager CAN create assignment (201 Created)
    res_mgr_create = dev_client.post("/api/v1/offices/assignments", json=payload, headers=manager_headers)
    assert res_mgr_create.status_code == 201
    assignment_id = res_mgr_create.json()["id"]

    # 3. Employee CAN view own assignment
    res_emp_view = dev_client.get(f"/api/v1/offices/assignments/{assignment_id}", headers=employee_headers)
    assert res_emp_view.status_code == 200
    assert res_emp_view.json()["id"] == assignment_id

    # 4. Manager cannot delete assignment (403 Forbidden)
    res_mgr_del = dev_client.delete(f"/api/v1/offices/assignments/{assignment_id}", headers=manager_headers)
    assert res_mgr_del.status_code == 403

    # 5. Admin CAN delete assignment (204 No Content)
    res_admin_del = dev_client.delete(f"/api/v1/offices/assignments/{assignment_id}", headers=admin_headers)
    assert res_admin_del.status_code == 204


def test_get_assignments_route_not_shadowed_by_offices(
    dev_client,
    admin_headers,
    manager_headers,
    employee_headers,
    employee_user,
    dev_db_session,
):
    """Regression test: GET /api/v1/offices/assignments must not return 422 due to /{office_id} route shadowing."""
    # 1. ADMIN can list assignments and receives 200 OK (not 422 integer parsing error)
    res_admin = dev_client.get("/api/v1/offices/assignments", headers=admin_headers)
    assert res_admin.status_code == 200
    assert isinstance(res_admin.json(), list)

    # 2. MANAGER can list assignments and receives 200 OK
    res_mgr = dev_client.get("/api/v1/offices/assignments", headers=manager_headers)
    assert res_mgr.status_code == 200
    assert isinstance(res_mgr.json(), list)

    # 3. EMPLOYEE can list own assignments and receives 200 OK
    res_emp = dev_client.get("/api/v1/offices/assignments", headers=employee_headers)
    assert res_emp.status_code == 200
    assert isinstance(res_emp.json(), list)

    # 4. GET /api/v1/offices/{office_id} still works for genuine integer office IDs
    off = Office(name="Test Shadow Office", code="TSO-01", timezone="Asia/Kolkata")
    dev_db_session.add(off)
    dev_db_session.flush()

    res_off = dev_client.get(f"/api/v1/offices/{off.id}", headers=admin_headers)
    assert res_off.status_code == 200
    assert res_off.json()["code"] == "TSO-01"
