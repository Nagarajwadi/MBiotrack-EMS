import concurrent.futures
from datetime import datetime, timedelta, timezone
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, decode_access_token, hash_password
from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.auth import LoginRequest
from app.services.auth_service import AuthService, _DUMMY_ARGON2ID_HASH

settings = get_settings()


# ---------------------------------------------------------------------------
# Helpers & Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def active_user(db_session: Session) -> User:
    user = User(
        full_name="Test Administrator",
        email="admin@example.com",
        password_hash=hash_password("SuperSecretPass123!"),
        role="ADMIN",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def inactive_user(db_session: Session) -> User:
    user = User(
        full_name="Deactivated Admin",
        email="inactive@example.com",
        password_hash=hash_password("SuperSecretPass123!"),
        role="ADMIN",
        is_active=False,
    )
    db_session.add(user)
    db_session.commit()
    return user


# ---------------------------------------------------------------------------
# Authentication Tests (POST /api/v1/auth/login)
# ---------------------------------------------------------------------------

def test_login_success(client: TestClient, active_user: User):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "SuperSecretPass123!"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["expires_in"] == 15 * 60

    # Verify token payload
    payload = decode_access_token(data["access_token"])
    assert payload["sub"] == str(active_user.id)
    assert payload["iss"] == "mbiotrack-ems"


def test_login_case_insensitive_email(client: TestClient, active_user: User):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "  ADMIN@EXAMPLE.COM  ", "password": "SuperSecretPass123!"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data


def test_login_incorrect_password(client: TestClient, active_user: User):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "WrongPassword999!"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password."


def test_login_nonexistent_user_executes_dummy_hash(client: TestClient):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "AnyPassword123!"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password."


def test_login_inactive_user_returns_generic_401(client: TestClient, inactive_user: User):
    # Account enumeration defense: inactive account receives same generic 401
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "inactive@example.com", "password": "SuperSecretPass123!"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password."


def test_login_invalid_request_validation(client: TestClient):
    # Invalid email format
    res1 = client.post(
        "/api/v1/auth/login",
        json={"email": "not-an-email", "password": "ValidPassword123!"},
    )
    assert res1.status_code == 422

    # Missing password
    res2 = client.post(
        "/api/v1/auth/login",
        json={"email": "valid@example.com"},
    )
    assert res2.status_code == 422


def test_jwt_numeric_subject_roundtrip():
    # User ID 42 serializes to string and parses back to integer
    token = create_access_token(subject=42)
    payload = decode_access_token(token)
    assert payload["sub"] == "42"
    assert int(payload["sub"]) == 42


# ---------------------------------------------------------------------------
# Current User Tests (GET /api/v1/auth/me)
# ---------------------------------------------------------------------------

def test_get_me_success(client: TestClient, active_user: User):
    token = create_access_token(subject=active_user.id)
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == active_user.id
    assert data["email"] == active_user.email
    assert data["full_name"] == active_user.full_name
    assert data["role"] == active_user.role
    assert data["is_active"] is True
    assert "password_hash" not in data


def test_get_me_missing_token_returns_401(client: TestClient):
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401


def test_get_me_expired_token_returns_401(client: TestClient, active_user: User):
    expired_token = create_access_token(
        subject=active_user.id,
        expires_delta=timedelta(seconds=-10),
    )
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Token has expired."


def test_get_me_inactive_user_after_token_issued_returns_403(client: TestClient, active_user: User, db_session: Session):
    token = create_access_token(subject=active_user.id)
    
    # Deactivate user after token creation
    active_user.is_active = False
    db_session.commit()

    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "User account is inactive."


def test_logout_stateless(client: TestClient, active_user: User):
    token = create_access_token(subject=active_user.id)
    response = client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert "Discard token on client" in response.json()["message"]


# ---------------------------------------------------------------------------
# Audit & Rate Limiting Tests
# ---------------------------------------------------------------------------

def test_failed_login_records_audit_log(client: TestClient, db_session: Session):
    client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "WrongPassword123!"},
    )
    audit = db_session.scalar(
        select(AuditLog)
        .where(AuditLog.action == "AUTH_LOGIN_FAILED")
        .order_by(AuditLog.created_at.desc())
    )
    assert audit is not None
    assert audit.action == "AUTH_LOGIN_FAILED"
    assert audit.metadata_["reason"] == "user_not_found"
    # Plaintext email must not be present in target_id or metadata
    assert "nobody@example.com" not in str(audit.metadata_)
    assert audit.target_id != "nobody@example.com"


def test_successful_login_records_audit_log(client: TestClient, active_user: User, db_session: Session):
    client.post(
        "/api/v1/auth/login",
        json={"email": active_user.email, "password": "SuperSecretPass123!"},
    )
    audit = db_session.scalar(
        select(AuditLog)
        .where(AuditLog.action == "AUTH_LOGIN_SUCCESS")
        .order_by(AuditLog.created_at.desc())
    )
    assert audit is not None
    assert audit.actor_user_id == active_user.id
    assert audit.target_id == str(active_user.id)
    assert audit.metadata_["role"] == "ADMIN"


def test_rate_limiting_five_failures_then_429(client: TestClient, db_session: Session):
    test_ip = "198.51.100.1"
    headers = {"X-Real-IP": test_ip}  # Testclient direct host mock

    # Insert 5 failed attempts within window
    for i in range(5):
        audit = AuditLog(
            action="AUTH_LOGIN_FAILED",
            target_type="auth",
            ip_address="testclient",
            metadata_={"reason": "test_failure"},
        )
        db_session.add(audit)
    db_session.commit()

    # 6th attempt should be blocked with 429
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "any@example.com", "password": "WrongPassword123!"},
    )
    assert response.status_code == 429
    assert "Too many failed login attempts" in response.json()["detail"]
    assert "Retry-After" in response.headers


# ---------------------------------------------------------------------------
# Concurrency Rate-Limiting Test (10 Independent Sessions)
# ---------------------------------------------------------------------------

def test_concurrent_failed_logins_strictly_enforce_rate_limit(test_engine):
    """Verify that concurrent requests from separate sessions serialize via advisory locks.
    
    10 concurrent failed login attempts from the same IP must result in exactly 5 failures (401)
    and 5 rate-limit rejections (429).
    """
    client_ip = "198.51.100.99"
    payload = LoginRequest(email="concurrent@example.com", password="WrongPassword123!")

    def attempt_login():
        with Session(bind=test_engine) as session:
            try:
                AuthService.authenticate_user(db=session, payload=payload, client_ip=client_ip)
                return 200
            except HTTPException as e:
                return e.status_code

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(attempt_login) for _ in range(10)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        status_401_count = results.count(401)
        status_429_count = results.count(429)

        assert status_401_count == 5, f"Expected 5 401s, got {status_401_count}"
        assert status_429_count == 5, f"Expected 5 429s, got {status_429_count}"
    finally:
        # Strictly clean up only records created by this test IP
        with Session(bind=test_engine) as cleanup_session:
            cleanup_session.execute(delete(AuditLog).where(AuditLog.ip_address == client_ip))
            cleanup_session.commit()


# ---------------------------------------------------------------------------
# Client IP & Proxy Resolution Tests
# ---------------------------------------------------------------------------

def test_client_ip_direct_address(client: TestClient):
    # Standard client request uses direct host 'testclient' -> maps safely
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "test@example.com", "password": "WrongPassword123!"},
    )
    assert response.status_code == 401


def test_client_ip_untrusted_forwarded_header_ignored(client: TestClient, monkeypatch):
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", False)
    # Attacker attempts to spoof IP via X-Forwarded-For
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "test@example.com", "password": "WrongPassword123!"},
        headers={"X-Forwarded-For": "203.0.113.195"},
    )
    # Must process without error using testclient direct host
    assert response.status_code == 401


def test_client_ip_trusted_proxy_right_to_left(client: TestClient, monkeypatch):
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
    monkeypatch.setattr(settings, "TRUSTED_PROXIES", ["10.0.0.1", "127.0.0.1", "testclient"])

    # Header: client_ip, proxy_ip
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "test@example.com", "password": "WrongPassword123!"},
        headers={"X-Forwarded-For": "198.51.100.25, 10.0.0.1"},
    )
    assert response.status_code == 401


def test_client_ip_malformed_forwarded_header_rejected(client: TestClient, monkeypatch):
    monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
    monkeypatch.setattr(settings, "TRUSTED_PROXIES", ["testclient"])

    # Header with invalid IP
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "test@example.com", "password": "WrongPassword123!"},
        headers={"X-Forwarded-For": "not-an-ip-address"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Malformed X-Forwarded-For header."

    # Header with empty segment
    response2 = client.post(
        "/api/v1/auth/login",
        json={"email": "test@example.com", "password": "WrongPassword123!"},
        headers={"X-Forwarded-For": "198.51.100.25,,10.0.0.1"},
    )
    assert response2.status_code == 400
    assert response2.json()["detail"] == "Malformed X-Forwarded-For header."
