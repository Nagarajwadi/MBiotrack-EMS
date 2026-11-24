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
from app.models.attendance_correction import AttendanceCorrection
from app.models.attendance_event import AttendanceEvent
from app.models.device import Device
from app.models.employee import Employee
from app.models.office import EmployeeOfficeAssignment, Office
from app.models.user import User

settings = get_settings()




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
    user_admin = User(
        full_name="Admin Reports",
        email="admin.reports@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="ADMIN",
        employee_id=None,
        is_active=True,
    )
    dev_db_session.add(user_admin)
    dev_db_session.flush()

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
        "db": dev_db_session,
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
    token = create_access_token(
        subject=user.id,
        extra_claims={
            "role": user.role,
            "pwd": derive_pwd_fingerprint(user.password_hash),
        },
    )
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
    """Verify EMPLOYEE role can only access their own report, and MANAGER is scoped to their department."""
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

    # 3. Manager query is department-scoped: user_manager (Bob in '=CMD|calc') sees only Bob (1 event); Alice's 3 events in Engineering are excluded
    mgr_headers = make_headers(report_test_data["user_manager"])
    res_mgr = dev_client.get(
        f"/api/v1/attendance/report?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}",
        headers=mgr_headers,
    )
    assert res_mgr.status_code == 200
    data_mgr = res_mgr.json()
    assert data_mgr["summary"]["total_events"] == 1
    assert data_mgr["summary"]["employees_with_punches"] == 1
    assert data_mgr["summary"]["eligible_employee_count"] == 1
    assert all(it["employee_id"] == bob_id for it in data_mgr["items"])

    # 4. Manager filtering by cross-department employee (Alice in Engineering) is forbidden (403)
    res_cross = dev_client.get(
        f"/api/v1/attendance/report?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}&employee_id={alice_id}",
        headers=mgr_headers,
    )
    assert res_cross.status_code == 403
    assert "authorized team" in res_cross.json()["detail"].lower()

    # 5. Manager filtering by in-department employee (Bob) succeeds (200)
    res_in_dept = dev_client.get(
        f"/api/v1/attendance/report?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}&employee_id={bob_id}",
        headers=mgr_headers,
    )
    assert res_in_dept.status_code == 200
    assert len(res_in_dept.json()["items"]) == 1
    assert res_in_dept.json()["items"][0]["employee_id"] == bob_id


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
    expected_header = "Employee Code,Employee Name,Department,Office,Attendance Date,Punch Count,First Punch,Last Punch,Roaming Status,Work Duration"
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

    # Verify Alice's work duration (9h 0m) and Bob's incomplete duration (—) in CSV
    assert "9h 0m" in text_content
    assert "—" in text_content


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


def test_unlinked_manager_denied_on_report(dev_client, report_test_data):
    """Verify that a MANAGER user without a linked employee profile is denied access (403)."""
    mock_mgr = User(
        id=9999,
        full_name="Unlinked Manager",
        email="unlinked.manager@example.com",
        role="MANAGER",
        employee_id=None,
        is_active=True,
    )
    app.dependency_overrides[get_current_user] = lambda: mock_mgr
    try:
        res = dev_client.get(
            f"/api/v1/attendance/report?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}",
            headers={"Authorization": "Bearer dummy_token"},
        )
        assert res.status_code == 403
        assert "not linked to an employee staff profile" in res.json()["detail"].lower()
    finally:
        del app.dependency_overrides[get_current_user]


def test_manager_without_department_denied_on_report(dev_client, report_test_data):
    """Verify that a MANAGER user whose employee profile has no department is denied access (403)."""
    db = report_test_data["db"]
    emp_no_dept = Employee(
        employee_code="EMP-NO-DEPT",
        first_name="NoDept",
        last_name="Manager",
        email="nodept.manager@example.com",
        department="",
        designation="Manager",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    db.add(emp_no_dept)
    db.flush()

    manager_user = User(
        employee_id=emp_no_dept.id,
        full_name="No Dept Manager",
        email="nodept.user@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="MANAGER",
        is_active=True,
    )
    db.add(manager_user)
    db.flush()

    headers = make_headers(manager_user)
    res = dev_client.get(
        f"/api/v1/attendance/report?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}",
        headers=headers,
    )
    assert res.status_code == 403
    assert "no assigned department team" in res.json()["detail"].lower()


def test_manager_csv_export_scoped_to_department(dev_client, report_test_data):
    """Verify that CSV export for a MANAGER is strictly scoped to the manager's department."""
    mgr_headers = make_headers(report_test_data["user_manager"])
    url = f"/api/v1/attendance/report/export-csv?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}"
    res = dev_client.get(url, headers=mgr_headers)
    assert res.status_code == 200

    csv_content = res.content.decode("utf-8-sig")
    # Bob (in manager's department '=CMD|calc') must appear
    assert "EMP-REP-02" in csv_content
    # Alice (in Engineering) and Charlie (in HR) must NOT appear
    assert "EMP-REP-01" not in csv_content
    assert "EMP-REP-03" not in csv_content


def test_manager_csv_export_alias_scoped_to_department(dev_client, report_test_data):
    """Verify that legacy /api/v1/attendance/export CSV alias for MANAGER is also department-scoped."""
    mgr_headers = make_headers(report_test_data["user_manager"])
    url = f"/api/v1/attendance/export?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}"
    res = dev_client.get(url, headers=mgr_headers)
    assert res.status_code == 200

    csv_content = res.content.decode("utf-8-sig")
    assert "EMP-REP-02" in csv_content
    assert "EMP-REP-01" not in csv_content
    assert "EMP-REP-03" not in csv_content


def test_admin_department_filter_and_org_wide(dev_client, report_test_data):
    """Verify ADMIN can filter by any department or omit department for org-wide view."""
    admin_headers = make_headers(report_test_data["user_admin"])
    base_url = f"/api/v1/attendance/report?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}"

    # 1. Filter by Engineering -> returns Alice only
    res_eng = dev_client.get(f"{base_url}&department=Engineering", headers=admin_headers)
    assert res_eng.status_code == 200
    data_eng = res_eng.json()
    assert data_eng["summary"]["eligible_employee_count"] == 1
    assert data_eng["summary"]["total_events"] == 3
    assert all(it["department"] == "Engineering" for it in data_eng["items"])

    # 2. Filter by '=CMD|calc' -> returns Bob only
    res_bob = dev_client.get(f"{base_url}&department==CMD|calc", headers=admin_headers)
    assert res_bob.status_code == 200
    data_bob = res_bob.json()
    assert data_bob["summary"]["eligible_employee_count"] == 1
    assert data_bob["summary"]["total_events"] == 1
    assert all(it["department"] == "=CMD|calc" for it in data_bob["items"])

    # 3. Filter by non-existent department -> empty items and 0 eligible employees
    res_none = dev_client.get(f"{base_url}&department=NonExistentDept", headers=admin_headers)
    assert res_none.status_code == 200
    data_none = res_none.json()
    assert data_none["summary"]["eligible_employee_count"] == 0
    assert len(data_none["items"]) == 0

    # 4. Omitted department -> org-wide (Alice, Bob, Charlie)
    res_all = dev_client.get(base_url, headers=admin_headers)
    assert res_all.status_code == 200
    data_all = res_all.json()
    assert data_all["summary"]["eligible_employee_count"] == 3
    assert data_all["summary"]["total_events"] == 4


def test_manager_department_filtering_own_and_cross(dev_client, report_test_data):
    """Verify MANAGER is restricted to own department and gets 403 on other departments."""
    mgr_headers = make_headers(report_test_data["user_manager"])
    base_url = f"/api/v1/attendance/report?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}"

    # 1. Omitted department defaults to manager's department ('=CMD|calc')
    res_default = dev_client.get(base_url, headers=mgr_headers)
    assert res_default.status_code == 200
    data_default = res_default.json()
    assert all(it["department"] == "=CMD|calc" for it in data_default["items"])

    # 2. Explicit own department succeeds
    res_own = dev_client.get(f"{base_url}&department==CMD|calc", headers=mgr_headers)
    assert res_own.status_code == 200
    data_own = res_own.json()
    assert all(it["department"] == "=CMD|calc" for it in data_own["items"])

    # 3. Cross department request returns HTTP 403 Forbidden
    res_cross = dev_client.get(f"{base_url}&department=Engineering", headers=mgr_headers)
    assert res_cross.status_code == 403
    assert "authorized team" in res_cross.json()["detail"].lower()


def test_employee_department_filter_restrictions(dev_client, report_test_data):
    """Verify EMPLOYEE may view own department attendance or is denied cross-department."""
    emp_headers = make_headers(report_test_data["user_alice"])
    base_url = f"/api/v1/attendance/report?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}"

    # 1. Alice filtering by own department (Engineering) succeeds
    res_own = dev_client.get(f"{base_url}&department=Engineering", headers=emp_headers)
    assert res_own.status_code == 200
    assert all(it["employee_id"] == report_test_data["emp_alice"].id for it in res_own.json()["items"])

    # 2. Alice filtering by another department returns 403
    res_cross = dev_client.get(f"{base_url}&department==CMD|calc", headers=emp_headers)
    assert res_cross.status_code == 403
    assert "authorized department" in res_cross.json()["detail"].lower()


def test_csv_export_department_filter_endpoints(dev_client, report_test_data):
    """Verify department filtering in /export-csv and legacy /export alias."""
    admin_headers = make_headers(report_test_data["user_admin"])
    mgr_headers = make_headers(report_test_data["user_manager"])

    # 1. Admin exports with department=Engineering on /export-csv
    res_admin = dev_client.get(
        f"/api/v1/attendance/report/export-csv?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}&department=Engineering",
        headers=admin_headers,
    )
    assert res_admin.status_code == 200
    csv_text = res_admin.content.decode("utf-8-sig")
    assert "EMP-REP-01" in csv_text
    assert "EMP-REP-02" not in csv_text

    # 2. Manager exports with cross-department on /export-csv -> 403
    res_mgr_cross = dev_client.get(
        f"/api/v1/attendance/report/export-csv?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}&department=Engineering",
        headers=mgr_headers,
    )
    assert res_mgr_cross.status_code == 403

    # 3. Manager exports with own department on legacy alias /export -> 200
    res_mgr_alias = dev_client.get(
        f"/api/v1/attendance/export?start_date={report_test_data['start_date']}&end_date={report_test_data['end_date']}&department==CMD|calc",
        headers=mgr_headers,
    )
    assert res_mgr_alias.status_code == 200
    csv_alias = res_mgr_alias.content.decode("utf-8-sig")
    assert "EMP-REP-02" in csv_alias
    assert "EMP-REP-01" not in csv_alias


def test_daily_worked_duration_single_and_split_sessions(dev_client, report_test_data):
    """Verify daily worked duration calculation for single and split sessions."""
    db = report_test_data["db"]
    office = report_test_data["office_hq"]
    device = Device(
        office_id=office.id,
        name="HQ Turnstile Split",
        device_code="DEV-HQ-SPLIT",
        serial_number="SN-HQ-SPLIT",
        status="ACTIVE",
        is_active=True,
    )
    db.add(device)
    db.flush()

    emp_split = Employee(
        employee_code="EMP-REP-SPLIT",
        first_name="Split",
        last_name="Worker",
        email="split.worker@example.com",
        department="Operations",
        designation="Operator",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    db.add(emp_split)
    db.flush()

    val_range = Range(
        datetime(2026, 11, 1, 0, 0, 0, tzinfo=timezone.utc),
        datetime(2026, 11, 30, 0, 0, 0, tzinfo=timezone.utc),
        bounds="[)",
    )
    db.add(EmployeeOfficeAssignment(employee_id=emp_split.id, office_id=office.id, validity_range=val_range))

    # Split session on 2026-11-10:
    # Session 1: 08:30 to 12:30 UTC = 4 hours (240 min)
    # Session 2: 13:30 to 17:45 UTC = 4 hours 15 min (255 min)
    # Total = 495 min = 8h 15m
    p1 = AttendanceEvent(
        employee_id=emp_split.id,
        device_id=device.id,
        office_id=office.id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 10, 8, 30, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=report_test_data["user_admin"].id,
    )
    p2 = AttendanceEvent(
        employee_id=emp_split.id,
        device_id=device.id,
        office_id=office.id,
        punch_type="CHECK_OUT",
        event_timestamp=datetime(2026, 11, 10, 12, 30, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=report_test_data["user_admin"].id,
    )
    p3 = AttendanceEvent(
        employee_id=emp_split.id,
        device_id=device.id,
        office_id=office.id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 10, 13, 30, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=report_test_data["user_admin"].id,
    )
    p4 = AttendanceEvent(
        employee_id=emp_split.id,
        device_id=device.id,
        office_id=office.id,
        punch_type="CHECK_OUT",
        event_timestamp=datetime(2026, 11, 10, 17, 45, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=report_test_data["user_admin"].id,
    )
    db.add_all([p1, p2, p3, p4])
    db.flush()

    headers = make_headers(report_test_data["user_admin"])
    res = dev_client.get(
        f"/api/v1/attendance/report?start_date=2026-11-10&end_date=2026-11-10&employee_id={emp_split.id}",
        headers=headers,
    )
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["punch_count"] == 4
    assert items[0]["work_duration_minutes"] == 495
    assert items[0]["work_duration_formatted"] == "8h 15m"


def test_daily_worked_duration_incomplete_sessions(dev_client, report_test_data):
    """Verify days with odd punch counts, unpaired punches, or non-alternating punches return None duration."""
    db = report_test_data["db"]
    office = report_test_data["office_hq"]

    device = Device(
        office_id=office.id,
        name="HQ Turnstile Odd",
        device_code="DEV-HQ-ODD",
        serial_number="SN-HQ-ODD",
        status="ACTIVE",
        is_active=True,
    )
    db.add(device)
    db.flush()

    emp_odd = Employee(
        employee_code="EMP-REP-ODD",
        first_name="Odd",
        last_name="Punches",
        email="odd.punches@example.com",
        department="Testing",
        designation="Tester",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    db.add(emp_odd)
    db.flush()

    val_range = Range(
        datetime(2026, 11, 1, 0, 0, 0, tzinfo=timezone.utc),
        datetime(2026, 11, 30, 0, 0, 0, tzinfo=timezone.utc),
        bounds="[)",
    )
    db.add(EmployeeOfficeAssignment(employee_id=emp_odd.id, office_id=office.id, validity_range=val_range))

    # Day 1: 3 punches (CHECK_IN, CHECK_OUT, CHECK_IN) -> incomplete
    p1 = AttendanceEvent(
        employee_id=emp_odd.id,
        device_id=device.id,
        office_id=office.id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 10, 9, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=report_test_data["user_admin"].id,
    )
    p2 = AttendanceEvent(
        employee_id=emp_odd.id,
        device_id=device.id,
        office_id=office.id,
        punch_type="CHECK_OUT",
        event_timestamp=datetime(2026, 11, 10, 13, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=report_test_data["user_admin"].id,
    )
    p3 = AttendanceEvent(
        employee_id=emp_odd.id,
        device_id=device.id,
        office_id=office.id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 10, 14, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=report_test_data["user_admin"].id,
    )

    # Day 2: 2 punches but both CHECK_IN (non-alternating) -> incomplete
    p4 = AttendanceEvent(
        employee_id=emp_odd.id,
        device_id=device.id,
        office_id=office.id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 11, 9, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=report_test_data["user_admin"].id,
    )
    p5 = AttendanceEvent(
        employee_id=emp_odd.id,
        device_id=device.id,
        office_id=office.id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 11, 11, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=report_test_data["user_admin"].id,
    )

    db.add_all([p1, p2, p3, p4, p5])
    db.flush()

    headers = make_headers(report_test_data["user_admin"])
    res = dev_client.get(
        f"/api/v1/attendance/report?start_date=2026-11-10&end_date=2026-11-11&employee_id={emp_odd.id}",
        headers=headers,
    )
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 2
    for it in items:
        assert it["work_duration_minutes"] is None
        assert it["work_duration_formatted"] is None


def test_daily_worked_duration_with_approved_corrections(dev_client, report_test_data):
    """Verify that approved corrections merge into daily punches and complete durations."""
    db = report_test_data["db"]
    alice = report_test_data["emp_alice"]
    # Alice on Nov 11 only had CHECK_IN at 09:15 UTC.
    # Add an approved AttendanceCorrection for MISSING_CHECK_OUT at 17:45 UTC
    corr = AttendanceCorrection(
        employee_id=alice.id,
        attendance_date=date(2026, 11, 11),
        correction_type="MISSING_CHECK_OUT",
        proposed_timestamp=datetime(2026, 11, 11, 17, 45, 0, tzinfo=timezone.utc),
        reason="Forgot to punch out at turnstile",
        status="APPROVED",
        requested_by_user_id=report_test_data["user_alice"].id,
        reviewed_by_user_id=report_test_data["user_admin"].id,
        reviewed_at=datetime(2026, 11, 11, 18, 0, 0, tzinfo=timezone.utc),
        idempotency_key="corr-test-key-1",
    )
    db.add(corr)
    db.flush()

    headers = make_headers(report_test_data["user_admin"])
    res = dev_client.get(
        f"/api/v1/attendance/report?start_date=2026-11-11&end_date=2026-11-11&employee_id={alice.id}",
        headers=headers,
    )
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) == 1
    # 09:15 to 17:45 = 8h 30m = 510 min
    assert items[0]["punch_count"] == 2
    assert items[0]["work_duration_minutes"] == 510
    assert items[0]["work_duration_formatted"] == "8h 30m"


def test_summary_totals_and_averages_exclude_incomplete_days(dev_client, report_test_data):
    """Verify summary total_worked_hours and average_daily_worked_hours exclude incomplete days."""
    headers = make_headers(report_test_data["user_admin"])
    alice_id = report_test_data["emp_alice"].id

    # For Alice across 2026-11-10 to 2026-11-12:
    # 2026-11-10: 9:00 to 18:00 = 9h 0m (complete)
    # 2026-11-11: 9:15 CHECK_IN only (incomplete)
    # 2026-11-12: 0 punches (absent)
    # Total worked hours should be 9.0; average daily worked hours should be 9.0 (9.0 / 1 complete day)
    res = dev_client.get(
        f"/api/v1/attendance/report?start_date=2026-11-10&end_date=2026-11-12&employee_id={alice_id}",
        headers=headers,
    )
    assert res.status_code == 200
    summary = res.json()["summary"]
    assert summary["total_worked_hours"] == 9.0
    assert summary["average_daily_worked_hours"] == 9.0


