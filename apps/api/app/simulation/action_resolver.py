"""
Action Resolution Engine for ECHO.

Validates ActionIntent contracts against World state and applies deterministic
effects (movement, consumption, rest, work, socialization) to mutate Agent and World state.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from app.economy.production import get_output_value_for_occupation
from app.economy.wages import get_wage_for_occupation
from app.goals.enums import GoalStatus, GoalType
from app.goals.system import GoalsSystem
from app.needs.enums import NeedType
from app.needs.system import NeedsSystem
from app.schemas.action_intent import ActionIntent
from app.society.relationships import Relationship, RelationshipType
from app.world.enums import LocationType
from app.world.models import Location, World

if TYPE_CHECKING:
    from app.agents.agent import Agent


class ActionResult:
    """Outcome of resolving a single agent's ActionIntent."""

    def __init__(
        self,
        agent_id: uuid.UUID,
        agent_name: str,
        action_type: str,
        success: bool,
        message: str,
        changes: dict[str, Any] | None = None,
    ) -> None:
        self.agent_id = agent_id
        self.agent_name = agent_name
        self.action_type = action_type
        self.success = success
        self.message = message
        self.changes = changes or {}


class ActionResolver:
    """
    Validates and executes ActionIntents in batch or per-agent,
    guaranteeing deterministic state mutations.
    """

    @classmethod
    def resolve(
        cls,
        agent: Agent,
        intent: ActionIntent,
        world: World,
        other_agents: list[Agent] | None = None,
    ) -> ActionResult:
        """
        Validate preconditions and apply state mutations for a single agent intent.

        `other_agents` is required for the "socialize" action to actually
        deepen a relationship (RelationshipType.interact()) with the
        specific agent being socialized with; every other action ignores
        it. Optional/defaulted to None so existing single-agent callers
        (e.g. unit tests exercising move/consume_food/rest/work in
        isolation) keep working unchanged.
        """
        action = intent.action_type.lower()

        # ----------------------------------------------------
        # 1. MOVEMENT ACTION
        # ----------------------------------------------------
        if action == "move":
            target_raw = intent.params.get("target_location_id")
            if not target_raw:
                return ActionResult(
                    agent_id=agent.id,
                    agent_name=agent.name,
                    action_type="move",
                    success=False,
                    message="Move action rejected: missing target_location_id.",
                )

            try:
                target_uuid = uuid.UUID(str(target_raw))
            except ValueError:
                return ActionResult(
                    agent_id=agent.id,
                    agent_name=agent.name,
                    action_type="move",
                    success=False,
                    message=f"Move action rejected: invalid target UUID '{target_raw}'.",
                )

            if target_uuid not in world.locations:
                return ActionResult(
                    agent_id=agent.id,
                    agent_name=agent.name,
                    action_type="move",
                    success=False,
                    message=f"Move action rejected: location {target_uuid} does not exist in world.",
                )

            old_loc_id = agent.location_id
            old_loc = world.locations.get(old_loc_id) if old_loc_id else None
            new_loc = world.locations[target_uuid]

            # Apply state mutation
            agent.location_id = target_uuid

            return ActionResult(
                agent_id=agent.id,
                agent_name=agent.name,
                action_type="move",
                success=True,
                message=f"{agent.name} moved from {old_loc.name if old_loc else 'unknown'} to {new_loc.name}.",
                changes={
                    "previous_location_id": str(old_loc_id) if old_loc_id else None,
                    "new_location_id": str(target_uuid),
                    "new_location_name": new_loc.name,
                },
            )

        # ----------------------------------------------------
        # 2. FOOD CONSUMPTION -- requires physical presence at a MARKET
        # Location, mirroring the "work" action's employment-presence
        # requirement below. Before this, an agent could satisfy hunger
        # and lose wealth from *any* location, with that spent money
        # going nowhere: no Business ever received it. The decision
        # layer (agents/decision.py) already only ever issues a
        # "consume_food" intent once an agent has traveled to a market,
        # so this was a real gap between what decisions assumed and what
        # the resolver enforced -- not a hypothetical one.
        # ----------------------------------------------------
        elif action == "consume_food":
            location = world.locations.get(agent.location_id) if agent.location_id else None
            if location is None or location.location_type != LocationType.MARKET:
                return ActionResult(
                    agent_id=agent.id,
                    agent_name=agent.name,
                    action_type="consume_food",
                    success=False,
                    message=f"{agent.name} attempted to buy food but is not at a market.",
                )

            # Satisfy hunger need
            hunger_need = agent.needs.get(NeedType.HUNGER) or agent.needs.get(NeedType.HUNGER.value)
            if hunger_need:
                NeedsSystem.satisfy(hunger_need, amount=0.40)

            # Small food cost. Only agents who can actually afford it pay
            # (and only a completed payment reaches the market's
            # Business as revenue) -- an agent too poor to pay still eats
            # for MVP simplicity (no starvation-consequence modeling
            # yet), but does not fabricate economic activity that didn't
            # happen.
            cost = 5.0
            market = world.get_business(location.id)
            paid = agent.wealth >= cost
            if paid:
                agent.wealth = round(agent.wealth - cost, 2)
                if market is not None:
                    market.record_sale(cost)

            GoalsSystem.update_goals(agent)

            changes: dict[str, Any] = {
                "hunger_value": hunger_need.value if hunger_need else 1.0,
                "wealth": agent.wealth,
                "paid": paid,
            }
            if market is not None:
                changes["business_id"] = str(market.id)
                changes["business_cash"] = market.cash

            return ActionResult(
                agent_id=agent.id,
                agent_name=agent.name,
                action_type="consume_food",
                success=True,
                message=(
                    f"{agent.name} bought and consumed food at {location.name} "
                    f"(hunger satisfied +0.40, wealth -${cost if paid else 0.0})."
                ),
                changes=changes,
            )

        # ----------------------------------------------------
        # 3. REST & SLEEP
        # ----------------------------------------------------
        elif action == "rest":
            energy_need = agent.needs.get(NeedType.ENERGY) or agent.needs.get(NeedType.ENERGY.value)
            if energy_need:
                NeedsSystem.satisfy(energy_need, amount=0.35)

            GoalsSystem.update_goals(agent)

            return ActionResult(
                agent_id=agent.id,
                agent_name=agent.name,
                action_type="rest",
                success=True,
                message=f"{agent.name} rested (energy restored +0.35).",
                changes={"energy_value": energy_need.value if energy_need else 1.0},
            )

        # ----------------------------------------------------
        # 4. SOCIALIZATION
        # ----------------------------------------------------
        elif action == "socialize":
            social_need = agent.needs.get(NeedType.SOCIAL) or agent.needs.get(NeedType.SOCIAL.value)
            if social_need:
                NeedsSystem.satisfy(social_need, amount=0.35)

            GoalsSystem.update_goals(agent)

            relationship_changes = cls._apply_relationship_interaction(
                agent=agent,
                intent=intent,
                world=world,
                other_agents=other_agents,
            )

            changes: dict[str, Any] = {"social_value": social_need.value if social_need else 1.0}
            changes.update(relationship_changes)

            return ActionResult(
                agent_id=agent.id,
                agent_name=agent.name,
                action_type="socialize",
                success=True,
                message=f"{agent.name} engaged in social conversation (social need restored +0.35).",
                changes=changes,
            )

        # ----------------------------------------------------
        # 5. WORK -- requires a genuine, persistent employment
        # relationship: agent.workplace_id must be set (established once,
        # at generation time, not re-decided per tick -- see
        # agents/generator.py::_assign_workplaces) AND the agent must
        # actually be physically present at that specific workplace right
        # now. A "work" intent from an agent with no employer, or standing
        # at a workplace that isn't theirs, is rejected: it is not a
        # legal action, not silently downgraded to a smaller payout.
        # ----------------------------------------------------
        elif action == "work":
            if agent.workplace_id is None:
                return ActionResult(
                    agent_id=agent.id,
                    agent_name=agent.name,
                    action_type="work",
                    success=False,
                    message=f"{agent.name} has no employer and cannot work.",
                )

            if agent.location_id != agent.workplace_id:
                return ActionResult(
                    agent_id=agent.id,
                    agent_name=agent.name,
                    action_type="work",
                    success=False,
                    message=f"{agent.name} attempted to work but is not present at their workplace.",
                )

            workplace = world.locations.get(agent.workplace_id)
            if workplace is None or workplace.location_type != LocationType.WORKPLACE:
                return ActionResult(
                    agent_id=agent.id,
                    agent_name=agent.name,
                    action_type="work",
                    success=False,
                    message=f"{agent.name}'s registered workplace is invalid.",
                )

            # Economic causality: the shift must produce value *before*
            # the agent is paid for it. output_value flows into the
            # employing Business's cash as revenue; wage is deducted from
            # that same Business as a labor cost. An agent is never paid
            # out of nowhere -- see economy/production.py and
            # economy/business.py for why this replaces the old
            # "work happened -> wage appears" mutation.
            wage = get_wage_for_occupation(agent.occupation)
            output_value = get_output_value_for_occupation(agent.occupation)
            business = world.get_business(workplace.id)
            if business is not None:
                business.record_shift(output_value=output_value, wage=wage)

            agent.wealth = round(agent.wealth + wage, 2)

            # Working causes a minor exertion
            energy_need = agent.needs.get(NeedType.ENERGY) or agent.needs.get(NeedType.ENERGY.value)
            if energy_need:
                energy_need.value = max(0.0, round(energy_need.value - 0.015, 4))

            changes: dict[str, Any] = {
                "wage": wage,
                "wealth": agent.wealth,
                "workplace_id": str(agent.workplace_id),
                "output_value": output_value,
            }
            if business is not None:
                changes["business_id"] = str(business.id)
                changes["business_cash"] = business.cash

            return ActionResult(
                agent_id=agent.id,
                agent_name=agent.name,
                action_type="work",
                success=True,
                message=(
                    f"{agent.name} worked a shift as {agent.occupation} at {workplace.name} "
                    f"(produced ${output_value} in value, earned +${wage})."
                ),
                changes=changes,
            )

        # ----------------------------------------------------
        # 6. IDLE
        # ----------------------------------------------------
        elif action == "idle":
            return ActionResult(
                agent_id=agent.id,
                agent_name=agent.name,
                action_type="idle",
                success=True,
                message=f"{agent.name} idled.",
            )

        else:
            return ActionResult(
                agent_id=agent.id,
                agent_name=agent.name,
                action_type=action,
                success=False,
                message=f"Unknown action type '{action}'.",
            )

    # ----------------------------------------------------------------
    # Relationship memory: wires the "socialize" action to the existing
    # Relationship model (app/society/relationships.py), which already
    # defines interact() -- evolving strength/trust/type on repeated
    # contact -- but was never actually called anywhere. This is the
    # smallest real hook-up: no new systems, just using what already
    # existed. Only fires for a specific co-located target_agent_id (the
    # RuleBasedDecisionStrategy case where an agent chose to socialize
    # with someone visible); the ambient "socialize at a leisure spot with
    # nobody in particular" case (target_agent_id=None) intentionally
    # does not fabricate a relationship with no one.
    # ----------------------------------------------------------------
    @staticmethod
    def _apply_relationship_interaction(
        agent: Agent,
        intent: ActionIntent,
        world: World,
        other_agents: list[Agent] | None,
    ) -> dict[str, Any]:
        target_raw = intent.params.get("target_agent_id")
        if not target_raw or not other_agents:
            return {}

        try:
            target_id = uuid.UUID(str(target_raw))
        except ValueError:
            return {}

        if target_id == agent.id:
            return {}

        target_agent = next((a for a in other_agents if a.id == target_id), None)
        if target_agent is None:
            return {}

        forward = agent.relationships.get(target_id)
        if forward is None:
            forward = Relationship(
                agent_id=agent.id,
                other_agent_id=target_id,
                relationship_type=RelationshipType.STRANGER,
                strength=0.10,
                trust=0.10,
            )
            agent.relationships[target_id] = forward
        forward.interact(tick=world.tick)

        backward = target_agent.relationships.get(agent.id)
        if backward is None:
            backward = Relationship(
                agent_id=target_agent.id,
                other_agent_id=agent.id,
                relationship_type=RelationshipType.STRANGER,
                strength=0.10,
                trust=0.10,
            )
            target_agent.relationships[agent.id] = backward
        backward.interact(tick=world.tick)

        return {
            "relationship_target_id": str(target_id),
            "relationship_type": forward.type_str,
            "relationship_strength": forward.strength,
            "relationship_trust": forward.trust,
        }
