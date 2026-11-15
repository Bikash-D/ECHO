"""
Goals system for generating, updating, and abandoning agent goals based on needs.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from app.core.rng import SimulationRNG
from app.goals.enums import GoalStatus, GoalType
from app.goals.models import Goal
from app.needs.enums import NeedType

if TYPE_CHECKING:
    from app.agents.agent import Agent


class GoalsSystem:
    """
    Evaluates agent needs and manages the lifecycle of goals.
    """

    DEPLETION_THRESHOLD = 0.3
    SATISFACTION_THRESHOLD = 0.8

    NEED_TO_GOAL_CONFIG: dict[NeedType, tuple[GoalType, str]] = {
        NeedType.HUNGER: (GoalType.SATISFY_HUNGER, "Find and consume food to satisfy hunger"),
        NeedType.ENERGY: (GoalType.RESTORE_ENERGY, "Rest and sleep to restore energy"),
        NeedType.SOCIAL: (GoalType.SEEK_SOCIAL_CONTACT, "Seek conversation or contact with other agents"),
    }

    GOAL_TO_NEED_TYPE: dict[GoalType, NeedType] = {
        GoalType.SATISFY_HUNGER: NeedType.HUNGER,
        GoalType.RESTORE_ENERGY: NeedType.ENERGY,
        GoalType.SEEK_SOCIAL_CONTACT: NeedType.SOCIAL,
    }

    @classmethod
    def generate_goals(
        cls,
        agent: Agent,
        rng: SimulationRNG | None = None,
    ) -> list[Goal]:
        """
        Examines agent.needs and generates new ACTIVE goals for any depleted needs
        that do not already have an active goal.
        """
        new_goals: list[Goal] = []
        active_goal_types = {
            g.goal_type for g in agent.goals if g.status == GoalStatus.ACTIVE
        }

        goal_rng = None
        if rng is not None:
            goal_rng = rng.spawn_child(f"goal_generation_{agent.id}")

        for need_type, need in agent.needs.items():
            # Support both NeedType enum and str keys
            norm_need_type = NeedType(need_type) if isinstance(need_type, str) else need_type
            if norm_need_type not in cls.NEED_TO_GOAL_CONFIG:
                continue

            goal_type, description = cls.NEED_TO_GOAL_CONFIG[norm_need_type]

            if need.value <= cls.DEPLETION_THRESHOLD and goal_type not in active_goal_types:
                priority = max(1, min(100, int((1.0 - need.value) * 100)))
                goal_id = goal_rng.uuid() if goal_rng is not None else uuid.uuid4()

                goal = Goal(
                    id=goal_id,
                    goal_type=goal_type,
                    description=description,
                    priority=priority,
                    status=GoalStatus.ACTIVE,
                    progress=0.0,
                )
                agent.goals.append(goal)
                new_goals.append(goal)
                active_goal_types.add(goal_type)

        return new_goals

    @classmethod
    def update_goals(cls, agent: Agent) -> None:
        """
        Updates active goal statuses based on current need values.
        Marks goals as COMPLETED if their corresponding need has reached
        or exceeded SATISFACTION_THRESHOLD.
        """
        for goal in agent.goals:
            if goal.status != GoalStatus.ACTIVE:
                continue

            norm_goal_type = GoalType(goal.goal_type) if isinstance(goal.goal_type, str) else goal.goal_type
            if norm_goal_type in cls.GOAL_TO_NEED_TYPE:
                need_type = cls.GOAL_TO_NEED_TYPE[norm_goal_type]
                need = agent.needs.get(need_type) or agent.needs.get(need_type.value)
                if need and need.value >= cls.SATISFACTION_THRESHOLD:
                    goal.status = GoalStatus.COMPLETED
                    goal.progress = 1.0

    @staticmethod
    def abandon(goal: Goal) -> None:
        """Mark a goal as abandoned."""
        goal.status = GoalStatus.ABANDONED
