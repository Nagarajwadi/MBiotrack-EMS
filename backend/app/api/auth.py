import ipaddress
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.schemas.auth import LoginRequest, LogoutResponse, TokenResponse, UserResponse
from app.services.auth_service import AuthService

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])
settings = get_settings()


def get_client_ip(request: Request) -> str:
    """Safely resolve client IP with strict right-to-left trusted proxy validation."""
    if not request.client or not request.client.host:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid client network address.",
        )

    raw_host = request.client.host.strip()
    if raw_host == "testclient":
        direct_ip_obj = None
        direct_ip_str = "testclient"
    else:
        try:
            direct_ip_obj = ipaddress.ip_address(raw_host)
            direct_ip_str = str(direct_ip_obj)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid client network address.",
            )

    # If proxy trust is disabled or trusted proxy list is empty, return direct peer IP
    if not settings.TRUST_PROXY_HEADERS or not settings.TRUSTED_PROXIES:
        return direct_ip_str

    # Parse configured trusted proxy networks/addresses
    trusted_networks = []
    trusted_strings = set()
    for item in settings.TRUSTED_PROXIES:
        trusted_strings.add(item.strip())
        try:
            trusted_networks.append(ipaddress.ip_network(item.strip(), strict=False))
        except ValueError:
            continue

    is_direct_trusted = (
        direct_ip_str in trusted_strings
        or (direct_ip_obj is not None and any(direct_ip_obj in net for net in trusted_networks))
    )
    if not is_direct_trusted:
        return direct_ip_str

    forwarded_header = request.headers.get("X-Forwarded-For")
    if not forwarded_header:
        return direct_ip_str

    # Reject malformed or empty segments in X-Forwarded-For
    raw_tokens = forwarded_header.split(",")
    ip_tokens = []
    for t in raw_tokens:
        cleaned = t.strip()
        if not cleaned:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Malformed X-Forwarded-For header.",
            )
        try:
            ip_tokens.append(ipaddress.ip_address(cleaned))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Malformed X-Forwarded-For header.",
            )

    # Parse right-to-left: strip trusted proxies until first untrusted IP is reached
    for cand_ip in reversed(ip_tokens):
        if not any(cand_ip in net for net in trusted_networks):
            return str(cand_ip)

    # If all IPs in chain are trusted, return leftmost valid IP
    return str(ip_tokens[0])


@router.post(
    "/login",
    response_model=TokenResponse,
    status_code=status.HTTP_200_OK,
    summary="Authenticate user and issue JWT access token",
)
def login(
    payload: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Authenticate user with normalized email and password.
    
    Returns a 15-minute HS256 access token upon success.
    Enforces atomic rate limiting (max 5 failed attempts per 15 minutes per IP).
    """
    client_ip = get_client_ip(request)
    return AuthService.authenticate_user(db=db, payload=payload, client_ip=client_ip)


@router.get(
    "/me",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve current user profile",
)
def get_current_user_profile(
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    """Retrieve profile of the currently authenticated user.
    
    Loaded from PostgreSQL on every request; excludes password_hash.
    """
    return AuthService.get_current_user_profile(user=current_user)


@router.post(
    "/logout",
    response_model=LogoutResponse,
    status_code=status.HTTP_200_OK,
    summary="Stateless logout notification",
)
def logout(
    current_user: User = Depends(get_current_user),
) -> LogoutResponse:
    """Stateless logout. Notifies client to discard the access token.
    
    Does not claim token revocation since JWTs are stateless.
    """
    return LogoutResponse(message="Logged out successfully. Discard token on client.")
