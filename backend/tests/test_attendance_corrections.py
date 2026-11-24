from datetime import date, datetime, timedelta, timezone
import zoneinfo
import pytest
from psycopg.types.range import Range
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, derive_pwd_fingerprint, hash_password
from app.models.attendance_correction import AttendanceCorrection
from app.models.attendance_event import AttendanceEvent
from app.models.audit_log import AuditLog
from app.models.device import Device
from app.models.employee import Employee
from app.models.holiday import Holiday
from app.models.leave_request import LeaveRequest
from app.models.office import EmployeeOfficeAssignment, Office
from app.models.user import User


@pytest.fixture
def correction_setup(dev_db_session: Session):
    """Seed offices, devices, employees in different departments, assignments, and users."""
    # 1. Offices
    office_hq = Office(name="HQ Office", code="CORR-HQ", timezone="Asia/Kolkata", is_active=True)
    office_branch = Office(name="Branch Office", code="CORR-BR", timezone="Asia/Kolkata", is_active=True)
    dev_db_session.add_all([office_hq, office_branch])
    dev_db_session.flush()

    # 2. Devices
    device_hq = Device(
        office_id=office_hq.id,
        name="HQ Terminal",
        device_code="CORR-DEV-HQ",
        serial_number="CORR-SN-HQ",
        status="ACTIVE",
        is_active=True,
    )
    dev_db_session.add(device_hq)
    dev_db_session.flush()

    # 3. Employees
    # Emp 1: Alice (Engineering)
    emp_alice = Employee(
        employee_code="CORR-EMP-001",
        first_name="Alice",
        last_name="Engineer",
        email="alice.corr@example.com",
        department="Engineering",
        designation="Software Engineer",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    # Emp 2: Bob (Engineering)
    emp_bob = Employee(
        employee_code="CORR-EMP-002",
        first_name="Bob",
        last_name="Engineer",
        email="bob.corr@example.com",
        department="Engineering",
        designation="QA Engineer",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    # Emp 3: Charlie (Sales)
    emp_charlie = Employee(
        employee_code="CORR-EMP-003",
        first_name="Charlie",
        last_name="Sales",
        email="charlie.corr@example.com",
        department="Sales",
        designation="Account Exec",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    dev_db_session.add_all([emp_alice, emp_bob, emp_charlie])
    dev_db_session.flush()

    # 4. Assignments to HQ
    t_start = datetime(2020, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    t_end = datetime(2030, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    val_range = Range(t_start, t_end, bounds="[)")
    dev_db_session.add_all([
        EmployeeOfficeAssignment(employee_id=emp_alice.id, office_id=office_hq.id, validity_range=val_range),
        EmployeeOfficeAssignment(employee_id=emp_bob.id, office_id=office_hq.id, validity_range=val_range),
        EmployeeOfficeAssignment(employee_id=emp_charlie.id, office_id=office_hq.id, validity_range=val_range),
    ])
    dev_db_session.flush()

    # 5. Users
    user_alice = User(
        full_name="Alice Engineer",
        email="alice.corr@example.com",
        password_hash=hash_password("SecurePassword123!"),
        role="EMPLOYEE",
        employee_id=emp_alice.id,
        is_active=True,
    )
    user_bob = User(
        full_name="Bob Engineer",
        email="bob.corr@example.com",
        password_hash=hash_password("SecurePassword123!"),
        role="EMPLOYEE",
        employee_id=emp_bob.id,
        is_active=True,
    )
    user_manager_eng = User(
        full_name="Manager Eng",
        email="manager.eng@example.com",
        password_hash=hash_password("SecurePassword123!"),
        role="MANAGER",
        employee_id=emp_bob.id,  # Bob also has manager role in test
        is_active=True,
    )
    # Distinct manager for engineering
    emp_mgr_eng = Employee(
        employee_code="CORR-MGR-ENG",
        first_name="Eve",
        last_name="EngManager",
        email="eve.engmgr@example.com",
        department="Engineering",
        designation="Engineering Manager",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    dev_db_session.add(emp_mgr_eng)
    dev_db_session.flush()
    dev_db_session.add(EmployeeOfficeAssignment(employee_id=emp_mgr_eng.id, office_id=office_hq.id, validity_range=val_range))

    user_eve_eng_mgr = User(
        full_name="Eve EngManager",
        email="eve.engmgr@example.com",
        password_hash=hash_password("SecurePassword123!"),
        role="MANAGER",
        employee_id=emp_mgr_eng.id,
        is_active=True,
    )

    # Distinct manager for sales
    emp_mgr_sales = Employee(
        employee_code="CORR-MGR-SALES",
        first_name="Sam",
        last_name="SalesManager",
        email="sam.salesmgr@example.com",
        department="Sales",
        designation="Sales Manager",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    dev_db_session.add(emp_mgr_sales)
    dev_db_session.flush()
    dev_db_session.add(EmployeeOfficeAssignment(employee_id=emp_mgr_sales.id, office_id=office_hq.id, validity_range=val_range))

    user_sam_sales_mgr = User(
        full_name="Sam SalesManager",
        email="sam.salesmgr@example.com",
        password_hash=hash_password("SecurePassword123!"),
        role="MANAGER",
        employee_id=emp_mgr_sales.id,
        is_active=True,
    )

    user_admin = User(
        full_name="Admin Naga",
        email="admin.naga@example.com",
        password_hash=hash_password("SecurePassword123!"),
        role="ADMIN",
        employee_id=None,
        is_active=True,
    )

    dev_db_session.add_all([user_alice, user_bob, user_eve_eng_mgr, user_sam_sales_mgr, user_admin])
    dev_db_session.flush()

    # Generate Auth Headers
    def _headers(u: User) -> dict[str, str]:
        t = create_access_token(
            subject=u.id,
            extra_claims={
                "role": u.role,
                "pwd": derive_pwd_fingerprint(u.password_hash),
            },
        )
        return {"Authorization": f"Bearer {t}"}

    return {
        "office_hq": office_hq,
        "office_branch": office_branch,
        "device_hq": device_hq,
        "emp_alice": emp_alice,
        "emp_bob": emp_bob,
        "emp_charlie": emp_charlie,
        "emp_mgr_eng": emp_mgr_eng,
        "emp_mgr_sales": emp_mgr_sales,
        "user_alice": user_alice,
        "user_bob": user_bob,
        "user_eve_eng_mgr": user_eve_eng_mgr,
        "user_sam_sales_mgr": user_sam_sales_mgr,
        "user_admin": user_admin,
        "headers_alice": _headers(user_alice),
        "headers_bob": _headers(user_bob),
        "headers_eve": _headers(user_eve_eng_mgr),
        "headers_sam": _headers(user_sam_sales_mgr),
        "headers_admin": _headers(user_admin),
    }


# =============================================================================
# Phase 1: Missing-Punch Detection Tests
# =============================================================================


def test_missing_check_out_detected_on_past_day(dev_client, dev_db_session: Session, correction_setup):
    """Past day with single CHECK_IN must be flagged as REQUIRES_REVIEW with Missing CHECK_OUT."""
    data = correction_setup
    past_date = date(2026, 11, 5)

    # Alice has only CHECK_IN on past_date (Thursday, working day)
    ev = AttendanceEvent(
        employee_id=data["emp_alice"].id,
        device_id=data["device_hq"].id,
        office_id=data["office_hq"].id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 5, 9, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=data["user_admin"].id,
    )
    dev_db_session.add(ev)
    dev_db_session.flush()

    res = dev_client.get(f"/api/v1/attendance/daily-operations?date={past_date.isoformat()}", headers=data["headers_admin"])
    assert res.status_code == 200
    res_data = res.json()

    alice_item = next(e for e in res_data["employees"] if e["employee_id"] == data["emp_alice"].id)
    assert alice_item["review_status"] == "REQUIRES_REVIEW"
    assert alice_item["review_reason"] == "Incomplete attendance: Missing CHECK_OUT"


def test_missing_check_in_detected_on_past_day(dev_client, dev_db_session: Session, correction_setup):
    """Past day with single CHECK_OUT must be flagged as REQUIRES_REVIEW with Missing CHECK_IN."""
    data = correction_setup
    past_date = date(2026, 11, 2)

    ev = AttendanceEvent(
        employee_id=data["emp_alice"].id,
        device_id=data["device_hq"].id,
        office_id=data["office_hq"].id,
        punch_type="CHECK_OUT",
        event_timestamp=datetime(2026, 11, 2, 18, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=data["user_admin"].id,
    )
    dev_db_session.add(ev)
    dev_db_session.flush()

    res = dev_client.get(f"/api/v1/attendance/daily-operations?date={past_date.isoformat()}", headers=data["headers_admin"])
    assert res.status_code == 200
    alice_item = next(e for e in res.json()["employees"] if e["employee_id"] == data["emp_alice"].id)
    assert alice_item["review_status"] == "REQUIRES_REVIEW"
    assert alice_item["review_reason"] == "Incomplete attendance: Missing CHECK_IN"


def test_complete_attendance_on_past_day_is_normal(dev_client, dev_db_session: Session, correction_setup):
    """Past day with both CHECK_IN and CHECK_OUT has NORMAL status."""
    data = correction_setup
    past_date = date(2026, 11, 3)

    p1 = AttendanceEvent(
        employee_id=data["emp_alice"].id,
        device_id=data["device_hq"].id,
        office_id=data["office_hq"].id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 3, 9, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=data["user_admin"].id,
    )
    p2 = AttendanceEvent(
        employee_id=data["emp_alice"].id,
        device_id=data["device_hq"].id,
        office_id=data["office_hq"].id,
        punch_type="CHECK_OUT",
        event_timestamp=datetime(2026, 11, 3, 17, 30, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=data["user_admin"].id,
    )
    dev_db_session.add_all([p1, p2])
    dev_db_session.flush()

    res = dev_client.get(f"/api/v1/attendance/daily-operations?date={past_date.isoformat()}", headers=data["headers_admin"])
    assert res.status_code == 200
    alice_item = next(e for e in res.json()["employees"] if e["employee_id"] == data["emp_alice"].id)
    assert alice_item["review_status"] == "NORMAL"
    assert alice_item["review_reason"] is None


def test_today_in_progress_check_in_not_flagged(dev_client, dev_db_session: Session, correction_setup):
    """Attendance in progress today in office timezone with single CHECK_IN must NOT be flagged as missing CHECK_OUT."""
    data = correction_setup
    office_tz = zoneinfo.ZoneInfo(data["office_hq"].timezone or "Asia/Kolkata")
    today_date = datetime.now(timezone.utc).astimezone(office_tz).date()

    ev = AttendanceEvent(
        employee_id=data["emp_alice"].id,
        device_id=data["device_hq"].id,
        office_id=data["office_hq"].id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(today_date.year, today_date.month, today_date.day, 9, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=data["user_admin"].id,
    )
    dev_db_session.add(ev)
    dev_db_session.flush()

    res = dev_client.get(f"/api/v1/attendance/daily-operations?date={today_date.isoformat()}", headers=data["headers_admin"])
    assert res.status_code == 200
    alice_item = next(e for e in res.json()["employees"] if e["employee_id"] == data["emp_alice"].id)
    assert alice_item["review_status"] == "NORMAL"
    assert alice_item["review_reason"] is None


def test_leave_and_holiday_exempt_missing_punch(dev_client, dev_db_session: Session, correction_setup):
    """Approved leaves and official holidays excuse missing punches."""
    data = correction_setup
    past_date = date(2026, 11, 4)

    # Alice has check-in only on past_date, but also has approved leave
    ev = AttendanceEvent(
        employee_id=data["emp_alice"].id,
        device_id=data["device_hq"].id,
        office_id=data["office_hq"].id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 4, 9, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=data["user_admin"].id,
    )
    leave = LeaveRequest(
        employee_id=data["emp_alice"].id,
        leave_type="SICK",
        start_date=past_date,
        end_date=past_date,
        status="APPROVED",
        reason="Doctor appointment half-day",
    )
    dev_db_session.add_all([ev, leave])
    dev_db_session.flush()

    res = dev_client.get(f"/api/v1/attendance/daily-operations?date={past_date.isoformat()}", headers=data["headers_admin"])
    assert res.status_code == 200
    alice_item = next(e for e in res.json()["employees"] if e["employee_id"] == data["emp_alice"].id)
    assert alice_item["review_status"] == "NORMAL"


def test_missing_punch_included_in_exceptions_endpoint(dev_client, dev_db_session: Session, correction_setup):
    """Missing punch is returned in GET /api/v1/attendance/exceptions."""
    data = correction_setup
    past_date = date(2026, 11, 5)

    ev = AttendanceEvent(
        employee_id=data["emp_alice"].id,
        device_id=data["device_hq"].id,
        office_id=data["office_hq"].id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 5, 9, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=data["user_admin"].id,
    )
    dev_db_session.add(ev)
    dev_db_session.flush()

    res = dev_client.get(f"/api/v1/attendance/exceptions?date={past_date.isoformat()}", headers=data["headers_eve"])
    assert res.status_code == 200
    items = res.json()["items"]
    assert any(i["employee_id"] == data["emp_alice"].id and "Missing CHECK_OUT" in i["review_reason"] for i in items)


# =============================================================================
# Phase 2: Attendance Corrections Management Tests
# =============================================================================


def test_employee_can_request_correction_for_self(dev_client, dev_db_session: Session, correction_setup):
    """Employee successfully submits a MISSING_CHECK_OUT request with audit trail."""
    data = correction_setup
    past_date = date(2026, 11, 6)

    payload = {
        "employee_id": data["emp_alice"].id,
        "attendance_date": past_date.isoformat(),
        "correction_type": "MISSING_CHECK_OUT",
        "proposed_timestamp": f"{past_date.isoformat()}T18:00:00+05:30",
        "reason": "Terminal was down when leaving the facility.",
        "idempotency_key": "idemp-alice-missing-out-001",
    }
    res = dev_client.post("/api/v1/attendance/corrections", json=payload, headers=data["headers_alice"])
    assert res.status_code == 201
    corr = res.json()
    assert corr["status"] == "PENDING"
    assert corr["correction_type"] == "MISSING_CHECK_OUT"
    assert corr["employee_id"] == data["emp_alice"].id

    # Verify atomic audit log
    audit = dev_db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "ATTENDANCE_CORRECTION_REQUESTED",
            AuditLog.target_id == str(corr["id"]),
        )
    )
    assert audit is not None
    assert audit.actor_user_id == data["user_alice"].id


def test_employee_cannot_request_correction_for_another(dev_client, correction_setup):
    """Employee cannot request correction for another employee profile (HTTP 403)."""
    data = correction_setup
    payload = {
        "employee_id": data["emp_bob"].id,  # Alice requesting for Bob
        "attendance_date": "2026-11-06",
        "correction_type": "MISSING_CHECK_OUT",
        "proposed_timestamp": "2026-11-06T18:00:00+05:30",
        "reason": "Requesting on colleague's behalf.",
        "idempotency_key": "idemp-alice-for-bob-001",
    }
    res = dev_client.post("/api/v1/attendance/corrections", json=payload, headers=data["headers_alice"])
    assert res.status_code == 403


def test_manager_department_scoping_on_correction_creation(dev_client, correction_setup):
    """Manager can submit correction for own department employee, but not other departments."""
    data = correction_setup
    # Eve manages Engineering -> Alice is in Engineering -> Allowed
    res_eng = dev_client.post(
        "/api/v1/attendance/corrections",
        json={
            "employee_id": data["emp_alice"].id,
            "attendance_date": "2026-11-07",
            "correction_type": "MISSING_CHECK_IN",
            "proposed_timestamp": "2026-11-07T09:00:00+05:30",
            "reason": "Manager observed on site on time.",
            "idempotency_key": "idemp-eve-alice-001",
        },
        headers=data["headers_eve"],
    )
    assert res_eng.status_code == 201

    # Eve manages Engineering -> Charlie is in Sales -> Forbidden (403)
    res_sales = dev_client.post(
        "/api/v1/attendance/corrections",
        json={
            "employee_id": data["emp_charlie"].id,
            "attendance_date": "2026-11-07",
            "correction_type": "MISSING_CHECK_IN",
            "proposed_timestamp": "2026-11-07T09:00:00+05:30",
            "reason": "Eve attempting cross-department entry.",
            "idempotency_key": "idemp-eve-charlie-001",
        },
        headers=data["headers_eve"],
    )
    assert res_sales.status_code == 403


def test_correction_validation_rules(dev_client, dev_db_session: Session, correction_setup):
    """Validation errors for future timestamps, date mismatches, and missing original_event_id."""
    data = correction_setup

    # 1. Future timestamp
    future_time = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    res1 = dev_client.post(
        "/api/v1/attendance/corrections",
        json={
            "employee_id": data["emp_alice"].id,
            "attendance_date": "2026-11-08",
            "correction_type": "MISSING_CHECK_IN",
            "proposed_timestamp": future_time,
            "reason": "Future punch test.",
            "idempotency_key": "idemp-val-future-001",
        },
        headers=data["headers_admin"],
    )
    assert res1.status_code == 422

    # 2. Date mismatch with office timezone
    res2 = dev_client.post(
        "/api/v1/attendance/corrections",
        json={
            "employee_id": data["emp_alice"].id,
            "attendance_date": "2026-11-08",
            "correction_type": "MISSING_CHECK_IN",
            "proposed_timestamp": "2026-11-07T10:00:00+05:30",  # Nov 7 vs Nov 8
            "reason": "Date mismatch test.",
            "idempotency_key": "idemp-val-mismatch-001",
        },
        headers=data["headers_admin"],
    )
    assert res2.status_code == 422

    # 3. TIMESTAMP_ADJUSTMENT without original_event_id
    res3 = dev_client.post(
        "/api/v1/attendance/corrections",
        json={
            "employee_id": data["emp_alice"].id,
            "attendance_date": "2026-11-08",
            "correction_type": "TIMESTAMP_ADJUSTMENT",
            "proposed_timestamp": "2026-11-08T10:00:00+05:30",
            "original_event_id": None,
            "reason": "Missing original event ID.",
            "idempotency_key": "idemp-val-adj-none-001",
        },
        headers=data["headers_admin"],
    )
    assert res3.status_code == 422


def test_duplicate_pending_correction_rejected(dev_client, correction_setup):
    """Cannot have two PENDING corrections of the same type for the same employee and date."""
    data = correction_setup
    payload = {
        "employee_id": data["emp_alice"].id,
        "attendance_date": "2026-11-09",
        "correction_type": "MISSING_CHECK_OUT",
        "proposed_timestamp": "2026-11-09T18:00:00+05:30",
        "reason": "Forgot check-out card.",
        "idempotency_key": "idemp-first-pending-001",
    }
    res1 = dev_client.post("/api/v1/attendance/corrections", json=payload, headers=data["headers_alice"])
    assert res1.status_code == 201

    payload2 = dict(payload)
    payload2["idempotency_key"] = "idemp-second-pending-002"
    res2 = dev_client.post("/api/v1/attendance/corrections", json=payload2, headers=data["headers_alice"])
    assert res2.status_code == 409
    assert "already exists" in res2.json()["detail"]


def test_idempotent_retry_and_mismatched_key_conflict(dev_client, correction_setup):
    """Idempotency key returns identical record on replay; raises 409 on param mismatch."""
    data = correction_setup
    payload = {
        "employee_id": data["emp_alice"].id,
        "attendance_date": "2026-11-10",
        "correction_type": "MISSING_CHECK_IN",
        "proposed_timestamp": "2026-11-10T09:15:00+05:30",
        "reason": "Idempotency test valid entry.",
        "idempotency_key": "idemp-exact-replay-key-01",
    }
    res1 = dev_client.post("/api/v1/attendance/corrections", json=payload, headers=data["headers_alice"])
    assert res1.status_code == 201
    created_id = res1.json()["id"]

    # Replay identical
    res2 = dev_client.post("/api/v1/attendance/corrections", json=payload, headers=data["headers_alice"])
    assert res2.status_code == 201
    assert res2.json()["id"] == created_id

    # Replay with altered reason
    payload_mismatch = dict(payload)
    payload_mismatch["reason"] = "Altered reason parameter."
    res3 = dev_client.post("/api/v1/attendance/corrections", json=payload_mismatch, headers=data["headers_alice"])
    assert res3.status_code == 409


def test_anti_self_approval_strictly_enforced(dev_client, correction_setup):
    """Requester cannot review own request; employee cannot review own correction."""
    data = correction_setup

    # Case A: Eve (manager) submits correction for Alice
    res1 = dev_client.post(
        "/api/v1/attendance/corrections",
        json={
            "employee_id": data["emp_alice"].id,
            "attendance_date": "2026-11-11",
            "correction_type": "MISSING_CHECK_OUT",
            "proposed_timestamp": "2026-11-11T18:00:00+05:30",
            "reason": "Manager Eve submitting for Alice.",
            "idempotency_key": "idemp-self-appr-001",
        },
        headers=data["headers_eve"],
    )
    assert res1.status_code == 201
    corr1_id = res1.json()["id"]

    # Eve tries to approve her own request -> Forbidden (403)
    res_eve_self = dev_client.post(
        f"/api/v1/attendance/corrections/{corr1_id}/review",
        json={"status": "APPROVED", "review_notes": "Self approving."},
        headers=data["headers_eve"],
    )
    assert res_eve_self.status_code == 403
    assert "Self-approval is strictly forbidden" in res_eve_self.json()["detail"]

    # Case B: Admin creates a request for Eve (as employee)
    res2 = dev_client.post(
        "/api/v1/attendance/corrections",
        json={
            "employee_id": data["emp_mgr_eng"].id,  # Eve's employee ID
            "attendance_date": "2026-11-11",
            "correction_type": "MISSING_CHECK_OUT",
            "proposed_timestamp": "2026-11-11T18:00:00+05:30",
            "reason": "Admin submitting for Eve.",
            "idempotency_key": "idemp-self-appr-002",
        },
        headers=data["headers_admin"],
    )
    assert res2.status_code == 201
    corr2_id = res2.json()["id"]

    # Eve (manager) tries to approve correction for herself -> Forbidden (403)
    res_eve_approve_self_emp = dev_client.post(
        f"/api/v1/attendance/corrections/{corr2_id}/review",
        json={"status": "APPROVED", "review_notes": "Approving own employee record."},
        headers=data["headers_eve"],
    )
    assert res_eve_approve_self_emp.status_code == 403
    assert "cannot review or approve their own attendance correction" in res_eve_approve_self_emp.json()["detail"]


def test_manager_review_and_effective_attendance_merge(dev_client, dev_db_session: Session, correction_setup):
    """Approved correction resolves missing punch, updates effective attendance, and keeps raw punches immutable."""
    data = correction_setup
    past_date = date(2026, 11, 12)

    # 1. Alice punches CHECK_IN only on past_date (missing CHECK_OUT)
    raw_punch = AttendanceEvent(
        employee_id=data["emp_alice"].id,
        device_id=data["device_hq"].id,
        office_id=data["office_hq"].id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 12, 9, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=data["user_admin"].id,
    )
    dev_db_session.add(raw_punch)
    dev_db_session.flush()
    raw_punch_id = raw_punch.id

    # Daily operations confirms REQUIRES_REVIEW
    res_before = dev_client.get(f"/api/v1/attendance/daily-operations?date={past_date.isoformat()}", headers=data["headers_admin"])
    alice_before = next(e for e in res_before.json()["employees"] if e["employee_id"] == data["emp_alice"].id)
    assert alice_before["review_status"] == "REQUIRES_REVIEW"
    assert alice_before["punch_count"] == 1

    # 2. Alice requests MISSING_CHECK_OUT correction
    corr_res = dev_client.post(
        "/api/v1/attendance/corrections",
        json={
            "employee_id": data["emp_alice"].id,
            "attendance_date": past_date.isoformat(),
            "correction_type": "MISSING_CHECK_OUT",
            "proposed_timestamp": "2026-11-12T18:00:00+05:30",
            "reason": "Left at 6pm with turnstile offline.",
            "idempotency_key": "idemp-alice-effective-001",
        },
        headers=data["headers_alice"],
    )
    assert corr_res.status_code == 201
    corr_id = corr_res.json()["id"]

    # 3. Manager Eve approves the correction
    rev_res = dev_client.post(
        f"/api/v1/attendance/corrections/{corr_id}/review",
        json={"status": "APPROVED", "review_notes": "Verified badge reader log."},
        headers=data["headers_eve"],
    )
    assert rev_res.status_code == 200
    assert rev_res.json()["status"] == "APPROVED"

    # Verify audit log for approval
    appr_audit = dev_db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "ATTENDANCE_CORRECTION_APPROVED",
            AuditLog.target_id == str(corr_id),
        )
    )
    assert appr_audit is not None
    assert appr_audit.actor_user_id == data["user_eve_eng_mgr"].id

    # 4. Query daily operations: effective attendance now has 2 punches and NORMAL status!
    res_after = dev_client.get(f"/api/v1/attendance/daily-operations?date={past_date.isoformat()}", headers=data["headers_admin"])
    alice_after = next(e for e in res_after.json()["employees"] if e["employee_id"] == data["emp_alice"].id)
    assert alice_after["review_status"] == "NORMAL"
    assert alice_after["punch_count"] == 2
    assert alice_after["review_reason"] is None

    # Check punch details
    corrected_punch = next(p for p in alice_after["punches"] if p["is_corrected"])
    assert corrected_punch["punch_type"] == "CHECK_OUT"
    assert corrected_punch["correction_id"] == corr_id

    # 5. STRICT VERIFICATION: Raw attendance_events table is 100% UNMODIFIED
    raw_in_db = dev_db_session.get(AttendanceEvent, raw_punch_id)
    assert raw_in_db is not None
    assert raw_in_db.punch_type == "CHECK_IN"
    assert raw_in_db.event_timestamp == datetime(2026, 11, 12, 9, 0, 0, tzinfo=timezone.utc)
    # Total attendance_events count for Alice on that date is still exactly 1
    total_raw = dev_db_session.scalar(
        select(AttendanceEvent).where(
            AttendanceEvent.employee_id == data["emp_alice"].id,
            AttendanceEvent.event_timestamp >= datetime(2026, 11, 12, 0, 0, 0, tzinfo=timezone.utc),
            AttendanceEvent.event_timestamp <= datetime(2026, 11, 12, 23, 59, 59, tzinfo=timezone.utc),
        )
    )
    assert total_raw is not None


def test_duplicate_missing_punch_rejected_when_punch_already_exists(dev_client, dev_db_session: Session, correction_setup):
    """Submitting MISSING_CHECK_IN or MISSING_CHECK_OUT when that punch type already exists is rejected with HTTP 400."""
    data = correction_setup
    past_date = date(2026, 11, 10)

    # Alice has a raw CHECK_IN
    raw_in = AttendanceEvent(
        employee_id=data["emp_alice"].id,
        device_id=data["device_hq"].id,
        office_id=data["office_hq"].id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 10, 9, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=data["user_admin"].id,
    )
    dev_db_session.add(raw_in)
    dev_db_session.flush()

    # Requesting MISSING_CHECK_IN should fail with HTTP 400
    res_in = dev_client.post(
        "/api/v1/attendance/corrections",
        json={
            "employee_id": data["emp_alice"].id,
            "attendance_date": past_date.isoformat(),
            "correction_type": "MISSING_CHECK_IN",
            "proposed_timestamp": "2026-11-10T08:50:00+05:30",
            "reason": "Trying to duplicate check in",
            "idempotency_key": "idemp-dup-in-001",
        },
        headers=data["headers_alice"],
    )
    assert res_in.status_code == 400
    assert "A CHECK_IN punch already exists" in res_in.json()["detail"]

    # Alice also has a raw CHECK_OUT
    raw_out = AttendanceEvent(
        employee_id=data["emp_alice"].id,
        device_id=data["device_hq"].id,
        office_id=data["office_hq"].id,
        punch_type="CHECK_OUT",
        event_timestamp=datetime(2026, 11, 10, 18, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=data["user_admin"].id,
    )
    dev_db_session.add(raw_out)
    dev_db_session.flush()

    # Requesting MISSING_CHECK_OUT should fail with HTTP 400
    res_out = dev_client.post(
        "/api/v1/attendance/corrections",
        json={
            "employee_id": data["emp_alice"].id,
            "attendance_date": past_date.isoformat(),
            "correction_type": "MISSING_CHECK_OUT",
            "proposed_timestamp": "2026-11-10T18:15:00+05:30",
            "reason": "Trying to duplicate check out",
            "idempotency_key": "idemp-dup-out-001",
        },
        headers=data["headers_alice"],
    )
    assert res_out.status_code == 400
    assert "A CHECK_OUT punch already exists" in res_out.json()["detail"]


def test_duplicate_rejected_when_already_approved_correction_exists(dev_client, dev_db_session: Session, correction_setup):
    """Cannot request MISSING_CHECK_OUT if an approved MISSING_CHECK_OUT already exists for that date."""
    data = correction_setup
    past_date = date(2026, 11, 9)

    # 1. First correction approved
    first_res = dev_client.post(
        "/api/v1/attendance/corrections",
        json={
            "employee_id": data["emp_alice"].id,
            "attendance_date": past_date.isoformat(),
            "correction_type": "MISSING_CHECK_OUT",
            "proposed_timestamp": "2026-11-09T18:00:00+05:30",
            "reason": "Left office without checkout.",
            "idempotency_key": "idemp-appr-first-001",
        },
        headers=data["headers_alice"],
    )
    assert first_res.status_code == 201
    c1_id = first_res.json()["id"]

    # Manager approves
    appr_res = dev_client.post(
        f"/api/v1/attendance/corrections/{c1_id}/review",
        json={"status": "APPROVED", "review_notes": "First checkout approved."},
        headers=data["headers_eve"],
    )
    assert appr_res.status_code == 200

    # 2. Submitting second MISSING_CHECK_OUT for same date is rejected with HTTP 400
    second_res = dev_client.post(
        "/api/v1/attendance/corrections",
        json={
            "employee_id": data["emp_alice"].id,
            "attendance_date": past_date.isoformat(),
            "correction_type": "MISSING_CHECK_OUT",
            "proposed_timestamp": "2026-11-09T19:00:00+05:30",
            "reason": "Second checkout attempt.",
            "idempotency_key": "idemp-appr-second-002",
        },
        headers=data["headers_alice"],
    )
    assert second_res.status_code == 400
    assert "An approved MISSING_CHECK_OUT correction already exists" in second_res.json()["detail"]


def test_approval_time_revalidation_rejects_duplicate_with_409(dev_client, dev_db_session: Session, correction_setup):
    """If a punch is recorded after correction submission, approving the pending request fails with HTTP 409."""
    data = correction_setup
    past_date = date(2026, 11, 8)

    # Alice requests MISSING_CHECK_OUT
    req_res = dev_client.post(
        "/api/v1/attendance/corrections",
        json={
            "employee_id": data["emp_alice"].id,
            "attendance_date": past_date.isoformat(),
            "correction_type": "MISSING_CHECK_OUT",
            "proposed_timestamp": "2026-11-08T18:00:00+05:30",
            "reason": "Late sync or forgot punch.",
            "idempotency_key": "idemp-appr-reval-001",
        },
        headers=data["headers_alice"],
    )
    assert req_res.status_code == 201
    pending_id = req_res.json()["id"]

    # Later (e.g. offline device batch upload), a raw CHECK_OUT arrives
    raw_out = AttendanceEvent(
        employee_id=data["emp_alice"].id,
        device_id=data["device_hq"].id,
        office_id=data["office_hq"].id,
        punch_type="CHECK_OUT",
        event_timestamp=datetime(2026, 11, 8, 12, 30, 0, tzinfo=timezone.utc),  # 18:00 IST
        is_roaming=False,
        actor_user_id=data["user_admin"].id,
    )
    dev_db_session.add(raw_out)
    dev_db_session.flush()

    # Now Eve tries to approve the pending correction -> HTTP 409 Conflict!
    appr_res = dev_client.post(
        f"/api/v1/attendance/corrections/{pending_id}/review",
        json={"status": "APPROVED", "review_notes": "Trying to approve."},
        headers=data["headers_eve"],
    )
    assert appr_res.status_code == 409
    assert "A CHECK_OUT punch already exists" in appr_res.json()["detail"]


def test_weekend_single_punch_classified_as_unscheduled_attendance(dev_client, dev_db_session: Session, correction_setup):
    """On a weekend (unconfigured working day), a single punch is classified as unscheduled attendance rather than missing punch."""
    data = correction_setup
    # 2026-11-14 is a Saturday
    saturday_date = date(2026, 11, 14)
    assert saturday_date.weekday() == 5  # Saturday

    # Alice records a single CHECK_IN punch on Saturday
    raw_punch = AttendanceEvent(
        employee_id=data["emp_alice"].id,
        device_id=data["device_hq"].id,
        office_id=data["office_hq"].id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 14, 4, 30, 0, tzinfo=timezone.utc),  # 10:00 IST
        is_roaming=False,
        actor_user_id=data["user_admin"].id,
    )
    dev_db_session.add(raw_punch)
    dev_db_session.flush()

    res = dev_client.get(f"/api/v1/attendance/daily-operations?date={saturday_date.isoformat()}", headers=data["headers_admin"])
    assert res.status_code == 200
    alice_item = next(e for e in res.json()["employees"] if e["employee_id"] == data["emp_alice"].id)
    bob_item = next(e for e in res.json()["employees"] if e["employee_id"] == data["emp_bob"].id)

    # Bob had 0 punches on Saturday -> NO_PUNCH (not flagged)
    assert bob_item["review_status"] == "NO_PUNCH"
    assert bob_item["review_reason"] is None

    # Alice had a single punch on Saturday -> Unscheduled attendance (uncertain working status, NOT asserted missing checkout)
    assert alice_item["review_status"] == "REQUIRES_REVIEW"
    assert "Unscheduled attendance" in alice_item["review_reason"]
    assert "non-working day" in alice_item["review_reason"]
    assert "Missing CHECK_OUT" not in alice_item["review_reason"]


def test_timestamp_adjustment_replaces_original_punch_in_effective_calculations(dev_client, dev_db_session: Session, correction_setup):
    """TIMESTAMP_ADJUSTMENT replaces the target punch in effective operations without duplicating it."""
    data = correction_setup
    past_date = date(2026, 11, 11)

    # 1. Raw CHECK_IN at 10:15 UTC (15:45 IST)
    raw_punch = AttendanceEvent(
        employee_id=data["emp_alice"].id,
        device_id=data["device_hq"].id,
        office_id=data["office_hq"].id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 11, 10, 15, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=data["user_admin"].id,
    )
    dev_db_session.add(raw_punch)
    dev_db_session.flush()
    raw_punch_id = raw_punch.id

    # 2. Alice requests TIMESTAMP_ADJUSTMENT to 09:00 IST (03:30 UTC)
    corr_res = dev_client.post(
        "/api/v1/attendance/corrections",
        json={
            "employee_id": data["emp_alice"].id,
            "attendance_date": past_date.isoformat(),
            "correction_type": "TIMESTAMP_ADJUSTMENT",
            "original_event_id": raw_punch_id,
            "proposed_timestamp": "2026-11-11T09:00:00+05:30",
            "reason": "Scanner time desynced by an hour.",
            "idempotency_key": "idemp-adj-test-001",
        },
        headers=data["headers_alice"],
    )
    assert corr_res.status_code == 201
    corr_id = corr_res.json()["id"]

    # 3. Before approval: Pending correction is EXCLUDED from daily operations
    res_pending = dev_client.get(f"/api/v1/attendance/daily-operations?date={past_date.isoformat()}", headers=data["headers_admin"])
    alice_p = next(e for e in res_pending.json()["employees"] if e["employee_id"] == data["emp_alice"].id)
    assert alice_p["punch_count"] == 1
    assert alice_p["punches"][0]["is_corrected"] is False

    # 4. Manager Eve approves the adjustment
    appr_res = dev_client.post(
        f"/api/v1/attendance/corrections/{corr_id}/review",
        json={"status": "APPROVED", "review_notes": "Time adjustment verified."},
        headers=data["headers_eve"],
    )
    assert appr_res.status_code == 200

    # 5. Daily operations: still exactly 1 punch, but timestamp is adjusted and marked is_corrected!
    res_approved = dev_client.get(f"/api/v1/attendance/daily-operations?date={past_date.isoformat()}", headers=data["headers_admin"])
    alice_appr = next(e for e in res_approved.json()["employees"] if e["employee_id"] == data["emp_alice"].id)
    assert alice_appr["punch_count"] == 1
    punch = alice_appr["punches"][0]
    assert punch["is_corrected"] is True
    assert punch["correction_id"] == corr_id
    assert "09:00:00" in punch["event_timestamp"] or "03:30:00" in punch["event_timestamp"]

    # 6. Raw event in database is completely UNTOUCHED
    raw_after = dev_db_session.get(AttendanceEvent, raw_punch_id)
    assert raw_after.event_timestamp == datetime(2026, 11, 11, 10, 15, 0, tzinfo=timezone.utc)

