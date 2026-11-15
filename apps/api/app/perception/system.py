"""
Perception system for generating transient perception snapshots and agent contexts.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.perception.models import (
    PerceivedAgent,
    PerceivedLocation,
    PerceptionSnapshot,
)
from app.schemas.agent_context import (
    AgentContext,
    GoalSnapshot,
    MemorySnapshot,
    NeedSnapshot,
    RelationshipSnapshot,
)

if TYPE_CHECKING:
    from app.agents.agent import Agent
    from app.world.models import World


class PerceptionSystem:
    """
    Constructs transient perceptual slices of the world for individual agents.
    """

    @classmethod
    def perceive(
        cls,
        agent: Agent,
        world: World,
        other_agents: list[Agent],
        tick: int | None = None,
    ) -> PerceptionSnapshot:
        """
        Build a transient PerceptionSnapshot for `agent` at current tick.

        - Visible agents: other agents with the exact same `location_id` (co-located).
        - Visible locations: all locations situated within the same neighborhood.
        - Perception is transient and does not mutate agent state.
        """
        if agent.location_id is None:
            raise ValueError(f"Agent {agent.id} ({agent.name}) has no location_id.")

        if agent.location_id not in world.locations:
            raise ValueError(
                f"Agent location {agent.location_id} is not registered on the World."
            )

        current_tick = tick if tick is not None else world.tick
        current_location = world.get_location(agent.location_id)
        neighborhood_id = current_location.neighborhood_id

        # Co-located agents (same location_id, excluding perceiving agent)
        visible_agents = [
            PerceivedAgent.from_agent(other)
            for other in other_agents
            if other.id != agent.id and other.location_id == agent.location_id
        ]

        # Locations in current neighborhood
        locations_in_hood = world.locations_in_neighborhood(neighborhood_id)
        visible_locations = [
            PerceivedLocation.from_location(loc) for loc in locations_in_hood
        ]

        return PerceptionSnapshot(
            tick=current_tick,
            agent_id=agent.id,
            location_id=agent.location_id,
            neighborhood_id=neighborhood_id,
            visible_agents=visible_agents,
            visible_locations=visible_locations,
            local_prices=dict(world.global_state),
            active_events=[],
        )

    @classmethod
    def build_agent_context(
        cls,
        agent: Agent,
        world: World,
        other_agents: list[Agent],
        relevant_memories: list[MemorySnapshot] | None = None,
        relationships: list[RelationshipSnapshot] | None = None,
        available_action_types: list[str] | None = None,
        tick: int | None = None,
    ) -> AgentContext:
        """
        Build the canonical AgentContext Pydantic contract consumed by DecisionStrategy backends.
        """
        snapshot = cls.perceive(agent, world, other_agents, tick=tick)

        # Convert needs to snapshots
        need_snapshots: list[NeedSnapshot] = []
        if isinstance(agent.needs, dict):
            for need in agent.needs.values():
                need_snapshots.append(
                    need.to_snapshot() if hasattr(need, "to_snapshot") else NeedSnapshot(
                        need_type=str(getattr(need, "need_type", "")),
                        value=float(getattr(need, "value", 1.0)),
                    )
                )
        elif isinstance(agent.needs, list):
            for need in agent.needs:
                need_snapshots.append(
                    need.to_snapshot() if hasattr(need, "to_snapshot") else NeedSnapshot(
                        need_type=str(getattr(need, "need_type", "")),
                        value=float(getattr(need, "value", 1.0)),
                    )
                )

        # Convert goals to snapshots
        goal_snapshots: list[GoalSnapshot] = []
        for goal in agent.goals:
            goal_snapshots.append(
                goal.to_snapshot() if hasattr(goal, "to_snapshot") else GoalSnapshot(
                    id=goal.id,
                    description=goal.description,
                    priority=goal.priority,
                    status=str(goal.status),
                    progress=goal.progress,
                )
            )

        # Convert relationships to snapshots
        rel_snapshots: list[RelationshipSnapshot] = relationships if relationships is not None else [
            r.to_snapshot() if hasattr(r, "to_snapshot") else r
            for r in getattr(agent, "relationships", {}).values()
        ]

        return AgentContext(
            agent_id=agent.id,
            tick=snapshot.tick,
            personality=agent.personality.as_dict(),
            needs=need_snapshots,
            goals=goal_snapshots,
            relevant_memories=relevant_memories or [],
            relationships=rel_snapshots,
            perceived_world=snapshot.to_schema(),
            wealth=agent.wealth,
            occupation=agent.occupation,
            workplace_id=agent.workplace_id,
            emotional_state=dict(agent.emotional_state),
            available_action_types=available_action_types or [],
        )

