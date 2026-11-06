from datetime import date, datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from psycopg.types.range import Range
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, hash_password
from app.db.session import get_db
from app.main import app
from app.models.attendance_event import AttendanceEvent
from app.models.device import Device
from app.models.employee import Employee
from app.models.office import EmployeeOfficeAssignment, Office
from app.models.user import User

settings = get_settings()


@pytest.fixture
def dev_db_session():
    """Target mbiotrack_dev isolated in a transaction savepoint with guaranteed rollback."""
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
    def override_get_db():
        yield dev_db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def test_data(dev_db_session: Session):
    """Seed test offices, devices, employees, assignments, and users."""
    # 1. Offices
    office_hq = Office(name="Headquarters", code="HQ-01", timezone="Asia/Kolkata", is_active=True)
    office_branch = Office(name="Branch North", code="BR-NORTH", timezone="Asia/Kolkata", is_active=True)
    dev_db_session.add_all([office_hq, office_branch])
    dev_db_session.flush()

    # 2. Devices
    device_hq = Device(
        office_id=office_hq.id,
        name="HQ Turnstile",
        device_code="DEV-HQ-01",
        serial_number="SN-HQ-101",
        status="ACTIVE",
        is_active=True,
    )
    device_branch = Device(
        office_id=office_branch.id,
        name="Branch Turnstile",
        device_code="DEV-BR-01",
        serial_number="SN-BR-201",
        status="ACTIVE",
        is_active=True,
    )
    dev_db_session.add_all([device_hq, device_branch])
    dev_db_session.flush()

    # 3. Employees
    # Emp 1: Alice (assigned to HQ, has 2 punches at HQ - normal)
    emp_alice = Employee(
        employee_code="EMP-D-001",
        first_name="Alice",
        last_name="Normal",
        email="alice.ops@example.com",
        department="Engineering",
        designation="Software Engineer",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    # Emp 2: Bob (assigned to HQ, punches at Branch - roaming)
    emp_bob = Employee(
        employee_code="EMP-D-002",
        first_name="Bob",
        last_name="Roamer",
        email="bob.ops@example.com",
        department="Sales",
        designation="Sales Representative",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    # Emp 3: Charlie (assigned to HQ, 0 punches - NO_PUNCH)
    emp_charlie = Employee(
        employee_code="EMP-D-003",
        first_name="Charlie",
        last_name="NoPunch",
        email="charlie.ops@example.com",
        department="HR",
        designation="HR Associate",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    dev_db_session.add_all([emp_alice, emp_bob, emp_charlie])
    dev_db_session.flush()

    # 4. Assignments to HQ
    today_dt = datetime(2026, 11, 10, 0, 0, 0, tzinfo=timezone.utc)
    t_start = today_dt - timedelta(days=10)
    t_end = today_dt + timedelta(days=10)
    val_range = Range(t_start, t_end, bounds="[)")

    asgn_alice = EmployeeOfficeAssignment(employee_id=emp_alice.id, office_id=office_hq.id, validity_range=val_range)
    asgn_bob = EmployeeOfficeAssignment(employee_id=emp_bob.id, office_id=office_hq.id, validity_range=val_range)
    asgn_charlie = EmployeeOfficeAssignment(employee_id=emp_charlie.id, office_id=office_hq.id, validity_range=val_range)
    dev_db_session.add_all([asgn_alice, asgn_bob, asgn_charlie])
    dev_db_session.flush()

    # 5. Users
    user_admin = dev_db_session.scalar(select(User).where(User.role == "ADMIN", User.is_active.is_(True)))
    assert user_admin is not None

    user_alice = User(
        employee_id=emp_alice.id,
        full_name="Alice Normal",
        email="alice.ops@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="EMPLOYEE",
        is_active=True,
    )
    user_manager = User(
        employee_id=emp_bob.id,
        full_name="Manager Bob",
        email="bob.manager@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="MANAGER",
        is_active=True,
    )
    dev_db_session.add_all([user_alice, user_manager])
    dev_db_session.flush()

    # 6. Punches on test date 2026-11-10
    # Alice: Check-in 09:00 UTC at HQ (in-assignment)
    punch_alice_in = AttendanceEvent(
        employee_id=emp_alice.id,
        device_id=device_hq.id,
        office_id=office_hq.id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 10, 9, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=user_admin.id,
    )
    # Alice: Check-out 18:00 UTC at HQ (in-assignment)
    punch_alice_out = AttendanceEvent(
        employee_id=emp_alice.id,
        device_id=device_hq.id,
        office_id=office_hq.id,
        punch_type="CHECK_OUT",
        event_timestamp=datetime(2026, 11, 10, 18, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=user_admin.id,
    )
    # Bob: Check-in 10:00 UTC at Branch North (roaming punch under GOV-08)
    punch_bob_in = AttendanceEvent(
        employee_id=emp_bob.id,
        device_id=device_branch.id,
        office_id=office_branch.id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 10, 10, 0, 0, tzinfo=timezone.utc),
        is_roaming=True,
        actor_user_id=user_admin.id,
    )
    dev_db_session.add_all([punch_alice_in, punch_alice_out, punch_bob_in])
    dev_db_session.flush()

    return {
        "office_hq": office_hq,
        "office_branch": office_branch,
        "device_hq": device_hq,
        "device_branch": device_branch,
        "emp_alice": emp_alice,
        "emp_bob": emp_bob,
        "emp_charlie": emp_charlie,
        "user_admin": user_admin,
        "user_alice": user_alice,
        "user_manager": user_manager,
        "test_date": "2026-11-10",
    }


def make_headers(user: User) -> dict[str, str]:
    token = create_access_token(subject=user.id, extra_claims={"role": user.role})
    return {"Authorization": f"Bearer {token}"}


def test_daily_summary_calculations(dev_client, test_data):
    """Verify daily summary metrics: total events, employees with/without punches, review count, roaming count."""
    headers = make_headers(test_data["user_admin"])
    res = dev_client.get(f"/api/v1/attendance/daily-summary?date={test_data['test_date']}", headers=headers)
    assert res.status_code == 200
    data = res.json()

    summary = data["summary"]
    assert summary["date"] == "2026-11-10"
    # Total events: 2 for Alice + 1 for Bob = 3 events
    assert summary["total_events"] == 3
    # Alice and Bob have punches = 2
    assert summary["employees_with_punches"] == 2
    # Charlie has no punches recorded = at least 1 (neutral label)
    assert summary["employees_without_punches"] >= 1
    # Bob has roaming punch = 1 requires review
    assert summary["requires_review_count"] >= 1
    # Roaming punches count = 1
    assert summary["roaming_punch_count"] == 1


def test_employee_wise_attendance_items(dev_client, test_data):
    """Verify employee-wise attendance details: punch count, timestamps, roaming indicator, review status."""
    headers = make_headers(test_data["user_admin"])
    res = dev_client.get(f"/api/v1/attendance/daily-summary?date={test_data['test_date']}", headers=headers)
    assert res.status_code == 200
    employees = {e["employee_code"]: e for e in res.json()["employees"]}

    # Alice: Normal in-assignment attendance
    alice = employees["EMP-D-001"]
    assert alice["punch_count"] == 2
    assert alice["has_roaming"] is False
    assert alice["review_status"] == "NORMAL"
    assert alice["assigned_office_code"] == "HQ-01"
    assert len(alice["punches"]) == 2

    # Bob: Roaming attendance under GOV-08
    bob = employees["EMP-D-002"]
    assert bob["punch_count"] == 1
    assert bob["has_roaming"] is True
    assert bob["roaming_count"] == 1
    assert bob["review_status"] == "REQUIRES_REVIEW"
    assert "Roaming" in (bob["review_reason"] or "")

    # Charlie: No punch recorded (neutral label, no assumption of absence)
    charlie = employees["EMP-D-003"]
    assert charlie["punch_count"] == 0
    assert charlie["review_status"] == "NO_PUNCH"
    assert charlie["first_punch"] is None
    assert charlie["last_punch"] is None


def test_date_and_office_filtering(dev_client, test_data):
    """Verify date filtering and office filtering isolate records properly."""
    headers = make_headers(test_data["user_admin"])

    # 1. Other date has 0 events for test employees
    res_empty_date = dev_client.get("/api/v1/attendance/daily-summary?date=2026-10-01", headers=headers)
    assert res_empty_date.status_code == 200
    assert res_empty_date.json()["summary"]["total_events"] == 0

    # 2. Filter by HQ office (Alice's punches only)
    hq_id = test_data["office_hq"].id
    res_hq = dev_client.get(
        f"/api/v1/attendance/daily-summary?date={test_data['test_date']}&office_id={hq_id}",
        headers=headers,
    )
    assert res_hq.status_code == 200
    hq_summary = res_hq.json()["summary"]
    assert hq_summary["total_events"] == 2
    assert hq_summary["roaming_punch_count"] == 0

    # 3. Filter by Branch office (Bob's roaming punch)
    branch_id = test_data["office_branch"].id
    res_branch = dev_client.get(
        f"/api/v1/attendance/daily-summary?date={test_data['test_date']}&office_id={branch_id}",
        headers=headers,
    )
    assert res_branch.status_code == 200
    branch_summary = res_branch.json()["summary"]
    assert branch_summary["total_events"] == 1
    assert branch_summary["roaming_punch_count"] == 1


def test_role_based_data_isolation(dev_client, test_data):
    """Verify EMPLOYEE role can only view their own attendance and cannot query others."""
    emp_headers = make_headers(test_data["user_alice"])
    alice_id = test_data["emp_alice"].id
    bob_id = test_data["emp_bob"].id

    # 1. Employee query defaults to own profile
    res_self = dev_client.get(
        f"/api/v1/attendance/daily-summary?date={test_data['test_date']}",
        headers=emp_headers,
    )
    assert res_self.status_code == 200
    data = res_self.json()
    assert len(data["employees"]) == 1
    assert data["employees"][0]["employee_id"] == alice_id

    # 2. Employee attempting to query another employee is rejected with 403 Forbidden
    res_forbidden = dev_client.get(
        f"/api/v1/attendance/daily-summary?date={test_data['test_date']}&employee_id={bob_id}",
        headers=emp_headers,
    )
    assert res_forbidden.status_code == 403

    # 3. Manager can query across employees
    mgr_headers = make_headers(test_data["user_manager"])
    res_mgr = dev_client.get(
        f"/api/v1/attendance/daily-summary?date={test_data['test_date']}",
        headers=mgr_headers,
    )
    assert res_mgr.status_code == 200
    assert len(res_mgr.json()["employees"]) >= 2


def test_invalid_parameters_handling(dev_client, test_data):
    """Verify validation handling for malformed dates and invalid office IDs."""
    headers = make_headers(test_data["user_admin"])

    # Invalid date format returns 422
    res_bad_date = dev_client.get("/api/v1/attendance/daily-summary?date=invalid-date", headers=headers)
    assert res_bad_date.status_code == 422

    # Non-existent office ID returns 404
    res_bad_office = dev_client.get("/api/v1/attendance/daily-summary?office_id=999999", headers=headers)
    assert res_bad_office.status_code == 404


def test_pagination_of_daily_operations(dev_client, test_data):
    """Verify limit and offset pagination on employee-level attendance rows."""
    headers = make_headers(test_data["user_admin"])
    res = dev_client.get(
        f"/api/v1/attendance/daily-summary?date={test_data['test_date']}&limit=1&offset=0",
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert len(data["employees"]) == 1
    assert data["total_employees"] >= 3
    assert data["limit"] == 1
    assert data["offset"] == 0
