"""
Business domain model.

Plain Python dataclass, NOT a SQLAlchemy model and NOT a Pydantic schema --
same rationale as app/world/models.py and app/agents/agent.py: it is
mutated every tick during the simulation loop and must not carry implicit
DB/session behavior.

This is the smallest real link between a workplace Location (already
existing, see app/world/models.py) and an actual economic consequence of
work happening there. Matches architecture.md's ER diagram entity
`BUSINESSES { uuid id PK  uuid location_id FK  string name  float cash
json price_table }`, minus `price_table`: per-good pricing/supply-demand
is explicitly future scope (see app/economy/production.py's module
docstring), so no unused field is added ahead of the milestone that
would actually read/write it.

One Business per economic Location for MVP (see world/models.py's
ECONOMIC_LOCATION_TYPES: WORKPLACE and MARKET) -- not the general
N-businesses-per-location the ER diagram's
`LOCATIONS ||--o{ BUSINESSES : hosts` cardinality allows for. That is a
future extension (e.g. multiple shops sharing one building), not needed
by anything in this milestone.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass


@dataclass
class Business:
    """The economic entity that occupies a workplace Location."""

    id: uuid.UUID
    location_id: uuid.UUID
    name: str
    cash: float = 0.0

    def record_shift(self, output_value: float, wage: float) -> None:
        """
        Apply the economic consequence of one completed work shift.

        `output_value` (what the shift produced) is added to the
        business's cash as revenue; `wage` (what the business pays the
        worker for it) is deducted as a labor cost. The business keeps
        the difference as retained profit -- which can be negative if a
        wage table is ever configured to pay more than an occupation
        produces, and that is deliberately visible here rather than
        clamped, since this is meant to be the seam a future pricing/
        labor-market milestone extends, not a bottomless account.
        """
        self.cash = round(self.cash + output_value - wage, 2)

    def record_sale(self, amount: float) -> None:
        """
        Apply the economic consequence of one completed purchase (e.g. a
        market selling food to a consuming agent). Unlike `record_shift`,
        there is no cost side here -- the whole payment is revenue. This
        is what makes an agent's spending an actual event on the
        world's economic state instead of money vanishing into an
        untracked cost with no counterpart.
        """
        self.cash = round(self.cash + amount, 2)
