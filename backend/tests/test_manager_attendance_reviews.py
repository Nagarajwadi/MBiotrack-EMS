from datetime import date, datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from psycopg.types.range import Range
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, derive_pwd_fingerprint, hash_password
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.main import app
from app.models.attendance_event import AttendanceEvent
from app.models.attendance_review import AttendanceReview
from app.models.audit_log import AuditLog
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
def review_test_data(dev_db_session: Session):
    """Seed test data for exception review testing with multiple departments and roaming events."""
    # 1. Offices and devices
    office_hq = Office(name="HQ Main Office", code="HQ-REV-01", timezone="Asia/Kolkata", is_active=True)
    office_branch = Office(name="Branch Office", code="BR-REV-01", timezone="Asia/Kolkata", is_active=True)
    dev_db_session.add_all([office_hq, office_branch])
    dev_db_session.flush()

    device_hq = Device(
        office_id=office_hq.id,
        name="HQ Turnstile",
        device_code="BIO-REV-HQ-01",
        serial_number="SN-REV-HQ-01",
        status="ACTIVE",
        is_active=True,
    )
    device_branch = Device(
        office_id=office_branch.id,
        name="Branch Turnstile",
        device_code="BIO-REV-BR-01",
        serial_number="SN-REV-BR-01",
        status="ACTIVE",
        is_active=True,
    )
    dev_db_session.add_all([device_hq, device_branch])
    dev_db_session.flush()

    # 2. Employees: 2 in Engineering (Manager Bob + Engineer Alice), 1 in Sales (Charlie)
    emp_mgr = Employee(
        employee_code="EMP-REV-MGR-01",
        first_name="Bob",
        last_name="Manager",
        email="bob.mgr.rev@example.com",
        department="Engineering-Review-Test",
        designation="Engineering Manager",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    emp_eng = Employee(
        employee_code="EMP-REV-ENG-01",
        first_name="Alice",
        last_name="Engineer",
        email="alice.eng.rev@example.com",
        department="Engineering-Review-Test",
        designation="Software Engineer",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    emp_sales = Employee(
        employee_code="EMP-REV-SAL-01",
        first_name="Charlie",
        last_name="Sales",
        email="charlie.sales.rev@example.com",
        department="Sales-Review-Test",
        designation="Sales Exec",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    dev_db_session.add_all([emp_mgr, emp_eng, emp_sales])
    dev_db_session.flush()

    # 3. Assignments: Both Alice and Charlie assigned to office_hq
    val_range = Range(
        datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc),
        datetime(2028, 1, 1, 0, 0, 0, tzinfo=timezone.utc),
        bounds="[)",
    )
    asgn_eng = EmployeeOfficeAssignment(employee_id=emp_eng.id, office_id=office_hq.id, validity_range=val_range)
    asgn_sales = EmployeeOfficeAssignment(employee_id=emp_sales.id, office_id=office_hq.id, validity_range=val_range)
    dev_db_session.add_all([asgn_eng, asgn_sales])
    dev_db_session.flush()

    # 4. Users
    pwd = hash_password("SecurePass123!")
    user_mgr = User(
        employee_id=emp_mgr.id,
        full_name="Bob Manager",
        email="bob.mgr.rev@example.com",
        password_hash=pwd,
        role="MANAGER",
        is_active=True,
    )
    user_eng = User(
        employee_id=emp_eng.id,
        full_name="Alice Engineer",
        email="alice.eng.rev@example.com",
        password_hash=pwd,
        role="EMPLOYEE",
        is_active=True,
    )
    user_admin = User(
        employee_id=None,
        full_name="System Admin",
        email="admin.rev@example.com",
        password_hash=pwd,
        role="ADMIN",
        is_active=True,
    )
    dev_db_session.add_all([user_mgr, user_eng, user_admin])
    dev_db_session.flush()

    # 5. Roaming Attendance Event on 2026-11-08 for Alice at Branch Office (out of assignment)
    target_date = date(2026, 11, 8)
    punch_time = datetime(2026, 11, 8, 9, 30, 0, tzinfo=timezone.utc)
    event_roaming = AttendanceEvent(
        employee_id=emp_eng.id,
        device_id=device_branch.id,
        office_id=office_branch.id,
        punch_type="CHECK_IN",
        event_timestamp=punch_time,
        is_roaming=True,
        actor_user_id=user_eng.id,
        idempotency_key="seed-roaming-punch-001",
    )
    dev_db_session.add(event_roaming)
    dev_db_session.flush()

    return {
        "office_hq": office_hq,
        "office_branch": office_branch,
        "device_branch": device_branch,
        "emp_mgr": emp_mgr,
        "emp_eng": emp_eng,
        "emp_sales": emp_sales,
        "user_mgr": user_mgr,
        "user_eng": user_eng,
        "user_admin": user_admin,
        "target_date": target_date,
        "event_roaming": event_roaming,
    }


def test_manager_department_isolation_and_cross_department_denial(dev_client: TestClient, review_test_data):
    """Manager can acknowledge team employee roaming exception, but cross-department returns 403."""
    user_mgr = review_test_data["user_mgr"]
    emp_eng = review_test_data["emp_eng"]
    emp_sales = review_test_data["emp_sales"]
    target_date = review_test_data["target_date"]
    headers = _make_auth_headers(user_mgr)

    # 1. Cross-department attempt: Manager Bob (Engineering) reviews Charlie (Sales)
    resp_cross = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": emp_sales.id,
            "attendance_date": target_date.isoformat(),
            "review_status": "ACKNOWLEDGED",
            "review_notes": "Cross dept review",
            "idempotency_key": "idemp-cross-dept-001",
        },
        headers=headers,
    )
    assert resp_cross.status_code == 403
    assert "within your authorized team" in resp_cross.json()["detail"]

    # 2. In-department attempt: Manager Bob reviews Alice (Engineering) -> 201
    resp_valid = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": emp_eng.id,
            "attendance_date": target_date.isoformat(),
            "review_status": "ACKNOWLEDGED",
            "review_notes": "Authorized branch office visit",
            "idempotency_key": "idemp-valid-ack-001",
        },
        headers=headers,
    )
    assert resp_valid.status_code == 201
    data = resp_valid.json()
    assert data["employee_id"] == emp_eng.id
    assert data["attendance_date"] == target_date.isoformat()
    assert data["review_status"] == "ACKNOWLEDGED"
    assert data["review_notes"] == "Authorized branch office visit"
    assert data["reviewer_name"] == user_mgr.full_name
    assert data["reviewer_email"] == user_mgr.email


def test_admin_access_and_employee_denial(dev_client: TestClient, review_test_data, dev_db_session: Session):
    """Admin has organization-wide review authority; Employee is forbidden from review operations."""
    user_admin = review_test_data["user_admin"]
    user_eng = review_test_data["user_eng"]
    emp_eng = review_test_data["emp_eng"]
    emp_sales = review_test_data["emp_sales"]
    target_date = review_test_data["target_date"]

    # 1. EMPLOYEE role is denied POST, GET reviews, and GET exceptions
    headers_emp = _make_auth_headers(user_eng)
    resp_post = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": emp_eng.id,
            "attendance_date": target_date.isoformat(),
            "review_status": "ACKNOWLEDGED",
            "idempotency_key": "idemp-emp-try-001",
        },
        headers=headers_emp,
    )
    assert resp_post.status_code == 403

    resp_get_rev = dev_client.get(
        f"/api/v1/attendance/reviews?employee_id={emp_eng.id}",
        headers=headers_emp,
    )
    assert resp_get_rev.status_code == 403

    resp_get_exc = dev_client.get(
        f"/api/v1/attendance/exceptions?date={target_date.isoformat()}",
        headers=headers_emp,
    )
    assert resp_get_exc.status_code == 403

    # 2. ADMIN role has organization-wide access
    headers_admin = _make_auth_headers(user_admin)
    resp_admin = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": emp_eng.id,
            "attendance_date": target_date.isoformat(),
            "review_status": "ACKNOWLEDGED",
            "review_notes": "Admin review note",
            "idempotency_key": "idemp-admin-ack-001",
        },
        headers=headers_admin,
    )
    assert resp_admin.status_code == 201
    assert resp_admin.json()["reviewer_name"] == user_admin.full_name


def test_unlinked_manager_denial(dev_client: TestClient, review_test_data):
    """Manager user without linked employee_id must be denied review operations."""
    emp_eng = review_test_data["emp_eng"]
    target_date = review_test_data["target_date"]

    # Fake unlinked manager
    unlinked_user = User(
        id=99998,
        employee_id=None,
        full_name="Unlinked Manager",
        email="unlinked.mgr@example.com",
        password_hash="fakehash",
        role="MANAGER",
        is_active=True,
    )
    app.dependency_overrides[get_current_user] = lambda: unlinked_user

    resp = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": emp_eng.id,
            "attendance_date": target_date.isoformat(),
            "review_status": "ACKNOWLEDGED",
            "idempotency_key": "idemp-unlinked-001",
        },
    )
    assert resp.status_code == 403
    assert "not linked to an employee" in resp.json()["detail"]


def test_attendance_day_timezone_boundary_eligibility(dev_client: TestClient, review_test_data, dev_db_session: Session):
    """Review eligibility must strictly respect the canonical UTC attendance day boundaries."""
    user_mgr = review_test_data["user_mgr"]
    emp_eng = review_test_data["emp_eng"]
    device_branch = review_test_data["device_branch"]
    office_branch = review_test_data["office_branch"]
    headers = _make_auth_headers(user_mgr)

    # Date D = 2026-11-15
    date_d = date(2026, 11, 15)

    # 1. Event on 2026-11-16 00:00:01 UTC (date D+1)
    event_next_day = AttendanceEvent(
        employee_id=emp_eng.id,
        device_id=device_branch.id,
        office_id=office_branch.id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 16, 0, 0, 1, tzinfo=timezone.utc),
        is_roaming=True,
        actor_user_id=user_mgr.id,
        idempotency_key="seed-roaming-dplus1",
    )
    dev_db_session.add(event_next_day)
    dev_db_session.flush()

    # Attempting to acknowledge date_d should fail (no roaming punch on date_d)
    resp_fail = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": emp_eng.id,
            "attendance_date": date_d.isoformat(),
            "review_status": "ACKNOWLEDGED",
            "idempotency_key": "idemp-boundary-fail-001",
        },
        headers=headers,
    )
    assert resp_fail.status_code == 400
    assert "No eligible attendance exception" in resp_fail.json()["detail"]

    # 2. Now add roaming event right at end of date D: 23:59:59.000 UTC
    event_at_boundary = AttendanceEvent(
        employee_id=emp_eng.id,
        device_id=device_branch.id,
        office_id=office_branch.id,
        punch_type="CHECK_OUT",
        event_timestamp=datetime(2026, 11, 15, 23, 59, 59, tzinfo=timezone.utc),
        is_roaming=True,
        actor_user_id=user_mgr.id,
        idempotency_key="seed-roaming-boundary-d",
    )
    dev_db_session.add(event_at_boundary)
    dev_db_session.flush()

    # Now date_d must succeed
    resp_ok = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": emp_eng.id,
            "attendance_date": date_d.isoformat(),
            "review_status": "ACKNOWLEDGED",
            "idempotency_key": "idemp-boundary-success-001",
        },
        headers=headers,
    )
    assert resp_ok.status_code == 201


def test_non_roaming_and_nonexistent_exception_rejection(dev_client: TestClient, review_test_data, dev_db_session: Session):
    """Ordinary in-office attendance days or non-existent exceptions must be rejected with 400."""
    user_mgr = review_test_data["user_mgr"]
    emp_eng = review_test_data["emp_eng"]
    device_branch = review_test_data["device_branch"]
    office_hq = review_test_data["office_hq"]
    headers = _make_auth_headers(user_mgr)

    # 1. Normal punch (is_roaming=False) on 2026-11-20
    normal_date = date(2026, 11, 20)
    normal_event = AttendanceEvent(
        employee_id=emp_eng.id,
        device_id=device_branch.id,
        office_id=office_hq.id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 20, 9, 0, 0, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=user_mgr.id,
        idempotency_key="seed-normal-punch-001",
    )
    dev_db_session.add(normal_event)
    dev_db_session.flush()

    resp_normal = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": emp_eng.id,
            "attendance_date": normal_date.isoformat(),
            "review_status": "ACKNOWLEDGED",
            "idempotency_key": "idemp-normal-try-001",
        },
        headers=headers,
    )
    assert resp_normal.status_code == 400
    assert "No eligible attendance exception" in resp_normal.json()["detail"]

    # 2. Non-existent employee ID
    resp_404 = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": 999999,
            "attendance_date": review_test_data["target_date"].isoformat(),
            "review_status": "ACKNOWLEDGED",
            "idempotency_key": "idemp-404-001",
        },
        headers=headers,
    )
    assert resp_404.status_code == 404


def test_review_and_audit_atomicity(dev_client: TestClient, review_test_data, dev_db_session: Session):
    """AttendanceReview and AuditLog must be written atomically in the same database transaction."""
    user_mgr = review_test_data["user_mgr"]
    emp_eng = review_test_data["emp_eng"]
    target_date = review_test_data["target_date"]
    headers = _make_auth_headers(user_mgr)

    audit_count_before = dev_db_session.scalar(
        select(func.count(AuditLog.id)).where(AuditLog.action == "ATTENDANCE_EXCEPTION_ACKNOWLEDGED")
    ) or 0

    resp = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": emp_eng.id,
            "attendance_date": target_date.isoformat(),
            "review_status": "ACKNOWLEDGED",
            "review_notes": "Atomic test note",
            "idempotency_key": "idemp-atomic-001",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    review_id = resp.json()["id"]

    audit_entry = dev_db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "ATTENDANCE_EXCEPTION_ACKNOWLEDGED",
            AuditLog.target_id == str(review_id),
        )
    )
    assert audit_entry is not None
    assert audit_entry.actor_user_id == user_mgr.id
    assert audit_entry.target_type == "attendance_review"
    assert audit_entry.after_state["review_status"] == "ACKNOWLEDGED"
    assert audit_entry.after_state["employee_id"] == emp_eng.id


def test_identical_idempotent_retry_and_conflicting_key_reuse(dev_client: TestClient, review_test_data, dev_db_session: Session):
    """Identical retries return existing record without duplicate audit; mismatched key reuse returns 409."""
    user_mgr = review_test_data["user_mgr"]
    emp_eng = review_test_data["emp_eng"]
    target_date = review_test_data["target_date"]
    headers = _make_auth_headers(user_mgr)

    idemp_key = "idemp-retry-test-999"

    # 1. First submission -> 201
    resp1 = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": emp_eng.id,
            "attendance_date": target_date.isoformat(),
            "review_status": "ACKNOWLEDGED",
            "review_notes": "Initial note",
            "idempotency_key": idemp_key,
        },
        headers=headers,
    )
    assert resp1.status_code == 201
    first_id = resp1.json()["id"]

    audit_count_after_first = dev_db_session.scalar(
        select(func.count(AuditLog.id)).where(
            AuditLog.action == "ATTENDANCE_EXCEPTION_ACKNOWLEDGED",
            AuditLog.target_id == str(first_id),
        )
    )
    assert audit_count_after_first == 1

    # 2. Identical retry with exact same key -> Returns existing review (201/200)
    resp2 = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": emp_eng.id,
            "attendance_date": target_date.isoformat(),
            "review_status": "ACKNOWLEDGED",
            "review_notes": "Initial note",
            "idempotency_key": idemp_key,
        },
        headers=headers,
    )
    assert resp2.status_code in (200, 201)
    assert resp2.json()["id"] == first_id

    # Verify NO duplicate audit log entry was created
    audit_count_after_retry = dev_db_session.scalar(
        select(func.count(AuditLog.id)).where(
            AuditLog.action == "ATTENDANCE_EXCEPTION_ACKNOWLEDGED",
            AuditLog.target_id == str(first_id),
        )
    )
    assert audit_count_after_retry == 1

    # 3. Conflicting key reuse: Same key, different notes -> 409 Conflict
    resp3 = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": emp_eng.id,
            "attendance_date": target_date.isoformat(),
            "review_status": "ACKNOWLEDGED",
            "review_notes": "Conflicting different note",
            "idempotency_key": idemp_key,
        },
        headers=headers,
    )
    assert resp3.status_code == 409
    assert "mismatched parameters" in resp3.json()["detail"]


def test_notes_validation_and_append_only_history(dev_client: TestClient, review_test_data):
    """Review notes length is validated; multiple reviews form an append-only timeline."""
    user_mgr = review_test_data["user_mgr"]
    emp_eng = review_test_data["emp_eng"]
    target_date = review_test_data["target_date"]
    headers = _make_auth_headers(user_mgr)

    # 1. Notes > 1000 chars -> 422
    long_notes = "x" * 1001
    resp_long = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": emp_eng.id,
            "attendance_date": target_date.isoformat(),
            "review_status": "ACKNOWLEDGED",
            "review_notes": long_notes,
            "idempotency_key": "idemp-toolong-001",
        },
        headers=headers,
    )
    assert resp_long.status_code == 422

    # 2. Append review 1
    resp_r1 = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": emp_eng.id,
            "attendance_date": target_date.isoformat(),
            "review_status": "ACKNOWLEDGED",
            "review_notes": "First review action",
            "idempotency_key": "idemp-history-001",
        },
        headers=headers,
    )
    assert resp_r1.status_code == 201

    # 3. Append review 2 (distinct key)
    resp_r2 = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": emp_eng.id,
            "attendance_date": target_date.isoformat(),
            "review_status": "ACKNOWLEDGED",
            "review_notes": "Second updated supervisory review",
            "idempotency_key": "idemp-history-002",
        },
        headers=headers,
    )
    assert resp_r2.status_code == 201

    # 4. Fetch review history -> Both reviews present in reverse chronological order
    resp_hist = dev_client.get(
        f"/api/v1/attendance/reviews?employee_id={emp_eng.id}&date={target_date.isoformat()}",
        headers=headers,
    )
    assert resp_hist.status_code == 200
    hist = resp_hist.json()
    assert hist["total_items"] >= 2
    assert hist["items"][0]["review_notes"] == "Second updated supervisory review"
    assert hist["items"][1]["review_notes"] == "First review action"


def test_raw_punch_immutability(dev_client: TestClient, review_test_data, dev_db_session: Session):
    """Manager acknowledgement must never alter, mutate, or delete raw punch events."""
    user_mgr = review_test_data["user_mgr"]
    emp_eng = review_test_data["emp_eng"]
    target_date = review_test_data["target_date"]
    event_roaming = review_test_data["event_roaming"]
    headers = _make_auth_headers(user_mgr)

    original_timestamp = event_roaming.event_timestamp
    original_device = event_roaming.device_id
    original_office = event_roaming.office_id
    original_roaming = event_roaming.is_roaming

    # Submit acknowledgement
    resp = dev_client.post(
        "/api/v1/attendance/reviews",
        json={
            "employee_id": emp_eng.id,
            "attendance_date": target_date.isoformat(),
            "review_status": "ACKNOWLEDGED",
            "review_notes": "Checking punch immutability",
            "idempotency_key": "idemp-immutability-001",
        },
        headers=headers,
    )
    assert resp.status_code == 201

    # Re-query the raw punch event directly from DB
    dev_db_session.expire_all()
    re_event = dev_db_session.get(AttendanceEvent, event_roaming.id)
    assert re_event is not None
    assert re_event.event_timestamp == original_timestamp
    assert re_event.device_id == original_device
    assert re_event.office_id == original_office
    assert re_event.is_roaming is True
    assert re_event.is_roaming == original_roaming
