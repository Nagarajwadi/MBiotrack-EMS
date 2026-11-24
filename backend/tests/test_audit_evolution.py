from datetime import datetime
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, derive_pwd_fingerprint
from app.db.session import get_db
from app.main import app
from app.models.audit_log import AuditLog
from app.models.user import User
from app.services.audit_service import AuditService

settings = get_settings()







# ============================================================================
# 1. HISTORICAL DATA INTEGRITY & MODEL ALIGNMENT TESTS
# ============================================================================

def test_historical_audit_records_readable_with_null_states(dev_db_session):
    """Existing historical records remain readable and have null before/after states."""
    historical_log = AuditLog(
        actor_user_id=None,
        action="HISTORICAL_SYSTEM_INIT",
        target_type="system",
        target_id="sys-001",
        before_state=None,
        after_state=None,
    )
    dev_db_session.add(historical_log)
    dev_db_session.flush()

    dev_db_session.expire_all()
    fetched = dev_db_session.get(AuditLog, historical_log.id)
    assert fetched is not None
    assert fetched.id == historical_log.id
    assert fetched.action == "HISTORICAL_SYSTEM_INIT"
    assert fetched.target_type == "system"
    assert fetched.target_id == "sys-001"
    # Historical logs must have null before/after state (not fabricated)
    assert fetched.before_state is None
    assert fetched.after_state is None
    # Aliased entity attributes must match target_type and target_id
    assert fetched.entity_name == fetched.target_type
    assert fetched.entity_id == fetched.target_id


def test_insert_audit_with_before_and_after_states(dev_db_session, admin_user):
    """New audit logs can include structured before_state and after_state payloads."""
    log = AuditLog(
        actor_user_id=admin_user.id,
        action="CONFIG_UPDATE",
        target_type="system_config",
        target_id="setting_01",
        before_state={"timeout": 30, "mode": "legacy"},
        after_state={"timeout": 60, "mode": "modern"},
        metadata_={"reason": "performance tuning"},
    )
    dev_db_session.add(log)
    dev_db_session.flush()

    assert log.id is not None
    # Query back using ORM
    fetched = dev_db_session.get(AuditLog, log.id)
    assert fetched is not None
    assert fetched.before_state == {"timeout": 30, "mode": "legacy"}
    assert fetched.after_state == {"timeout": 60, "mode": "modern"}
    assert fetched.metadata_ == {"reason": "performance tuning"}
    assert fetched.db_session_user is not None


def test_before_after_state_sensitive_key_scrubbing(dev_db_session, admin_user):
    """Pydantic AuditLogResponse scrubs sensitive credentials in before_state and after_state."""
    log = AuditLog(
        actor_user_id=admin_user.id,
        action="USER_CREDENTIAL_CHANGE",
        target_type="user",
        target_id=str(admin_user.id),
        before_state={"username": "admin", "password_hash": "$argon2id$v=19$m=65536..."},
        after_state={"username": "admin", "password_hash": "$argon2id$v=19$m=65536...new"},
    )
    dev_db_session.add(log)
    dev_db_session.flush()

    res = AuditService.get_audit_logs(dev_db_session, limit=10, action="USER_CREDENTIAL_CHANGE")
    matching = [item for item in res.items if item.id == log.id]
    assert len(matching) == 1
    item = matching[0]

    # Sensitive keys must be redacted
    assert item.before_state["password_hash"] == "[REDACTED]"
    assert item.after_state["password_hash"] == "[REDACTED]"
    # Non-sensitive keys must be preserved
    assert item.before_state["username"] == "admin"
    assert item.after_state["username"] == "admin"


# ============================================================================
# 2. DATABASE-LEVEL PHYSICAL IMMUTABILITY PROTECTION TESTS
# ============================================================================

def test_database_immutability_blocks_update(dev_db_session, admin_user):
    """Database trigger strictly rejects UPDATE operations on audit_logs with SQLSTATE 42501."""
    log = AuditLog(
        actor_user_id=admin_user.id,
        action="TEST_IMMUTABILITY_UPDATE",
        target_type="test",
        target_id="1",
    )
    dev_db_session.add(log)
    dev_db_session.flush()

    sp = dev_db_session.begin_nested()
    with pytest.raises(Exception) as exc_info:
        dev_db_session.execute(
            text("UPDATE audit_logs SET action = 'MUTATED' WHERE id = :id"),
            {"id": log.id},
        )
    sp.rollback()

    sqlstate = getattr(getattr(exc_info.value, "orig", None), "sqlstate", None)
    assert sqlstate == "42501", f"Expected SQLSTATE 42501, got {sqlstate}"
    assert "immutable" in str(exc_info.value).lower()


def test_database_immutability_blocks_delete(dev_db_session, admin_user):
    """Database trigger strictly rejects DELETE operations on audit_logs with SQLSTATE 42501."""
    log = AuditLog(
        actor_user_id=admin_user.id,
        action="TEST_IMMUTABILITY_DELETE",
        target_type="test",
        target_id="2",
    )
    dev_db_session.add(log)
    dev_db_session.flush()

    sp = dev_db_session.begin_nested()
    with pytest.raises(Exception) as exc_info:
        dev_db_session.execute(
            text("DELETE FROM audit_logs WHERE id = :id"),
            {"id": log.id},
        )
    sp.rollback()

    sqlstate = getattr(getattr(exc_info.value, "orig", None), "sqlstate", None)
    assert sqlstate == "42501", f"Expected SQLSTATE 42501, got {sqlstate}"
    assert "immutable" in str(exc_info.value).lower()


def test_database_immutability_blocks_truncate(dev_db_session):
    """Database trigger strictly rejects TRUNCATE on audit_logs with SQLSTATE 42501."""
    sp = dev_db_session.begin_nested()
    with pytest.raises(Exception) as exc_info:
        dev_db_session.execute(text("TRUNCATE TABLE audit_logs"))
    sp.rollback()

    sqlstate = getattr(getattr(exc_info.value, "orig", None), "sqlstate", None)
    assert sqlstate == "42501", f"Expected SQLSTATE 42501, got {sqlstate}"


def test_fk_restrict_blocks_user_hard_deletion(dev_db_session, admin_user):
    """Deleting a user who produced audit records is blocked by ON DELETE RESTRICT (SQLSTATE 23503)."""
    # Seed an audit record produced by admin_user
    log = AuditLog(
        actor_user_id=admin_user.id,
        action="AUTH_ACTION_TEST",
        target_type="user",
        target_id=str(admin_user.id),
    )
    dev_db_session.add(log)
    dev_db_session.flush()

    # Verify admin has audit logs
    has_logs = dev_db_session.scalar(
        select(AuditLog.id).where(AuditLog.actor_user_id == admin_user.id).limit(1)
    )
    assert has_logs is not None

    sp = dev_db_session.begin_nested()
    with pytest.raises(Exception) as exc_info:
        dev_db_session.execute(
            text("DELETE FROM users WHERE id = :id"),
            {"id": admin_user.id},
        )
    sp.rollback()

    sqlstate = getattr(getattr(exc_info.value, "orig", None), "sqlstate", None)
    assert sqlstate in ("23001", "23503"), f"Expected restrict/foreign key violation (23001 or 23503), got {sqlstate}"


# ============================================================================
# 3. API ENDPOINT & PRODUCER COMPATIBILITY TESTS
# ============================================================================

def test_audit_logs_api_endpoint_success(dev_client, admin_headers, dev_db_session):
    """GET /api/v1/audit-logs returns 200 with new schema fields and backward-compatible envelope."""
    test_log = AuditLog(
        actor_user_id=None,
        action="SYSTEM_CHECK",
        target_type="system",
        target_id="sys-99",
        before_state={"status": "initial"},
        after_state={"status": "ready"},
    )
    dev_db_session.add(test_log)
    dev_db_session.flush()

    response = dev_client.get("/api/v1/audit-logs?limit=5", headers=admin_headers)
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "total" in data
    assert data["total"] >= 1
    assert len(data["items"]) <= 5

    item = data["items"][0]
    assert "id" in item
    assert "action" in item
    assert "target_type" in item
    assert "before_state" in item
    assert "after_state" in item
    assert "db_session_user" in item
    assert "entity_name" in item
    assert "entity_id" in item


def test_existing_audit_event_producer_works(dev_client, admin_headers, dev_db_session):
    """Existing producers (e.g. creating an office) continue recording audit logs without issues."""
    payload = {
        "name": "Audit Verification Office",
        "code": "AUD-OFF-01",
        "timezone": "Asia/Kolkata",
    }
    response = dev_client.post("/api/v1/offices", json=payload, headers=admin_headers)
    assert response.status_code == 201
    office_id = response.json()["id"]

    # Verify audit log recorded
    audit = dev_db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "OFFICE_CREATE",
            AuditLog.target_id == str(office_id),
        )
    )
    assert audit is not None
    assert audit.target_type == "office"
    assert audit.metadata_["code"] == "AUD-OFF-01"
