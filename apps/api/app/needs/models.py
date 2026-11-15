"""
Need domain model.

Plain dataclass representation of an agent's individual need.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.needs.enums import NeedType
from app.schemas.agent_context import NeedSnapshot


@dataclass
class Need:
    """
    Represents one need of an agent (e.g. hunger, energy, social).

    Value is in [0.0, 1.0], where:
    - 1.0 represents fully satisfied
    - 0.0 represents completely depleted / severe deprivation
    """

    need_type: NeedType | str
    value: float
    decay_rate: float

    def __post_init__(self) -> None:
        if isinstance(self.need_type, str):
            try:
                self.need_type = NeedType(self.need_type.lower())
            except ValueError:
                pass

        if not (0.0 <= self.value <= 1.0):
            raise ValueError(f"Need value must be in [0.0, 1.0], got {self.value}")
        if self.decay_rate < 0.0:
            raise ValueError(f"Need decay_rate cannot be negative, got {self.decay_rate}")

    @property
    def type_str(self) -> str:
        if isinstance(self.need_type, NeedType):
            return self.need_type.value
        return str(self.need_type)

    def to_snapshot(self) -> NeedSnapshot:
        return NeedSnapshot(
            need_type=self.type_str,
            value=round(self.value, 4),
        )
