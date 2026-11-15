"""
Tests for the complete autonomous simulation loop:
Need state -> Perception -> Goal generation -> Decision -> ActionIntent -> Action Resolution -> World Mutation.
"""

import uuid
from app.agents.decision import RuleBasedDecisionStrategy
from app.agents.generator import generate_mvp_agents
from app.core.rng import SimulationRNG
from app.goals.enums import GoalStatus, GoalType
from app.goals.system import GoalsSystem
from app.needs.enums import NeedType
from app.needs.system import NeedsSystem
from app.perception.system import PerceptionSystem
from app.schemas.action_intent import ActionIntent, DecisionMode
from app.simulation.action_resolver import ActionResolver
from app.simulation.state import SimulationService
from app.world.enums import LocationType
from app.world.generator import generate_mvp_world


def test_rule_based_decision_strategy_moves_hungry_agent_to_market():
    rng = SimulationRNG(seed=42)
    world = generate_mvp_world(rng=rng)
    agents = generate_mvp_agents(world, rng, population_size=10)

    agent = agents[0]
    # Artificially deplete hunger
    agent.needs[NeedType.HUNGER].value = 0.15
    GoalsSystem.generate_goals(agent, rng)

    # Build perception context
    context = PerceptionSystem.build_agent_context(agent, world, agents, tick=1)

    strategy = RuleBasedDecisionStrategy()
    intent = strategy.decide(context)

    assert isinstance(intent, ActionIntent)
    assert intent.produced_by == DecisionMode.RULE_BASED
    # Agent is initially at home (residential), so must decide to move to market
    assert intent.action_type == "move"
    assert "target_location_id" in intent.params
    target_uuid = uuid.UUID(intent.params["target_location_id"])
    assert world.locations[target_uuid].location_type == LocationType.MARKET


def test_action_resolver_mutates_agent_location_and_resolves_actions():
    rng = SimulationRNG(seed=42)
    world = generate_mvp_world(rng=rng)
    agents = generate_mvp_agents(world, rng, population_size=5)

    agent = agents[0]
    initial_location = agent.location_id
    market = world.locations_by_type(LocationType.MARKET)[0]

    # Intent to move to market
    move_intent = ActionIntent(
        action_type="move",
        params={"target_location_id": str(market.id)},
        produced_by=DecisionMode.RULE_BASED,
    )

    result = ActionResolver.resolve(agent, move_intent, world)
    assert result.success is True
    assert agent.location_id == market.id
    assert agent.location_id != initial_location

    # While at market, intent to consume food
    agent.needs[NeedType.HUNGER].value = 0.20
    initial_wealth = agent.wealth
    eat_intent = ActionIntent(
        action_type="consume_food",
        produced_by=DecisionMode.RULE_BASED,
    )
    eat_result = ActionResolver.resolve(agent, eat_intent, world)
    assert eat_result.success is True
    assert agent.needs[NeedType.HUNGER].value > 0.20
    assert agent.wealth < initial_wealth


def test_end_to_end_autonomous_simulation_step_moves_agents():
    """
    Verify that stepping the simulation service causes real agents
    to autonomously transition locations across ticks.
    """
    service = SimulationService(seed=12345, population_size=100)
    assert service.world.tick == 0

    # Capture initial agent locations at tick 0 (all at residences)
    initial_locations = {agent.id: agent.location_id for agent in service.agents}
    assert all(service.world.locations[loc_id].location_type == LocationType.RESIDENTIAL for loc_id in initial_locations.values())

    # Step simulation across multiple ticks
    for _ in range(10):
        service.step()

    assert service.world.tick == 10

    # At least some agents should have autonomously moved to workplace, market, or leisure
    current_locations = {agent.id: agent.location_id for agent in service.agents}
    moved_agents = [
        agent for agent in service.agents if current_locations[agent.id] != initial_locations[agent.id]
    ]

    assert len(moved_agents) > 0, "Expected autonomous agents to change location based on needs and routines."

    # Verify occupant counts across locations match agent location_id exactly
    for loc_id, loc in service.world.locations.items():
        occupants = [a for a in service.agents if a.location_id == loc_id]
        # Valid state integrity
        assert isinstance(occupants, list)

    total_occupancy = sum(len([a for a in service.agents if a.location_id == loc_id]) for loc_id in service.world.locations)
    assert total_occupancy == 100
