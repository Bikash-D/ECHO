"""
Pydantic response schemas for World and Simulation API endpoints.
"""

from __future__ import annotations

import uuid
from typing import Any
from pydantic import BaseModel, Field


class NeedResponse(BaseModel):
    need_type: str
    value: float


class GoalResponse(BaseModel):
    id: uuid.UUID
    description: str
    priority: int
    status: str
    progress: float


class PersonalityResponse(BaseModel):
    openness: float
    conscientiousness: float
    extraversion: float
    agreeableness: float
    neuroticism: float


class RelationshipResponse(BaseModel):
    """
    One bilateral relationship edge, as seen from the owning agent. Backed
    directly by app/society/relationships.py's Relationship dataclass --
    that model already tracked all of these fields (interact() updates
    them every "socialize" action), they were just never surfaced through
    the API before this milestone.
    """

    other_agent_id: uuid.UUID
    other_agent_name: str
    relationship_type: str
    strength: float
    trust: float
    interactions_count: int
    last_interaction_tick: int


class AgentActionResponse(BaseModel):
    """
    The outcome of the most recent tick's Perception -> Decision -> Action
    Resolution pipeline for one agent -- i.e. "what is this agent doing
    right now, and why." `reasoning` is the DecisionStrategy's own
    human-readable justification (schemas/action_intent.py::ActionIntent.
    reasoning), not something invented for display; `message`/`success`
    come from the ActionResolver's actual resolution of that intent.
    None until the agent has been through at least one simulation step
    since the last reset.
    """

    tick: int
    action_type: str
    success: bool
    message: str
    reasoning: str


class AgentSummaryResponse(BaseModel):
    id: uuid.UUID
    name: str
    age: int
    occupation: str
    wealth: float
    social_status: float
    location_id: uuid.UUID
    neighborhood_id: uuid.UUID
    household_id: uuid.UUID | None = None
    workplace_id: uuid.UUID | None = None
    # Derived read-only employment detail -- not new domain state. Name of
    # the Location at workplace_id, and the deterministic wage for
    # `occupation` (economy/wages.py), the same figure the "work" action
    # itself pays out. Both None together iff workplace_id is None (i.e.
    # occupation == "unemployed"; see agents/generator.py).
    employer_name: str | None = None
    wage: float | None = None
    personality: PersonalityResponse
    needs: list[NeedResponse]
    goals: list[GoalResponse]
    # Highest-priority ACTIVE goal, if any -- the same objects already in
    # `goals`, just surfaced directly so an inspector doesn't have to
    # re-implement "which goal is the agent actually pursuing right now."
    current_goal: GoalResponse | None = None
    relationships: list[RelationshipResponse] = Field(default_factory=list)
    current_action: AgentActionResponse | None = None


class BusinessResponse(BaseModel):
    id: uuid.UUID
    location_id: uuid.UUID
    name: str
    cash: float


class LocationResponse(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    neighborhood_id: uuid.UUID
    capacity: int | None = None
    occupancy: int
    occupant_ids: list[uuid.UUID] = Field(default_factory=list)
    # Only populated for `type == "workplace"` locations -- see
    # economy/business.py (one Business per WORKPLACE Location for MVP).
    business: BusinessResponse | None = None
    # Semantic identity beyond `type` (Living City milestone / Phase A --
    # see app/world/enums.py::VenueKind). Always populated -- every real
    # Location has a real venue_kind, never a placeholder.
    venue_kind: str
    architectural_style: str
    floor_count: int
    is_public: bool
    # Deterministic function of venue_kind (app/world/enums.py::
    # interior_archetype_for) -- what a future interior/cutaway renderer
    # would key off of. No interior is rendered by this milestone; this
    # is metadata only.
    interior_archetype: str


class LocationDetailResponse(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    neighborhood_id: uuid.UUID
    neighborhood_name: str
    capacity: int | None = None
    occupancy: int
    occupants: list[AgentSummaryResponse]
    business: BusinessResponse | None = None
    venue_kind: str
    architectural_style: str
    floor_count: int
    is_public: bool
    interior_archetype: str


class NeighborhoodResponse(BaseModel):
    id: uuid.UUID
    name: str
    city_id: uuid.UUID
    number_of_locations: int
    population: int
    location_ids: list[uuid.UUID]


class NeighborhoodDetailResponse(BaseModel):
    id: uuid.UUID
    name: str
    city_id: uuid.UUID
    population: int
    locations: list[LocationResponse]
    breakdown: dict[str, int]
    residents: list[AgentSummaryResponse]


class CityResponse(BaseModel):
    id: uuid.UUID
    name: str
    neighborhood_count: int


class SocietyStatisticsResponse(BaseModel):
    total_population: int
    average_wealth: float
    average_social_status: float
    average_needs: dict[str, float]
    occupation_distribution: dict[str, int]
    # Sum of every Business's cash -- a coarse, whole-economy signal that
    # work is producing more value than it pays out (see
    # economy/production.py's OUTPUT_MULTIPLIER). Not a claim about GDP
    # or anything beyond "total retained business profit right now."
    total_business_cash: float = 0.0


class WorldResponse(BaseModel):
    city: CityResponse
    tick: int
    status: str
    neighborhoods: list[NeighborhoodResponse]
    locations: list[LocationResponse]
    agents: list[AgentSummaryResponse]
    statistics: SocietyStatisticsResponse


class SimulationLifecycleResponse(BaseModel):
    status: str
    tick: int
    population_size: int
