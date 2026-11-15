"""
Social Relationship domain model for ECHO agents.

Tracks bilateral and emergent relationships between agents (housemates, colleagues, friends, acquaintances).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import Enum

from app.schemas.agent_context import RelationshipSnapshot


class RelationshipType(str, Enum):
    HOUSEMATE = "housemate"
    COLLEAGUE = "colleague"
    CLOSE_FRIEND = "close_friend"
    FRIEND = "friend"
    ACQUAINTANCE = "acquaintance"
    STRANGER = "stranger"


@dataclass
class Relationship:
    """
    Represents one agent's bilateral relationship and social memory of another agent.
    """

    agent_id: uuid.UUID
    other_agent_id: uuid.UUID
    relationship_type: RelationshipType | str
    strength: float  # [0.0, 1.0] emotional affinity / connection
    trust: float     # [0.0, 1.0] reliability / safety
    interactions_count: int = 0
    last_interaction_tick: int = 0

    def __post_init__(self) -> None:
        self.strength = max(0.0, min(1.0, float(self.strength)))
        self.trust = max(0.0, min(1.0, float(self.trust)))
        if isinstance(self.relationship_type, str):
            try:
                self.relationship_type = RelationshipType(self.relationship_type.lower())
            except ValueError:
                pass

    @property
    def type_str(self) -> str:
        if isinstance(self.relationship_type, RelationshipType):
            return self.relationship_type.value
        return str(self.relationship_type)

    def interact(self, tick: int, strength_delta: float = 0.05, trust_delta: float = 0.03) -> None:
        """Record a social interaction and evolve relationship depth."""
        self.interactions_count += 1
        self.last_interaction_tick = tick
        self.strength = min(1.0, round(self.strength + strength_delta, 3))
        self.trust = min(1.0, round(self.trust + trust_delta, 3))

        # Evolve relationship status based on interaction depth
        if self.relationship_type not in (RelationshipType.HOUSEMATE, RelationshipType.COLLEAGUE):
            if self.strength >= 0.80 and self.trust >= 0.75:
                self.relationship_type = RelationshipType.CLOSE_FRIEND
            elif self.strength >= 0.50 and self.trust >= 0.45:
                self.relationship_type = RelationshipType.FRIEND
            elif self.strength >= 0.20:
                self.relationship_type = RelationshipType.ACQUAINTANCE

    def to_snapshot(self) -> RelationshipSnapshot:
        return RelationshipSnapshot(
            other_agent_id=self.other_agent_id,
            type=self.type_str,
            strength=round(self.strength, 3),
            trust=round(self.trust, 3),
        )
