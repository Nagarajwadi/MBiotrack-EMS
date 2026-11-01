import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.main import app

settings = get_settings()


@pytest.fixture(scope="session")
def test_engine():
    """Verify safety requirements and initialize the session-level test engine."""
    test_url = settings.TEST_DATABASE_URL
    if not test_url:
        pytest.exit("CRITICAL: TEST_DATABASE_URL is not set. Aborting tests.", returncode=1)

    parsed = make_url(test_url)
    db_name = (parsed.database or "").lower()
    db_host = (parsed.host or "").lower()

    # Strict safety guards: require exact database name and local host
    if db_name != "mbiotrack_test":
        pytest.exit(
            f"CRITICAL: Refusing to run tests against database '{db_name}'. "
            "TEST_DATABASE_URL must target exactly 'mbiotrack_test'.",
            returncode=1,
        )

    if db_host not in ("localhost", "127.0.0.1"):
        pytest.exit(
            f"CRITICAL: Refusing to run tests against non-local host '{db_host}'. "
            "Host must be 'localhost' or '127.0.0.1'.",
            returncode=1,
        )

    # Never fall back to DATABASE_URL or allow dev database in test run
    if settings.DATABASE_URL:
        dev_parsed = make_url(settings.DATABASE_URL)
        if (dev_parsed.database or "").lower() == db_name:
            pytest.exit(
                "CRITICAL: TEST_DATABASE_URL matches DATABASE_URL. "
                "Test and dev databases must be separate.",
                returncode=1,
            )

    engine = create_engine(
        test_url,
        pool_pre_ping=True,
    )
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(test_engine):
    """Provide a database session isolated within a transaction savepoint.
    
    Any commit within endpoints commits only to the savepoint; outer transaction
    rolls back on teardown so zero test data persists.
    """
    connection = test_engine.connect()
    transaction = connection.begin()

    session = Session(
        bind=connection,
        join_transaction_mode="create_savepoint",
        expire_on_commit=False,
    )

    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def client(db_session):
    """Provide FastAPI TestClient with get_db overridden to use the savepoint session."""
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()
