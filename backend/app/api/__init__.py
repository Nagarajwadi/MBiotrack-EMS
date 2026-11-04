from app.api.audit_logs import router as audit_logs_router
from app.api.auth import router as auth_router
from app.api.employees import router as employees_router

__all__ = ["auth_router", "employees_router", "audit_logs_router"]
