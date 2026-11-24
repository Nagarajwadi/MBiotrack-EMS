from datetime import date
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, derive_pwd_fingerprint, hash_password
from app.db.session import get_db
from app.main import app
from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.leave_entitlement import (
    EmployeeLeaveEntitlement,
    LeaveBalanceLedger,
    LeaveEntitlementDefault,
)
from app.models.leave_request import LeaveRequest
from app.models.office import Office
from app.models.user import User


@pytest.fixture
def entitlement_test_data(dev_db_session: Session):
    """Seed office, employees, users, and tokens for entitlement & balance tests."""
    # 1. Office
    office = Office(
        name="Bengaluru Office",
        code="BLR-HQ",
        timezone="Asia/Kolkata",
        is_active=True,
    )
    dev_db_session.add(office)
    dev_db_session.flush()

    # 2. Employees
    emp1 = Employee(
        employee_code="EMP-ENT-01",
        first_name="Alice",
        last_name="Engineer",
        email="alice.ent@example.com",
        department="Engineering",
        designation="Software Engineer",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    emp2 = Employee(
        employee_code="EMP-ENT-02",
        first_name="Bob",
        last_name="Lead",
        email="bob.ent@example.com",
        department="Engineering",
        designation="Engineering Lead",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    dev_db_session.add_all([emp1, emp2])
    dev_db_session.flush()

    # 3. Users: Admin, Manager (emp2), Employee (emp1)
    admin_user = User(
        email="admin.ent@example.com",
        full_name="Admin Entitlement",
        password_hash=hash_password("ValidPassword123!"),
        role="ADMIN",
        is_active=True,
        employee_id=None,
    )
    manager_user = User(
        email="manager.ent@example.com",
        full_name="Bob Lead",
        password_hash=hash_password("ValidPassword123!"),
        role="MANAGER",
        is_active=True,
        employee_id=emp2.id,
    )
    employee_user = User(
        email="employee.ent@example.com",
        full_name="Alice Engineer",
        password_hash=hash_password("ValidPassword123!"),
        role="EMPLOYEE",
        is_active=True,
        employee_id=emp1.id,
    )
    dev_db_session.add_all([admin_user, manager_user, employee_user])
    dev_db_session.flush()

    # 4. Auth tokens
    admin_token = create_access_token(
        subject=str(admin_user.id),
        extra_claims={
            "role": "ADMIN",
            "email": admin_user.email,
            "pwd": derive_pwd_fingerprint(admin_user.password_hash),
        },
    )
    manager_token = create_access_token(
        subject=str(manager_user.id),
        extra_claims={
            "role": "MANAGER",
            "email": manager_user.email,
            "pwd": derive_pwd_fingerprint(manager_user.password_hash),
        },
    )
    employee_token = create_access_token(
        subject=str(employee_user.id),
        extra_claims={
            "role": "EMPLOYEE",
            "email": employee_user.email,
            "pwd": derive_pwd_fingerprint(employee_user.password_hash),
        },
    )

    return {
        "db": dev_db_session,
        "emp1": emp1,
        "emp2": emp2,
        "admin_user": admin_user,
        "manager_user": manager_user,
        "employee_user": employee_user,
        "admin_headers": {"Authorization": f"Bearer {admin_token}"},
        "manager_headers": {"Authorization": f"Bearer {manager_token}"},
        "employee_headers": {"Authorization": f"Bearer {employee_token}"},
    }


def test_org_entitlement_defaults_crud(entitlement_test_data):
    """Test creating, reading, updating, and deleting organization-wide entitlement defaults."""
    db = entitlement_test_data["db"]
    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db

    try:
        # Non-admin cannot set default
        res_emp = client.post(
            "/api/v1/leaves/entitlements/defaults",
            json={"year": 2026, "leave_type": "ANNUAL", "allocated_days": 15},
            headers=entitlement_test_data["employee_headers"],
        )
        assert res_emp.status_code == 403

        # Invalid leave type
        res_inv = client.post(
            "/api/v1/leaves/entitlements/defaults",
            json={"year": 2026, "leave_type": "MATERNITY", "allocated_days": 15},
            headers=entitlement_test_data["admin_headers"],
        )
        assert res_inv.status_code == 422

        # Admin sets ANNUAL default = 15
        res_create = client.post(
            "/api/v1/leaves/entitlements/defaults",
            json={"year": 2026, "leave_type": "ANNUAL", "allocated_days": 15},
            headers=entitlement_test_data["admin_headers"],
        )
        assert res_create.status_code == 200
        data = res_create.json()
        default_id = data["id"]
        assert data["allocated_days"] == 15
        assert data["leave_type"] == "ANNUAL"
        assert data["year"] == 2026

        # Admin updates ANNUAL default to 18
        res_update = client.post(
            "/api/v1/leaves/entitlements/defaults",
            json={"year": 2026, "leave_type": "ANNUAL", "allocated_days": 18},
            headers=entitlement_test_data["admin_headers"],
        )
        assert res_update.status_code == 200
        assert res_update.json()["allocated_days"] == 18
        assert res_update.json()["id"] == default_id

        # List defaults
        res_list = client.get(
            "/api/v1/leaves/entitlements/defaults?year=2026",
            headers=entitlement_test_data["admin_headers"],
        )
        assert res_list.status_code == 200
        assert len(res_list.json()) == 1
        assert res_list.json()[0]["allocated_days"] == 18

        # Delete default
        res_del = client.delete(
            f"/api/v1/leaves/entitlements/defaults/{default_id}",
            headers=entitlement_test_data["admin_headers"],
        )
        assert res_del.status_code == 204

        # List after delete is empty
        res_list_after = client.get(
            "/api/v1/leaves/entitlements/defaults?year=2026",
            headers=entitlement_test_data["admin_headers"],
        )
        assert len(res_list_after.json()) == 0
    finally:
        app.dependency_overrides.clear()


def test_employee_entitlement_overrides_crud_and_precedence(entitlement_test_data):
    """Test employee overrides take precedence over org defaults, and deletion reverts to default."""
    db = entitlement_test_data["db"]
    emp1 = entitlement_test_data["emp1"]
    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db

    try:
        # Set Org Default ANNUAL = 15
        client.post(
            "/api/v1/leaves/entitlements/defaults",
            json={"year": 2026, "leave_type": "ANNUAL", "allocated_days": 15},
            headers=entitlement_test_data["admin_headers"],
        )

        # Before override, emp1 has 15 days (is_override=False)
        res_bal1 = client.get(
            f"/api/v1/leaves/balances/{emp1.id}?year=2026",
            headers=entitlement_test_data["employee_headers"],
        )
        assert res_bal1.status_code == 200
        annual_bal1 = next(b for b in res_bal1.json()["balances"] if b["leave_type"] == "ANNUAL")
        assert annual_bal1["allocated_days"] == 15
        assert annual_bal1["available_days"] == 15
        assert annual_bal1["is_override"] is False

        # Set Employee Override for emp1 ANNUAL = 22
        res_ov = client.post(
            "/api/v1/leaves/entitlements/overrides",
            json={"employee_id": emp1.id, "year": 2026, "leave_type": "ANNUAL", "allocated_days": 22},
            headers=entitlement_test_data["admin_headers"],
        )
        assert res_ov.status_code == 200
        override_id = res_ov.json()["id"]

        # Now emp1 has 22 days (is_override=True)
        res_bal2 = client.get(
            f"/api/v1/leaves/balances/{emp1.id}?year=2026",
            headers=entitlement_test_data["employee_headers"],
        )
        annual_bal2 = next(b for b in res_bal2.json()["balances"] if b["leave_type"] == "ANNUAL")
        assert annual_bal2["allocated_days"] == 22
        assert annual_bal2["available_days"] == 22
        assert annual_bal2["is_override"] is True

        # Delete override reverts back to org default 15
        res_del = client.delete(
            f"/api/v1/leaves/entitlements/overrides/{override_id}",
            headers=entitlement_test_data["admin_headers"],
        )
        assert res_del.status_code == 204

        res_bal3 = client.get(
            f"/api/v1/leaves/balances/{emp1.id}?year=2026",
            headers=entitlement_test_data["employee_headers"],
        )
        annual_bal3 = next(b for b in res_bal3.json()["balances"] if b["leave_type"] == "ANNUAL")
        assert annual_bal3["allocated_days"] == 15
        assert annual_bal3["is_override"] is False
    finally:
        app.dependency_overrides.clear()


def test_leave_balance_enforcement_lifecycle(entitlement_test_data):
    """Test full balance lifecycle:
    1. Unconfigured type allows request without balance limits.
    2. Configured type checks balance and reserves working days on submission.
    3. Exceeding available balance is rejected.
    4. Approval consumes reserved days into used days.
    5. Rejection releases reserved days.
    6. Cancellation releases reserved/consumed days.
    """
    db = entitlement_test_data["db"]
    emp1 = entitlement_test_data["emp1"]
    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db

    try:
        # 1. Unconfigured CASUAL leave: allows submission without configured entitlement
        res_casual = client.post(
            "/api/v1/leaves",
            json={
                "start_date": "2026-03-02",  # Monday (1 day)
                "end_date": "2026-03-02",
                "leave_type": "CASUAL",
                "reason": "Personal errand",
            },
            headers=entitlement_test_data["employee_headers"],
        )
        assert res_casual.status_code == 201

        # 2. Configure ANNUAL = 5 days for 2026
        client.post(
            "/api/v1/leaves/entitlements/defaults",
            json={"year": 2026, "leave_type": "ANNUAL", "allocated_days": 5},
            headers=entitlement_test_data["admin_headers"],
        )

        # 3. Submit request for 3 working days (Mon-Wed: 2026-06-01 to 2026-06-03)
        res_sub1 = client.post(
            "/api/v1/leaves",
            json={
                "start_date": "2026-06-01",
                "end_date": "2026-06-03",
                "leave_type": "ANNUAL",
                "reason": "Summer vacation",
            },
            headers=entitlement_test_data["employee_headers"],
        )
        assert res_sub1.status_code == 201
        req1_id = res_sub1.json()["id"]
        assert res_sub1.json()["working_days"] == 3

        # Check balance: allocated=5, pending=3, used=0, available=2
        res_bal = client.get(
            f"/api/v1/leaves/balances/{emp1.id}?year=2026",
            headers=entitlement_test_data["employee_headers"],
        )
        ann = next(b for b in res_bal.json()["balances"] if b["leave_type"] == "ANNUAL")
        assert ann["allocated_days"] == 5
        assert ann["pending_days"] == 3
        assert ann["used_days"] == 0
        assert ann["available_days"] == 2

        # Check ledger has RESERVATION
        res_ledg = client.get(
            f"/api/v1/leaves/ledger/{emp1.id}?year=2026",
            headers=entitlement_test_data["employee_headers"],
        )
        assert len(res_ledg.json()) == 1
        assert res_ledg.json()[0]["transaction_type"] == "RESERVATION"
        assert res_ledg.json()[0]["days"] == 3

        # 4. Attempt to submit request for 3 working days (available is only 2) -> REJECTED (422)
        res_excess = client.post(
            "/api/v1/leaves",
            json={
                "start_date": "2026-06-08",
                "end_date": "2026-06-10",
                "leave_type": "ANNUAL",
                "reason": "Exceeding balance",
            },
            headers=entitlement_test_data["employee_headers"],
        )
        assert res_excess.status_code == 422
        assert "Insufficient leave balance for ANNUAL" in res_excess.json()["detail"]

        # 5. Submit request for 2 working days (Thu-Fri: 2026-06-11 to 2026-06-12) -> SUCCEEDS (available becomes 0)
        res_sub2 = client.post(
            "/api/v1/leaves",
            json={
                "start_date": "2026-06-11",
                "end_date": "2026-06-12",
                "leave_type": "ANNUAL",
                "reason": "Short trip",
            },
            headers=entitlement_test_data["employee_headers"],
        )
        assert res_sub2.status_code == 201
        req2_id = res_sub2.json()["id"]

        # Check balance: allocated=5, pending=5, used=0, available=0
        res_bal2 = client.get(
            f"/api/v1/leaves/balances/{emp1.id}?year=2026",
            headers=entitlement_test_data["employee_headers"],
        )
        ann2 = next(b for b in res_bal2.json()["balances"] if b["leave_type"] == "ANNUAL")
        assert ann2["available_days"] == 0
        assert ann2["pending_days"] == 5

        # 6. Manager approves req1 (3 days)
        # Check details before review has balance impact
        res_req1_det = client.get(
            f"/api/v1/leaves/{req1_id}",
            headers=entitlement_test_data["manager_headers"],
        )
        assert res_req1_det.status_code == 200
        assert res_req1_det.json()["allocated_days"] == 5
        assert res_req1_det.json()["available_days_before"] == 3  # available before req1 is consumed (5 - 2 pending from req2)
        assert res_req1_det.json()["available_days_after"] == 0

        res_appr1 = client.post(
            f"/api/v1/leaves/{req1_id}/review",
            json={"decision": "APPROVED", "decision_notes": "Have a great trip"},
            headers=entitlement_test_data["manager_headers"],
        )
        assert res_appr1.status_code == 200
        assert res_appr1.json()["status"] == "APPROVED"

        # Check balance: allocated=5, used=3, pending=2, available=0
        res_bal3 = client.get(
            f"/api/v1/leaves/balances/{emp1.id}?year=2026",
            headers=entitlement_test_data["employee_headers"],
        )
        ann3 = next(b for b in res_bal3.json()["balances"] if b["leave_type"] == "ANNUAL")
        assert ann3["used_days"] == 3
        assert ann3["pending_days"] == 2
        assert ann3["available_days"] == 0

        # 7. Reject req2 -> releases 2 reserved days back to available
        res_rej2 = client.post(
            f"/api/v1/leaves/{req2_id}/review",
            json={"decision": "REJECTED", "decision_notes": "Project deadline"},
            headers=entitlement_test_data["manager_headers"],
        )
        assert res_rej2.status_code == 200
        assert res_rej2.json()["status"] == "REJECTED"

        # Check balance: allocated=5, used=3, pending=0, available=2
        res_bal4 = client.get(
            f"/api/v1/leaves/balances/{emp1.id}?year=2026",
            headers=entitlement_test_data["employee_headers"],
        )
        ann4 = next(b for b in res_bal4.json()["balances"] if b["leave_type"] == "ANNUAL")
        assert ann4["used_days"] == 3
        assert ann4["pending_days"] == 0
        assert ann4["available_days"] == 2

        # 8. Cancel approved req1 (Admin/Manager cancellation) -> restores consumed 3 days
        res_cancel = client.post(
            f"/api/v1/leaves/{req1_id}/cancel",
            headers=entitlement_test_data["admin_headers"],
        )
        assert res_cancel.status_code == 200
        assert res_cancel.json()["status"] == "CANCELLED"

        # Check balance: allocated=5, used=0, pending=0, available=5
        res_bal5 = client.get(
            f"/api/v1/leaves/balances/{emp1.id}?year=2026",
            headers=entitlement_test_data["employee_headers"],
        )
        ann5 = next(b for b in res_bal5.json()["balances"] if b["leave_type"] == "ANNUAL")
        assert ann5["used_days"] == 0
        assert ann5["pending_days"] == 0
        assert ann5["available_days"] == 5
    finally:
        app.dependency_overrides.clear()


def test_revalidation_at_approval_fails_if_allocation_reduced(entitlement_test_data):
    """If admin reduces entitlement while a request is pending such that it exceeds allocated,
    approval must fail with 409."""
    db = entitlement_test_data["db"]
    emp1 = entitlement_test_data["emp1"]
    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db

    try:
        # 1. Admin sets SICK = 10 days
        client.post(
            "/api/v1/leaves/entitlements/defaults",
            json={"year": 2026, "leave_type": "SICK", "allocated_days": 10},
            headers=entitlement_test_data["admin_headers"],
        )

        # 2. Employee submits SICK for 4 days
        res_sub = client.post(
            "/api/v1/leaves",
            json={
                "start_date": "2026-07-06",  # Mon-Thu: 4 days
                "end_date": "2026-07-09",
                "leave_type": "SICK",
                "reason": "Recovery",
            },
            headers=entitlement_test_data["employee_headers"],
        )
        assert res_sub.status_code == 201
        req_id = res_sub.json()["id"]

        # 3. Admin reduces SICK allocation to 2 days
        client.post(
            "/api/v1/leaves/entitlements/defaults",
            json={"year": 2026, "leave_type": "SICK", "allocated_days": 2},
            headers=entitlement_test_data["admin_headers"],
        )

        # 4. Manager tries to approve the 4-day request -> FAILS with 409
        res_appr = client.post(
            f"/api/v1/leaves/{req_id}/review",
            json={"decision": "APPROVED", "decision_notes": "Get well"},
            headers=entitlement_test_data["manager_headers"],
        )
        assert res_appr.status_code == 409
        assert "Insufficient annual entitlement" in res_appr.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_unpaid_leave_does_not_consume_paid_entitlement(entitlement_test_data):
    """UNPAID leave requests do not consume or reserve paid leave entitlement."""
    db = entitlement_test_data["db"]
    emp1 = entitlement_test_data["emp1"]
    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db

    try:
        # Admin sets ANNUAL = 2 days
        client.post(
            "/api/v1/leaves/entitlements/defaults",
            json={"year": 2026, "leave_type": "ANNUAL", "allocated_days": 2},
            headers=entitlement_test_data["admin_headers"],
        )

        # Employee submits UNPAID leave for 10 working days
        res_unpaid = client.post(
            "/api/v1/leaves",
            json={
                "start_date": "2026-08-03",  # Mon to Fri x2 = 10 working days
                "end_date": "2026-08-14",
                "leave_type": "UNPAID",
                "reason": "Sabbatical",
            },
            headers=entitlement_test_data["employee_headers"],
        )
        assert res_unpaid.status_code == 201
        req_id = res_unpaid.json()["id"]

        # ANNUAL available days is STILL 2!
        res_bal = client.get(
            f"/api/v1/leaves/balances/{emp1.id}?year=2026",
            headers=entitlement_test_data["employee_headers"],
        )
        ann = next(b for b in res_bal.json()["balances"] if b["leave_type"] == "ANNUAL")
        assert ann["available_days"] == 2

        # Approve UNPAID leave
        res_appr = client.post(
            f"/api/v1/leaves/{req_id}/review",
            json={"decision": "APPROVED"},
            headers=entitlement_test_data["manager_headers"],
        )
        assert res_appr.status_code == 200

        # ANNUAL available days is STILL 2!
        res_bal2 = client.get(
            f"/api/v1/leaves/balances/{emp1.id}?year=2026",
            headers=entitlement_test_data["employee_headers"],
        )
        ann2 = next(b for b in res_bal2.json()["balances"] if b["leave_type"] == "ANNUAL")
        assert ann2["available_days"] == 2
        unpaid_bal = next(b for b in res_bal2.json()["balances"] if b["leave_type"] == "UNPAID")
        assert unpaid_bal["used_days"] == 10
        assert unpaid_bal["is_enforced"] is False
    finally:
        app.dependency_overrides.clear()


def test_cross_year_leave_rejected_and_year_isolation(entitlement_test_data):
    """Leave requests spanning multiple calendar years are rejected (422),
    and entitlements in 2026 do not affect 2027 balances."""
    db = entitlement_test_data["db"]
    emp1 = entitlement_test_data["emp1"]
    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db

    try:
        # Cross-year request (2026-12-30 to 2027-01-04)
        res_cross = client.post(
            "/api/v1/leaves",
            json={
                "start_date": "2026-12-30",
                "end_date": "2027-01-04",
                "leave_type": "ANNUAL",
                "reason": "New Year vacation",
            },
            headers=entitlement_test_data["employee_headers"],
        )
        assert res_cross.status_code == 422
        assert "multiple calendar years" in res_cross.json()["detail"]

        # Configure 2026 = 10, 2027 = 20
        client.post(
            "/api/v1/leaves/entitlements/defaults",
            json={"year": 2026, "leave_type": "ANNUAL", "allocated_days": 10},
            headers=entitlement_test_data["admin_headers"],
        )
        client.post(
            "/api/v1/leaves/entitlements/defaults",
            json={"year": 2027, "leave_type": "ANNUAL", "allocated_days": 20},
            headers=entitlement_test_data["admin_headers"],
        )

        bal_2026 = client.get(
            f"/api/v1/leaves/balances/{emp1.id}?year=2026",
            headers=entitlement_test_data["employee_headers"],
        ).json()
        bal_2027 = client.get(
            f"/api/v1/leaves/balances/{emp1.id}?year=2027",
            headers=entitlement_test_data["employee_headers"],
        ).json()

        ann_2026 = next(b for b in bal_2026["balances"] if b["leave_type"] == "ANNUAL")
        ann_2027 = next(b for b in bal_2027["balances"] if b["leave_type"] == "ANNUAL")

        assert ann_2026["allocated_days"] == 10
        assert ann_2027["allocated_days"] == 20
    finally:
        app.dependency_overrides.clear()


def test_audit_logging_for_entitlements_and_ledger(entitlement_test_data):
    """Verify audit logs are recorded for entitlement changes and balance transactions."""
    db = entitlement_test_data["db"]
    emp1 = entitlement_test_data["emp1"]
    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db

    try:
        # Default creation audit
        client.post(
            "/api/v1/leaves/entitlements/defaults",
            json={"year": 2026, "leave_type": "CASUAL", "allocated_days": 8},
            headers=entitlement_test_data["admin_headers"],
        )

        logs = db.scalars(
            select(AuditLog).where(AuditLog.target_type == "leave_entitlement_default")
        ).all()
        assert any(l.action == "LEAVE_ENTITLEMENT_DEFAULT_CREATED" for l in logs)

        # Override creation audit
        client.post(
            "/api/v1/leaves/entitlements/overrides",
            json={"employee_id": emp1.id, "year": 2026, "leave_type": "CASUAL", "allocated_days": 12},
            headers=entitlement_test_data["admin_headers"],
        )

        ov_logs = db.scalars(
            select(AuditLog).where(AuditLog.target_type == "employee_leave_entitlement")
        ).all()
        assert any(l.action == "EMPLOYEE_LEAVE_ENTITLEMENT_OVERRIDE_CREATED" for l in ov_logs)

        # Balance reservation audit
        res_sub = client.post(
            "/api/v1/leaves",
            json={
                "start_date": "2026-09-07",
                "end_date": "2026-09-08",
                "leave_type": "CASUAL",
                "reason": "Personal work",
            },
            headers=entitlement_test_data["employee_headers"],
        )
        assert res_sub.status_code == 201

        res_logs = db.scalars(
            select(AuditLog).where(AuditLog.action == "LEAVE_BALANCE_RESERVED")
        ).all()
        assert len(res_logs) >= 1
    finally:
        app.dependency_overrides.clear()


def test_reservation_released_even_if_entitlement_deleted_while_pending(entitlement_test_data):
    """When an entitlement is deleted while a request is pending, rejection/cancellation must still release the reservation."""
    db = entitlement_test_data["db"]
    emp1 = entitlement_test_data["emp1"]
    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db

    try:
        # 1. Admin configures default
        res_def = client.post(
            "/api/v1/leaves/entitlements/defaults",
            json={"year": 2026, "leave_type": "ANNUAL", "allocated_days": 15},
            headers=entitlement_test_data["admin_headers"],
        )
        assert res_def.status_code == 200
        default_id = res_def.json()["id"]

        # 2. Employee submits 3 working days (Mon-Wed)
        res_sub = client.post(
            "/api/v1/leaves",
            json={
                "start_date": "2026-10-05",
                "end_date": "2026-10-07",
                "leave_type": "ANNUAL",
                "reason": "Fall break",
            },
            headers=entitlement_test_data["employee_headers"],
        )
        assert res_sub.status_code == 201
        req_id = res_sub.json()["id"]

        # Verify RESERVATION in ledger
        res_entry = db.scalar(
            select(LeaveBalanceLedger).where(
                LeaveBalanceLedger.leave_request_id == req_id,
                LeaveBalanceLedger.transaction_type == "RESERVATION",
            )
        )
        assert res_entry is not None
        assert res_entry.days == 3

        # 3. Admin deletes the default entitlement
        res_del = client.delete(
            f"/api/v1/leaves/entitlements/defaults/{default_id}",
            headers=entitlement_test_data["admin_headers"],
        )
        assert res_del.status_code == 204

        # 4. Manager rejects the pending request
        res_rev = client.post(
            f"/api/v1/leaves/{req_id}/review",
            json={"decision": "REJECTED", "decision_notes": "Cancelled program"},
            headers=entitlement_test_data["manager_headers"],
        )
        assert res_rev.status_code == 200
        assert res_rev.json()["status"] == "REJECTED"

        # 5. Verify exactly one RESERVATION_RELEASE in ledger
        rel_entries = db.scalars(
            select(LeaveBalanceLedger).where(
                LeaveBalanceLedger.leave_request_id == req_id,
                LeaveBalanceLedger.transaction_type == "RESERVATION_RELEASE",
            )
        ).all()
        assert len(rel_entries) == 1
        assert rel_entries[0].days == 3
    finally:
        app.dependency_overrides.clear()


def test_no_phantom_release_when_entitlement_configured_after_submission(entitlement_test_data):
    """When a request was submitted without an entitlement (unconstrained), no phantom release is created upon rejection."""
    db = entitlement_test_data["db"]
    emp1 = entitlement_test_data["emp1"]
    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db

    try:
        # 1. Submit SICK leave with no entitlement configured for SICK
        res_sub = client.post(
            "/api/v1/leaves",
            json={
                "start_date": "2026-11-02",
                "end_date": "2026-11-03",
                "leave_type": "SICK",
                "reason": "Doctor visit",
            },
            headers=entitlement_test_data["employee_headers"],
        )
        assert res_sub.status_code == 201
        req_id = res_sub.json()["id"]

        # Confirm NO reservation in ledger
        res_entry = db.scalar(
            select(LeaveBalanceLedger).where(
                LeaveBalanceLedger.leave_request_id == req_id,
                LeaveBalanceLedger.transaction_type == "RESERVATION",
            )
        )
        assert res_entry is None

        # 2. Admin now configures a default for SICK leave
        client.post(
            "/api/v1/leaves/entitlements/defaults",
            json={"year": 2026, "leave_type": "SICK", "allocated_days": 10},
            headers=entitlement_test_data["admin_headers"],
        )

        # 3. Manager rejects the request
        res_rev = client.post(
            f"/api/v1/leaves/{req_id}/review",
            json={"decision": "REJECTED", "decision_notes": "Not needed"},
            headers=entitlement_test_data["manager_headers"],
        )
        assert res_rev.status_code == 200

        # 4. Verify NO phantom RESERVATION_RELEASE in ledger
        rel_entries = db.scalars(
            select(LeaveBalanceLedger).where(
                LeaveBalanceLedger.leave_request_id == req_id,
            )
        ).all()
        assert len(rel_entries) == 0
    finally:
        app.dependency_overrides.clear()


def test_normal_reservation_release_on_cancellation(entitlement_test_data):
    """Verify normal reservation release on employee pending cancellation, and consumption release on approved cancellation."""
    db = entitlement_test_data["db"]
    emp1 = entitlement_test_data["emp1"]
    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db

    try:
        client.post(
            "/api/v1/leaves/entitlements/defaults",
            json={"year": 2026, "leave_type": "CASUAL", "allocated_days": 10},
            headers=entitlement_test_data["admin_headers"],
        )

        # 1. Pending cancellation releases reservation
        res1 = client.post(
            "/api/v1/leaves",
            json={"start_date": "2026-11-09", "end_date": "2026-11-10", "leave_type": "CASUAL", "reason": "Trip"},
            headers=entitlement_test_data["employee_headers"],
        )
        req1_id = res1.json()["id"]

        client.post(f"/api/v1/leaves/{req1_id}/cancel", headers=entitlement_test_data["employee_headers"])

        rel1 = db.scalars(
            select(LeaveBalanceLedger).where(
                LeaveBalanceLedger.leave_request_id == req1_id,
                LeaveBalanceLedger.transaction_type == "RESERVATION_RELEASE",
            )
        ).all()
        assert len(rel1) == 1
        assert rel1[0].days == 2

        # 2. Approved cancellation releases consumption
        res2 = client.post(
            "/api/v1/leaves",
            json={"start_date": "2026-11-16", "end_date": "2026-11-17", "leave_type": "CASUAL", "reason": "Another trip"},
            headers=entitlement_test_data["employee_headers"],
        )
        req2_id = res2.json()["id"]

        # Approve
        client.post(
            f"/api/v1/leaves/{req2_id}/review",
            json={"decision": "APPROVED", "decision_notes": "OK"},
            headers=entitlement_test_data["manager_headers"],
        )
        # Cancel as Manager/Admin
        client.post(f"/api/v1/leaves/{req2_id}/cancel", headers=entitlement_test_data["manager_headers"])

        cons_rel = db.scalars(
            select(LeaveBalanceLedger).where(
                LeaveBalanceLedger.leave_request_id == req2_id,
                LeaveBalanceLedger.transaction_type == "CONSUMPTION_RELEASE",
            )
        ).all()
        assert len(cons_rel) == 1
        assert cons_rel[0].days == 2
    finally:
        app.dependency_overrides.clear()


def test_duplicate_release_prevention(entitlement_test_data):
    """Verify idempotency: duplicate release rows cannot be inserted for the same request."""
    db = entitlement_test_data["db"]
    emp1 = entitlement_test_data["emp1"]
    client = TestClient(app)
    app.dependency_overrides[get_db] = lambda: db

    try:
        client.post(
            "/api/v1/leaves/entitlements/defaults",
            json={"year": 2026, "leave_type": "CASUAL", "allocated_days": 10},
            headers=entitlement_test_data["admin_headers"],
        )

        res1 = client.post(
            "/api/v1/leaves",
            json={"start_date": "2026-12-01", "end_date": "2026-12-02", "leave_type": "CASUAL", "reason": "Break"},
            headers=entitlement_test_data["employee_headers"],
        )
        req1_id = res1.json()["id"]

        # Reject once
        res_rej = client.post(
            f"/api/v1/leaves/{req1_id}/review",
            json={"decision": "REJECTED", "decision_notes": "No"},
            headers=entitlement_test_data["manager_headers"],
        )
        assert res_rej.status_code == 200

        # Attempt to review or cancel again - should be rejected by state machine
        res_dup = client.post(
            f"/api/v1/leaves/{req1_id}/review",
            json={"decision": "REJECTED", "decision_notes": "No again"},
            headers=entitlement_test_data["manager_headers"],
        )
        assert res_dup.status_code == 409

        res_dup_cancel = client.post(
            f"/api/v1/leaves/{req1_id}/cancel",
            headers=entitlement_test_data["manager_headers"],
        )
        assert res_dup_cancel.status_code == 409

        # Ensure exactly one release row in ledger
        releases = db.scalars(
            select(LeaveBalanceLedger).where(
                LeaveBalanceLedger.leave_request_id == req1_id,
                LeaveBalanceLedger.transaction_type == "RESERVATION_RELEASE",
            )
        ).all()
        assert len(releases) == 1
    finally:
        app.dependency_overrides.clear()
