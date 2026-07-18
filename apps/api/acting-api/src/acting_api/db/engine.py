from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker


def normalize_database_url(database_url: str) -> str:
    """Select psycopg3 for standard PostgreSQL URL schemes."""
    normalized = database_url.strip()
    if not normalized:
        raise RuntimeError("DATABASE_URL is required")
    if normalized.startswith("postgres://"):
        return normalized.replace("postgres://", "postgresql+psycopg://", 1)
    if normalized.startswith("postgresql://"):
        return normalized.replace("postgresql://", "postgresql+psycopg://", 1)
    return normalized


def create_db_engine(database_url: str, **kwargs) -> Engine:
    return create_engine(normalize_database_url(database_url), **kwargs)


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)
