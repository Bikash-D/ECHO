"""
ActionIntent: the single output contract produced by every decision
strategy. The action system validates and applies these -- it does not
care which strategy produced one, which is what keeps the three modes
experimentally interchangeable.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class DecisionMode(str, Enum):
    RULE_BASED = "rule_based"
    UTILITY_BASED = "utility_based"
    LLM_ASSISTED = "llm_assisted"


class ActionIntent(BaseModel):
    """
    A proposed action, not yet validated or applied. The action system
    (Phase 4+) is responsible for checking preconditions and applying
    effects -- this schema only carries the *decision*, not proof that
    it's legal.
    """

    action_type: str
    params: dict = Field(default_factory=dict)

    confidence: float = Field(ge=0.0, le=1.0, default=1.0)
    reasoning: str = Field(
        default="",
        description="Short human-readable justification. Required for "
        "LLM-assisted decisions (from the model's own output); optional "
        "but encouraged for rule/utility decisions to aid debugging.",
    )

    produced_by: DecisionMode

    model_config = ConfigDict(use_enum_values=True)
