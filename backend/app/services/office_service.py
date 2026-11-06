from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.office import Office
from app.models.user import User
from app.schemas.office import OfficeCreate, OfficeUpdate


def _handle_office_integrity_error(exc: IntegrityError, db: Session) -> None:
    db.rollback()
    orig = getattr(exc, "orig", None)
    diag = getattr(orig, "diag", None)
    constraint_name = getattr(diag, "constraint_name", None)

    if constraint_name == "uq_offices_lower_code":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Office code already exists",
        )

    msg = str(orig or exc)
    if "uq_offices_lower_code" in msg:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Office code already exists",
        )
    if "invalid_parameter_value" in msg or "Invalid IANA timezone identifier" in msg:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid IANA timezone identifier",
        )

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Database constraint violation",
    )


class OfficeService:
    @staticmethod
    def create_office(
        db: Session,
        payload: OfficeCreate,
        current_user: User,
    ) -> Office:
        norm_code = payload.code.strip().upper()

        # Application-level duplicate pre-check
        existing_code = db.scalar(
            select(Office.id).where(
                func.lower(Office.code) == norm_code.lower()
            )
        )
        if existing_code is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Office code already exists",
            )

        office = Office(
            name=payload.name.strip(),
            code=norm_code,
            timezone=payload.timezone,
            address=payload.address.strip() if payload.address else None,
            is_active=payload.is_active,
        )

        db.add(office)
        try:
            db.flush()

            audit = AuditLog(
                actor_user_id=current_user.id,
                action="OFFICE_CREATE",
                target_type="office",
                target_id=str(office.id),
                metadata_={
                    "code": office.code,
                    "name": office.name,
                    "timezone": office.timezone,
                },
            )
            db.add(audit)

            db.commit()
            db.refresh(office)
            return office
        except IntegrityError as exc:
            _handle_office_integrity_error(exc, db)
            raise

    @staticmethod
    def list_offices(
        db: Session,
        active_only: bool = False,
    ) -> list[Office]:
        stmt = select(Office).order_by(Office.code.asc())
        if active_only:
            stmt = stmt.where(Office.is_active.is_(True))
        return list(db.scalars(stmt).all())

    @staticmethod
    def get_office_by_id(
        db: Session,
        office_id: int,
    ) -> Office:
        office = db.get(Office, office_id)
        if office is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Office not found",
            )
        return office

    @staticmethod
    def update_office(
        db: Session,
        office_id: int,
        payload: OfficeUpdate,
        current_user: User,
    ) -> Office:
        office = OfficeService.get_office_by_id(db, office_id)

        changes: dict[str, str | bool | None] = {}
        if payload.name is not None and payload.name.strip() != office.name:
            office.name = payload.name.strip()
            changes["name"] = office.name

        if payload.code is not None:
            norm_code = payload.code.strip().upper()
            if norm_code.lower() != office.code.lower():
                existing = db.scalar(
                    select(Office.id).where(
                        func.lower(Office.code) == norm_code.lower(),
                        Office.id != office_id,
                    )
                )
                if existing is not None:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Office code already exists",
                    )
                office.code = norm_code
                changes["code"] = norm_code

        if payload.timezone is not None and payload.timezone != office.timezone:
            office.timezone = payload.timezone
            changes["timezone"] = office.timezone

        if payload.address is not None:
            new_addr = payload.address.strip() if payload.address else None
            if new_addr != office.address:
                office.address = new_addr
                changes["address"] = new_addr

        if payload.is_active is not None and payload.is_active != office.is_active:
            office.is_active = payload.is_active
            changes["is_active"] = office.is_active

        if not changes:
            return office

        try:
            db.flush()

            audit = AuditLog(
                actor_user_id=current_user.id,
                action="OFFICE_UPDATE",
                target_type="office",
                target_id=str(office.id),
                metadata_={"changes": changes},
            )
            db.add(audit)

            db.commit()
            db.refresh(office)
            return office
        except IntegrityError as exc:
            _handle_office_integrity_error(exc, db)
            raise

    @staticmethod
    def deactivate_office(
        db: Session,
        office_id: int,
        current_user: User,
    ) -> Office:
        office = OfficeService.get_office_by_id(db, office_id)
        if not office.is_active:
            return office

        office.is_active = False
        try:
            db.flush()

            audit = AuditLog(
                actor_user_id=current_user.id,
                action="OFFICE_DEACTIVATE",
                target_type="office",
                target_id=str(office.id),
                metadata_={"code": office.code},
            )
            db.add(audit)

            db.commit()
            db.refresh(office)
            return office
        except IntegrityError as exc:
            _handle_office_integrity_error(exc, db)
            raise
