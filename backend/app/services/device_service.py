from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.device import Device
from app.models.office import Office
from app.models.user import User
from app.schemas.device import DeviceCreate, DeviceUpdate


def _handle_device_integrity_error(exc: IntegrityError, db: Session) -> None:
    db.rollback()
    orig = getattr(exc, "orig", None)
    diag = getattr(orig, "diag", None)
    constraint_name = getattr(diag, "constraint_name", None)
    msg = str(orig or exc)

    if (
        constraint_name == "uq_devices_lower_device_code"
        or "uq_devices_lower_device_code" in msg
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Device code already exists",
        )

    if (
        constraint_name == "uq_devices_lower_serial_number"
        or "uq_devices_lower_serial_number" in msg
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Device serial number already exists",
        )

    if (
        constraint_name == "fk_devices_office_id"
        or "fk_devices_office_id" in msg
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Office not found",
        )

    if (
        constraint_name == "ck_devices_status"
        or "ck_devices_status" in msg
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid device status (must be ACTIVE, INACTIVE, or DECOMMISSIONED)",
        )

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Database constraint violation on device record.",
    )


class DeviceService:
    @staticmethod
    def create_device(
        db: Session,
        payload: DeviceCreate,
        current_user: User,
    ) -> Device:
        # 1. Office existence & active status check
        office = db.get(Office, payload.office_id)
        if office is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Office not found",
            )
        if not office.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot register a device to an inactive office.",
            )

        norm_code = payload.device_code.strip().upper()
        norm_serial = payload.serial_number.strip().upper()

        # 2. Application-level duplicate pre-checks
        existing_code = db.scalar(
            select(Device.id).where(
                func.lower(Device.device_code) == norm_code.lower()
            )
        )
        if existing_code is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Device code already exists",
            )

        existing_serial = db.scalar(
            select(Device.id).where(
                func.lower(Device.serial_number) == norm_serial.lower()
            )
        )
        if existing_serial is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Device serial number already exists",
            )

        # Status & active flag alignment
        is_active = payload.is_active
        if payload.status != "ACTIVE":
            is_active = False

        device = Device(
            office_id=payload.office_id,
            name=payload.name.strip(),
            device_code=norm_code,
            serial_number=norm_serial,
            model_name=payload.model_name.strip() if payload.model_name else None,
            ip_address=payload.ip_address.strip() if payload.ip_address else None,
            mac_address=payload.mac_address,
            status=payload.status,
            is_active=is_active,
        )

        db.add(device)
        try:
            db.flush()

            audit = AuditLog(
                actor_user_id=current_user.id,
                action="DEVICE_CREATE",
                target_type="device",
                target_id=str(device.id),
                metadata_={
                    "device_code": device.device_code,
                    "serial_number": device.serial_number,
                    "office_id": device.office_id,
                    "status": device.status,
                },
            )
            db.add(audit)

            db.commit()
            db.refresh(device)
            return device
        except IntegrityError as exc:
            _handle_device_integrity_error(exc, db)
            raise

    @staticmethod
    def list_devices(
        db: Session,
        office_id: int | None = None,
        status_filter: str | None = None,
        active_only: bool = False,
    ) -> list[Device]:
        stmt = select(Device).order_by(Device.device_code.asc())
        if office_id is not None:
            stmt = stmt.where(Device.office_id == office_id)
        if status_filter is not None:
            stmt = stmt.where(Device.status == status_filter.upper())
        if active_only:
            stmt = stmt.where(Device.is_active.is_(True))

        return list(db.scalars(stmt).all())

    @staticmethod
    def get_device_by_id(
        db: Session,
        device_id: int,
    ) -> Device:
        device = db.get(Device, device_id)
        if device is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Device not found",
            )
        return device

    @staticmethod
    def update_device(
        db: Session,
        device_id: int,
        payload: DeviceUpdate,
        current_user: User,
    ) -> Device:
        device = DeviceService.get_device_by_id(db, device_id)

        # Decommissioned devices cannot be modified
        if device.status == "DECOMMISSIONED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot modify a decommissioned device.",
            )

        changes: dict[str, str | int | bool | None] = {}

        if payload.office_id is not None and payload.office_id != device.office_id:
            target_office = db.get(Office, payload.office_id)
            if target_office is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Office not found",
                )
            if not target_office.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot reassign device to an inactive office.",
                )
            device.office_id = payload.office_id
            changes["office_id"] = device.office_id

        if payload.name is not None and payload.name.strip() != device.name:
            device.name = payload.name.strip()
            changes["name"] = device.name

        if payload.device_code is not None:
            norm_code = payload.device_code.strip().upper()
            if norm_code.lower() != device.device_code.lower():
                existing = db.scalar(
                    select(Device.id).where(
                        func.lower(Device.device_code) == norm_code.lower(),
                        Device.id != device_id,
                    )
                )
                if existing is not None:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Device code already exists",
                    )
                device.device_code = norm_code
                changes["device_code"] = norm_code

        if payload.serial_number is not None:
            norm_serial = payload.serial_number.strip().upper()
            if norm_serial.lower() != device.serial_number.lower():
                existing = db.scalar(
                    select(Device.id).where(
                        func.lower(Device.serial_number) == norm_serial.lower(),
                        Device.id != device_id,
                    )
                )
                if existing is not None:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Device serial number already exists",
                    )
                device.serial_number = norm_serial
                changes["serial_number"] = norm_serial

        if payload.model_name is not None:
            new_model = payload.model_name.strip() if payload.model_name else None
            if new_model != device.model_name:
                device.model_name = new_model
                changes["model_name"] = new_model

        if payload.ip_address is not None:
            new_ip = payload.ip_address.strip() if payload.ip_address else None
            if new_ip != device.ip_address:
                device.ip_address = new_ip
                changes["ip_address"] = new_ip

        if payload.mac_address is not None and payload.mac_address != device.mac_address:
            device.mac_address = payload.mac_address
            changes["mac_address"] = device.mac_address

        if payload.status is not None and payload.status != device.status:
            device.status = payload.status
            if device.status == "ACTIVE":
                device.is_active = True
            else:
                device.is_active = False
            changes["status"] = device.status
            changes["is_active"] = device.is_active

        if payload.is_active is not None and payload.is_active != device.is_active:
            device.is_active = payload.is_active
            if device.is_active and device.status == "INACTIVE":
                device.status = "ACTIVE"
            elif not device.is_active and device.status == "ACTIVE":
                device.status = "INACTIVE"
            changes["is_active"] = device.is_active
            changes["status"] = device.status

        if not changes:
            return device

        try:
            db.flush()

            audit = AuditLog(
                actor_user_id=current_user.id,
                action="DEVICE_UPDATE",
                target_type="device",
                target_id=str(device.id),
                metadata_={"changes": changes},
            )
            db.add(audit)

            db.commit()
            db.refresh(device)
            return device
        except IntegrityError as exc:
            _handle_device_integrity_error(exc, db)
            raise

    @staticmethod
    def decommission_device(
        db: Session,
        device_id: int,
        current_user: User,
    ) -> Device:
        device = DeviceService.get_device_by_id(db, device_id)
        if device.status == "DECOMMISSIONED":
            return device

        device.status = "DECOMMISSIONED"
        device.is_active = False

        try:
            db.flush()

            audit = AuditLog(
                actor_user_id=current_user.id,
                action="DEVICE_DECOMMISSION",
                target_type="device",
                target_id=str(device.id),
                metadata_={"device_code": device.device_code},
            )
            db.add(audit)

            db.commit()
            db.refresh(device)
            return device
        except IntegrityError as exc:
            _handle_device_integrity_error(exc, db)
            raise

    @staticmethod
    def deactivate_device(
        db: Session,
        device_id: int,
        current_user: User,
    ) -> Device:
        device = DeviceService.get_device_by_id(db, device_id)
        if device.status == "DECOMMISSIONED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot deactivate a decommissioned device.",
            )
        if not device.is_active:
            return device

        device.is_active = False
        device.status = "INACTIVE"

        try:
            db.flush()

            audit = AuditLog(
                actor_user_id=current_user.id,
                action="DEVICE_DEACTIVATE",
                target_type="device",
                target_id=str(device.id),
                metadata_={"device_code": device.device_code},
            )
            db.add(audit)

            db.commit()
            db.refresh(device)
            return device
        except IntegrityError as exc:
            _handle_device_integrity_error(exc, db)
            raise
