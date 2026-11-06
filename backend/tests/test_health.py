from unittest.mock import MagicMock

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.db.session import get_db
from app.main import app
import app.main as app_module


def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "application": "MBiotrack-EMS",
    }


def test_health_ready_success(client):
    """Readiness endpoint returns HTTP 200 when database connectivity is healthy."""
    response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "database": "connected",
    }


def test_health_ready_failure():
    """Readiness endpoint returns HTTP 503 and safe generic detail when database query fails."""
    def failing_get_db():
        mock_session = MagicMock()
        mock_session.execute.side_effect = OperationalError("connection refused", None, None)
        yield mock_session

    app.dependency_overrides[get_db] = failing_get_db
    try:
        with TestClient(app) as test_client:
            response = test_client.get("/health/ready")
            assert response.status_code == 503
            assert response.json() == {"detail": "Database connectivity unavailable."}
            # Verify no connection strings, passwords, or raw exceptions leak
            assert "connection refused" not in response.text
            assert "postgresql" not in response.text
    finally:
        app.dependency_overrides.clear()


def test_root(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {
        "message": "Welcome to MBiotrack-EMS",
        "docs": "/docs",
    }


def test_root_in_production(monkeypatch):
    """Root endpoint omits documentation link when running in production."""
    monkeypatch.setattr(app_module, "is_production", True)
    response = app_module.root()
    assert response == {"message": "Welcome to MBiotrack-EMS"}
    assert "docs" not in response


def test_api_documentation_available_in_development(client):
    """In development, interactive documentation and OpenAPI spec remain accessible."""
    docs_res = client.get("/docs")
    assert docs_res.status_code == 200

    openapi_res = client.get("/openapi.json")
    assert openapi_res.status_code == 200
    assert "openapi" in openapi_res.json()


def test_api_documentation_disabled_in_production():
    """When initialized with production settings, docs and openapi routes are strictly disabled."""
    from fastapi import FastAPI
    from app.core.config import get_settings

    settings = get_settings()
    prod_app = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    with TestClient(prod_app) as prod_client:
        assert prod_client.get("/docs").status_code == 404
        assert prod_client.get("/redoc").status_code == 404
        assert prod_client.get("/openapi.json").status_code == 404


def test_cors_preflight(client):
    response = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"

