"""
`simulations` table.

Phase 0 scope: enough to prove the DB pipeline end-to-end (migration
applies, a row can be written/read). The full reproducibility fields
described in architecture.md Section 3 (config, scenario_id, version
etc.) are represented here since they cost nothing to declare now and
are needed immediately once Phase 1 begins in earnest.
"""

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base


class Simulation(Base):
    __tablename__ = "simulations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    seed: Mapped[int] = mapped_column(Integer, nullable=False)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    scenario_id: Mapped[str | None] = mapped_column(String, nullable=True)
    version: Mapped[str] = mapped_column(String, default="0.0.0-phase0")
    status: Mapped[str] = mapped_column(String, default="initialized")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
