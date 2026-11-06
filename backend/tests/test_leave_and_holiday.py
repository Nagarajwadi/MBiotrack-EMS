from datetime import date, datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, hash_password
from app.db.session import get_db
from app.main import app
from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.holiday import Holiday
from app.models.leave_request import LeaveRequest
from app.models.office import Office
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
def leave_test_data(dev_db_session: Session):
    """Seed offices, employees, and users with distinct roles."""
    # 1. Office
    office = Office(
        name="Main Headquarters",
        code="HQ",
        timezone="Asia/Kolkata",
        is_active=True,
    )
    dev_db_session.add(office)
    dev_db_session.flush()

    # 2. Employees
    emp1 = Employee(
        employee_code="EMP-L01",
        first_name="Alice",
        last_name="Worker",
        email="alice.leave@example.com",
        department="Engineering",
        designation="Software Engineer",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    emp2 = Employee(
        employee_code="EMP-L02",
        first_name="Bob",
        last_name="Staff",
        email="bob.leave@example.com",
        department="Support",
        designation="Support Specialist",
        joining_date=date(2025, 2, 1),
        is_active=True,
    )
    dev_db_session.add_all([emp1, emp2])
    dev_db_session.flush()

    # 3. Users: Admin, Manager (linked to emp2), and Employee (linked to emp1)
    admin_user = User(
        email="admin.leave@example.com",
        full_name="Admin Leave",
        password_hash=hash_password("ValidPassword123!"),
        role="ADMIN",
        is_active=True,
        employee_id=None,
    )
    manager_user = User(
        email="manager.leave@example.com",
        full_name="Manager Leave",
        password_hash=hash_password("ValidPassword123!"),
        role="MANAGER",
        is_active=True,
        employee_id=emp2.id,
    )
    employee_user = User(
        email="employee.leave@example.com",
        full_name="Alice Worker",
        password_hash=hash_password("ValidPassword123!"),
        role="EMPLOYEE",
        is_active=True,
        employee_id=emp1.id,
    )
    dev_db_session.add_all([admin_user, manager_user, employee_user])
    dev_db_session.flush()

    # 4. Auth tokens
    admin_token = create_access_token(subject=str(admin_user.id), extra_claims={"role": "ADMIN", "email": admin_user.email})
    manager_token = create_access_token(subject=str(manager_user.id), extra_claims={"role": "MANAGER", "email": manager_user.email})
    employee_token = create_access_token(subject=str(employee_user.id), extra_claims={"role": "EMPLOYEE", "email": employee_user.email})

    return {
        "office": office,
        "emp1": emp1,
        "emp2": emp2,
        "admin_user": admin_user,
        "manager_user": manager_user,
        "employee_user": employee_user,
        "admin_headers": {"Authorization": f"Bearer {admin_token}"},
        "manager_headers": {"Authorization": f"Bearer {manager_token}"},
        "employee_headers": {"Authorization": f"Bearer {employee_token}"},
    }


def test_submit_leave_request_and_validation(dev_client: TestClient, leave_test_data, dev_db_session: Session):
    headers = leave_test_data["employee_headers"]

    # 1. Valid leave submission
    res = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-15",
            "end_date": "2026-11-18",
            "leave_type": "ANNUAL",
            "reason": "Family vacation",
        },
        headers=headers,
    )
    assert res.status_code == 201
    body = res.json()
    assert body["employee_id"] == leave_test_data["emp1"].id
    assert body["start_date"] == "2026-11-15"
    assert body["end_date"] == "2026-11-18"
    assert body["leave_type"] == "ANNUAL"
    assert body["status"] == "PENDING"
    assert body["employee_code"] == "EMP-L01"

    # Check audit log
    audit = dev_db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "LEAVE_REQUEST_SUBMITTED",
            AuditLog.target_id == str(body["id"]),
        )
    )
    assert audit is not None
    assert audit.actor_user_id == leave_test_data["employee_user"].id

    # 2. Date ordering validation (end_date < start_date)
    res_bad_dates = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-20",
            "end_date": "2026-11-15",
            "leave_type": "ANNUAL",
        },
        headers=headers,
    )
    assert res_bad_dates.status_code == 422

    # 3. Invalid leave type
    res_bad_type = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-20",
            "end_date": "2026-11-21",
            "leave_type": "MATERNITY_NOT_IN_ENUM",
        },
        headers=headers,
    )
    assert res_bad_type.status_code == 422


def test_leave_request_employee_self_isolation(dev_client: TestClient, leave_test_data):
    emp_headers = leave_test_data["employee_headers"]
    emp2_id = leave_test_data["emp2"].id

    # Employee 1 attempts to submit leave on behalf of Employee 2 -> 403 Forbidden
    res = dev_client.post(
        "/api/v1/leaves",
        json={
            "employee_id": emp2_id,
            "start_date": "2026-12-01",
            "end_date": "2026-12-02",
            "leave_type": "SICK",
        },
        headers=emp_headers,
    )
    assert res.status_code == 403
    assert "own" in res.json()["detail"].lower()

    # Employee 1 attempts to query Employee 2's requests -> 403 Forbidden
    res_list = dev_client.get(
        f"/api/v1/leaves?employee_id={emp2_id}",
        headers=emp_headers,
    )
    assert res_list.status_code == 403


def test_leave_request_review_and_self_approval_prevention(dev_client: TestClient, leave_test_data, dev_db_session: Session):
    emp_headers = leave_test_data["employee_headers"]
    mgr_headers = leave_test_data["manager_headers"]
    adm_headers = leave_test_data["admin_headers"]

    # 1. Employee 1 submits a leave request
    res = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-25",
            "end_date": "2026-11-26",
            "leave_type": "CASUAL",
            "reason": "Personal matters",
        },
        headers=emp_headers,
    )
    assert res.status_code == 201
    leave_id = res.json()["id"]

    # 2. Employee cannot approve request -> 403
    res_emp_review = dev_client.post(
        f"/api/v1/leaves/{leave_id}/review",
        json={"decision": "APPROVED"},
        headers=emp_headers,
    )
    assert res_emp_review.status_code == 403

    # 3. Manager reviews and approves Employee 1's request -> 200 APPROVED
    res_mgr_review = dev_client.post(
        f"/api/v1/leaves/{leave_id}/review",
        json={"decision": "APPROVED", "decision_notes": "Approved by engineering manager"},
        headers=mgr_headers,
    )
    assert res_mgr_review.status_code == 200
    assert res_mgr_review.json()["status"] == "APPROVED"
    assert res_mgr_review.json()["decision_notes"] == "Approved by engineering manager"

    # Audit log check
    audit = dev_db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "LEAVE_REQUEST_APPROVED",
            AuditLog.target_id == str(leave_id),
        )
    )
    assert audit is not None
    assert audit.actor_user_id == leave_test_data["manager_user"].id

    # 4. Repeated decision on already-decided request is rejected -> 409 Conflict
    res_repeat = dev_client.post(
        f"/api/v1/leaves/{leave_id}/review",
        json={"decision": "REJECTED"},
        headers=adm_headers,
    )
    assert res_repeat.status_code == 409

    # 5. Self-approval prevention: Manager user is linked to emp2.
    # Manager submits leave for emp2, then tries to approve it themselves
    res_mgr_sub = dev_client.post(
        "/api/v1/leaves",
        json={
            "employee_id": leave_test_data["emp2"].id,
            "start_date": "2026-12-05",
            "end_date": "2026-12-06",
            "leave_type": "ANNUAL",
        },
        headers=mgr_headers,
    )
    assert res_mgr_sub.status_code == 201
    mgr_leave_id = res_mgr_sub.json()["id"]

    res_self_approve = dev_client.post(
        f"/api/v1/leaves/{mgr_leave_id}/review",
        json={"decision": "APPROVED"},
        headers=mgr_headers,
    )
    assert res_self_approve.status_code == 403
    assert "own" in res_self_approve.json()["detail"].lower()


def test_overlapping_leave_request_rejection(dev_client: TestClient, leave_test_data):
    emp_headers = leave_test_data["employee_headers"]

    # 1. Submit initial request for Nov 10 to Nov 14
    res = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-10",
            "end_date": "2026-11-14",
            "leave_type": "ANNUAL",
        },
        headers=emp_headers,
    )
    assert res.status_code == 201

    # 2. Attempt overlapping submission: Nov 12 to Nov 16 -> 409 Conflict
    res_overlap1 = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-12",
            "end_date": "2026-11-16",
            "leave_type": "SICK",
        },
        headers=emp_headers,
    )
    assert res_overlap1.status_code == 409

    # 3. Attempt overlapping submission completely enclosing: Nov 9 to Nov 15 -> 409 Conflict
    res_overlap2 = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-11-09",
            "end_date": "2026-11-15",
            "leave_type": "CASUAL",
        },
        headers=emp_headers,
    )
    assert res_overlap2.status_code == 409


def test_leave_request_cancellation(dev_client: TestClient, leave_test_data):
    emp_headers = leave_test_data["employee_headers"]
    mgr_headers = leave_test_data["manager_headers"]

    # 1. Submit request
    res = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-12-10",
            "end_date": "2026-12-12",
            "leave_type": "UNPAID",
        },
        headers=emp_headers,
    )
    assert res.status_code == 201
    leave_id = res.json()["id"]

    # 2. Employee cancels own pending request -> 200 CANCELLED
    res_cancel = dev_client.post(
        f"/api/v1/leaves/{leave_id}/cancel",
        headers=emp_headers,
    )
    assert res_cancel.status_code == 200
    assert res_cancel.json()["status"] == "CANCELLED"

    # 3. Cancelled request allows submitting a new request for the same dates
    res_resubmit = dev_client.post(
        "/api/v1/leaves",
        json={
            "start_date": "2026-12-10",
            "end_date": "2026-12-12",
            "leave_type": "ANNUAL",
        },
        headers=emp_headers,
    )
    assert res_resubmit.status_code == 201


def test_holiday_calendar_management_and_scoping(dev_client: TestClient, leave_test_data, dev_db_session: Session):
    adm_headers = leave_test_data["admin_headers"]
    mgr_headers = leave_test_data["manager_headers"]
    emp_headers = leave_test_data["employee_headers"]
    office_id = leave_test_data["office"].id

    # 1. Non-admin cannot create holiday -> 403 Forbidden
    res_mgr_create = dev_client.post(
        "/api/v1/holidays",
        json={
            "holiday_date": "2027-01-01",
            "name": "New Year's Day",
        },
        headers=mgr_headers,
    )
    assert res_mgr_create.status_code == 403

    # 2. Admin creates organization-wide holiday (office_id=None)
    res_org_holiday = dev_client.post(
        "/api/v1/holidays",
        json={
            "holiday_date": "2027-01-01",
            "name": "New Year's Day",
            "description": "Global holiday across all offices",
            "office_id": None,
            "is_optional": False,
        },
        headers=adm_headers,
    )
    assert res_org_holiday.status_code == 201
    org_h_id = res_org_holiday.json()["id"]
    assert res_org_holiday.json()["office_id"] is None

    # Check audit log
    audit_create = dev_db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "HOLIDAY_CREATED",
            AuditLog.target_id == str(org_h_id),
        )
    )
    assert audit_create is not None

    # 3. Duplicate org-wide holiday on same date is rejected -> 409 Conflict
    res_dup = dev_client.post(
        "/api/v1/holidays",
        json={
            "holiday_date": "2027-01-01",
            "name": "Duplicate Day",
            "office_id": None,
        },
        headers=adm_headers,
    )
    assert res_dup.status_code == 409

    # 4. Admin creates office-specific holiday for same date -> 201 (partial index allows it)
    res_off_holiday = dev_client.post(
        "/api/v1/holidays",
        json={
            "holiday_date": "2027-01-01",
            "name": "HQ Founders Day",
            "office_id": office_id,
        },
        headers=adm_headers,
    )
    assert res_off_holiday.status_code == 201
    off_h_id = res_off_holiday.json()["id"]

    # Duplicate office holiday on same date for same office is rejected -> 409 Conflict
    res_dup_office = dev_client.post(
        "/api/v1/holidays",
        json={
            "holiday_date": "2027-01-01",
            "name": "HQ Duplicate Day",
            "office_id": office_id,
        },
        headers=adm_headers,
    )
    assert res_dup_office.status_code == 409

    # 5. List holidays (all authenticated users can list)
    res_list_emp = dev_client.get(
        "/api/v1/holidays",
        headers=emp_headers,
    )
    assert res_list_emp.status_code == 200
    items = res_list_emp.json()["items"]
    assert len(items) >= 2

    # 6. Admin updates holiday
    res_update = dev_client.put(
        f"/api/v1/holidays/{org_h_id}",
        json={"name": "New Year's Day (Updated)"},
        headers=adm_headers,
    )
    assert res_update.status_code == 200
    assert res_update.json()["name"] == "New Year's Day (Updated)"

    # 7. Admin deletes holiday
    res_del = dev_client.delete(
        f"/api/v1/holidays/{org_h_id}",
        headers=adm_headers,
    )
    assert res_del.status_code == 204


def test_office_deletion_restricted_when_holidays_reference_it(dev_client: TestClient, leave_test_data, dev_db_session: Session):
    adm_headers = leave_test_data["admin_headers"]
    office = leave_test_data["office"]

    # 1. Create office-specific holiday
    res_h = dev_client.post(
        "/api/v1/holidays",
        json={
            "holiday_date": "2027-08-15",
            "name": "HQ Independence Day",
            "office_id": office.id,
        },
        headers=adm_headers,
    )
    assert res_h.status_code == 201

    # 2. Attempting to delete the office directly in SQL must raise IntegrityError because of ON DELETE RESTRICT
    with pytest.raises(IntegrityError):
        dev_db_session.delete(office)
        dev_db_session.flush()
