"""
Needs system for managing agent need initialization, decay, and satisfaction.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Iterable

from app.core.rng import SimulationRNG
from app.needs.enums import NeedType
from app.needs.models import Need

if TYPE_CHECKING:
    from app.agents.agent import Agent


class NeedsSystem:
    """
    Manages need initialization, deterministic decay per tick, and satisfaction.
    """

    DEFAULT_DECAY_RATES: dict[NeedType, float] = {
        NeedType.HUNGER: 0.02,
        NeedType.ENERGY: 0.01,
        NeedType.SOCIAL: 0.015,
    }

    @classmethod
    def initialize_needs(
        cls,
        agent: Agent | None = None,
        rng: SimulationRNG | None = None,
    ) -> dict[NeedType, Need]:
        """
        Initialize the 3 core needs for an agent.

        If `rng` is provided, starting values are seeded/deterministic floats
        in [0.7, 1.0]. Otherwise, all starting values default to 1.0.
        """
        needs: dict[NeedType, Need] = {}

        if rng is not None:
            needs_rng = rng.spawn_child("needs_initialization") if agent is None else rng.spawn_child(f"needs_init_{agent.id}")
            for need_type, decay_rate in cls.DEFAULT_DECAY_RATES.items():
                starting_val = round(0.7 + 0.3 * needs_rng.random(), 3)
                needs[need_type] = Need(
                    need_type=need_type,
                    value=starting_val,
                    decay_rate=decay_rate,
                )
        else:
            for need_type, decay_rate in cls.DEFAULT_DECAY_RATES.items():
                needs[need_type] = Need(
                    need_type=need_type,
                    value=1.0,
                    decay_rate=decay_rate,
                )

        if agent is not None:
            agent.needs = needs

        return needs

    @staticmethod
    def decay(
        needs: dict[NeedType, Need] | Iterable[Need],
        personality: Any | None = None,
    ) -> None:
        """
        Apply deterministic decay to all given needs.
        Zero RNG used -- pure arithmetic subtraction.
        If personality is provided, scales decay according to psychological traits:
        - Extraversion accelerates social need decay.
        - Neuroticism slightly increases energy decay.
        """
        need_items = needs.values() if isinstance(needs, dict) else needs
        for need in need_items:
            rate = need.decay_rate
            if personality is not None:
                norm_type = need.need_type.value if hasattr(need.need_type, "value") else str(need.need_type)
                if norm_type == NeedType.SOCIAL.value and hasattr(personality, "extraversion"):
                    rate = rate * (0.6 + 0.8 * float(personality.extraversion))
                elif norm_type == NeedType.ENERGY.value and hasattr(personality, "neuroticism"):
                    rate = rate * (0.85 + 0.3 * float(personality.neuroticism))

            need.value = max(0.0, round(need.value - rate, 4))


    @staticmethod
    def satisfy(need: Need, amount: float) -> None:
        """
        Increase need value by `amount`, clamped to [0.0, 1.0].
        """
        if amount < 0.0:
            raise ValueError(f"Satisfaction amount cannot be negative, got {amount}")
        need.value = min(1.0, round(need.value + amount, 4))

    @staticmethod
    def is_depleted(need: Need, threshold: float = 0.3) -> bool:
        """Return True if need value is below the depletion threshold."""
        return need.value <= threshold
