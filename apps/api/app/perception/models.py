"""
Perception domain models for ECHO agents.

Defines transient snapshots of what an agent perceives at a given tick.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from app.schemas.agent_context import PerceivedWorldState
from app.world.enums import LocationType

if TYPE_CHECKING:
    from app.agents.agent import Agent
    from app.world.models import Location


@dataclass
class PerceivedAgent:
    """
    Visible external state of another agent co-located at the same location.
    Agents can perceive basic surface attributes of peers in the same room/location.
    """

    id: uuid.UUID
    name: str
    occupation: str
    social_status: float
    emotional_state: dict[str, float] = field(default_factory=dict)

    @classmethod
    def from_agent(cls, agent: Agent) -> PerceivedAgent:
        return cls(
            id=agent.id,
            name=agent.name,
            occupation=agent.occupation,
            social_status=round(agent.social_status, 3),
            emotional_state=dict(agent.emotional_state),
        )


@dataclass
class PerceivedLocation:
    """
    Visible location in the agent's current neighborhood.
    """

    id: uuid.UUID
    name: str
    location_type: LocationType
    neighborhood_id: uuid.UUID

    @classmethod
    def from_location(cls, loc: Location) -> PerceivedLocation:
        return cls(
            id=loc.id,
            name=loc.name,
            location_type=loc.location_type,
            neighborhood_id=loc.neighborhood_id,
        )


@dataclass
class PerceptionSnapshot:
    """
    Transient snapshot of what one agent perceives during a simulation tick.

    Perception is strictly transient and reconstructed fresh each tick;
    it is never persisted on the Agent domain model.
    """

    tick: int
    agent_id: uuid.UUID
    location_id: uuid.UUID
    neighborhood_id: uuid.UUID
    visible_agents: list[PerceivedAgent] = field(default_factory=list)
    visible_locations: list[PerceivedLocation] = field(default_factory=list)
    local_prices: dict[str, float] = field(default_factory=dict)
    active_events: list[str] = field(default_factory=list)

    def to_schema(self) -> PerceivedWorldState:
        """Convert to the Pydantic PerceivedWorldState schema consumed by AgentContext."""
        from app.schemas.agent_context import PerceivedAgentSnapshot, PerceivedLocationSnapshot

        return PerceivedWorldState(
            tick=self.tick,
            location_id=self.location_id,
            neighborhood_id=self.neighborhood_id,
            visible_locations=[
                PerceivedLocationSnapshot(
                    id=loc.id,
                    name=loc.name,
                    location_type=loc.location_type.value if hasattr(loc.location_type, "value") else str(loc.location_type),
                    neighborhood_id=loc.neighborhood_id,
                )
                for loc in self.visible_locations
            ],
            visible_agents=[
                PerceivedAgentSnapshot(
                    id=a.id,
                    name=a.name,
                    occupation=a.occupation,
                    social_status=a.social_status,
                    emotional_state=dict(a.emotional_state),
                )
                for a in self.visible_agents
            ],
            local_prices=dict(self.local_prices),
            active_events=list(self.active_events),
        )

