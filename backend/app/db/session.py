from collections.abc import Generator
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    """Return or initialize the singleton SQLAlchemy Engine.
    
    Initializes lazily so importing this module does not attempt database
    connections or fail if DATABASE_URL is not configured yet.
    """
    global _engine, _SessionLocal
    if _engine is None:
        if not settings.DATABASE_URL:
            raise RuntimeError(
                "DATABASE_URL is not configured. Please configure it in your .env file."
            )
        _engine = create_engine(
            settings.DATABASE_URL,
            pool_pre_ping=settings.DB_POOL_PRE_PING,
            pool_size=settings.DB_POOL_SIZE,
            max_overflow=settings.DB_MAX_OVERFLOW,
            pool_timeout=settings.DB_POOL_TIMEOUT,
            echo=settings.DB_ECHO,
        )
        _SessionLocal = sessionmaker(
            autocommit=False,
            autoflush=False,
            bind=_engine,
            expire_on_commit=False,
        )
    return _engine


def get_sessionmaker() -> sessionmaker[Session]:
    """Return the sessionmaker bound to the active engine."""
    get_engine()
    assert _SessionLocal is not None
    return _SessionLocal


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a database session and closing it on completion."""
    session_factory = get_sessionmaker()
    db = session_factory()
    try:
        yield db
    finally:
        db.close()

