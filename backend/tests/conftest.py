from datetime import date
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, derive_pwd_fingerprint, hash_password
from app.db.session import get_db
from app.main import app
from app.models.employee import Employee
from app.models.user import User

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


@pytest.fixture
def dev_db_session(db_session):
    """Alias dev_db_session to central db_session using TEST_DATABASE_URL."""
    return db_session


@pytest.fixture
def dev_client(client):
    """Alias dev_client to central client using TEST_DATABASE_URL."""
    return client


@pytest.fixture
def admin_user(dev_db_session: Session) -> User:
    """Create an active ADMIN user conforming to password-hashing and model conventions."""
    user = User(
        full_name="Central Administrator",
        email="central.admin@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="ADMIN",
        employee_id=None,
        is_active=True,
    )
    dev_db_session.add(user)
    dev_db_session.flush()
    return user


@pytest.fixture
def manager_user(dev_db_session: Session) -> User:
    """Create an active MANAGER user with a valid linked Employee."""
    emp = Employee(
        employee_code="EMP-MGR-CENTRAL",
        first_name="Central",
        last_name="Manager",
        email="central.manager@example.com",
        department="Operations",
        designation="Operations Manager",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    dev_db_session.add(emp)
    dev_db_session.flush()

    user = User(
        full_name="Central Manager",
        email="central.manager@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="MANAGER",
        employee_id=emp.id,
        is_active=True,
    )
    dev_db_session.add(user)
    dev_db_session.flush()
    return user


@pytest.fixture
def employee_user(dev_db_session: Session) -> User:
    """Create an active EMPLOYEE user with a valid linked Employee."""
    emp = Employee(
        employee_code="EMP-USR-CENTRAL",
        first_name="Central",
        last_name="Employee",
        email="central.employee@example.com",
        department="Engineering",
        designation="Software Engineer",
        joining_date=date(2025, 1, 1),
        is_active=True,
    )
    dev_db_session.add(emp)
    dev_db_session.flush()

    user = User(
        full_name="Central Employee",
        email="central.employee@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="EMPLOYEE",
        employee_id=emp.id,
        is_active=True,
    )
    dev_db_session.add(user)
    dev_db_session.flush()
    return user


@pytest.fixture
def admin_headers(admin_user: User) -> dict[str, str]:
    token = create_access_token(
        subject=admin_user.id,
        extra_claims={
            "role": admin_user.role,
            "pwd": derive_pwd_fingerprint(admin_user.password_hash),
        },
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def manager_headers(manager_user: User) -> dict[str, str]:
    token = create_access_token(
        subject=manager_user.id,
        extra_claims={
            "role": manager_user.role,
            "pwd": derive_pwd_fingerprint(manager_user.password_hash),
        },
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def employee_headers(employee_user: User) -> dict[str, str]:
    token = create_access_token(
        subject=employee_user.id,
        extra_claims={
            "role": employee_user.role,
            "pwd": derive_pwd_fingerprint(employee_user.password_hash),
        },
    )
    return {"Authorization": f"Bearer {token}"}
