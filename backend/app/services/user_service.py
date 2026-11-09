from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.audit_log import AuditLog
from app.models.employee import Employee
from app.models.user import User
from app.schemas.auth import MessageResponse
from app.schemas.user import (
    PasswordResetRequest,
    UserAccountResponse,
    UserCreate,
    UserStatusUpdate,
)


def _map_to_response(user: User) -> UserAccountResponse:
    emp = user.employee
    return UserAccountResponse(
        id=user.id,
        employee_id=user.employee_id,
        full_name=user.full_name,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        updated_at=user.updated_at,
        employee_code=emp.employee_code if emp else None,
        department=emp.department if emp else None,
    )


class UserService:
    @staticmethod
    def list_users(
        db: Session,
        current_user: User,
        is_active: bool | None = None,
        role: str | None = None,
    ) -> list[UserAccountResponse]:
        if current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operation not permitted for the current user role.",
            )

        query = select(User).order_by(User.id.asc())
        if is_active is not None:
            query = query.where(User.is_active == is_active)
        if role is not None:
            query = query.where(User.role == role)

        users = db.scalars(query).all()
        return [_map_to_response(u) for u in users]

    @staticmethod
    def get_user(
        db: Session,
        user_id: int,
        current_user: User,
    ) -> UserAccountResponse:
        if current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operation not permitted for the current user role.",
            )

        user = db.get(User, user_id)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User account not found.",
            )
        return _map_to_response(user)

    @staticmethod
    def create_user(
        db: Session,
        payload: UserCreate,
        current_user: User,
    ) -> UserAccountResponse:
        if current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operation not permitted for the current user role.",
            )

        # 1. Look up employee
        employee = db.scalar(
            select(Employee).where(
                Employee.id == payload.employee_id,
            )
        )
        if employee is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Employee not found.",
            )

        # 2. Inactive / deleted employee restriction
        if not employee.is_active or employee.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot create a login account for an inactive or deactivated employee.",
            )

        # 3. Prevent duplicate account for same employee
        existing_account = db.scalar(
            select(User.id).where(User.employee_id == employee.id)
        )
        if existing_account is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A login account already exists for this employee.",
            )

        # 4. Role restriction
        if payload.role not in ("EMPLOYEE", "MANAGER"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only EMPLOYEE or MANAGER accounts can be created through this workflow.",
            )

        # 5. Resolve and validate email
        target_email = payload.email if payload.email else employee.email.strip().lower()
        norm_email = target_email.strip().lower()

        existing_email_user = db.scalar(
            select(User.id).where(func.lower(User.email) == norm_email)
        )
        if existing_email_user is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A user account with this email address already exists.",
            )

        # 6. Build user object
        full_name = f"{employee.first_name} {employee.last_name}".strip()
        pwd_hash = hash_password(payload.initial_password)

        new_user = User(
            employee_id=employee.id,
            full_name=full_name,
            email=norm_email,
            password_hash=pwd_hash,
            role=payload.role,
            is_active=True,
        )

        try:
            db.add(new_user)
            db.flush()

            audit = AuditLog(
                actor_user_id=current_user.id,
                action="USER_CREATE",
                target_type="user",
                target_id=str(new_user.id),
                ip_address=None,
                metadata_={
                    "employee_id": employee.id,
                    "employee_code": employee.employee_code,
                    "email": new_user.email,
                    "role": new_user.role,
                },
            )
            db.add(audit)
            db.commit()
            db.refresh(new_user)
            return _map_to_response(new_user)
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Database integrity conflict occurred during user creation.",
            )
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def update_user_status(
        db: Session,
        user_id: int,
        payload: UserStatusUpdate,
        current_user: User,
    ) -> UserAccountResponse:
        if current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operation not permitted for the current user role.",
            )

        user = db.get(User, user_id)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User account not found.",
            )

        # Prevent admin self-disable
        if user.id == current_user.id and payload.is_active is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Administrators cannot disable their own account.",
            )

        old_status = user.is_active
        user.is_active = payload.is_active
        user.updated_at = func.now()

        try:
            audit = AuditLog(
                actor_user_id=current_user.id,
                action="USER_STATUS_UPDATE",
                target_type="user",
                target_id=str(user.id),
                ip_address=None,
                metadata_={
                    "previous_is_active": old_status,
                    "new_is_active": user.is_active,
                    "role": user.role,
                },
            )
            db.add(audit)
            db.commit()
            db.refresh(user)
            return _map_to_response(user)
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Database conflict during status update.",
            )
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def reset_password(
        db: Session,
        user_id: int,
        payload: PasswordResetRequest,
        current_user: User,
        client_ip: str | None = None,
    ) -> MessageResponse:
        """Administrator password reset for target user account."""
        if current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operation not permitted for the current user role.",
            )

        user = db.get(User, user_id)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User account not found.",
            )

        new_hash = hash_password(payload.new_password)
        user.password_hash = new_hash
        user.updated_at = func.now()

        try:
            audit = AuditLog(
                actor_user_id=current_user.id,
                action="AUTH_PASSWORD_RESET",
                target_type="user",
                target_id=str(user.id),
                ip_address=client_ip,
                metadata_={
                    "target_user_id": user.id,
                    "target_role": user.role,
                    "target_email": user.email,
                },
            )
            db.add(audit)
            db.commit()
            db.refresh(user)
            return MessageResponse(message="Password reset successfully.")
        except Exception:
            db.rollback()
            raise
