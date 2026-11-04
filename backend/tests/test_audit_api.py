from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password
from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.user import User


# ---------------------------------------------------------------------------
# Test Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def admin_user(db_session: Session) -> User:
    user = User(
        full_name="Audit Administrator",
        email="audit_admin@example.com",
        password_hash=hash_password("ValidAdminPass123!"),
        role="ADMIN",
        employee_id=None,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def manager_user(db_session: Session) -> User:
    # Manager requires linked employee
    emp = Employee(
        employee_code="MGR001",
        first_name="Manager",
        last_name="User",
        email="manager@example.com",
        department="Operations",
        designation="Operations Manager",
        joining_date=datetime.now(timezone.utc).date(),
        is_active=True,
    )
    db_session.add(emp)
    db_session.flush()

    user = User(
        full_name="Operations Manager",
        email="manager@example.com",
        password_hash=hash_password("ValidManagerPass123!"),
        role="MANAGER",
        employee_id=emp.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def employee_user(db_session: Session) -> User:
    # Employee requires linked employee
    emp = Employee(
        employee_code="EMP999",
        first_name="Staff",
        last_name="Member",
        email="staff@example.com",
        department="Engineering",
        designation="Junior Developer",
        joining_date=datetime.now(timezone.utc).date(),
        is_active=True,
    )
    db_session.add(emp)
    db_session.flush()

    user = User(
        full_name="Staff Member",
        email="staff@example.com",
        password_hash=hash_password("ValidStaffPass123!"),
        role="EMPLOYEE",
        employee_id=emp.id,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def get_auth_headers(user: User) -> dict[str, str]:
    token = create_access_token(subject=user.id)
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Test Cases
# ---------------------------------------------------------------------------

def test_unauthenticated_access_returns_401(client: TestClient):
    """1. Unauthenticated access returns 401 Unauthorized."""
    resp = client.get("/api/v1/audit-logs")
    assert resp.status_code == 401
    assert "Not authenticated" in resp.json().get("detail", "")


def test_admin_can_retrieve_audit_logs(
    client: TestClient, db_session: Session, admin_user: User
):
    """2. ADMIN can retrieve audit logs."""
    log = AuditLog(
        actor_user_id=admin_user.id,
        action="TEST_ACTION",
        target_type="test",
        target_id="1",
        metadata_={"role": "ADMIN"},
        ip_address="127.0.0.1",
    )
    db_session.add(log)
    db_session.commit()

    headers = get_auth_headers(admin_user)
    resp = client.get("/api/v1/audit-logs", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "total" in data
    assert data["total"] >= 1
    actions = [item["action"] for item in data["items"]]
    assert "TEST_ACTION" in actions


def test_manager_receives_403(
    client: TestClient, manager_user: User
):
    """3. MANAGER receives 403 Forbidden."""
    headers = get_auth_headers(manager_user)
    resp = client.get("/api/v1/audit-logs", headers=headers)
    assert resp.status_code == 403
    assert "Operation not permitted" in resp.json().get("detail", "")


def test_employee_receives_403(
    client: TestClient, employee_user: User
):
    """4. EMPLOYEE receives 403 Forbidden."""
    headers = get_auth_headers(employee_user)
    resp = client.get("/api/v1/audit-logs", headers=headers)
    assert resp.status_code == 403
    assert "Operation not permitted" in resp.json().get("detail", "")


def test_default_pagination(
    client: TestClient, db_session: Session, admin_user: User
):
    """5. Default pagination works (limit=50, offset=0)."""
    headers = get_auth_headers(admin_user)
    resp = client.get("/api/v1/audit-logs", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["limit"] == 50
    assert data["offset"] == 0
    assert isinstance(data["items"], list)
    assert len(data["items"]) <= 50


def test_custom_limit_and_offset(
    client: TestClient, db_session: Session, admin_user: User
):
    """6. Custom limit and offset work."""
    # Seed 5 distinct audit logs
    for i in range(5):
        db_session.add(
            AuditLog(
                actor_user_id=admin_user.id,
                action=f"CUSTOM_PAGINATION_{i}",
                target_type="pagination",
                target_id=str(i),
            )
        )
    db_session.commit()

    headers = get_auth_headers(admin_user)
    resp = client.get("/api/v1/audit-logs?limit=2&offset=1", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["limit"] == 2
    assert data["offset"] == 1
    assert len(data["items"]) == 2


def test_maximum_limit_enforced(
    client: TestClient, admin_user: User
):
    """7. Maximum limit is enforced (limit > 100 rejected with 422)."""
    headers = get_auth_headers(admin_user)
    resp = client.get("/api/v1/audit-logs?limit=101", headers=headers)
    assert resp.status_code == 422


def test_negative_offset_rejected(
    client: TestClient, admin_user: User
):
    """8. Negative offset is rejected with 422."""
    headers = get_auth_headers(admin_user)
    resp = client.get("/api/v1/audit-logs?offset=-1", headers=headers)
    assert resp.status_code == 422


def test_invalid_limit_rejected(
    client: TestClient, admin_user: User
):
    """9. Invalid limit is rejected (limit=0 or non-integer)."""
    headers = get_auth_headers(admin_user)
    resp1 = client.get("/api/v1/audit-logs?limit=0", headers=headers)
    assert resp1.status_code == 422

    resp2 = client.get("/api/v1/audit-logs?limit=abc", headers=headers)
    assert resp2.status_code == 422


def test_action_filtering(
    client: TestClient, db_session: Session, admin_user: User
):
    """10. Action filtering works."""
    db_session.add(
        AuditLog(
            actor_user_id=admin_user.id,
            action="FILTER_ACTION_ALPHA",
            target_type="item",
        )
    )
    db_session.add(
        AuditLog(
            actor_user_id=admin_user.id,
            action="FILTER_ACTION_BETA",
            target_type="item",
        )
    )
    db_session.commit()

    headers = get_auth_headers(admin_user)
    resp = client.get(
        "/api/v1/audit-logs?action=FILTER_ACTION_ALPHA", headers=headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert all(item["action"] == "FILTER_ACTION_ALPHA" for item in data["items"])


def test_target_type_filtering(
    client: TestClient, db_session: Session, admin_user: User
):
    """11. Target type filtering works."""
    db_session.add(
        AuditLog(
            actor_user_id=admin_user.id,
            action="TEST_TARGET",
            target_type="TYPE_X",
        )
    )
    db_session.add(
        AuditLog(
            actor_user_id=admin_user.id,
            action="TEST_TARGET",
            target_type="TYPE_Y",
        )
    )
    db_session.commit()

    headers = get_auth_headers(admin_user)
    resp = client.get("/api/v1/audit-logs?target_type=TYPE_X", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert all(item["target_type"] == "TYPE_X" for item in data["items"])


def test_actor_filtering(
    client: TestClient, db_session: Session, admin_user: User
):
    """12. Actor filtering works."""
    # Another user
    other_user = User(
        full_name="Other Admin",
        email="other_admin@example.com",
        password_hash=hash_password("ValidOtherPass123!"),
        role="ADMIN",
        employee_id=None,
        is_active=True,
    )
    db_session.add(other_user)
    db_session.flush()

    db_session.add(
        AuditLog(
            actor_user_id=admin_user.id,
            action="ACTOR_TEST",
            target_type="user",
        )
    )
    db_session.add(
        AuditLog(
            actor_user_id=other_user.id,
            action="ACTOR_TEST",
            target_type="user",
        )
    )
    db_session.commit()

    headers = get_auth_headers(admin_user)
    resp = client.get(
        f"/api/v1/audit-logs?actor_user_id={other_user.id}", headers=headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert all(item["actor_user_id"] == other_user.id for item in data["items"])


def test_actor_email_is_correctly_returned(
    client: TestClient, db_session: Session, admin_user: User
):
    """13. Actor email is correctly returned via outer join."""
    log = AuditLog(
        actor_user_id=admin_user.id,
        action="ACTOR_EMAIL_TEST",
        target_type="test",
    )
    db_session.add(log)
    db_session.commit()

    headers = get_auth_headers(admin_user)
    resp = client.get(
        "/api/v1/audit-logs?action=ACTOR_EMAIL_TEST", headers=headers
    )
    assert resp.status_code == 200
    data = resp.json()
    item = next((i for i in data["items"] if i["id"] == log.id), None)
    assert item is not None
    assert item["actor_user_id"] == admin_user.id
    assert item["actor_email"] == admin_user.email


def test_missing_or_null_actor_handled(
    client: TestClient, db_session: Session, admin_user: User
):
    """14. Missing/null actor is handled gracefully (actor_email is null)."""
    log = AuditLog(
        actor_user_id=None,
        action="ANONYMOUS_EVENT",
        target_type="auth",
        target_id="pseudo_hash_123",
        ip_address="198.51.100.1",
    )
    db_session.add(log)
    db_session.commit()

    headers = get_auth_headers(admin_user)
    resp = client.get("/api/v1/audit-logs?action=ANONYMOUS_EVENT", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    item = next((i for i in data["items"] if i["id"] == log.id), None)
    assert item is not None
    assert item["actor_user_id"] is None
    assert item["actor_email"] is None


def test_ordering_is_deterministic_when_timestamps_match(
    client: TestClient, db_session: Session, admin_user: User
):
    """15. Ordering is deterministic when timestamps match (secondary sort by id DESC)."""
    shared_ts = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)
    log1 = AuditLog(
        actor_user_id=admin_user.id,
        action="DETERMINISTIC_SORT",
        target_type="sort",
        created_at=shared_ts,
    )
    log2 = AuditLog(
        actor_user_id=admin_user.id,
        action="DETERMINISTIC_SORT",
        target_type="sort",
        created_at=shared_ts,
    )
    db_session.add(log1)
    db_session.add(log2)
    db_session.commit()

    headers = get_auth_headers(admin_user)
    resp = client.get(
        "/api/v1/audit-logs?action=DETERMINISTIC_SORT", headers=headers
    )
    assert resp.status_code == 200
    data = resp.json()
    items = [i for i in data["items"] if i["action"] == "DETERMINISTIC_SORT"]
    assert len(items) >= 2
    # The higher ID should appear first because sort is id DESC
    assert items[0]["id"] > items[1]["id"]


def test_total_count_reflects_filters(
    client: TestClient, db_session: Session, admin_user: User
):
    """16. Total count reflects filters."""
    for _ in range(3):
        db_session.add(
            AuditLog(
                actor_user_id=admin_user.id,
                action="COUNT_TEST_FILTERED",
                target_type="filter_count",
            )
        )
    for _ in range(2):
        db_session.add(
            AuditLog(
                actor_user_id=admin_user.id,
                action="COUNT_TEST_OTHER",
                target_type="other_count",
            )
        )
    db_session.commit()

    headers = get_auth_headers(admin_user)
    resp = client.get(
        "/api/v1/audit-logs?action=COUNT_TEST_FILTERED&limit=1", headers=headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["limit"] == 1
    assert len(data["items"]) == 1
    assert data["total"] == 3


def test_sensitive_metadata_is_not_exposed(
    client: TestClient, db_session: Session, admin_user: User
):
    """17. Sensitive metadata keys are sanitized/redacted in output."""
    log = AuditLog(
        actor_user_id=admin_user.id,
        action="SENSITIVE_META_TEST",
        target_type="meta",
        metadata_={
            "safe_field": "visible_value",
            "password": "plain_password_123",
            "user_token": "secret_bearer_token",
            "nested": {
                "secret_key": "private_secret_string",
                "normal": "normal_nested",
            },
        },
    )
    db_session.add(log)
    db_session.commit()

    headers = get_auth_headers(admin_user)
    resp = client.get(
        "/api/v1/audit-logs?action=SENSITIVE_META_TEST", headers=headers
    )
    assert resp.status_code == 200
    data = resp.json()
    item = next((i for i in data["items"] if i["id"] == log.id), None)
    assert item is not None
    meta = item["metadata"]
    assert meta["safe_field"] == "visible_value"
    assert meta["password"] == "[REDACTED]"
    assert meta["user_token"] == "[REDACTED]"
    assert meta["nested"]["secret_key"] == "[REDACTED]"
    assert meta["nested"]["normal"] == "normal_nested"


def test_audit_records_remain_unchanged_after_queries(
    client: TestClient, db_session: Session, admin_user: User
):
    """18. Audit records remain unchanged on disk after queries (strictly read-only)."""
    log = AuditLog(
        actor_user_id=admin_user.id,
        action="READONLY_INTEGRITY_TEST",
        target_type="test",
        metadata_={"original": "data"},
        ip_address="127.0.0.1",
    )
    db_session.add(log)
    db_session.commit()

    headers = get_auth_headers(admin_user)
    resp = client.get(
        "/api/v1/audit-logs?action=READONLY_INTEGRITY_TEST", headers=headers
    )
    assert resp.status_code == 200

    # Query the physical database record directly to verify zero mutations
    saved_log = db_session.scalar(select(AuditLog).where(AuditLog.id == log.id))
    assert saved_log is not None
    assert saved_log.action == "READONLY_INTEGRITY_TEST"
    assert saved_log.metadata_ == {"original": "data"}
    assert saved_log.ip_address == "127.0.0.1"


def test_unsupported_methods_not_allowed(
    client: TestClient, admin_user: User
):
    """19. Unsupported POST, PUT, PATCH, and DELETE methods are rejected (405)."""
    headers = get_auth_headers(admin_user)
    endpoint = "/api/v1/audit-logs"

    resp_post = client.post(endpoint, json={"action": "MUTATION"}, headers=headers)
    assert resp_post.status_code == 405

    resp_put = client.put(endpoint, json={"action": "MUTATION"}, headers=headers)
    assert resp_put.status_code == 405

    resp_patch = client.patch(endpoint, json={"action": "MUTATION"}, headers=headers)
    assert resp_patch.status_code == 405

    resp_delete = client.delete(endpoint, headers=headers)
    assert resp_delete.status_code == 405

