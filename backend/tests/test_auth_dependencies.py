from datetime import timedelta
import pytest
from fastapi import HTTPException

from app.core.security import create_access_token, hash_password
from app.dependencies.auth import (
    get_current_user,
    get_token_payload,
    require_role,
)
from app.models.user import User


def test_get_token_payload_valid():
    token = create_access_token(subject=100)
    payload = get_token_payload(token)
    assert payload["sub"] == "100"
    assert payload["iss"] == "mbiotrack-ems"


def test_get_token_payload_expired_raises_401():
    expired_token = create_access_token(
        subject=100,
        expires_delta=timedelta(seconds=-10),
    )
    with pytest.raises(HTTPException) as exc_info:
        get_token_payload(expired_token)
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Token has expired."
    assert exc_info.value.headers == {"WWW-Authenticate": "Bearer"}


def test_get_token_payload_invalid_raises_401():
    with pytest.raises(HTTPException) as exc_info:
        get_token_payload("invalid.bearer.token")
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Could not validate credentials."
    assert exc_info.value.headers == {"WWW-Authenticate": "Bearer"}


def test_get_current_user_non_numeric_subject_raises_401(db_session):
    token = create_access_token(subject="not-a-number")
    payload = get_token_payload(token)

    with pytest.raises(HTTPException) as exc_info:
        get_current_user(token_payload=payload, db=db_session)
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Could not validate user identity."


def test_get_current_user_nonexistent_user_raises_401(db_session):
    token = create_access_token(subject=999999)
    payload = get_token_payload(token)

    with pytest.raises(HTTPException) as exc_info:
        get_current_user(token_payload=payload, db=db_session)
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "User account no longer exists."


def test_get_current_user_active_user_success(db_session):
    user = User(
        full_name="Active Admin",
        email="active_admin@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="ADMIN",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()

    token = create_access_token(subject=user.id)
    payload = get_token_payload(token)

    resolved_user = get_current_user(token_payload=payload, db=db_session)
    assert resolved_user.id == user.id
    assert resolved_user.email == "active_admin@example.com"
    assert resolved_user.role == "ADMIN"


def test_get_current_user_inactive_user_raises_403(db_session):
    user = User(
        full_name="Inactive Admin",
        email="inactive_admin@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="ADMIN",
        is_active=False,
    )
    db_session.add(user)
    db_session.commit()

    token = create_access_token(subject=user.id)
    payload = get_token_payload(token)

    with pytest.raises(HTTPException) as exc_info:
        get_current_user(token_payload=payload, db=db_session)
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "User account is inactive."


def test_require_role_does_not_trust_dict_claims():
    fake_payload = {"sub": "1", "role": "ADMIN"}
    checker = require_role("ADMIN")

    with pytest.raises(HTTPException) as exc_info:
        checker(current_user=fake_payload)
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Operation not permitted for the current user role."


def test_require_role_with_mock_user_object():
    class DummyUser:
        def __init__(self, role: str):
            self.role = role

    admin_user = DummyUser("ADMIN")
    employee_user = DummyUser("EMPLOYEE")

    admin_checker = require_role("ADMIN")
    assert admin_checker(current_user=admin_user) is admin_user

    with pytest.raises(HTTPException) as exc_info:
        admin_checker(current_user=employee_user)
    assert exc_info.value.status_code == 403
