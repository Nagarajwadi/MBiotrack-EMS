from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.auth import get_client_ip
from app.db.session import get_db
from app.dependencies.auth import require_role
from app.models.user import User
from app.schemas.auth import MessageResponse
from app.schemas.user import (
    PasswordResetRequest,
    UserAccountResponse,
    UserCreate,
    UserRoleUpdate,
    UserStatusUpdate,
)
from app.services.user_service import UserService

router = APIRouter(prefix="/api/v1/users", tags=["Users"])


@router.get("", response_model=list[UserAccountResponse])
def list_users(
    is_active: bool | None = Query(default=None, description="Filter by active status"),
    role: str | None = Query(default=None, description="Filter by role"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    return UserService.list_users(
        db=db,
        current_user=current_user,
        is_active=is_active,
        role=role,
    )


@router.post("", response_model=UserAccountResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    return UserService.create_user(
        db=db,
        payload=payload,
        current_user=current_user,
    )


@router.get("/{user_id}", response_model=UserAccountResponse)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    return UserService.get_user(
        db=db,
        user_id=user_id,
        current_user=current_user,
    )


@router.patch("/{user_id}/status", response_model=UserAccountResponse)
def update_user_status(
    user_id: int,
    payload: UserStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    return UserService.update_user_status(
        db=db,
        user_id=user_id,
        payload=payload,
        current_user=current_user,
    )


@router.patch("/{user_id}/role", response_model=UserAccountResponse)
def update_user_role(
    user_id: int,
    payload: UserRoleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    return UserService.update_user_role(
        db=db,
        user_id=user_id,
        payload=payload,
        current_user=current_user,
    )


@router.post(
    "/{user_id}/reset-password",
    response_model=MessageResponse,
    status_code=status.HTTP_200_OK,
    summary="Reset a user account password (Admin only)",
)
def reset_password(
    user_id: int,
    payload: PasswordResetRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("ADMIN")),
):
    client_ip = get_client_ip(request)
    return UserService.reset_password(
        db=db,
        user_id=user_id,
        payload=payload,
        current_user=current_user,
        client_ip=client_ip,
    )
