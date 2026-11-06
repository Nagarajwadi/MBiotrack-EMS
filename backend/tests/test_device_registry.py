import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.session import get_db
from app.main import app
from app.models.audit_log import AuditLog
from app.models.device import Device
from app.models.office import Office
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
def admin_user(dev_db_session) -> User:
    user = dev_db_session.scalar(select(User).where(User.role == "ADMIN", User.is_active.is_(True)))
    assert user is not None, "mbiotrack_dev must contain an active ADMIN user"
    return user


@pytest.fixture
def manager_user(dev_db_session) -> User:
    user = dev_db_session.scalar(select(User).where(User.role == "MANAGER", User.is_active.is_(True)))
    assert user is not None, "mbiotrack_dev must contain an active MANAGER user"
    return user


@pytest.fixture
def employee_user(dev_db_session) -> User:
    user = dev_db_session.scalar(select(User).where(User.role == "EMPLOYEE", User.is_active.is_(True)))
    assert user is not None, "mbiotrack_dev must contain an active EMPLOYEE user"
    return user


@pytest.fixture
def admin_headers(admin_user: User) -> dict[str, str]:
    token = create_access_token(subject=admin_user.id, extra_claims={"role": admin_user.role})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def manager_headers(manager_user: User) -> dict[str, str]:
    token = create_access_token(subject=manager_user.id, extra_claims={"role": manager_user.role})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def employee_headers(employee_user: User) -> dict[str, str]:
    token = create_access_token(subject=employee_user.id, extra_claims={"role": employee_user.role})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def test_office(dev_db_session) -> Office:
    off = Office(name="Bengaluru Central", code="BLR-CENTRAL", timezone="Asia/Kolkata", is_active=True)
    dev_db_session.add(off)
    dev_db_session.flush()
    return off


# ============================================================================
# 1. DEVICE CREATION & DUPLICATE REJECTION TESTS
# ============================================================================

def test_admin_create_device_success(dev_client, admin_headers, test_office, dev_db_session):
    payload = {
        "office_id": test_office.id,
        "name": "Front Gate Biometric Terminal",
        "device_code": "DEV-GATE-01",
        "serial_number": "SN-GATE-2026-001",
        "model_name": "BioEntry W2",
        "ip_address": "192.168.1.100",
        "mac_address": "00:1A:2B:3C:4D:5E",
        "status": "ACTIVE",
        "is_active": True,
    }
    response = dev_client.post("/api/v1/devices", json=payload, headers=admin_headers)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Front Gate Biometric Terminal"
    assert data["device_code"] == "DEV-GATE-01"
    assert data["serial_number"] == "SN-GATE-2026-001"
    assert data["office_id"] == test_office.id
    assert data["status"] == "ACTIVE"
    assert data["is_active"] is True
    assert "id" in data

    # Verify audit log creation
    audit = dev_db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "DEVICE_CREATE",
            AuditLog.target_id == str(data["id"]),
        )
    )
    assert audit is not None
    assert audit.target_type == "device"


def test_device_duplicate_device_code_rejected(dev_client, admin_headers, test_office):
    payload = {
        "office_id": test_office.id,
        "name": "Entrance Terminal",
        "device_code": "DEV-DUP-01",
        "serial_number": "SN-DUP-001",
    }
    res1 = dev_client.post("/api/v1/devices", json=payload, headers=admin_headers)
    assert res1.status_code == 201

    # Exact duplicate code
    res2 = dev_client.post(
        "/api/v1/devices",
        json={**payload, "serial_number": "SN-DUP-002"},
        headers=admin_headers,
    )
    assert res2.status_code == 409
    assert "code already exists" in res2.json()["detail"].lower()

    # Case-insensitive duplicate code: "dev-dup-01"
    res3 = dev_client.post(
        "/api/v1/devices",
        json={**payload, "device_code": "dev-dup-01", "serial_number": "SN-DUP-003"},
        headers=admin_headers,
    )
    assert res3.status_code == 409
    assert "code already exists" in res3.json()["detail"].lower()


def test_device_duplicate_serial_number_rejected(dev_client, admin_headers, test_office):
    payload = {
        "office_id": test_office.id,
        "name": "Turnstile Terminal",
        "device_code": "DEV-SN-01",
        "serial_number": "SN-SHARED-999",
    }
    res1 = dev_client.post("/api/v1/devices", json=payload, headers=admin_headers)
    assert res1.status_code == 201

    # Exact duplicate serial
    res2 = dev_client.post(
        "/api/v1/devices",
        json={**payload, "device_code": "DEV-SN-02"},
        headers=admin_headers,
    )
    assert res2.status_code == 409
    assert "serial number already exists" in res2.json()["detail"].lower()

    # Case-insensitive duplicate serial: "sn-shared-999"
    res3 = dev_client.post(
        "/api/v1/devices",
        json={**payload, "device_code": "DEV-SN-03", "serial_number": "sn-shared-999"},
        headers=admin_headers,
    )
    assert res3.status_code == 409
    assert "serial number already exists" in res3.json()["detail"].lower()


# ============================================================================
# 2. VALIDATION & OFFICE RELATIONSHIP TESTS
# ============================================================================

def test_device_office_relationship_validation(dev_client, admin_headers, dev_db_session):
    inactive_office = Office(name="Closed Office", code="CLOSED-01", timezone="Asia/Kolkata", is_active=False)
    dev_db_session.add(inactive_office)
    dev_db_session.flush()

    # Inactive office rejection (400)
    p_inactive = {
        "office_id": inactive_office.id,
        "name": "Terminal in Closed Office",
        "device_code": "DEV-INACT-01",
        "serial_number": "SN-INACT-001",
    }
    res_inact = dev_client.post("/api/v1/devices", json=p_inactive, headers=admin_headers)
    assert res_inact.status_code == 400
    assert "inactive office" in res_inact.json()["detail"].lower()

    # Non-existent office rejection (404)
    p_nonexistent = {
        "office_id": 999999,
        "name": "Terminal in Phantom Office",
        "device_code": "DEV-PHANTOM-01",
        "serial_number": "SN-PHANTOM-001",
    }
    res_nonexistent = dev_client.post("/api/v1/devices", json=p_nonexistent, headers=admin_headers)
    assert res_nonexistent.status_code == 404
    assert "office not found" in res_nonexistent.json()["detail"].lower()


def test_device_input_validation(dev_client, admin_headers, test_office):
    # Invalid MAC address format (422)
    p_bad_mac = {
        "office_id": test_office.id,
        "name": "Bad MAC Terminal",
        "device_code": "DEV-BAD-MAC",
        "serial_number": "SN-BAD-MAC",
        "mac_address": "NOT-A-MAC-ADDRESS",
    }
    res_mac = dev_client.post("/api/v1/devices", json=p_bad_mac, headers=admin_headers)
    assert res_mac.status_code == 422

    # Invalid status value (422)
    p_bad_status = {
        "office_id": test_office.id,
        "name": "Bad Status Terminal",
        "device_code": "DEV-BAD-STAT",
        "serial_number": "SN-BAD-STAT",
        "status": "EXPLODED",
    }
    res_status = dev_client.post("/api/v1/devices", json=p_bad_status, headers=admin_headers)
    assert res_status.status_code == 422


# ============================================================================
# 3. RBAC & LIST/RETRIEVAL TESTS
# ============================================================================

def test_device_rbac_permissions(dev_client, admin_headers, manager_headers, employee_headers, test_office):
    payload = {
        "office_id": test_office.id,
        "name": "RBAC Test Terminal",
        "device_code": "DEV-RBAC-01",
        "serial_number": "SN-RBAC-001",
    }

    # Manager cannot create device (403)
    res_mgr_create = dev_client.post("/api/v1/devices", json=payload, headers=manager_headers)
    assert res_mgr_create.status_code == 403

    # Employee cannot create device (403)
    res_emp_create = dev_client.post("/api/v1/devices", json=payload, headers=employee_headers)
    assert res_emp_create.status_code == 403

    # Admin creates device
    res_admin_create = dev_client.post("/api/v1/devices", json=payload, headers=admin_headers)
    assert res_admin_create.status_code == 201
    dev_id = res_admin_create.json()["id"]

    # All authenticated users can list devices
    assert dev_client.get("/api/v1/devices", headers=employee_headers).status_code == 200
    assert dev_client.get("/api/v1/devices", headers=manager_headers).status_code == 200
    assert dev_client.get(f"/api/v1/devices/{dev_id}", headers=employee_headers).status_code == 200

    # Manager and Employee cannot update device (403)
    assert dev_client.patch(f"/api/v1/devices/{dev_id}", json={"name": "New"}, headers=manager_headers).status_code == 403
    assert dev_client.patch(f"/api/v1/devices/{dev_id}", json={"name": "New"}, headers=employee_headers).status_code == 403

    # Manager and Employee cannot decommission or delete (403)
    assert dev_client.post(f"/api/v1/devices/{dev_id}/decommission", headers=manager_headers).status_code == 403
    assert dev_client.delete(f"/api/v1/devices/{dev_id}", headers=employee_headers).status_code == 403


def test_device_list_filtering(dev_client, admin_headers, dev_db_session):
    off1 = Office(name="Filter Office 1", code="FO-1", timezone="Asia/Kolkata")
    off2 = Office(name="Filter Office 2", code="FO-2", timezone="Asia/Kolkata")
    dev_db_session.add_all([off1, off2])
    dev_db_session.flush()

    dev1 = Device(office_id=off1.id, name="Dev 1", device_code="FO1-D1", serial_number="SN-F1", status="ACTIVE", is_active=True)
    dev2 = Device(office_id=off1.id, name="Dev 2", device_code="FO1-D2", serial_number="SN-F2", status="INACTIVE", is_active=False)
    dev3 = Device(office_id=off2.id, name="Dev 3", device_code="FO2-D1", serial_number="SN-F3", status="DECOMMISSIONED", is_active=False)
    dev_db_session.add_all([dev1, dev2, dev3])
    dev_db_session.flush()

    # Filter by office_id
    res_off = dev_client.get(f"/api/v1/devices?office_id={off1.id}", headers=admin_headers)
    assert res_off.status_code == 200
    ids_off = [d["id"] for d in res_off.json()]
    assert dev1.id in ids_off and dev2.id in ids_off and dev3.id not in ids_off

    # Filter by active_only
    res_act = dev_client.get("/api/v1/devices?active_only=true", headers=admin_headers)
    assert res_act.status_code == 200
    ids_act = [d["id"] for d in res_act.json()]
    assert dev1.id in ids_act and dev2.id not in ids_act and dev3.id not in ids_act

    # Filter by status
    res_decom = dev_client.get("/api/v1/devices?status=DECOMMISSIONED", headers=admin_headers)
    assert res_decom.status_code == 200
    ids_decom = [d["id"] for d in res_decom.json()]
    assert dev3.id in ids_decom and dev1.id not in ids_decom


# ============================================================================
# 4. LIFECYCLE: UPDATE, DEACTIVATE & DECOMMISSION TESTS
# ============================================================================

def test_device_update_and_reassignment(dev_client, admin_headers, test_office, dev_db_session):
    off2 = Office(name="Secondary Office", code="SEC-01", timezone="Asia/Kolkata")
    dev_db_session.add(off2)
    dev_db_session.flush()

    res = dev_client.post(
        "/api/v1/devices",
        json={
            "office_id": test_office.id,
            "name": "Original Name",
            "device_code": "DEV-UPD-01",
            "serial_number": "SN-UPD-001",
        },
        headers=admin_headers,
    )
    dev_id = res.json()["id"]

    # Admin updates name, IP, and reassigns to off2
    patch_res = dev_client.patch(
        f"/api/v1/devices/{dev_id}",
        json={
            "name": "Updated Name",
            "office_id": off2.id,
            "ip_address": "10.0.0.50",
            "model_name": "FaceStation 2",
        },
        headers=admin_headers,
    )
    assert patch_res.status_code == 200
    data = patch_res.json()
    assert data["name"] == "Updated Name"
    assert data["office_id"] == off2.id
    assert data["ip_address"] == "10.0.0.50"
    assert data["model_name"] == "FaceStation 2"


def test_device_decommission_permanence(dev_client, admin_headers, test_office):
    res = dev_client.post(
        "/api/v1/devices",
        json={
            "office_id": test_office.id,
            "name": "To Be Decommissioned",
            "device_code": "DEV-DEC-01",
            "serial_number": "SN-DEC-001",
        },
        headers=admin_headers,
    )
    dev_id = res.json()["id"]

    # Decommission device
    dec_res = dev_client.post(f"/api/v1/devices/{dev_id}/decommission", headers=admin_headers)
    assert dec_res.status_code == 200
    assert dec_res.json()["status"] == "DECOMMISSIONED"
    assert dec_res.json()["is_active"] is False

    # Attempting to edit decommissioned device must fail (400)
    edit_res = dev_client.patch(
        f"/api/v1/devices/{dev_id}",
        json={"name": "Attempted Edit"},
        headers=admin_headers,
    )
    assert edit_res.status_code == 400
    assert "decommissioned device" in edit_res.json()["detail"].lower()

    # Attempting to deactivate already decommissioned device must fail (400)
    deact_res = dev_client.delete(f"/api/v1/devices/{dev_id}", headers=admin_headers)
    assert deact_res.status_code == 400


def test_device_deactivate_lifecycle(dev_client, admin_headers, test_office):
    res = dev_client.post(
        "/api/v1/devices",
        json={
            "office_id": test_office.id,
            "name": "To Be Deactivated",
            "device_code": "DEV-DEACT-01",
            "serial_number": "SN-DEACT-001",
        },
        headers=admin_headers,
    )
    dev_id = res.json()["id"]

    # Deactivate device (soft delete)
    del_res = dev_client.delete(f"/api/v1/devices/{dev_id}", headers=admin_headers)
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "INACTIVE"
    assert del_res.json()["is_active"] is False

    # Can be re-activated via PATCH
    react_res = dev_client.patch(
        f"/api/v1/devices/{dev_id}",
        json={"status": "ACTIVE"},
        headers=admin_headers,
    )
    assert react_res.status_code == 200
    assert react_res.json()["status"] == "ACTIVE"
    assert react_res.json()["is_active"] is True
