"""
Agent domain model.

Plain Python dataclass, NOT a SQLAlchemy model and NOT a Pydantic schema --
same rationale as app/world/models.py: the simulation engine must run
headlessly and mutate agent state every tick without implicit DB/session
behavior, and this is not a validated I/O boundary (schemas/agent_context.py
is, and Personality.as_dict()/emotional_state already match its shape).

`app/models/agent.py` (SQLAlchemy) is the separate persistence-layer
representation and is intentionally NOT modified in this step -- extending
it is Phase 1 Step 9 (DB models/migrations), per the agreed Phase 1 scope.

CRITICAL SEPARATION OF CONCERNS: this class holds data only. It has no
`decide()` method and no knowledge of DecisionStrategy/AgentContext. Decision
logic belongs to strategies implementing schemas/decision_strategy.py
(Phase 1 Step 7, Rule-Based), which will take a snapshot of this data
(via Perception, Step 5) as input and never mutate the Agent directly.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from app.agents.personality import Personality

if TYPE_CHECKING:
    from app.goals.models import Goal
    from app.needs.enums import NeedType
    from app.needs.models import Need


def _default_emotional_state() -> dict[str, float]:
    """
    Minimal MVP baseline: a single neutral 'mood' scalar in [0, 1].

    Emotional state is not specified in detail anywhere in the approved
    architecture beyond its type (dict[str, float] on AgentContext) --
    deliberately not inventing a richer affect model here. Needs (Step 3)
    is the system expected to actually drive emotional_state changes over
    ticks; this default is just a valid, harmless starting point.
    """
    return {"mood": 0.5}


@dataclass
class Agent:
    """
    One agent in the simulation. Fields match architecture.md's Agent
    class diagram exactly, with two Optional exceptions (location_id,
    household_id) to allow constructing an Agent before it's placed in a
    World -- the MVP generator (generator.py) always sets both.
    """

    id: uuid.UUID
    name: str
    age: int
    personality: Personality
    occupation: str
    wealth: float
    location_id: uuid.UUID | None = None
    household_id: uuid.UUID | None = None
    workplace_id: uuid.UUID | None = None
    emotional_state: dict[str, float] = field(default_factory=_default_emotional_state)
    social_status: float = 0.5
    needs: dict[Any, Any] = field(default_factory=dict)
    goals: list[Any] = field(default_factory=list)
    relationships: dict[uuid.UUID, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.age <= 0:
            raise ValueError(f"age must be positive, got {self.age}")
        if self.wealth < 0:
            raise ValueError(f"wealth cannot be negative, got {self.wealth}")
        if not (0.0 <= self.social_status <= 1.0):
            raise ValueError(f"social_status must be in [0.0, 1.0], got {self.social_status}")

