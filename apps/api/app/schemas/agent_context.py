"""
AgentContext: the single input contract consumed by every decision
strategy (Rule-Based, Utility-Based, LLM-Assisted).

This is deliberately provider-agnostic and logic-free. It is a snapshot
of what one agent can perceive/know at decision time, nothing more --
agents must not have access to global/omniscient state (Section 8 of
the original spec).
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class NeedSnapshot(BaseModel):
    need_type: str
    value: float = Field(ge=0.0, le=1.0)


class GoalSnapshot(BaseModel):
    id: UUID
    description: str
    priority: int
    status: str
    progress: float = Field(ge=0.0, le=1.0)


class MemorySnapshot(BaseModel):
    id: UUID
    tick: int
    type: str
    content: str
    importance: float = Field(ge=0.0, le=1.0)


class RelationshipSnapshot(BaseModel):
    other_agent_id: UUID
    type: str
    strength: float = Field(ge=0.0, le=1.0)
    trust: float = Field(ge=0.0, le=1.0)


class PerceivedLocationSnapshot(BaseModel):
    id: UUID
    name: str
    location_type: str
    neighborhood_id: UUID


class PerceivedAgentSnapshot(BaseModel):
    id: UUID
    name: str
    occupation: str
    social_status: float
    emotional_state: dict[str, float] = Field(default_factory=dict)


class PerceivedWorldState(BaseModel):
    """
    Only the slice of world state visible/relevant to this agent at
    this location -- not the full world. What "visible" means is
    defined by the simulation engine's perception logic (Phase 2+),
    not by this schema.
    """

    tick: int
    location_id: UUID
    neighborhood_id: UUID | None = None
    visible_locations: list[PerceivedLocationSnapshot] = Field(default_factory=list)
    visible_agents: list[PerceivedAgentSnapshot] = Field(default_factory=list)
    local_prices: dict[str, float] = Field(default_factory=dict)
    active_events: list[str] = Field(default_factory=list)



class AgentContext(BaseModel):
    """
    Everything a decision strategy is allowed to see when producing
    an ActionIntent for one agent at one tick.
    """

    agent_id: UUID
    tick: int

    personality: dict[str, float]
    needs: list[NeedSnapshot]
    goals: list[GoalSnapshot]
    relevant_memories: list[MemorySnapshot]
    relationships: list[RelationshipSnapshot]
    perceived_world: PerceivedWorldState

    wealth: float
    occupation: str = ""
    workplace_id: UUID | None = Field(
        default=None,
        description="The agent's own persistent employment relationship: the "
        "Location.id of the workplace they are employed at, if any. None "
        "means genuinely unemployed -- not merely 'not currently visible'.",
    )
    emotional_state: dict[str, float] = Field(default_factory=dict)

    available_action_types: list[str] = Field(
        default_factory=list,
        description="Actions this agent could legally attempt this tick, "
        "as determined by the action system's precondition checks -- "
        "not chosen yet, just eligible.",
    )
