from datetime import date, datetime, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, derive_pwd_fingerprint, hash_password
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.main import app
from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.leave_request import LeaveRequest
from app.models.office import Office
from app.models.user import User

settings = get_settings()




@pytest.fixture
def manager_leave_fixture(dev_db_session: Session):
    """Seed offices, multiple departments, employees, managers, and leave requests."""
    office = Office(
        name="Tech Center",
        code="TC-01",
        timezone="Asia/Kolkata",
        is_active=True,
    )
    dev_db_session.add(office)
    dev_db_session.flush()

    # Employees in Engineering
    eng_emp1 = Employee(
        employee_code="ENG-001",
        first_name="Evan",
        last_name="Engineer",
        email="evan.eng@example.com",
        department="Engineering",
        designation="Software Engineer",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    eng_mgr_emp = Employee(
        employee_code="ENG-MGR",
        first_name="Elena",
        last_name="Manager",
        email="elena.mgr@example.com",
        department="Engineering",
        designation="Engineering Manager",
        joining_date=date(2024, 6, 1),
        is_active=True,
    )

    # Employees in Sales
    sales_emp1 = Employee(
        employee_code="SLS-001",
        first_name="Sam",
        last_name="Sales",
        email="sam.sales@example.com",
        department="Sales",
        designation="Account Executive",
        joining_date=date(2025, 2, 1),
        is_active=True,
    )
    sales_mgr_emp = Employee(
        employee_code="SLS-MGR",
        first_name="Sarah",
        last_name="Saleslead",
        email="sarah.salesmgr@example.com",
        department="Sales",
        designation="Sales Manager",
        joining_date=date(2024, 5, 1),
        is_active=True,
    )

    dev_db_session.add_all([eng_emp1, eng_mgr_emp, sales_emp1, sales_mgr_emp])
    dev_db_session.flush()

    # Users
    admin_user = User(
        email="admin.teamleave@example.com",
        full_name="Global Admin",
        password_hash=hash_password("ValidPassword123!"),
        role="ADMIN",
        is_active=True,
        employee_id=None,
    )
    eng_mgr_user = User(
        email="elena.mgr@example.com",
        full_name="Elena Manager",
        password_hash=hash_password("ValidPassword123!"),
        role="MANAGER",
        is_active=True,
        employee_id=eng_mgr_emp.id,
    )
    sales_mgr_user = User(
        email="sarah.salesmgr@example.com",
        full_name="Sarah Saleslead",
        password_hash=hash_password("ValidPassword123!"),
        role="MANAGER",
        is_active=True,
        employee_id=sales_mgr_emp.id,
    )
    eng_emp_user = User(
        email="evan.eng@example.com",
        full_name="Evan Engineer",
        password_hash=hash_password("ValidPassword123!"),
        role="EMPLOYEE",
        is_active=True,
        employee_id=eng_emp1.id,
    )

    dev_db_session.add_all([admin_user, eng_mgr_user, sales_mgr_user, eng_emp_user])
    dev_db_session.flush()

    # Seed pending leave requests
    eng_req = LeaveRequest(
        employee_id=eng_emp1.id,
        start_date=date(2026, 12, 1),
        end_date=date(2026, 12, 3),
        leave_type="ANNUAL",
        reason="Winter vacation",
        status="PENDING",
    )
    sales_req = LeaveRequest(
        employee_id=sales_emp1.id,
        start_date=date(2026, 12, 5),
        end_date=date(2026, 12, 6),
        leave_type="SICK",
        reason="Medical appointment",
        status="PENDING",
    )
    dev_db_session.add_all([eng_req, sales_req])
    dev_db_session.flush()

    admin_token = create_access_token(
        str(admin_user.id),
        extra_claims={
            "role": "ADMIN",
            "email": admin_user.email,
            "pwd": derive_pwd_fingerprint(admin_user.password_hash),
        },
    )
    eng_mgr_token = create_access_token(
        str(eng_mgr_user.id),
        extra_claims={
            "role": "MANAGER",
            "email": eng_mgr_user.email,
            "pwd": derive_pwd_fingerprint(eng_mgr_user.password_hash),
        },
    )
    sales_mgr_token = create_access_token(
        str(sales_mgr_user.id),
        extra_claims={
            "role": "MANAGER",
            "email": sales_mgr_user.email,
            "pwd": derive_pwd_fingerprint(sales_mgr_user.password_hash),
        },
    )
    eng_emp_token = create_access_token(
        str(eng_emp_user.id),
        extra_claims={
            "role": "EMPLOYEE",
            "email": eng_emp_user.email,
            "pwd": derive_pwd_fingerprint(eng_emp_user.password_hash),
        },
    )

    return {
        "eng_emp1": eng_emp1,
        "eng_mgr_emp": eng_mgr_emp,
        "sales_emp1": sales_emp1,
        "sales_mgr_emp": sales_mgr_emp,
        "eng_req": eng_req,
        "sales_req": sales_req,
        "admin_headers": {"Authorization": f"Bearer {admin_token}"},
        "eng_mgr_headers": {"Authorization": f"Bearer {eng_mgr_token}"},
        "sales_mgr_headers": {"Authorization": f"Bearer {sales_mgr_token}"},
        "eng_emp_headers": {"Authorization": f"Bearer {eng_emp_token}"},
        "eng_mgr_user": eng_mgr_user,
    }


def test_manager_team_leave_listing_scoped_to_department(dev_client: TestClient, manager_leave_fixture):
    """Manager in Engineering queries leave requests and receives ONLY Engineering leaves."""
    eng_mgr_headers = manager_leave_fixture["eng_mgr_headers"]
    eng_req = manager_leave_fixture["eng_req"]
    sales_req = manager_leave_fixture["sales_req"]

    res = dev_client.get("/api/v1/leaves", headers=eng_mgr_headers)
    assert res.status_code == 200
    data = res.json()

    assert data["department"] == "Engineering"
    assert data["total"] == 1
    assert len(data["items"]) == 1
    assert data["items"][0]["id"] == eng_req.id
    assert data["items"][0]["department"] == "Engineering"

    # Explicit check: Sales request is not leaked
    item_ids = [item["id"] for item in data["items"]]
    assert sales_req.id not in item_ids


def test_manager_cross_department_employee_filter_denied(dev_client: TestClient, manager_leave_fixture):
    """Manager in Engineering cannot filter by an employee in Sales -> 403 Forbidden."""
    eng_mgr_headers = manager_leave_fixture["eng_mgr_headers"]
    sales_emp_id = manager_leave_fixture["sales_emp1"].id

    res = dev_client.get(f"/api/v1/leaves?employee_id={sales_emp_id}", headers=eng_mgr_headers)
    assert res.status_code == 403
    assert "authorized team" in res.json()["detail"].lower()


def test_unlinked_manager_denied_on_leaves(dev_client: TestClient, manager_leave_fixture):
    """Manager without a linked employee profile is denied access with 403 Forbidden."""
    unlinked_mgr = User(
        id=9998,
        full_name="Unlinked Manager",
        email="unlinked.mgr@example.com",
        role="MANAGER",
        employee_id=None,
        is_active=True,
    )
    eng_req_id = manager_leave_fixture["eng_req"].id

    app.dependency_overrides[get_current_user] = lambda: unlinked_mgr
    try:
        # 1. Listing leaves -> 403
        res_list = dev_client.get("/api/v1/leaves")
        assert res_list.status_code == 403
        assert "linked" in res_list.json()["detail"].lower()

        # 2. Reviewing leaves -> 403
        res_review = dev_client.post(
            f"/api/v1/leaves/{eng_req_id}/review",
            json={"decision": "APPROVED", "decision_notes": "Unlinked attempt"},
        )
        assert res_review.status_code == 403
        assert "linked" in res_review.json()["detail"].lower()
    finally:
        del app.dependency_overrides[get_current_user]


def test_manager_cross_department_review_denied(dev_client: TestClient, manager_leave_fixture):
    """Engineering manager cannot review Sales leave request -> 403 Forbidden."""
    eng_mgr_headers = manager_leave_fixture["eng_mgr_headers"]
    sales_req_id = manager_leave_fixture["sales_req"].id

    res = dev_client.post(
        f"/api/v1/leaves/{sales_req_id}/review",
        json={"decision": "APPROVED", "decision_notes": "Unauthorized cross-department attempt"},
        headers=eng_mgr_headers,
    )
    assert res.status_code == 403
    assert "authorized team" in res.json()["detail"].lower()


def test_manager_can_review_own_team_leave(dev_client: TestClient, manager_leave_fixture, dev_db_session: Session):
    """Engineering manager can approve Engineering employee leave request with audit logging."""
    eng_mgr_headers = manager_leave_fixture["eng_mgr_headers"]
    eng_req_id = manager_leave_fixture["eng_req"].id
    eng_mgr_user = manager_leave_fixture["eng_mgr_user"]

    res = dev_client.post(
        f"/api/v1/leaves/{eng_req_id}/review",
        json={"decision": "APPROVED", "decision_notes": "Work coverage confirmed by lead"},
        headers=eng_mgr_headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "APPROVED"
    assert data["decision_notes"] == "Work coverage confirmed by lead"
    assert data["decision_by_user_id"] == eng_mgr_user.id

    # Verify audit log was recorded with department metadata
    audit = dev_db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "LEAVE_REQUEST_APPROVED",
            AuditLog.target_id == str(eng_req_id),
        )
    )
    assert audit is not None
    assert audit.actor_user_id == eng_mgr_user.id
    assert audit.metadata_["department"] == "Engineering"


def test_manager_cross_department_submission_and_cancellation_denied(dev_client: TestClient, manager_leave_fixture):
    """Engineering manager cannot submit or cancel leave for a Sales employee -> 403 Forbidden."""
    eng_mgr_headers = manager_leave_fixture["eng_mgr_headers"]
    sales_emp_id = manager_leave_fixture["sales_emp1"].id
    sales_req_id = manager_leave_fixture["sales_req"].id

    # Submission for cross-department employee -> 403
    res_sub = dev_client.post(
        "/api/v1/leaves",
        json={
            "employee_id": sales_emp_id,
            "start_date": "2026-12-20",
            "end_date": "2026-12-21",
            "leave_type": "CASUAL",
        },
        headers=eng_mgr_headers,
    )
    assert res_sub.status_code == 403
    assert "authorized team" in res_sub.json()["detail"].lower()

    # Cancellation of cross-department request -> 403
    res_cancel = dev_client.post(
        f"/api/v1/leaves/{sales_req_id}/cancel",
        headers=eng_mgr_headers,
    )
    assert res_cancel.status_code == 403
    assert "authorized team" in res_cancel.json()["detail"].lower()


def test_admin_organization_wide_access_and_department_filtering(dev_client: TestClient, manager_leave_fixture):
    """Admin has organization-wide visibility and can filter by department."""
    admin_headers = manager_leave_fixture["admin_headers"]
    eng_req = manager_leave_fixture["eng_req"]
    sales_req = manager_leave_fixture["sales_req"]

    # 1. Admin without department filter sees both
    res_all = dev_client.get("/api/v1/leaves", headers=admin_headers)
    assert res_all.status_code == 200
    all_data = res_all.json()
    assert all_data["total"] >= 2
    ids = [item["id"] for item in all_data["items"]]
    assert eng_req.id in ids
    assert sales_req.id in ids

    # 2. Admin filters by department=Sales
    res_sales = dev_client.get("/api/v1/leaves?department=Sales", headers=admin_headers)
    assert res_sales.status_code == 200
    sales_data = res_sales.json()
    assert sales_data["department"] == "Sales"
    assert all(item["department"] == "Sales" for item in sales_data["items"])
    sales_ids = [item["id"] for item in sales_data["items"]]
    assert sales_req.id in sales_ids
    assert eng_req.id not in sales_ids
