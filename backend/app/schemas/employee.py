from datetime import date
from pydantic import BaseModel, ConfigDict, Field


class EmployeeCreate(BaseModel):
    employee_code: str = Field(min_length=1, max_length=30)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email: str = Field(max_length=255)
    department: str = Field(min_length=1, max_length=100)
    designation: str = Field(min_length=1, max_length=100)
    joining_date: date
    is_active: bool = True


class EmployeeUpdate(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=100)
    last_name: str | None = Field(default=None, min_length=1, max_length=100)
    email: str | None = Field(default=None, max_length=255)
    department: str | None = Field(default=None, min_length=1, max_length=100)
    designation: str | None = Field(default=None, min_length=1, max_length=100)
    joining_date: date | None = None
    is_active: bool | None = None


class EmployeeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_code: str
    first_name: str
    last_name: str
    email: str
    department: str
    designation: str
    joining_date: date
    is_active: bool
