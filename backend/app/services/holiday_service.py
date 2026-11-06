from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.holiday import Holiday
from app.models.office import Office
from app.models.user import User
from app.schemas.holiday import (
    HolidayCreate,
    HolidayDetail,
    HolidayListResponse,
    HolidayUpdate,
)


class HolidayService:
    """Service handling holiday calendar management and listing."""

    @staticmethod
    def _to_detail(h: Holiday) -> HolidayDetail:
        off = h.office
        return HolidayDetail(
            id=h.id,
            holiday_date=h.holiday_date,
            name=h.name,
            description=h.description,
            office_id=h.office_id,
            office_name=off.name if off else None,
            office_code=off.code if off else None,
            is_optional=h.is_optional,
            created_by_user_id=h.created_by_user_id,
            created_at=h.created_at,
            updated_at=h.updated_at,
        )

    @staticmethod
    def create_holiday(
        db: Session,
        current_user: User,
        payload: HolidayCreate,
    ) -> HolidayDetail:
        """Create a new holiday entry (Admin only)."""
        if current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only administrators can manage holidays.",
            )

        if payload.office_id is not None:
            office = db.get(Office, payload.office_id)
            if not office:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Office not found.",
                )

        # Check for duplicates using the partial-index logic
        if payload.office_id is None:
            dup_check = select(Holiday.id).where(
                Holiday.holiday_date == payload.holiday_date,
                Holiday.office_id.is_(None),
            )
        else:
            dup_check = select(Holiday.id).where(
                Holiday.holiday_date == payload.holiday_date,
                Holiday.office_id == payload.office_id,
            )

        if db.scalar(dup_check):
            scope_desc = "organization-wide" if payload.office_id is None else f"for office #{payload.office_id}"
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A holiday is already registered {scope_desc} on {payload.holiday_date}.",
            )

        new_holiday = Holiday(
            holiday_date=payload.holiday_date,
            name=payload.name,
            description=payload.description,
            office_id=payload.office_id,
            is_optional=payload.is_optional,
            created_by_user_id=current_user.id,
        )
        db.add(new_holiday)
        db.flush()

        audit = AuditLog(
            actor_user_id=current_user.id,
            action="HOLIDAY_CREATED",
            target_type="holiday",
            target_id=str(new_holiday.id),
            metadata_={
                "holiday_date": str(new_holiday.holiday_date),
                "name": new_holiday.name,
                "office_id": new_holiday.office_id,
                "is_optional": new_holiday.is_optional,
            },
        )
        db.add(audit)

        db.commit()
        db.refresh(new_holiday)
        return HolidayService._to_detail(new_holiday)

    @staticmethod
    def update_holiday(
        db: Session,
        current_user: User,
        holiday_id: int,
        payload: HolidayUpdate,
    ) -> HolidayDetail:
        """Update an existing holiday entry (Admin only)."""
        if current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only administrators can manage holidays.",
            )

        holiday = db.get(Holiday, holiday_id)
        if not holiday:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Holiday not found.",
            )

        new_date = payload.holiday_date if payload.holiday_date is not None else holiday.holiday_date
        new_office_id = payload.office_id if payload.office_id is not None else holiday.office_id

        # If office_id is being explicitly updated to a non-null value, check office existence
        if payload.office_id is not None:
            office = db.get(Office, payload.office_id)
            if not office:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Office not found.",
                )

        # Check duplicates if date or office changed
        if new_date != holiday.holiday_date or new_office_id != holiday.office_id:
            if new_office_id is None:
                dup_check = select(Holiday.id).where(
                    Holiday.holiday_date == new_date,
                    Holiday.office_id.is_(None),
                    Holiday.id != holiday_id,
                )
            else:
                dup_check = select(Holiday.id).where(
                    Holiday.holiday_date == new_date,
                    Holiday.office_id == new_office_id,
                    Holiday.id != holiday_id,
                )
            if db.scalar(dup_check):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"A holiday is already registered on {new_date} for this office scope.",
                )

        if payload.holiday_date is not None:
            holiday.holiday_date = payload.holiday_date
        if payload.name is not None:
            holiday.name = payload.name
        if payload.description is not None:
            holiday.description = payload.description
        if payload.office_id is not None:
            holiday.office_id = payload.office_id
        if payload.is_optional is not None:
            holiday.is_optional = payload.is_optional

        audit = AuditLog(
            actor_user_id=current_user.id,
            action="HOLIDAY_UPDATED",
            target_type="holiday",
            target_id=str(holiday.id),
            metadata_={
                "holiday_date": str(holiday.holiday_date),
                "name": holiday.name,
                "office_id": holiday.office_id,
                "is_optional": holiday.is_optional,
            },
        )
        db.add(audit)

        db.commit()
        db.refresh(holiday)
        return HolidayService._to_detail(holiday)

    @staticmethod
    def delete_holiday(
        db: Session,
        current_user: User,
        holiday_id: int,
    ) -> None:
        """Delete an existing holiday entry (Admin only)."""
        if current_user.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only administrators can manage holidays.",
            )

        holiday = db.get(Holiday, holiday_id)
        if not holiday:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Holiday not found.",
            )

        old_id = holiday.id
        old_name = holiday.name
        old_date = str(holiday.holiday_date)

        db.delete(holiday)

        audit = AuditLog(
            actor_user_id=current_user.id,
            action="HOLIDAY_DELETED",
            target_type="holiday",
            target_id=str(old_id),
            metadata_={
                "name": old_name,
                "holiday_date": old_date,
            },
        )
        db.add(audit)

        db.commit()

    @staticmethod
    def list_holidays(
        db: Session,
        current_user: User,
        office_id: int | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        include_org_wide: bool = True,
    ) -> HolidayListResponse:
        """Query holidays with date range and office scoping (all authenticated roles)."""
        query = select(Holiday)

        if office_id is not None:
            if include_org_wide:
                query = query.where(
                    (Holiday.office_id == office_id) | (Holiday.office_id.is_(None))
                )
            else:
                query = query.where(Holiday.office_id == office_id)

        if start_date is not None:
            query = query.where(Holiday.holiday_date >= start_date)

        if end_date is not None:
            query = query.where(Holiday.holiday_date <= end_date)

        query = query.order_by(Holiday.holiday_date.asc(), Holiday.id.asc())
        rows = list(db.scalars(query).all())

        return HolidayListResponse(
            items=[HolidayService._to_detail(h) for h in rows],
            total=len(rows),
        )
