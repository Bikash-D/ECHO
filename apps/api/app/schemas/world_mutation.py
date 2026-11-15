"""
WorldMutation: the single mechanism through which the environment can
be changed -- whether the change originates from a scripted Event
(Phase 8) or a live Researcher/God Mode Intervention (Section 7 of
architecture.md).

Both paths funnel through this schema so there is exactly one code
path that mutates World state, which is the guardrail that keeps God
Mode from becoming a backdoor around "events change environment,
agents decide" (Section 16 of the original spec).

Phase 0 defines the contract only. No mutation is actually applied
to any World object yet -- that begins in Phase 2 (simulation engine)
for Events and Phase 8 for Interventions.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class MutationTarget(str, Enum):
    """What kind of world parameter a mutation affects."""

    PRICE = "price"
    TAX_RATE = "tax_rate"
    RESOURCE_AVAILABILITY = "resource_availability"
    TECHNOLOGY_FLAG = "technology_flag"
    INFORMATION = "information"


class WorldMutation(BaseModel):
    target: MutationTarget
    scope: str = Field(
        description="What the mutation applies to, e.g. a resource type, "
        "a business category, 'global'. Interpreted by the applier for "
        "the given target, not by this schema."
    )
    params: dict = Field(default_factory=dict)

    start_tick: int
    duration: int | None = Field(
        default=None, description="None means the mutation is permanent."
    )

    source: str = Field(
        description="'event' or 'intervention' -- which subsystem produced this mutation."
    )
    source_id: str = Field(description="ID of the originating Event or Intervention record.")

    model_config = ConfigDict(use_enum_values=True)
