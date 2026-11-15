"""
Rule-Based Decision Strategy for ECHO agents.

Implements the DecisionStrategy contract to evaluate an AgentContext
and produce an actionable ActionIntent based on goals, needs, personality traits,
social relationships, and perceived locations.
"""

from __future__ import annotations

import uuid
from typing import Any

from app.goals.enums import GoalStatus, GoalType
from app.needs.enums import NeedType
from app.schemas.action_intent import ActionIntent, DecisionMode
from app.schemas.agent_context import AgentContext
from app.schemas.decision_strategy import DecisionStrategy
from app.world.enums import LocationType


class RuleBasedDecisionStrategy(DecisionStrategy):
    """
    Evaluates an agent's context and selects actions deterministically
    according to active goal priorities, need states, personality profiles,
    and perceived environment.
    """

    mode: str = DecisionMode.RULE_BASED

    def decide(self, context: AgentContext) -> ActionIntent:
        """
        Evaluate context and return exactly one ActionIntent.
        Does not mutate the context or query external state.
        """
        current_loc_id = context.perceived_world.location_id
        visible_locs = context.perceived_world.visible_locations
        visible_agents = context.perceived_world.visible_agents
        personality = context.personality

        extraversion = personality.get("extraversion", 0.5)
        conscientiousness = personality.get("conscientiousness", 0.5)
        openness = personality.get("openness", 0.5)
        agreeableness = personality.get("agreeableness", 0.5)

        # Find current location among visible locations
        current_loc = next((loc for loc in visible_locs if loc.id == current_loc_id), None)
        current_type = current_loc.location_type.lower() if current_loc else ""

        # Map active goals sorted by priority (highest first)
        active_goals = [g for g in context.goals if g.status == GoalStatus.ACTIVE.value or g.status == GoalStatus.ACTIVE]
        active_goals.sort(key=lambda g: g.priority, reverse=True)

        hour = context.tick % 24
        is_daytime = 7 <= hour <= 17
        is_evening = 18 <= hour <= 21

        # =========================================================================
        # 1. PRIMARY DRIVE: Satisfy Urgent Depleted Goals
        # =========================================================================
        if active_goals:
            top_goal = active_goals[0]
            goal_type_str = str(top_goal.goal_type) if hasattr(top_goal, "goal_type") else str(top_goal.description)

            # --- A. SATISFY HUNGER ---
            if GoalType.SATISFY_HUNGER.value in goal_type_str or "hunger" in goal_type_str.lower() or "food" in top_goal.description.lower():
                if current_type == LocationType.MARKET.value:
                    return ActionIntent(
                        action_type="consume_food",
                        params={"location_id": str(current_loc_id)},
                        confidence=0.95,
                        reasoning=f"At {current_loc.name if current_loc else 'Market'}, purchasing and consuming food.",
                        produced_by=DecisionMode.RULE_BASED,
                    )
                else:
                    market = next((l for l in visible_locs if l.location_type.lower() == LocationType.MARKET.value), None)
                    if market:
                        return ActionIntent(
                            action_type="move",
                            params={"target_location_id": str(market.id), "target_name": market.name},
                            confidence=0.90,
                            reasoning=f"Hunger depleted, traveling to {market.name}.",
                            produced_by=DecisionMode.RULE_BASED,
                        )

            # --- B. RESTORE ENERGY ---
            elif GoalType.RESTORE_ENERGY.value in goal_type_str or "energy" in goal_type_str.lower() or "sleep" in top_goal.description.lower() or "rest" in top_goal.description.lower():
                if current_type == LocationType.RESIDENTIAL.value:
                    return ActionIntent(
                        action_type="rest",
                        params={"location_id": str(current_loc_id)},
                        confidence=0.95,
                        reasoning=f"Resting at residence to restore energy.",
                        produced_by=DecisionMode.RULE_BASED,
                    )
                else:
                    residence = next((l for l in visible_locs if l.location_type.lower() == LocationType.RESIDENTIAL.value), None)
                    if residence:
                        return ActionIntent(
                            action_type="move",
                            params={"target_location_id": str(residence.id), "target_name": residence.name},
                            confidence=0.90,
                            reasoning=f"Energy exhausted, heading to residence {residence.name} to rest.",
                            produced_by=DecisionMode.RULE_BASED,
                        )

            # --- C. SEEK SOCIAL CONTACT ---
            elif GoalType.SEEK_SOCIAL_CONTACT.value in goal_type_str or "social" in goal_type_str.lower() or "contact" in top_goal.description.lower():
                if len(visible_agents) > 0:
                    # Pick closest acquaintance/friend or any present agent
                    target_agent = visible_agents[0].id
                    return ActionIntent(
                        action_type="socialize",
                        params={"target_agent_id": str(target_agent)},
                        confidence=0.90,
                        reasoning=f"Socializing with {visible_agents[0].name} at {current_loc.name if current_loc else 'venue'}.",
                        produced_by=DecisionMode.RULE_BASED,
                    )
                elif current_type == LocationType.LEISURE.value:
                    return ActionIntent(
                        action_type="socialize",
                        params={"target_agent_id": None},
                        confidence=0.85,
                        reasoning=f"Spending time at leisure spot {current_loc.name if current_loc else 'park'} to meet people.",
                        produced_by=DecisionMode.RULE_BASED,
                    )
                else:
                    leisure = next((l for l in visible_locs if l.location_type.lower() == LocationType.LEISURE.value), None)
                    if leisure:
                        return ActionIntent(
                            action_type="move",
                            params={"target_location_id": str(leisure.id), "target_name": leisure.name},
                            confidence=0.85,
                            reasoning=f"Seeking company, traveling to {leisure.name}.",
                            produced_by=DecisionMode.RULE_BASED,
                        )

        # =========================================================================
        # 2. SECONDARY DRIVE: Daily Routines & Social Habits
        # =========================================================================

        # Co-located socialization: if peers are present and agreeable/extraverted
        if len(visible_agents) > 0 and (extraversion > 0.6 or agreeableness > 0.6) and (is_evening or current_type in (LocationType.LEISURE.value, LocationType.RESIDENTIAL.value)):
            return ActionIntent(
                action_type="socialize",
                params={"target_agent_id": str(visible_agents[0].id)},
                confidence=0.75,
                reasoning=f"Catching up with {visible_agents[0].name} in {current_loc.name if current_loc else 'area'}.",
                produced_by=DecisionMode.RULE_BASED,
            )

        # Work commute / shift -- gated on the agent's OWN persistent
        # employment relationship (context.workplace_id), not on "any
        # workplace happens to be visible." An agent with no workplace_id
        # is genuinely unemployed and has no work path at all, regardless
        # of what location types it can see. An employed agent only ever
        # works or commutes toward the specific workplace it is employed
        # at -- never someone else's.
        if is_daytime and context.workplace_id is not None:
            own_workplace = next(
                (l for l in visible_locs if l.id == context.workplace_id), None
            )
            if own_workplace:
                if current_loc_id == context.workplace_id:
                    return ActionIntent(
                        action_type="work",
                        params={"location_id": str(current_loc_id)},
                        confidence=0.85,
                        reasoning="Conducting work shift at own workplace to earn livelihood.",
                        produced_by=DecisionMode.RULE_BASED,
                    )
                elif conscientiousness >= 0.35:  # Conscientious agents reliably commute
                    return ActionIntent(
                        action_type="move",
                        params={"target_location_id": str(own_workplace.id), "target_name": own_workplace.name},
                        confidence=0.80,
                        reasoning=f"Commuting to {own_workplace.name} for work shift.",
                        produced_by=DecisionMode.RULE_BASED,
                    )

        # Evening leisure / exploration for open or extraverted agents
        if is_evening and (openness > 0.55 or extraversion > 0.55):
            if current_type != LocationType.LEISURE.value:
                leisure = next((l for l in visible_locs if l.location_type.lower() == LocationType.LEISURE.value), None)
                if leisure:
                    return ActionIntent(
                        action_type="move",
                        params={"target_location_id": str(leisure.id), "target_name": leisure.name},
                        confidence=0.70,
                        reasoning=f"Visiting {leisure.name} for evening relaxation and exploration.",
                        produced_by=DecisionMode.RULE_BASED,
                    )

        # Night time (22 - 6): Head home to rest/sleep
        if hour >= 22 or hour < 7:
            if current_type == LocationType.RESIDENTIAL.value:
                return ActionIntent(
                    action_type="rest",
                    params={"location_id": str(current_loc_id)},
                    confidence=0.90,
                    reasoning="Sleeping through the night at home.",
                    produced_by=DecisionMode.RULE_BASED,
                )
            else:
                residence = next((l for l in visible_locs if l.location_type.lower() == LocationType.RESIDENTIAL.value), None)
                if residence:
                    return ActionIntent(
                        action_type="move",
                        params={"target_location_id": str(residence.id), "target_name": residence.name},
                        confidence=0.90,
                        reasoning=f"Night has fallen; heading home to {residence.name}.",
                        produced_by=DecisionMode.RULE_BASED,
                    )

        # 3. Default Idle
        return ActionIntent(
            action_type="idle",
            params={"location_id": str(current_loc_id)},
            confidence=0.50,
            reasoning="Needs are satisfied; resting in place.",
            produced_by=DecisionMode.RULE_BASED,
        )
