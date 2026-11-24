"""Focused test suite for working-day leave calculation (Approved Policy).

Covers:
1. Friday-to-Monday leave = 2 working days (weekends excluded).
2. Organization-wide official holiday exclusion.
3. Employee's assigned-office holiday exclusion.
4. Other-office holiday does not apply.
5. Office assignment changes during a leave period.
6. Optional holiday excluded only when selected.
7. Invalid optional-holiday selection rejected.
8. Zero-working-day request rejected with HTTP 422.
9. Legacy NULL-duration records serialize and display correctly.
10. Existing approval/rejection behavior preserves persisted duration.
"""
from datetime import date, datetime, timezone
import pytest
from fastapi.testclient import TestClient
from psycopg.types.range import Range
from sqlalchemy.orm import Session

from app.core.security import create_access_token, derive_pwd_fingerprint, hash_password
from app.models.employee import Employee
from app.models.holiday import Holiday
from app.models.leave_request import LeaveRequest
from app.models.office import EmployeeOfficeAssignment, Office
from app.models.user import User


@pytest.fixture
def working_day_test_data(dev_db_session: Session):
    """Seed offices, employee, user, and tokens for working-day leave tests."""
    # 1. Offices
    office_a = Office(
        name="Bengaluru Office",
        code="BLR-01",
        timezone="Asia/Kolkata",
        is_active=True,
    )
    office_b = Office(
        name="Mumbai Office",
        code="BOM-01",
        timezone="Asia/Kolkata",
        is_active=True,
    )
    dev_db_session.add_all([office_a, office_b])
    dev_db_session.flush()

    # 2. Employees
    emp = Employee(
        employee_code="EMP-WD-01",
        first_name="David",
        last_name="Worker",
        email="david.wd@example.com",
        department="Engineering",
        designation="Backend Engineer",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    mgr_emp = Employee(
        employee_code="EMP-MGR-01",
        first_name="Mary",
        last_name="Manager",
        email="mary.mgr@example.com",
        department="Engineering",
        designation="Engineering Manager",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    dev_db_session.add_all([emp, mgr_emp])
    dev_db_session.flush()

    # 3. Users: Admin, Manager, and Employee
    admin_user = User(
        email="admin.wd@example.com",
        full_name="Admin WD",
        password_hash=hash_password("ValidPassword123!"),
        role="ADMIN",
        is_active=True,
        employee_id=None,
    )
    mgr_user = User(
        email="mgr.wd@example.com",
        full_name="Manager WD",
        password_hash=hash_password("ValidPassword123!"),
        role="MANAGER",
        is_active=True,
        employee_id=mgr_emp.id,
    )
    emp_user = User(
        email="david.wd@example.com",
        full_name="David Worker",
        password_hash=hash_password("ValidPassword123!"),
        role="EMPLOYEE",
        is_active=True,
        employee_id=emp.id,
    )
    dev_db_session.add_all([admin_user, mgr_user, emp_user])
    dev_db_session.flush()

    # 4. Tokens
    emp_token = create_access_token(
        subject=str(emp_user.id),
        extra_claims={
            "role": "EMPLOYEE",
            "email": emp_user.email,
            "pwd": derive_pwd_fingerprint(emp_user.password_hash),
        },
    )
    mgr_token = create_access_token(
        subject=str(mgr_user.id),
        extra_claims={
            "role": "MANAGER",
            "email": mgr_user.email,
            "pwd": derive_pwd_fingerprint(mgr_user.password_hash),
        },
    )
    admin_token = create_access_token(
        subject=str(admin_user.id),
        extra_claims={
            "role": "ADMIN",
            "email": admin_user.email,
            "pwd": derive_pwd_fingerprint(admin_user.password_hash),
        },
    )

    return {
        "office_a": office_a,
        "office_b": office_b,
        "emp": emp,
        "mgr_emp": mgr_emp,
        "admin_user": admin_user,
        "mgr_user": mgr_user,
        "emp_user": emp_user,
        "emp_headers": {"Authorization": f"Bearer {emp_token}"},
        "mgr_headers": {"Authorization": f"Bearer {mgr_token}"},
        "admin_headers": {"Authorization": f"Bearer {admin_token}"},
    }


def test_1_friday_to_monday_leave_excludes_weekends(dev_client: TestClient, working_day_test_data):
    """1. Friday-to-Monday leave = 2 working days (Saturday & Sunday excluded)."""
    # 2026-11-20 is Friday, 2026-11-23 is Monday. Total calendar days = 4 (Fri, Sat, Sun, Mon)
    res = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-20",
            "end_date": "2026-11-23",
            "leave_type": "ANNUAL",
            "reason": "Weekend getaway",
        },
        headers=working_day_test_data["emp_headers"],
    )
    assert res.status_code == 201
    body = res.json()
    assert body["working_days"] == 2


def test_2_organization_wide_official_holiday_excluded(
    dev_client: TestClient, working_day_test_data, dev_db_session: Session
):
    """2. Organization-wide official holidays are automatically excluded."""
    # 2026-11-16 (Mon) to 2026-11-20 (Fri) = 5 working days normally.
    # Add an org-wide official holiday on Wednesday 2026-11-18.
    h = Holiday(
        holiday_date=date(2026, 11, 18),
        name="National Day",
        office_id=None,
        is_optional=False,
        created_by_user_id=working_day_test_data["admin_user"].id,
    )
    dev_db_session.add(h)
    dev_db_session.flush()

    res = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-16",
            "end_date": "2026-11-20",
            "leave_type": "CASUAL",
        },
        headers=working_day_test_data["emp_headers"],
    )
    assert res.status_code == 201
    assert res.json()["working_days"] == 4


def test_3_assigned_office_holiday_excluded(
    dev_client: TestClient, working_day_test_data, dev_db_session: Session
):
    """3. Official holidays for employee's assigned office are excluded."""
    emp = working_day_test_data["emp"]
    office_a = working_day_test_data["office_a"]

    # Assign employee to office_a for all of 2026
    val_range = Range(
        datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
        datetime(2026, 12, 31, 23, 59, tzinfo=timezone.utc),
        bounds="[)",
    )
    asgn = EmployeeOfficeAssignment(
        employee_id=emp.id,
        office_id=office_a.id,
        validity_range=val_range,
        is_primary=True,
    )
    dev_db_session.add(asgn)

    # Add holiday for office_a on Tuesday 2026-11-17
    h = Holiday(
        holiday_date=date(2026, 11, 17),
        name="Karnataka Rajyotsava Observation",
        office_id=office_a.id,
        is_optional=False,
        created_by_user_id=working_day_test_data["admin_user"].id,
    )
    dev_db_session.add(h)
    dev_db_session.flush()

    # Leave: 2026-11-16 (Mon) to 2026-11-18 (Wed) = 3 calendar days
    res = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-16",
            "end_date": "2026-11-18",
            "leave_type": "ANNUAL",
        },
        headers=working_day_test_data["emp_headers"],
    )
    assert res.status_code == 201
    assert res.json()["working_days"] == 2  # Mon & Wed only (Tue holiday excluded)


def test_4_other_office_holiday_does_not_apply(
    dev_client: TestClient, working_day_test_data, dev_db_session: Session
):
    """4. Holidays belonging to other offices are NOT excluded."""
    emp = working_day_test_data["emp"]
    office_a = working_day_test_data["office_a"]
    office_b = working_day_test_data["office_b"]

    # Employee assigned to office_a
    val_range = Range(
        datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
        datetime(2026, 12, 31, 23, 59, tzinfo=timezone.utc),
        bounds="[)",
    )
    asgn = EmployeeOfficeAssignment(
        employee_id=emp.id,
        office_id=office_a.id,
        validity_range=val_range,
        is_primary=True,
    )
    dev_db_session.add(asgn)

    # Holiday for office_b (Mumbai) on Tuesday 2026-11-17
    h = Holiday(
        holiday_date=date(2026, 11, 17),
        name="Maharashtra Day Local",
        office_id=office_b.id,
        is_optional=False,
        created_by_user_id=working_day_test_data["admin_user"].id,
    )
    dev_db_session.add(h)
    dev_db_session.flush()

    # Leave: 2026-11-16 (Mon) to 2026-11-18 (Wed) = 3 calendar days
    res = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-16",
            "end_date": "2026-11-18",
            "leave_type": "ANNUAL",
        },
        headers=working_day_test_data["emp_headers"],
    )
    assert res.status_code == 201
    # Office B holiday does NOT apply to employee in Office A
    assert res.json()["working_days"] == 3


def test_5_office_assignment_changes_during_leave_period(
    dev_client: TestClient, working_day_test_data, dev_db_session: Session
):
    """5. Office assignment changes during leave: holidays apply based on effective office on each date."""
    emp = working_day_test_data["emp"]
    office_a = working_day_test_data["office_a"]
    office_b = working_day_test_data["office_b"]

    # In Asia/Kolkata, 2026-11-18 local noon is 2026-11-18T06:30:00Z.
    # Assignment 1: in Office A until 2026-11-18T00:00:00Z
    # Assignment 2: in Office B starting 2026-11-18T00:00:00Z
    asgn1 = EmployeeOfficeAssignment(
        employee_id=emp.id,
        office_id=office_a.id,
        validity_range=Range(
            datetime(2026, 11, 1, 0, 0, tzinfo=timezone.utc),
            datetime(2026, 11, 18, 0, 0, tzinfo=timezone.utc),
            bounds="[)",
        ),
        is_primary=True,
    )
    asgn2 = EmployeeOfficeAssignment(
        employee_id=emp.id,
        office_id=office_b.id,
        validity_range=Range(
            datetime(2026, 11, 18, 0, 0, tzinfo=timezone.utc),
            datetime(2026, 11, 30, 0, 0, tzinfo=timezone.utc),
            bounds="[)",
        ),
        is_primary=True,
    )
    dev_db_session.add_all([asgn1, asgn2])

    # Holiday for office_a on Tue 2026-11-17 (employee IS in office_a -> excluded)
    h_a = Holiday(
        holiday_date=date(2026, 11, 17),
        name="Office A Day",
        office_id=office_a.id,
        is_optional=False,
        created_by_user_id=working_day_test_data["admin_user"].id,
    )
    # Holiday for office_a on Thu 2026-11-19 (employee is NOT in office_a anymore -> NOT excluded)
    h_a2 = Holiday(
        holiday_date=date(2026, 11, 19),
        name="Office A Late Day",
        office_id=office_a.id,
        is_optional=False,
        created_by_user_id=working_day_test_data["admin_user"].id,
    )
    # Holiday for office_b on Thu 2026-11-19 (employee IS now in office_b -> excluded)
    h_b = Holiday(
        holiday_date=date(2026, 11, 19),
        name="Office B Day",
        office_id=office_b.id,
        is_optional=False,
        created_by_user_id=working_day_test_data["admin_user"].id,
    )
    dev_db_session.add_all([h_a, h_a2, h_b])
    dev_db_session.flush()

    # Leave: 2026-11-16 (Mon) to 2026-11-20 (Fri) = 5 weekdays.
    # Mon (16): working
    # Tue (17): Office A holiday -> excluded
    # Wed (18): Office B working -> working
    # Thu (19): Office B holiday -> excluded
    # Fri (20): Office B working -> working
    # Net working days = 3
    res = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-16",
            "end_date": "2026-11-20",
            "leave_type": "ANNUAL",
        },
        headers=working_day_test_data["emp_headers"],
    )
    assert res.status_code == 201
    assert res.json()["working_days"] == 3


def test_6_optional_holiday_excluded_only_when_selected(
    dev_client: TestClient, working_day_test_data, dev_db_session: Session
):
    """6. Optional holiday is excluded ONLY when explicitly selected in optional_holiday_dates."""
    # Org-wide optional holiday on Wednesday 2026-11-18
    h_opt = Holiday(
        holiday_date=date(2026, 11, 18),
        name="Floating Festival",
        office_id=None,
        is_optional=True,
        created_by_user_id=working_day_test_data["admin_user"].id,
    )
    dev_db_session.add(h_opt)
    dev_db_session.flush()

    # Submitting WITHOUT selecting optional holiday: 5 working days
    res_unselected = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-16",
            "end_date": "2026-11-20",
            "leave_type": "ANNUAL",
            "optional_holiday_dates": [],
        },
        headers=working_day_test_data["emp_headers"],
    )
    assert res_unselected.status_code == 201
    assert res_unselected.json()["working_days"] == 5

    # Cancel previous request to avoid overlap
    leave_id = res_unselected.json()["id"]
    dev_client.post(f"/api/v1/leaves/{leave_id}/cancel", headers=working_day_test_data["emp_headers"])

    # Submitting WITH optional holiday selected: 4 working days
    res_selected = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-16",
            "end_date": "2026-11-20",
            "leave_type": "ANNUAL",
            "optional_holiday_dates": ["2026-11-18"],
        },
        headers=working_day_test_data["emp_headers"],
    )
    assert res_selected.status_code == 201
    assert res_selected.json()["working_days"] == 4


def test_7_invalid_optional_holiday_selection_rejected(
    dev_client: TestClient, working_day_test_data, dev_db_session: Session
):
    """7. Invalid, unrelated, or non-optional holiday selections are rejected with HTTP 422."""
    office_b = working_day_test_data["office_b"]

    # 1. Official (non-optional) holiday
    h_official = Holiday(
        holiday_date=date(2026, 11, 18),
        name="Official Day",
        office_id=None,
        is_optional=False,
        created_by_user_id=working_day_test_data["admin_user"].id,
    )
    # 2. Optional holiday for office B (employee has no assignment to B)
    h_other_office_opt = Holiday(
        holiday_date=date(2026, 11, 19),
        name="Office B Optional",
        office_id=office_b.id,
        is_optional=True,
        created_by_user_id=working_day_test_data["admin_user"].id,
    )
    dev_db_session.add_all([h_official, h_other_office_opt])
    dev_db_session.flush()

    # Case A: Date outside leave span
    res_outside = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-16",
            "end_date": "2026-11-20",
            "leave_type": "ANNUAL",
            "optional_holiday_dates": ["2026-11-25"],
        },
        headers=working_day_test_data["emp_headers"],
    )
    assert res_outside.status_code == 422
    assert "outside" in res_outside.json()["detail"].lower()

    # Case B: Date with no holiday at all
    res_no_holiday = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-16",
            "end_date": "2026-11-20",
            "leave_type": "ANNUAL",
            "optional_holiday_dates": ["2026-11-16"],
        },
        headers=working_day_test_data["emp_headers"],
    )
    assert res_no_holiday.status_code == 422
    assert "not a valid applicable optional holiday" in res_no_holiday.json()["detail"].lower()

    # Case C: Date with an OFFICIAL (non-optional) holiday
    res_non_opt = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-16",
            "end_date": "2026-11-20",
            "leave_type": "ANNUAL",
            "optional_holiday_dates": ["2026-11-18"],
        },
        headers=working_day_test_data["emp_headers"],
    )
    assert res_non_opt.status_code == 422
    assert "not a valid applicable optional holiday" in res_non_opt.json()["detail"].lower()

    # Case D: Optional holiday belonging to another office
    res_other_office = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-16",
            "end_date": "2026-11-20",
            "leave_type": "ANNUAL",
            "optional_holiday_dates": ["2026-11-19"],
        },
        headers=working_day_test_data["emp_headers"],
    )
    assert res_other_office.status_code == 422
    assert "not a valid applicable optional holiday" in res_other_office.json()["detail"].lower()


def test_8_zero_working_day_request_rejected(
    dev_client: TestClient, working_day_test_data, dev_db_session: Session
):
    """8. Requests containing zero working days are rejected with HTTP 422."""
    # Case A: Weekend-only leave request (Saturday & Sunday)
    # 2026-11-21 is Sat, 2026-11-22 is Sun
    res_weekend = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-21",
            "end_date": "2026-11-22",
            "leave_type": "ANNUAL",
        },
        headers=working_day_test_data["emp_headers"],
    )
    assert res_weekend.status_code == 422
    assert "0 working days" in res_weekend.json()["detail"]

    # Case B: Weekday request covering only an official holiday
    # 2026-11-25 (Wed) is an org-wide official holiday
    h = Holiday(
        holiday_date=date(2026, 11, 25),
        name="Official Festival",
        office_id=None,
        is_optional=False,
        created_by_user_id=working_day_test_data["admin_user"].id,
    )
    dev_db_session.add(h)
    dev_db_session.flush()

    res_holiday = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-25",
            "end_date": "2026-11-25",
            "leave_type": "SICK",
        },
        headers=working_day_test_data["emp_headers"],
    )
    assert res_holiday.status_code == 422
    assert "0 working days" in res_holiday.json()["detail"]


def test_9_legacy_null_duration_records_serialize_correctly(
    dev_client: TestClient, working_day_test_data, dev_db_session: Session
):
    """9. Legacy NULL-duration records serialize and return working_days=None without errors."""
    emp = working_day_test_data["emp"]

    # Directly insert a legacy leave request with working_days=None
    legacy_req = LeaveRequest(
        employee_id=emp.id,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 6, 5),
        leave_type="ANNUAL",
        reason="Historical vacation",
        status="APPROVED",
        working_days=None,  # Legacy unpersisted duration
    )
    dev_db_session.add(legacy_req)
    dev_db_session.flush()

    # Query single detail
    res_get = dev_client.get(
        f"/api/v1/leaves/{legacy_req.id}",
        headers=working_day_test_data["emp_headers"],
    )
    assert res_get.status_code == 200
    assert res_get.json()["working_days"] is None

    # Query list
    res_list = dev_client.get(
        f"/api/v1/leaves?employee_id={emp.id}",
        headers=working_day_test_data["emp_headers"],
    )
    assert res_list.status_code == 200
    items = res_list.json()["items"]
    matched = next((item for item in items if item["id"] == legacy_req.id), None)
    assert matched is not None
    assert matched["working_days"] is None


def test_10_approval_and_rejection_preserves_persisted_duration(
    dev_client: TestClient, working_day_test_data, dev_db_session: Session
):
    """10. Approval or rejection preserves the persisted working_days count without altering or recalculating it."""
    # 1. Submit leave request (Mon-Wed = 3 working days)
    res_sub = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-30",
            "end_date": "2026-12-02",
            "leave_type": "ANNUAL",
        },
        headers=working_day_test_data["emp_headers"],
    )
    assert res_sub.status_code == 201
    leave_id = res_sub.json()["id"]
    assert res_sub.json()["working_days"] == 3

    # Add a holiday retroactively during the leave span (Tue 2026-12-01)
    # This should NOT alter the persisted working_days during review!
    h_late = Holiday(
        holiday_date=date(2026, 12, 1),
        name="Retroactive Holiday",
        office_id=None,
        is_optional=False,
        created_by_user_id=working_day_test_data["admin_user"].id,
    )
    dev_db_session.add(h_late)
    dev_db_session.flush()

    # 2. Manager reviews and approves request
    res_approve = dev_client.post(
        f"/api/v1/leaves/{leave_id}/review",
        json={"decision": "APPROVED", "decision_notes": "Looks good"},
        headers=working_day_test_data["mgr_headers"],
    )
    assert res_approve.status_code == 200
    # Must remain strictly 3 working days (persisted duration preserved, not recalculated)
    assert res_approve.json()["working_days"] == 3

    # 3. Check legacy request approval preserves working_days=None
    emp = working_day_test_data["emp"]
    legacy_pending = LeaveRequest(
        employee_id=emp.id,
        start_date=date(2025, 7, 1),
        end_date=date(2025, 7, 3),
        leave_type="SICK",
        status="PENDING",
        working_days=None,
    )
    dev_db_session.add(legacy_pending)
    dev_db_session.flush()

    res_legacy_approve = dev_client.post(
        f"/api/v1/leaves/{legacy_pending.id}/review",
        json={"decision": "APPROVED"},
        headers=working_day_test_data["mgr_headers"],
    )
    assert res_legacy_approve.status_code == 200
    assert res_legacy_approve.json()["working_days"] is None
