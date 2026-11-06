from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.assignments import router as assignments_router
from app.api.attendance import router as attendance_router
from app.api.audit_logs import router as audit_logs_router
from app.api.auth import router as auth_router
from app.api.devices import router as devices_router
from app.api.employees import router as employees_router
from app.api.holidays import router as holidays_router
from app.api.leaves import router as leaves_router
from app.api.offices import router as offices_router
from app.core.config import get_settings
from app.db.session import get_db

settings = get_settings()

is_production = (settings.ENVIRONMENT or "").strip().lower() in ("production", "prod")

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Employee Management System with Biometric Attendance Tracking",
    version=settings.VERSION,
    docs_url=None if is_production else "/docs",
    redoc_url=None if is_production else "/redoc",
    openapi_url=None if is_production else "/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

app.include_router(auth_router)
app.include_router(employees_router)
app.include_router(audit_logs_router)
app.include_router(assignments_router)
app.include_router(offices_router)
app.include_router(devices_router)
app.include_router(attendance_router)
app.include_router(leaves_router)
app.include_router(holidays_router)


@app.get("/health", tags=["Health"])
def health_check() -> dict[str, str]:
    return {"status": "ok", "application": "MBiotrack-EMS"}


@app.get("/health/ready", tags=["Health"])
def readiness_check(db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ready", "database": "connected"}
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database connectivity unavailable.",
        )


@app.get("/", tags=["Root"])
def root() -> dict[str, str]:
    response = {"message": "Welcome to MBiotrack-EMS"}
    if not is_production:
        response["docs"] = "/docs"
    return response
