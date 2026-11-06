import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

VALID_STATUSES = ("ACTIVE", "INACTIVE", "DECOMMISSIONED")


class DeviceCreate(BaseModel):
    office_id: int = Field(gt=0, description="Associated office ID")
    name: str = Field(min_length=1, max_length=150, description="Device descriptive name")
    device_code: str = Field(min_length=1, max_length=50, description="Unique natural device code")
    serial_number: str = Field(min_length=1, max_length=100, description="Hardware serial number")
    model_name: str | None = Field(default=None, max_length=100, description="Hardware model name")
    ip_address: str | None = Field(default=None, max_length=45, description="Static or assigned IP address")
    mac_address: str | None = Field(default=None, max_length=17, description="Hardware MAC address")
    status: Literal["ACTIVE", "INACTIVE", "DECOMMISSIONED"] = "ACTIVE"
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Device name cannot be empty.")
        return cleaned

    @field_validator("device_code")
    @classmethod
    def validate_device_code(cls, v: str) -> str:
        cleaned = v.strip().upper()
        if not cleaned:
            raise ValueError("Device code cannot be empty.")
        return cleaned

    @field_validator("serial_number")
    @classmethod
    def validate_serial_number(cls, v: str) -> str:
        cleaned = v.strip().upper()
        if not cleaned:
            raise ValueError("Serial number cannot be empty.")
        return cleaned

    @field_validator("mac_address")
    @classmethod
    def validate_mac_address(cls, v: str | None) -> str | None:
        if v is not None:
            cleaned = v.strip().upper()
            if not cleaned:
                return None
            if not re.match(r"^([0-9A-F]{2}[:-]){5}([0-9A-F]{2})$", cleaned):
                raise ValueError("Invalid MAC address format (expected XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX).")
            return cleaned
        return None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in VALID_STATUSES:
            raise ValueError(f"Status must be one of: {', '.join(VALID_STATUSES)}")
        return v


class DeviceUpdate(BaseModel):
    office_id: int | None = Field(default=None, gt=0)
    name: str | None = Field(default=None, min_length=1, max_length=150)
    device_code: str | None = Field(default=None, min_length=1, max_length=50)
    serial_number: str | None = Field(default=None, min_length=1, max_length=100)
    model_name: str | None = Field(default=None, max_length=100)
    ip_address: str | None = Field(default=None, max_length=45)
    mac_address: str | None = Field(default=None, max_length=17)
    status: Literal["ACTIVE", "INACTIVE", "DECOMMISSIONED"] | None = None
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        if v is not None:
            cleaned = v.strip()
            if not cleaned:
                raise ValueError("Device name cannot be empty.")
            return cleaned
        return v

    @field_validator("device_code")
    @classmethod
    def validate_device_code(cls, v: str | None) -> str | None:
        if v is not None:
            cleaned = v.strip().upper()
            if not cleaned:
                raise ValueError("Device code cannot be empty.")
            return cleaned
        return v

    @field_validator("serial_number")
    @classmethod
    def validate_serial_number(cls, v: str | None) -> str | None:
        if v is not None:
            cleaned = v.strip().upper()
            if not cleaned:
                raise ValueError("Serial number cannot be empty.")
            return cleaned
        return v

    @field_validator("mac_address")
    @classmethod
    def validate_mac_address(cls, v: str | None) -> str | None:
        if v is not None:
            cleaned = v.strip().upper()
            if not cleaned:
                return None
            if not re.match(r"^([0-9A-F]{2}[:-]){5}([0-9A-F]{2})$", cleaned):
                raise ValueError("Invalid MAC address format (expected XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX).")
            return cleaned
        return None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_STATUSES:
            raise ValueError(f"Status must be one of: {', '.join(VALID_STATUSES)}")
        return v


class DeviceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    office_id: int
    name: str
    device_code: str
    serial_number: str
    model_name: str | None
    ip_address: str | None
    mac_address: str | None
    status: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
