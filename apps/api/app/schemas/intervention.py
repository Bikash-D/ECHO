"""
God Mode / Researcher intervention types.

These are the ONLY ways a researcher can affect a running simulation.
There is deliberately no generic "set any field to any value" escape
hatch -- every intervention type below is explicit, typed, and logged,
and every one of them produces a WorldMutation rather than touching
agent or world state directly (see world_mutation.py).

Phase 0 defines these types only. No InterventionController exists
yet to apply them (that lands in Phase 8, per architecture.md Section
7 -- intentionally sequenced after Events, not in Phase 0).

InformationInjection is included now so the schema surface is complete
and doesn't require a breaking change later, even though real
information propagation (Section 15 of the original spec) is out of
MVP scope. Applying it is a no-op until that subsystem exists.
"""

from __future__ import annotations

from abc import ABC
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class InterventionType(str, Enum):
    PRICE_SHOCK = "price_shock"
    TAX_POLICY = "tax_policy"
    RESOURCE_SHORTAGE = "resource_shortage"
    TECHNOLOGY_INTRODUCTION = "technology_introduction"
    INFORMATION_INJECTION = "information_injection"


class InterventionBase(BaseModel, ABC):
    intervention_type: InterventionType
    start_tick: int
    duration: int | None = None
    applied_by: str = Field(description="Researcher/user identifier, for the audit trail.")

    model_config = ConfigDict(use_enum_values=True)


class PriceShock(InterventionBase):
    intervention_type: InterventionType = InterventionType.PRICE_SHOCK
    target: str = Field(description="Resource or product category affected.")
    multiplier: float = Field(gt=0.0)


class TaxPolicy(InterventionBase):
    intervention_type: InterventionType = InterventionType.TAX_POLICY
    rate: float = Field(ge=0.0, le=1.0)
    applies_to: str = Field(description="e.g. 'income', 'transactions'.")


class ResourceShortage(InterventionBase):
    intervention_type: InterventionType = InterventionType.RESOURCE_SHORTAGE
    resource_type: str
    availability_multiplier: float = Field(ge=0.0, le=1.0)


class TechnologyIntroduction(InterventionBase):
    intervention_type: InterventionType = InterventionType.TECHNOLOGY_INTRODUCTION
    tech_id: str
    effect_params: dict = Field(default_factory=dict)


class InformationInjection(InterventionBase):
    """
    Schema reserved for future use -- real propagation is out of MVP
    scope (see architecture.md Section 8). Applying this currently
    has no effect on any subsystem.
    """

    intervention_type: InterventionType = InterventionType.INFORMATION_INJECTION
    content: str
    credibility: float = Field(ge=0.0, le=1.0)
    seed_agent_ids: list[UUID] = Field(default_factory=list)
