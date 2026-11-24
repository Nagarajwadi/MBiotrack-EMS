from datetime import date, datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from psycopg.types.range import Range
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, derive_pwd_fingerprint, hash_password
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.main import app
from app.models.attendance_event import AttendanceEvent
from app.models.device import Device
from app.models.employee import Employee
from app.models.office import EmployeeOfficeAssignment, Office
from app.models.user import User

settings = get_settings()




def _make_auth_headers(user: User) -> dict[str, str]:
    token = create_access_token(
        subject=str(user.id),
        extra_claims={
            "role": user.role,
            "email": user.email,
            "pwd": derive_pwd_fingerprint(user.password_hash),
        },
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def team_test_data(dev_db_session: Session):
    """Seed test data with multiple departments: Engineering and Sales."""
    # 1. Office and device
    office = Office(name="HQ Team Office", code="HQ-TEAM-ATT-1", timezone="Asia/Kolkata", is_active=True)
    dev_db_session.add(office)
    dev_db_session.flush()

    device = Device(
        office_id=office.id,
        name="Lobby Turnstile",
        device_code="BIO-TEAM-ATT-01",
        serial_number="SN-TEAM-ATT-01",
        status="ACTIVE",
        is_active=True,
    )
    dev_db_session.add(device)
    dev_db_session.flush()

    # 2. Employees: 2 in QA (Manager Bob + Alice), 1 in Sales (Charlie)
    emp_mgr_eng = Employee(
        employee_code="EMP-ENG-MGR-01",
        first_name="Bob",
        last_name="Manager",
        email="bob.mgr.team@example.com",
        department="QA-Team-Test",
        designation="QA Manager",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    emp_dev_eng = Employee(
        employee_code="EMP-ENG-DEV-01",
        first_name="Alice",
        last_name="Engineer",
        email="alice.dev.team@example.com",
        department="QA-Team-Test",
        designation="QA Engineer",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    emp_sales = Employee(
        employee_code="EMP-SALES-ATT-01",
        first_name="Charlie",
        last_name="Salesman",
        email="charlie.sales.team@example.com",
        department="Sales-Team-Test",
        designation="Sales Executive",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    dev_db_session.add_all([emp_mgr_eng, emp_dev_eng, emp_sales])
    dev_db_session.flush()

    # Assignments
    val_range = Range(
        datetime(2026, 1, 1, tzinfo=timezone.utc),
        datetime(2026, 12, 31, tzinfo=timezone.utc),
        bounds="[)",
    )
    asgn1 = EmployeeOfficeAssignment(employee_id=emp_mgr_eng.id, office_id=office.id, validity_range=val_range)
    asgn2 = EmployeeOfficeAssignment(employee_id=emp_dev_eng.id, office_id=office.id, validity_range=val_range)
    asgn3 = EmployeeOfficeAssignment(employee_id=emp_sales.id, office_id=office.id, validity_range=val_range)
    dev_db_session.add_all([asgn1, asgn2, asgn3])
    dev_db_session.flush()

    # 3. Users
    user_mgr = User(
        employee_id=emp_mgr_eng.id,
        full_name="Bob Manager",
        email="bob.mgr.team@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="MANAGER",
        is_active=True,
    )
    user_emp = User(
        employee_id=emp_dev_eng.id,
        full_name="Alice Engineer",
        email="alice.dev.team@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="EMPLOYEE",
        is_active=True,
    )
    user_admin = User(
        employee_id=None,
        full_name="Root Admin",
        email="admin.team@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="ADMIN",
        is_active=True,
    )
    dev_db_session.add_all([user_mgr, user_emp, user_admin])
    dev_db_session.flush()

    # 4. Punches for test date 2026-11-15
    test_date = "2026-11-15"
    t_base = datetime(2026, 11, 15, 9, 0, 0, tzinfo=timezone.utc)

    # Bob (Manager): Checked in at 09:00, Checked out at 17:00 (CHECKED_OUT)
    p_bob_in = AttendanceEvent(
        employee_id=emp_mgr_eng.id,
        device_id=device.id,
        office_id=office.id,
        punch_type="CHECK_IN",
        event_timestamp=t_base,
        is_roaming=False,
        actor_user_id=user_mgr.id,
    )
    p_bob_out = AttendanceEvent(
        employee_id=emp_mgr_eng.id,
        device_id=device.id,
        office_id=office.id,
        punch_type="CHECK_OUT",
        event_timestamp=t_base + timedelta(hours=8),
        is_roaming=False,
        actor_user_id=user_mgr.id,
    )

    # Alice (Team member): Checked in at 09:30 (CHECKED_IN)
    p_alice_in = AttendanceEvent(
        employee_id=emp_dev_eng.id,
        device_id=device.id,
        office_id=office.id,
        punch_type="CHECK_IN",
        event_timestamp=t_base + timedelta(minutes=30),
        is_roaming=False,
        actor_user_id=user_emp.id,
    )

    # Charlie (Sales): Checked in at 10:00 (Sales department event)
    p_charlie_in = AttendanceEvent(
        employee_id=emp_sales.id,
        device_id=device.id,
        office_id=office.id,
        punch_type="CHECK_IN",
        event_timestamp=t_base + timedelta(hours=1),
        is_roaming=False,
        actor_user_id=user_admin.id,
    )

    dev_db_session.add_all([p_bob_in, p_bob_out, p_alice_in, p_charlie_in])
    dev_db_session.flush()

    return {
        "test_date": test_date,
        "user_mgr": user_mgr,
        "user_emp": user_emp,
        "user_admin": user_admin,
        "emp_mgr_eng": emp_mgr_eng,
        "emp_dev_eng": emp_dev_eng,
        "emp_sales": emp_sales,
    }


def test_manager_can_view_own_team_attendance_summary(dev_client: TestClient, team_test_data):
    """Manager Bob in Engineering sees only Engineering employees on /team-summary."""
    mgr_headers = _make_auth_headers(team_test_data["user_mgr"])
    res = dev_client.get(
        f"/api/v1/attendance/team-summary?date={team_test_data['test_date']}",
        headers=mgr_headers,
    )
    assert res.status_code == 200
    data = res.json()

    # Total employees in manager's authorized team = 2 (Bob + Alice in Engineering)
    assert data["total_employees"] == 2
    emp_ids = [e["employee_id"] for e in data["employees"]]
    assert team_test_data["emp_mgr_eng"].id in emp_ids
    assert team_test_data["emp_dev_eng"].id in emp_ids
    # Crucial security check: Charlie in Sales is NOT present
    assert team_test_data["emp_sales"].id not in emp_ids


def test_manager_cross_team_access_denied(dev_client: TestClient, team_test_data):
    """Manager Bob in Engineering cannot query Charlie in Sales by passing employee_id."""
    mgr_headers = _make_auth_headers(team_test_data["user_mgr"])
    sales_emp_id = team_test_data["emp_sales"].id

    res = dev_client.get(
        f"/api/v1/attendance/team-summary?date={team_test_data['test_date']}&employee_id={sales_emp_id}",
        headers=mgr_headers,
    )
    assert res.status_code == 403
    assert "You may only view attendance for employees within your authorized team" in res.json()["detail"]


def test_unlinked_manager_rejected_on_team_summary(dev_client: TestClient, team_test_data):
    """Manager without a linked employee profile cannot view team summary."""
    mock_mgr = User(
        id=9999,
        full_name="Unlinked Manager",
        email="unlinked.mgr@example.com",
        role="MANAGER",
        employee_id=None,
        is_active=True,
    )
    app.dependency_overrides[get_current_user] = lambda: mock_mgr
    try:
        res = dev_client.get(
            f"/api/v1/attendance/team-summary?date={team_test_data['test_date']}",
            headers={"Authorization": "Bearer dummy_token"},
        )
        assert res.status_code == 403
        assert "Manager user account is not linked to an employee staff profile" in res.json()["detail"]
    finally:
        del app.dependency_overrides[get_current_user]


def test_employee_forbidden_from_team_summary(dev_client: TestClient, team_test_data):
    """Regular employee is denied access to team summary."""
    headers = _make_auth_headers(team_test_data["user_emp"])
    res = dev_client.get(
        f"/api/v1/attendance/team-summary?date={team_test_data['test_date']}",
        headers=headers,
    )
    assert res.status_code == 403
    assert "Operation not permitted for the current user role" in res.json()["detail"]


def test_admin_can_access_team_summary(dev_client: TestClient, team_test_data):
    """Admin has organization-wide access to team summary."""
    headers = _make_auth_headers(team_test_data["user_admin"])
    res = dev_client.get(
        f"/api/v1/attendance/team-summary?date={team_test_data['test_date']}",
        headers=headers,
    )
    assert res.status_code == 200
    # Admin sees all employees in DB (at least our 3)
    emp_ids = [e["employee_id"] for e in res.json()["employees"]]
    assert team_test_data["emp_mgr_eng"].id in emp_ids
    assert team_test_data["emp_dev_eng"].id in emp_ids
    assert team_test_data["emp_sales"].id in emp_ids


def test_team_summary_punch_aggregates_and_counters(dev_client: TestClient, team_test_data):
    """Team summary accurately computes punches, first/last punch times, and status."""
    mgr_headers = _make_auth_headers(team_test_data["user_mgr"])
    res = dev_client.get(
        f"/api/v1/attendance/team-summary?date={team_test_data['test_date']}",
        headers=mgr_headers,
    )
    assert res.status_code == 200
    data = res.json()

    # 3 punches by Engineering team (2 by Bob, 1 by Alice)
    assert data["summary"]["total_events"] == 3
    assert data["summary"]["employees_with_punches"] == 2
    assert data["summary"]["employees_without_punches"] == 0

    # Inspect Bob's record
    bob_record = next(e for e in data["employees"] if e["employee_id"] == team_test_data["emp_mgr_eng"].id)
    assert bob_record["punch_count"] == 2
    assert len(bob_record["punches"]) == 2
    assert bob_record["punches"][0]["punch_type"] == "CHECK_IN"
    assert bob_record["punches"][1]["punch_type"] == "CHECK_OUT"
    assert bob_record["first_punch"] is not None
    assert bob_record["last_punch"] is not None

    # Inspect Alice's record
    alice_record = next(e for e in data["employees"] if e["employee_id"] == team_test_data["emp_dev_eng"].id)
    assert alice_record["punch_count"] == 1
    assert len(alice_record["punches"]) == 1
    assert alice_record["punches"][0]["punch_type"] == "CHECK_IN"


def test_team_events_query_cross_team_denied(dev_client: TestClient, team_test_data):
    """GET /api/v1/attendance?scope=team enforces team boundary for raw punch events."""
    mgr_headers = _make_auth_headers(team_test_data["user_mgr"])
    sales_emp_id = team_test_data["emp_sales"].id

    res_cross = dev_client.get(
        f"/api/v1/attendance?scope=team&employee_id={sales_emp_id}",
        headers=mgr_headers,
    )
    assert res_cross.status_code == 403
    assert "You may only view attendance for employees within your authorized team" in res_cross.json()["detail"]

    # In-team query succeeds
    dev_emp_id = team_test_data["emp_dev_eng"].id
    res_in_team = dev_client.get(
        f"/api/v1/attendance?scope=team&employee_id={dev_emp_id}",
        headers=mgr_headers,
    )
    assert res_in_team.status_code == 200
    assert res_in_team.json()["total"] == 1
