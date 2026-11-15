"""
Shared SQLAlchemy declarative base. All ORM models import from here so
Alembic autogenerate can discover every table from one metadata object.
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
