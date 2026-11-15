"""
Personality: the Big Five (OCEAN) trait model, per architecture.md's Agent
class diagram.

Plain dataclass, not Pydantic -- consistent with the World domain model
(app/world/models.py): this is mutated/read every tick by decision
strategies, not a validated I/O boundary (that's schemas/agent_context.py's
job, which already carries personality as a plain `dict[str, float]` for
strategies to consume).

Lightweight range validation is included (not full Pydantic validation)
because these are domain invariants that later decision logic (rule-based,
utility-based) will rely on -- a personality trait outside [0, 1] would
silently produce nonsense weighting rather than failing loudly, so it's
worth the cheap check here.
"""

from __future__ import annotations

from dataclasses import dataclass


def _validate_unit_range(name: str, value: float) -> None:
    if not (0.0 <= value <= 1.0):
        raise ValueError(f"{name} must be in [0.0, 1.0], got {value}")


@dataclass
class Personality:
    openness: float
    conscientiousness: float
    extraversion: float
    agreeableness: float
    neuroticism: float

    def __post_init__(self) -> None:
        _validate_unit_range("openness", self.openness)
        _validate_unit_range("conscientiousness", self.conscientiousness)
        _validate_unit_range("extraversion", self.extraversion)
        _validate_unit_range("agreeableness", self.agreeableness)
        _validate_unit_range("neuroticism", self.neuroticism)

    def as_dict(self) -> dict[str, float]:
        """
        Convert to the plain dict[str, float] shape AgentContext.personality
        expects (schemas/agent_context.py). This is the only place that
        needs to know about that schema's shape -- Perception (Step 5) will
        call this rather than reaching into Personality's fields directly.
        """
        return {
            "openness": self.openness,
            "conscientiousness": self.conscientiousness,
            "extraversion": self.extraversion,
            "agreeableness": self.agreeableness,
            "neuroticism": self.neuroticism,
        }
