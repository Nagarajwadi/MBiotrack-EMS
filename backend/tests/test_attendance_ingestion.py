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
from app.models.audit_log import AuditLog
from app.models.device import Device
from app.models.employee import Employee
from app.models.office import EmployeeOfficeAssignment, Office
from app.models.user import User

settings = get_settings()


@pytest.fixture
def dev_db_session():
    """Provide a database session targeting mbiotrack_dev isolated in a transaction savepoint.

    All operations are rolled back on fixture teardown, guaranteeing zero persisted test data.
    """
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
    """FastAPI TestClient with get_db overridden to use dev_db_session."""
    def override_get_db():
        yield dev_db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def admin_user(dev_db_session: Session) -> User:
    user = dev_db_session.scalar(
        select(User).where(User.role == "ADMIN", User.is_active.is_(True))
    )
    assert user is not None, "mbiotrack_dev must contain an active ADMIN user"
    return user


@pytest.fixture
def admin_headers(admin_user: User) -> dict[str, str]:
    token = create_access_token(
        subject=admin_user.id,
        extra_claims={"role": admin_user.role},
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def test_setup(dev_db_session: Session):
    """Create test office, device, employees, and users for attendance punch tests."""
    # 1. Office A & Office B
    office_a = Office(
        name="Bengaluru Headquarters",
        code="BLR-HQ",
        timezone="Asia/Kolkata",
        address="100 Tech Park, Bengaluru",
        is_active=True,
    )
    office_b = Office(
        name="Mumbai Regional Hub",
        code="MUM-HUB",
        timezone="Asia/Kolkata",
        address="200 Marine Drive, Mumbai",
        is_active=True,
    )
    dev_db_session.add_all([office_a, office_b])
    dev_db_session.flush()

    # 2. Devices for each office
    device_a = Device(
        office_id=office_a.id,
        name="Front Lobby Turnstile",
        device_code="BIO-BLR-01",
        serial_number="SN-BLR-998811",
        model_name="BioEntry-W2",
        status="ACTIVE",
        is_active=True,
    )
    device_b = Device(
        office_id=office_b.id,
        name="Mumbai Gateway",
        device_code="BIO-MUM-01",
        serial_number="SN-MUM-112233",
        model_name="BioEntry-W2",
        status="ACTIVE",
        is_active=True,
    )
    dev_db_session.add_all([device_a, device_b])
    dev_db_session.flush()

    # 3. Employee 1 (Assigned to Office A)
    emp_1 = Employee(
        employee_code="EMP-ATT-001",
        first_name="Alice",
        last_name="Puncher",
        email="alice.puncher@example.com",
        department="Engineering",
        designation="Software Engineer",
        joining_date=date(2025, 1, 15),
        is_active=True,
    )
    # Employee 2 (Assigned to Office B)
    emp_2 = Employee(
        employee_code="EMP-ATT-002",
        first_name="Bob",
        last_name="Rambler",
        email="bob.rambler@example.com",
        department="Operations",
        designation="Operations Lead",
        joining_date=date(2025, 2, 1),
        is_active=True,
    )
    dev_db_session.add_all([emp_1, emp_2])
    dev_db_session.flush()

    # 4. User accounts for employees
    user_emp_1 = User(
        employee_id=emp_1.id,
        full_name="Alice Puncher",
        email="alice.puncher@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="EMPLOYEE",
        is_active=True,
    )
    user_emp_2 = User(
        employee_id=emp_2.id,
        full_name="Bob Rambler",
        email="bob.rambler@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="EMPLOYEE",
        is_active=True,
    )
    dev_db_session.add_all([user_emp_1, user_emp_2])
    dev_db_session.flush()

    # 5. Office assignment for Employee 1 in Office A covering present
    now = datetime.now(timezone.utc)
    t1 = now - timedelta(days=30)
    t2 = now + timedelta(days=365)
    assign_1 = EmployeeOfficeAssignment(
        employee_id=emp_1.id,
        office_id=office_a.id,
        validity_range=Range(t1, t2, bounds="[)"),
        is_primary=True,
    )
    dev_db_session.add(assign_1)
    dev_db_session.flush()

    return {
        "office_a": office_a,
        "office_b": office_b,
        "device_a": device_a,
        "device_b": device_b,
        "emp_1": emp_1,
        "emp_2": emp_2,
        "user_emp_1": user_emp_1,
        "user_emp_2": user_emp_2,
    }


def _auth_headers_for(user: User) -> dict[str, str]:
    token = create_access_token(
        subject=user.id,
        extra_claims={"role": user.role},
    )
    return {"Authorization": f"Bearer {token}"}


# ============================================================================
# 1. VALID PUNCH INGESTION & ROAMING EVALUATION
# ============================================================================

def test_valid_in_assignment_punch_ingestion(dev_client: TestClient, test_setup, dev_db_session: Session):
    """Employee punches at assigned office device; recorded as in-assignment with audit log."""
    user = test_setup["user_emp_1"]
    device = test_setup["device_a"]
    headers = _auth_headers_for(user)

    payload = {
        "device_id": device.id,
        "punch_type": "CHECK_IN",
    }
    resp = dev_client.post("/api/v1/attendance/punch", json=payload, headers=headers)
    assert resp.status_code == 201
    data = resp.json()

    assert data["id"] > 0
    assert data["employee_id"] == test_setup["emp_1"].id
    assert data["device_id"] == device.id
    assert data["office_id"] == test_setup["office_a"].id
    assert data["punch_type"] == "CHECK_IN"
    assert data["is_roaming"] is False
    assert "In-assignment" in data["notes"]
    assert data["actor_user_id"] == user.id

    # Verify atomic AuditLog record
    audit = dev_db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "ATTENDANCE_PUNCH_RECORDED",
            AuditLog.target_id == str(data["id"]),
        )
    )
    assert audit is not None
    assert audit.actor_user_id == user.id
    assert audit.after_state["is_roaming"] is False
    assert audit.after_state["punch_type"] == "CHECK_IN"


def test_valid_out_of_assignment_roaming_punch_ingestion(dev_client: TestClient, test_setup, dev_db_session: Session):
    """Employee punches at unassigned office device; flagged is_roaming=True under GOV-08."""
    user = test_setup["user_emp_1"]
    # Device B is in Office B, but Employee 1 is only assigned to Office A
    device_b = test_setup["device_b"]
    headers = _auth_headers_for(user)

    payload = {
        "device_id": device_b.id,
        "punch_type": "CHECK_IN",
    }
    resp = dev_client.post("/api/v1/attendance/punch", json=payload, headers=headers)
    assert resp.status_code == 201
    data = resp.json()

    assert data["id"] > 0
    assert data["employee_id"] == test_setup["emp_1"].id
    assert data["device_id"] == device_b.id
    assert data["office_id"] == test_setup["office_b"].id
    assert data["is_roaming"] is True
    assert "GOV-08" in data["notes"]

    # Verify audit telemetry explicitly flags roaming status
    audit = dev_db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "ATTENDANCE_PUNCH_RECORDED",
            AuditLog.target_id == str(data["id"]),
        )
    )
    assert audit is not None
    assert audit.after_state["is_roaming"] is True


def test_admin_manual_punch_for_employee(dev_client: TestClient, test_setup, admin_headers):
    """Admin records a punch on behalf of any employee."""
    emp_2 = test_setup["emp_2"]
    device_b = test_setup["device_b"]

    payload = {
        "employee_id": emp_2.id,
        "device_id": device_b.id,
        "punch_type": "CHECK_OUT",
    }
    resp = dev_client.post("/api/v1/attendance/punch", json=payload, headers=admin_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["employee_id"] == emp_2.id
    assert data["punch_type"] == "CHECK_OUT"


# ============================================================================
# 2. ROLE AUTHORIZATION & ACTOR SPOOFING PREVENTION
# ============================================================================

def test_employee_cannot_punch_for_another_employee(dev_client: TestClient, test_setup):
    """Employees attempting to punch with another employee's ID receive 403 Forbidden."""
    user_1 = test_setup["user_emp_1"]
    emp_2 = test_setup["emp_2"]
    device_a = test_setup["device_a"]
    headers = _auth_headers_for(user_1)

    payload = {
        "employee_id": emp_2.id,  # Spoofed employee ID
        "device_id": device_a.id,
        "punch_type": "CHECK_IN",
    }
    resp = dev_client.post("/api/v1/attendance/punch", json=payload, headers=headers)
    assert resp.status_code == 403
    assert "only authorized to record punches for themselves" in resp.json()["detail"]


def test_unauthenticated_punch_returns_401(dev_client: TestClient, test_setup):
    """Unauthenticated requests are rejected with 401 Unauthorized."""
    payload = {
        "device_id": test_setup["device_a"].id,
        "punch_type": "CHECK_IN",
    }
    resp = dev_client.post("/api/v1/attendance/punch", json=payload)
    assert resp.status_code == 401


# ============================================================================
# 3. ENTITY VALIDATION (INACTIVE / DELETED / MISSING)
# ============================================================================

def test_punch_with_nonexistent_device_returns_404(dev_client: TestClient, test_setup, admin_headers):
    """Punch at non-existent device returns 404 Not Found."""
    payload = {
        "employee_id": test_setup["emp_1"].id,
        "device_id": 999999,
        "punch_type": "CHECK_IN",
    }
    resp = dev_client.post("/api/v1/attendance/punch", json=payload, headers=admin_headers)
    assert resp.status_code == 404
    assert "Device not found" in resp.json()["detail"]


def test_punch_with_inactive_device_rejected(dev_client: TestClient, test_setup, admin_headers, dev_db_session: Session):
    """Punch at inactive or decommissioned device is rejected with 422."""
    device = test_setup["device_a"]
    device.status = "DECOMMISSIONED"
    device.is_active = False
    dev_db_session.flush()

    payload = {
        "employee_id": test_setup["emp_1"].id,
        "device_id": device.id,
        "punch_type": "CHECK_IN",
    }
    resp = dev_client.post("/api/v1/attendance/punch", json=payload, headers=admin_headers)
    assert resp.status_code == 422
    assert "Device is not active" in resp.json()["detail"]


def test_punch_with_inactive_employee_rejected(dev_client: TestClient, test_setup, admin_headers, dev_db_session: Session):
    """Punch for deactivated employee is rejected with 422."""
    emp = test_setup["emp_1"]
    emp.is_active = False
    emp.deleted_at = datetime.now(timezone.utc)
    dev_db_session.flush()

    payload = {
        "employee_id": emp.id,
        "device_id": test_setup["device_a"].id,
        "punch_type": "CHECK_IN",
    }
    resp = dev_client.post("/api/v1/attendance/punch", json=payload, headers=admin_headers)
    assert resp.status_code == 422
    assert "Employee is inactive or deleted" in resp.json()["detail"]


def test_punch_with_inactive_office_rejected(dev_client: TestClient, test_setup, admin_headers, dev_db_session: Session):
    """Punch at device whose office is inactive is rejected with 422."""
    office = test_setup["office_a"]
    office.is_active = False
    dev_db_session.flush()

    payload = {
        "employee_id": test_setup["emp_1"].id,
        "device_id": test_setup["device_a"].id,
        "punch_type": "CHECK_IN",
    }
    resp = dev_client.post("/api/v1/attendance/punch", json=payload, headers=admin_headers)
    assert resp.status_code == 422
    assert "Office associated with device is inactive" in resp.json()["detail"]


# ============================================================================
# 4. DUPLICATE & IDEMPOTENCY PROTECTION
# ============================================================================

def test_idempotent_submission_duplicate_rejected(dev_client: TestClient, test_setup):
    """Duplicate submission with same idempotency key is rejected with 409 Conflict."""
    user = test_setup["user_emp_1"]
    device = test_setup["device_a"]
    headers = _auth_headers_for(user)

    payload = {
        "device_id": device.id,
        "punch_type": "CHECK_IN",
        "idempotency_key": "unique-kiosk-token-8877",
    }
    # First submission succeeds
    resp1 = dev_client.post("/api/v1/attendance/punch", json=payload, headers=headers)
    assert resp1.status_code == 201

    # Second submission with same key is rejected with 409 Conflict
    resp2 = dev_client.post("/api/v1/attendance/punch", json=payload, headers=headers)
    assert resp2.status_code == 409
    assert "Duplicate punch submission" in resp2.json()["detail"]


def test_natural_duplicate_punch_rejected(dev_client: TestClient, test_setup):
    """Identical punch (same employee, device, type, timestamp) is rejected with 409 Conflict."""
    user = test_setup["user_emp_1"]
    device = test_setup["device_a"]
    headers = _auth_headers_for(user)
    punch_time = datetime(2026, 11, 5, 9, 0, 0, tzinfo=timezone.utc).isoformat()

    payload = {
        "device_id": device.id,
        "punch_type": "CHECK_IN",
        "punch_time": punch_time,
    }
    resp1 = dev_client.post("/api/v1/attendance/punch", json=payload, headers=headers)
    assert resp1.status_code == 201

    resp2 = dev_client.post("/api/v1/attendance/punch", json=payload, headers=headers)
    assert resp2.status_code == 409
    assert "Duplicate punch" in resp2.json()["detail"]


# ============================================================================
# 5. INPUT & TIMESTAMP VALIDATION
# ============================================================================

def test_future_punch_timestamp_rejected(dev_client: TestClient, test_setup):
    """Punch timestamp more than 5 minutes in future is rejected with 422."""
    user = test_setup["user_emp_1"]
    device = test_setup["device_a"]
    headers = _auth_headers_for(user)

    future_time = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    payload = {
        "device_id": device.id,
        "punch_type": "CHECK_IN",
        "punch_time": future_time,
    }
    resp = dev_client.post("/api/v1/attendance/punch", json=payload, headers=headers)
    assert resp.status_code == 422
    assert "future" in str(resp.json())


def test_invalid_punch_type_rejected(dev_client: TestClient, test_setup):
    """Invalid punch type is rejected with 422."""
    user = test_setup["user_emp_1"]
    device = test_setup["device_a"]
    headers = _auth_headers_for(user)

    payload = {
        "device_id": device.id,
        "punch_type": "BAD_PUNCH_TYPE",
    }
    resp = dev_client.post("/api/v1/attendance/punch", json=payload, headers=headers)
    assert resp.status_code == 422


# ============================================================================
# 6. READ-ONLY ATTENDANCE VIEWS & ROLE-BASED SCOPING (SLICE 5)
# ============================================================================

def test_employee_attendance_query_scoped_to_self(dev_client: TestClient, test_setup, dev_db_session: Session):
    """Employee query returns only their own records, automatically scoped."""
    user_1 = test_setup["user_emp_1"]
    emp_1 = test_setup["emp_1"]
    emp_2 = test_setup["emp_2"]
    device_a = test_setup["device_a"]
    headers_1 = _auth_headers_for(user_1)

    # Ingest punch for emp 1
    p1 = AttendanceEvent(
        employee_id=emp_1.id,
        device_id=device_a.id,
        office_id=test_setup["office_a"].id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 5, 8, 30, tzinfo=timezone.utc),
        is_roaming=False,
        actor_user_id=user_1.id,
    )
    # Ingest punch for emp 2
    p2 = AttendanceEvent(
        employee_id=emp_2.id,
        device_id=device_a.id,
        office_id=test_setup["office_a"].id,
        punch_type="CHECK_IN",
        event_timestamp=datetime(2026, 11, 5, 8, 45, tzinfo=timezone.utc),
        is_roaming=True,
        actor_user_id=user_1.id,
    )
    dev_db_session.add_all([p1, p2])
    dev_db_session.flush()

    # Employee 1 queries /api/v1/attendance
    resp = dev_client.get("/api/v1/attendance", headers=headers_1)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert len(data["items"]) == 1
    item = data["items"][0]
    assert item["employee_id"] == emp_1.id
    assert item["employee_code"] == emp_1.employee_code
    assert item["employee_name"] == f"{emp_1.first_name} {emp_1.last_name}"
    assert item["office_name"] == test_setup["office_a"].name
    assert item["device_name"] == device_a.name


def test_employee_forbidden_from_querying_other_employee_attendance(dev_client: TestClient, test_setup):
    """Employee specifying another employee_id in query receives 403 Forbidden."""
    user_1 = test_setup["user_emp_1"]
    emp_2 = test_setup["emp_2"]
    headers_1 = _auth_headers_for(user_1)

    resp = dev_client.get(f"/api/v1/attendance?employee_id={emp_2.id}", headers=headers_1)
    assert resp.status_code == 403
    assert "Employees may only query their own attendance records" in resp.json()["detail"]


def test_manager_and_admin_attendance_query_and_filters(dev_client: TestClient, test_setup, dev_db_session: Session, admin_headers):
    """Manager and Admin can query attendance records across employees with filters."""
    emp_1 = test_setup["emp_1"]
    emp_2 = test_setup["emp_2"]
    device_a = test_setup["device_a"]
    device_b = test_setup["device_b"]
    office_a = test_setup["office_a"]
    office_b = test_setup["office_b"]
    user_1 = test_setup["user_emp_1"]

    # Create manager user
    mgr_emp = Employee(
        employee_code="MGR-ATT-099",
        first_name="Monique",
        last_name="Manager",
        email="monique.mgr@example.com",
        department="Operations",
        designation="Operations Manager",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    dev_db_session.add(mgr_emp)
    dev_db_session.flush()

    mgr_user = User(
        employee_id=mgr_emp.id,
        full_name="Monique Manager",
        email="monique.mgr@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="MANAGER",
        is_active=True,
    )
    dev_db_session.add(mgr_user)
    dev_db_session.flush()
    mgr_headers = _auth_headers_for(mgr_user)

    # Seed events
    t_base = datetime(2026, 11, 5, 9, 0, tzinfo=timezone.utc)
    e1 = AttendanceEvent(
        employee_id=emp_1.id,
        device_id=device_a.id,
        office_id=office_a.id,
        punch_type="CHECK_IN",
        event_timestamp=t_base,
        is_roaming=False,
        actor_user_id=mgr_user.id,
    )
    e2 = AttendanceEvent(
        employee_id=emp_1.id,
        device_id=device_a.id,
        office_id=office_a.id,
        punch_type="CHECK_OUT",
        event_timestamp=t_base + timedelta(hours=8),
        is_roaming=False,
        actor_user_id=mgr_user.id,
    )
    e3 = AttendanceEvent(
        employee_id=emp_2.id,
        device_id=device_b.id,
        office_id=office_b.id,
        punch_type="CHECK_IN",
        event_timestamp=t_base + timedelta(hours=1),
        is_roaming=True,
        actor_user_id=mgr_user.id,
    )
    dev_db_session.add_all([e1, e2, e3])
    dev_db_session.flush()

    # Manager queries all
    res_mgr = dev_client.get("/api/v1/attendance", headers=mgr_headers)
    assert res_mgr.status_code == 200
    assert res_mgr.json()["total"] == 3

    # Manager filters by employee 1
    res_emp1 = dev_client.get(f"/api/v1/attendance?employee_id={emp_1.id}", headers=mgr_headers)
    assert res_emp1.status_code == 200
    assert res_emp1.json()["total"] == 2

    # Admin filters by punch_type=CHECK_OUT
    res_out = dev_client.get("/api/v1/attendance?punch_type=CHECK_OUT", headers=admin_headers)
    assert res_out.status_code == 200
    assert res_out.json()["total"] == 1
    assert res_out.json()["items"][0]["punch_type"] == "CHECK_OUT"

    # Admin filters by is_roaming=true
    res_roam = dev_client.get("/api/v1/attendance?is_roaming=true", headers=admin_headers)
    assert res_roam.status_code == 200
    assert res_roam.json()["total"] == 1
    assert res_roam.json()["items"][0]["is_roaming"] is True
    assert res_roam.json()["items"][0]["employee_id"] == emp_2.id

    # Admin filters by office_id=office_a.id
    res_off = dev_client.get(f"/api/v1/attendance?office_id={office_a.id}", headers=admin_headers)
    assert res_off.status_code == 200
    assert res_off.json()["total"] == 2

    # Date range filter
    start_str = (t_base + timedelta(minutes=30)).isoformat()
    res_date = dev_client.get(f"/api/v1/attendance?start_date={start_str}", headers=admin_headers)
    assert res_date.status_code == 200
    assert res_date.json()["total"] == 2  # e2 and e3

    # Pagination test: limit 1, offset 1
    res_page = dev_client.get("/api/v1/attendance?limit=1&offset=1", headers=admin_headers)
    assert res_page.status_code == 200
    page_data = res_page.json()
    assert page_data["total"] == 3
    assert len(page_data["items"]) == 1
    assert page_data["limit"] == 1
    assert page_data["offset"] == 1


def test_attendance_empty_results(dev_client: TestClient, admin_headers):
    """Query matching no events returns empty envelope without error."""
    resp = dev_client.get("/api/v1/attendance?employee_id=888888", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["items"] == []
