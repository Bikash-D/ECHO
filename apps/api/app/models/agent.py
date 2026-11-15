"""
`agents` table -- PLACEHOLDER ONLY.

Phase 0 scope explicitly limits this to enough columns to prove the
migration/FK pipeline works end-to-end. The full agent schema
(personality, wealth, location_id, household_id, emotional_state,
social_status, and the related agent_needs / agent_goals / memories /
relationships tables from the ER diagram in architecture.md Section 3)
is deliberately deferred to Phase 1. Do not add business fields here
without going through Phase 1.
"""

import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    simulation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("simulations.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
