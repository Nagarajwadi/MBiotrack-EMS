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
def report_test_data(dev_db_session: Session):
    """Seed test offices, devices, employees, assignments, and events across multiple dates."""
    # 1. Offices
    office_hq = Office(name="HQ Main", code="HQ-M", timezone="Asia/Kolkata", is_active=True)
    office_branch = Office(name="Branch North", code="BR-N", timezone="Asia/Kolkata", is_active=True)
    dev_db_session.add_all([office_hq, office_branch])
    dev_db_session.flush()

    # 2. Devices
    device_hq = Device(
        office_id=office_hq.id,
        name="HQ Turnstile 1",
        device_code="DEV-HQ-10",
        serial_number="SN-HQ-10",
        status="ACTIVE",
        is_active=True,
    )
    device_branch = Device(
        office_id=office_branch.id,
        name="Branch Turnstile 1",
        device_code="DEV-BR-10",
        serial_number="SN-BR-10",
        status="ACTIVE",
        is_active=True,
    )
    dev_db_session.add_all([device_hq, device_branch])
    dev_db_session.flush()

    # 3. Employees
    # Emp 1: Alice (punched on Nov 10 and Nov 11)
    emp_alice = Employee(
        employee_code="EMP-REP-01",
        first_name="Alice",
        last_name="Reporter",
        email="alice.rep@example.com",
        department="Engineering",
        designation="Software Engineer",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    # Emp 2: Bob (has formula character in department for CSV injection test, punches on Nov 10 roaming)
    emp_bob = Employee(
        employee_code="EMP-REP-02",
        first_name="Bob",
        last_name="Formula",
        email="bob.rep@example.com",
        department="=CMD|calc",
        designation="Sales Executive",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    # Emp 3: Charlie (assigned to HQ, 0 punches in date range)
    emp_charlie = Employee(
        employee_code="EMP-REP-03",
        first_name="Charlie",
        last_name="ZeroPunch",
        email="charlie.rep@example.com",
        department="Human Resources",
        designation="HR Specialist",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    dev_db_session.add_all([emp_alice, emp_bob, emp_charlie])
    dev_db_session.flush()

    # 4. Office assignments (all assigned to HQ)
    val_range = Range(
        datetime(2026, 11, 1, 0, 0, 0, tzinfo=timezone.utc),
        datetime(2026, 11, 30, 0, 0, 0, tzinfo=timezone.utc),
        bounds="[)",
    )
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
        full_name="Alice Reporter",
        email="alice.rep@example.com",
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

    # 6. Punches across dates:
    # Alice on 2026-11-10: Check-in & Check-out at HQ (in-assignment)
    p_a1 = AttendanceEvent(
        employee_id=emp_alice.id,
        device_id=device_hq.id,
        office_id=office_hq.id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 10, 9, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=user_admin.id,
    )
    p_a2 = AttendanceEvent(
        employee_id=emp_alice.id,
        device_id=device_hq.id,
        office_id=office_hq.id,
        punch_type="CHECK_OUT",
        event_timestamp=datetime(2026, 11, 10, 18, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=user_admin.id,
    )
    # Alice on 2026-11-11: Check-in at HQ
    p_a3 = AttendanceEvent(
        employee_id=emp_alice.id,
        device_id=device_hq.id,
        office_id=office_hq.id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 11, 9, 15, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=user_admin.id,
    )
    # Bob on 2026-11-10: Roaming punch at Branch North (GOV-08)
    p_b1 = AttendanceEvent(
        employee_id=emp_bob.id,
        device_id=device_branch.id,
        office_id=office_branch.id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 10, 10, 30, 0, tzinfo=timezone.utc),
        is_roaming=True,
        actor_user_id=user_admin.id,
    )
    dev_db_session.add_all([p_a1, p_a2, p_a3, p_b1])
    dev_db_session.flush()

    return {
        "office_hq": office_hq,
        "office_branch": office_branch,
        "emp_alice": emp_alice,
        "emp_bob": emp_bob,
        "emp_charlie": emp_charlie,
        "user_admin": user_admin,
        "user_alice": user_alice,
        "user_manager": user_manager,
        "start_date": "2026-11-10",
        "end_date": "2026-11-12",
    }


def make_headers(user: User) -> dict[str, str]:
    token = create_access_token(subject=user.id, extra_claims={"role": user.role})
    return {"Authorization": f"Bearer {token}"}


def test_date_range_report_calculations(dev_client, report_test_data):
    """Verify report summary aggregations and employee-date line items across a date range."""
    headers = make_headers(report_test_data["user_admin"])
    url = f"/api/v1/attendance/report?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}"
    res = dev_client.get(url, headers=headers)
    assert res.status_code == 200
    data = res.json()

    summary = data["summary"]
    assert summary["start_date"] == "2026-11-10"
    assert summary["end_date"] == "2026-11-12"
    # Total events: 3 for Alice (2 on Nov 10, 1 on Nov 11) + 1 for Bob (Nov 10) = 4
    assert summary["total_events"] == 4
    # Unique employees with punches: Alice and Bob = 2
    assert summary["employees_with_punches"] == 2
    # Employees without punches: Charlie = at least 1 (neutral wording)
    assert summary["employees_without_punches"] >= 1
    # Roaming punches: 1
    assert summary["roaming_punch_count"] == 1

    items = data["items"]
    # Alice has entries for both 2026-11-10 and 2026-11-11
    alice_items = [it for it in items if it["employee_code"] == "EMP-REP-01"]
    assert len(alice_items) == 2
    dates = {it["attendance_date"] for it in alice_items}
    assert dates == {"2026-11-10", "2026-11-11"}

    # Bob has 1 roaming entry on 2026-11-10
    bob_items = [it for it in items if it["employee_code"] == "EMP-REP-02"]
    assert len(bob_items) == 1
    assert bob_items[0]["has_roaming"] is True
    assert bob_items[0]["status"] == "REQUIRES_REVIEW"

    # Charlie has 0 punches with neutral NO_PUNCH status
    charlie_items = [it for it in items if it["employee_code"] == "EMP-REP-03"]
    assert len(charlie_items) == 1
    assert charlie_items[0]["punch_count"] == 0
    assert charlie_items[0]["status"] == "NO_PUNCH"


def test_office_and_employee_filtering_in_report(dev_client, report_test_data):
    """Verify filtering by office_id and employee_id restricts report data accordingly."""
    headers = make_headers(report_test_data["user_admin"])

    # 1. Filter by HQ office (only Alice's punches; Bob was at Branch North)
    hq_id = report_test_data["office_hq"].id
    res_hq = dev_client.get(
        f"/api/v1/attendance/report?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}&office_id={hq_id}",
        headers=headers,
    )
    assert res_hq.status_code == 200
    assert res_hq.json()["summary"]["total_events"] == 3
    assert res_hq.json()["summary"]["roaming_punch_count"] == 0

    # 2. Filter by Employee Alice
    alice_id = report_test_data["emp_alice"].id
    res_alice = dev_client.get(
        f"/api/v1/attendance/report?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}&employee_id={alice_id}",
        headers=headers,
    )
    assert res_alice.status_code == 200
    assert res_alice.json()["summary"]["total_events"] == 3
    assert all(it["employee_id"] == alice_id for it in res_alice.json()["items"])


def test_role_based_report_isolation(dev_client, report_test_data):
    """Verify EMPLOYEE role can only access their own report, and MANAGER can query organization-wide."""
    emp_headers = make_headers(report_test_data["user_alice"])
    alice_id = report_test_data["emp_alice"].id
    bob_id = report_test_data["emp_bob"].id

    # 1. Employee query defaults to own profile
    res_self = dev_client.get(
        f"/api/v1/attendance/report?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}",
        headers=emp_headers,
    )
    assert res_self.status_code == 200
    assert all(it["employee_id"] == alice_id for it in res_self.json()["items"])

    # 2. Employee query specifying other employee is forbidden (403)
    res_forbidden = dev_client.get(
        f"/api/v1/attendance/report?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}&employee_id={bob_id}",
        headers=emp_headers,
    )
    assert res_forbidden.status_code == 403

    # 3. Manager can view organization-wide report
    mgr_headers = make_headers(report_test_data["user_manager"])
    res_mgr = dev_client.get(
        f"/api/v1/attendance/report?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}",
        headers=mgr_headers,
    )
    assert res_mgr.status_code == 200
    assert res_mgr.json()["summary"]["total_events"] == 4


def test_date_range_limits_and_validation(dev_client, report_test_data):
    """Verify date format validation, ordering, and 31-day limit enforcement."""
    headers = make_headers(report_test_data["user_admin"])

    # 1. Invalid date format returns 422
    res_bad_format = dev_client.get(
        "/api/v1/attendance/report?start_date=2026/11/01&end_date=2026-11-05",
        headers=headers,
    )
    assert res_bad_format.status_code == 422

    # 2. end_date before start_date returns 422
    res_inverted = dev_client.get(
        "/api/v1/attendance/report?start_date=2026-11-15&end_date=2026-11-10",
        headers=headers,
    )
    assert res_inverted.status_code == 422
    assert "end_date must be on or after start_date" in res_inverted.json()["detail"]

    # 3. Date range exceeding 31 days returns 422
    res_too_long = dev_client.get(
        "/api/v1/attendance/report?start_date=2026-10-01&end_date=2026-11-10",
        headers=headers,
    )
    assert res_too_long.status_code == 422
    assert "cannot exceed 31 days" in res_too_long.json()["detail"]


def test_csv_export_format_and_formula_escaping(dev_client, report_test_data):
    """Verify CSV export headers, UTF-8 BOM, formula neutralization, and content formatting."""
    headers = make_headers(report_test_data["user_admin"])
    url = f"/api/v1/attendance/report/export-csv?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}"
    res = dev_client.get(url, headers=headers)
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]
    assert "attendance_report_2026-11-10_2026-11-12.csv" in res.headers["content-disposition"]

    # Verify UTF-8 BOM header
    content_bytes = res.content
    assert content_bytes.startswith(b"\xef\xbb\xbf"), "CSV export must include UTF-8 BOM"

    # Decode text
    text_content = content_bytes.decode("utf-8-sig")
    lines = text_content.strip().split("\r\n")

    # Verify CSV Header columns
    header_line = lines[0]
    expected_header = "Employee Code,Employee Name,Department,Office,Attendance Date,Punch Count,First Punch,Last Punch,Roaming Status"
    assert header_line == expected_header

    # Verify formula neutralization on Bob's department "=CMD|calc" -> "'=CMD|calc"
    # To reduce CSV injection risk, formula triggers must be prepended with a single quote
    assert "'=CMD|calc" in text_content
    # Raw unescaped formula should not appear
    assert ",=CMD|calc," not in text_content

    # Verify Bob's roaming status in CSV
    assert "Roaming (1)" in text_content
    # Verify Alice's in-assignment status
    assert "In-Assignment" in text_content


def test_csv_export_role_authorization(dev_client, report_test_data):
    """Verify EMPLOYEE role cannot export other employees' attendance via CSV endpoint."""
    emp_headers = make_headers(report_test_data["user_alice"])
    bob_id = report_test_data["emp_bob"].id

    # Employee attempting to export another employee's attendance returns 403
    res_forbidden = dev_client.get(
        f"/api/v1/attendance/report/export-csv?start_date=2026-11-10&end_date=2026-11-12&employee_id={bob_id}",
        headers=emp_headers,
    )
    assert res_forbidden.status_code == 403

    # Employee exporting own attendance succeeds
    res_own = dev_client.get(
        "/api/v1/attendance/report/export-csv?start_date=2026-11-10&end_date=2026-11-12",
        headers=emp_headers,
    )
    assert res_own.status_code == 200
    own_csv = res_own.content.decode("utf-8-sig")
    assert "EMP-REP-01" in own_csv
    assert "EMP-REP-02" not in own_csv
