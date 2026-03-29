"""
Table creation via SQLAlchemy ORM models.

Alembic handles real migrations; create_all() is a safety net for fresh installs.
"""
from core.models import db


def init_table():
    """Ensure all tables exist (safety net — Alembic handles migrations)."""
    db.create_all()
