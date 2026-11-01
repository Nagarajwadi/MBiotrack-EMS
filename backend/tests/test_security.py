from datetime import timedelta
import jwt
import pytest

from app.core.config import Settings
from app.core.security import (
    TokenExpiredError,
    TokenInvalidError,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_argon2id_password_hashing():
    password = "StrongPassword123!"
    hashed = hash_password(password)

    # Verify Argon2id algorithm identifier
    assert hashed.startswith("$argon2id$")
    assert verify_password(password, hashed) is True
    assert verify_password("WrongPassword123!", hashed) is False
    assert verify_password("", hashed) is False
    assert verify_password(password, "") is False


def test_password_length_enforcement():
    # Enforces minimum 12 characters
    with pytest.raises(ValueError, match="at least 12 characters"):
        hash_password("Short12345!")

    # 12 characters is accepted
    valid_12_char = "ValidPass12!"
    assert len(valid_12_char) == 12
    hashed = hash_password(valid_12_char)
    assert verify_password(valid_12_char, hashed) is True


def test_create_and_decode_access_token():
    subject = "user-101"
    token = create_access_token(subject=subject)

    payload = decode_access_token(token)
    assert payload["sub"] == "user-101"
    assert payload["iss"] == "mbiotrack-ems"
    assert "jti" in payload
    assert "iat" in payload
    assert "exp" in payload

    # Verify 15-minute lifetime by default
    lifetime_seconds = payload["exp"] - payload["iat"]
    assert lifetime_seconds == 15 * 60


def test_token_with_extra_claims():
    token = create_access_token(
        subject=42,
        extra_claims={"role": "ADMIN", "email": "admin@example.com"},
    )
    payload = decode_access_token(token)
    assert payload["sub"] == "42"
    assert payload["role"] == "ADMIN"
    assert payload["email"] == "admin@example.com"


def test_token_extra_claims_cannot_overwrite_protected_claims():
    # Attempting to forge issuer or sub via extra_claims is prevented
    token = create_access_token(
        subject="real-user",
        extra_claims={"iss": "attacker-fake-iss", "sub": "fake-user"},
    )
    payload = decode_access_token(token)
    assert payload["sub"] == "real-user"
    assert payload["iss"] == "mbiotrack-ems"


def test_expired_token_raises_token_expired_error():
    # Create a token that expired 10 seconds ago
    expired_token = create_access_token(
        subject="user-expired",
        expires_delta=timedelta(seconds=-10),
    )
    with pytest.raises(TokenExpiredError, match="Token has expired"):
        decode_access_token(expired_token)


def test_invalid_signature_raises_token_invalid_error():
    # Create token with a different secret
    forged_token = jwt.encode(
        {
            "sub": "user-forged",
            "iat": 1000000000,
            "exp": 2000000000,
            "jti": "fake-jti",
            "iss": "mbiotrack-ems",
        },
        "completely-different-secret-key-32-chars-long",
        algorithm="HS256",
    )
    with pytest.raises(TokenInvalidError):
        decode_access_token(forged_token)


def test_malformed_token_raises_token_invalid_error():
    with pytest.raises(TokenInvalidError):
        decode_access_token("this.is.not.a.valid.jwt.token")

    with pytest.raises(TokenInvalidError):
        decode_access_token("")


def test_wrong_issuer_raises_token_invalid_error():
    from app.core.config import get_settings

    settings = get_settings()
    forged_token = jwt.encode(
        {
            "sub": "user-wrong-iss",
            "iat": 1000000000,
            "exp": 2000000000,
            "jti": "some-jti",
            "iss": "unauthorized-external-issuer",
        },
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )
    with pytest.raises(TokenInvalidError):
        decode_access_token(forged_token)


def test_missing_required_claim_raises_token_invalid_error():
    from app.core.config import get_settings

    settings = get_settings()
    # Missing 'jti' and 'iat'
    incomplete_token = jwt.encode(
        {
            "sub": "user-no-jti",
            "exp": 2000000000,
            "iss": settings.TOKEN_ISSUER,
        },
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )
    with pytest.raises(TokenInvalidError):
        decode_access_token(incomplete_token)


def test_security_settings_validation():
    # Secret key shorter than 32 characters is rejected
    with pytest.raises(ValueError, match="at least 32 characters"):
        Settings(SECRET_KEY="short-secret-key")

    # HS384, HS512, and none are rejected - only HS256 is permitted
    with pytest.raises(ValueError, match="Only 'HS256' algorithm is permitted"):
        Settings(ALGORITHM="HS384")

    with pytest.raises(ValueError, match="Only 'HS256' algorithm is permitted"):
        Settings(ALGORITHM="HS512")

    with pytest.raises(ValueError, match="Only 'HS256' algorithm is permitted"):
        Settings(ALGORITHM="none")

    # Production environment rejecting development placeholder secret key
    with pytest.raises(
        ValueError,
        match="Cannot use development placeholder SECRET_KEY in production",
    ):
        Settings(
            ENVIRONMENT="production",
            SECRET_KEY=Settings.DEV_SECRET_KEY_PLACEHOLDER,
        )

    # Production environment with secure high-entropy secret succeeds
    prod_settings = Settings(
        ENVIRONMENT="production",
        SECRET_KEY="production-high-entropy-secret-key-minimum-32-chars-long",
    )
    assert prod_settings.ENVIRONMENT == "production"

    # Development configuration with default placeholder succeeds
    dev_settings = Settings(
        ENVIRONMENT="development",
        SECRET_KEY=Settings.DEV_SECRET_KEY_PLACEHOLDER,
    )
    assert dev_settings.ENVIRONMENT == "development"


def test_decode_rejects_non_hs256_token():
    from app.core.config import get_settings

    settings = get_settings()
    # Manually encode a token with HS384 using the secret key
    hs384_token = jwt.encode(
        {
            "sub": "user-hs384",
            "iat": 1000000000,
            "exp": 2000000000,
            "jti": "jti-hs384",
            "iss": settings.TOKEN_ISSUER,
        },
        settings.SECRET_KEY,
        algorithm="HS384",
    )
    # decode_access_token must reject it because only HS256 is in allowed algorithms
    with pytest.raises(TokenInvalidError):
        decode_access_token(hs384_token)


