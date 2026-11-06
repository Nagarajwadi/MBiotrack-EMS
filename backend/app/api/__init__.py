from app.api.assignments import router as assignments_router
from app.api.attendance import router as attendance_router
from app.api.audit_logs import router as audit_logs_router
from app.api.auth import router as auth_router
from app.api.devices import router as devices_router
from app.api.employees import router as employees_router
from app.api.holidays import router as holidays_router
from app.api.leaves import router as leaves_router
from app.api.offices import router as offices_router

__all__ = [
    "auth_router",
    "employees_router",
    "audit_logs_router",
    "offices_router",
    "assignments_router",
    "devices_router",
    "attendance_router",
    "leaves_router",
    "holidays_router",
]
