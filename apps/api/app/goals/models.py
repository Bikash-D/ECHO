"""
Goal domain model.

Plain dataclass representation of an agent's individual goal.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from app.goals.enums import GoalStatus, GoalType
from app.schemas.agent_context import GoalSnapshot


@dataclass
class Goal:
    """
    Represents one active, completed, or abandoned goal of an agent.

    - priority: integer indicating relative importance (higher = more urgent)
    - progress: float in [0.0, 1.0] indicating completion ratio
    """

    id: uuid.UUID
    goal_type: GoalType | str
    description: str
    priority: int
    status: GoalStatus | str = GoalStatus.ACTIVE
    progress: float = 0.0

    def __post_init__(self) -> None:
        if isinstance(self.goal_type, str):
            try:
                self.goal_type = GoalType(self.goal_type.lower())
            except ValueError:
                pass

        if isinstance(self.status, str):
            try:
                self.status = GoalStatus(self.status.lower())
            except ValueError:
                pass

        if not (0.0 <= self.progress <= 1.0):
            raise ValueError(f"Goal progress must be in [0.0, 1.0], got {self.progress}")

    @property
    def type_str(self) -> str:
        if isinstance(self.goal_type, GoalType):
            return self.goal_type.value
        return str(self.goal_type)

    @property
    def status_str(self) -> str:
        if isinstance(self.status, GoalStatus):
            return self.status.value
        return str(self.status)

    def to_snapshot(self) -> GoalSnapshot:
        return GoalSnapshot(
            id=self.id,
            description=self.description,
            priority=self.priority,
            status=self.status_str,
            progress=round(self.progress, 4),
        )
