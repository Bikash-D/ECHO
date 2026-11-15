"""
Phase 1 Step 5 tests: Perception domain model and PerceptionSystem.
"""

import uuid

from app.agents.agent import Agent
from app.agents.generator import generate_mvp_agents
from app.agents.personality import Personality
from app.core.rng import SimulationRNG
from app.goals.enums import GoalStatus, GoalType
from app.goals.models import Goal
from app.needs.enums import NeedType
from app.needs.models import Need
from app.perception.models import (
    PerceivedAgent,
    PerceivedLocation,
    PerceptionSnapshot,
)
from app.perception.system import PerceptionSystem
from app.schemas.agent_context import AgentContext, PerceivedWorldState
from app.world.enums import LocationType
from app.world.generator import generate_mvp_world
from app.world.models import City, Location, Neighborhood, World


def _valid_personality() -> Personality:
    return Personality(
        openness=0.6,
        conscientiousness=0.7,
        extraversion=0.8,
        agreeableness=0.4,
        neuroticism=0.3,
    )


def _make_test_agent(
    name: str = "Alice",
    location_id: uuid.UUID | None = None,
) -> Agent:
    return Agent(
        id=uuid.uuid4(),
        name=name,
        age=28,
        personality=_valid_personality(),
        occupation="trader",
        wealth=1200.0,
        location_id=location_id,
        social_status=0.65,
    )


# -- PerceivedAgent & PerceivedLocation Unit Tests ---------------------------


def test_perceived_agent_from_agent():
    agent = _make_test_agent(name="Bob")
    agent.emotional_state = {"mood": 0.8}
    perceived = PerceivedAgent.from_agent(agent)

    assert perceived.id == agent.id
    assert perceived.name == "Bob"
    assert perceived.occupation == "trader"
    assert perceived.social_status == 0.65
    assert perceived.emotional_state == {"mood": 0.8}


def test_perceived_location_from_location():
    loc_id = uuid.uuid4()
    nh_id = uuid.uuid4()
    loc = Location(
        id=loc_id,
        name="Riverside Market 1",
        neighborhood_id=nh_id,
        location_type=LocationType.MARKET,
    )
    perceived = PerceivedLocation.from_location(loc)

    assert perceived.id == loc_id
    assert perceived.name == "Riverside Market 1"
    assert perceived.location_type == LocationType.MARKET
    assert perceived.neighborhood_id == nh_id


# -- PerceptionSystem Co-location & Neighborhood Visibility -----------------


def test_perceive_detects_co_located_agents_excluding_self():
    world = generate_mvp_world()
    res_locs = world.locations_by_type(LocationType.RESIDENTIAL)
    loc_a = res_locs[0]
    loc_b = res_locs[1]

    agent1 = _make_test_agent("Agent 1", location_id=loc_a.id)
    agent2 = _make_test_agent("Agent 2", location_id=loc_a.id)
    agent3 = _make_test_agent("Agent 3", location_id=loc_b.id)

    all_agents = [agent1, agent2, agent3]

    snapshot1 = PerceptionSystem.perceive(agent1, world, all_agents)

    # Agent 1 should see Agent 2, but NOT Agent 3 and NOT itself
    visible_ids = [a.id for a in snapshot1.visible_agents]
    assert agent2.id in visible_ids
    assert agent1.id not in visible_ids
    assert agent3.id not in visible_ids
    assert len(snapshot1.visible_agents) == 1
    assert snapshot1.visible_agents[0].name == "Agent 2"


def test_perceive_empty_when_no_other_agents_at_location():
    world = generate_mvp_world()
    res_locs = world.locations_by_type(LocationType.RESIDENTIAL)
    loc_a = res_locs[0]
    loc_b = res_locs[1]

    agent1 = _make_test_agent("Agent 1", location_id=loc_a.id)
    agent2 = _make_test_agent("Agent 2", location_id=loc_b.id)

    snapshot = PerceptionSystem.perceive(agent1, world, [agent1, agent2])
    assert len(snapshot.visible_agents) == 0


def test_perceive_visible_locations_scoped_to_agent_neighborhood():
    world = generate_mvp_world()
    # 5 neighborhoods, each has 8 locations (4 res, 2 work, 1 market, 1 leisure)
    hood_ids = list(world.neighborhoods.keys())
    target_hood_id = hood_ids[0]
    other_hood_id = hood_ids[1]

    target_locations = world.locations_in_neighborhood(target_hood_id)
    loc_in_target = target_locations[0]

    agent = _make_test_agent("Agent 1", location_id=loc_in_target.id)

    snapshot = PerceptionSystem.perceive(agent, world, [agent])

    assert snapshot.neighborhood_id == target_hood_id
    assert len(snapshot.visible_locations) == len(target_locations)
    assert len(snapshot.visible_locations) == 8

    visible_loc_ids = {loc.id for loc in snapshot.visible_locations}
    target_loc_ids = {loc.id for loc in target_locations}
    assert visible_loc_ids == target_loc_ids

    # None of the other neighborhood's locations should be visible
    other_loc_ids = {loc.id for loc in world.locations_in_neighborhood(other_hood_id)}
    assert visible_loc_ids.isdisjoint(other_loc_ids)


# -- Transient Nature & Non-Mutation Tests -----------------------------------


def test_perception_is_transient_and_does_not_attach_state_to_agent():
    world = generate_mvp_world()
    res_loc = world.locations_by_type(LocationType.RESIDENTIAL)[0]
    agent = _make_test_agent("Agent 1", location_id=res_loc.id)

    initial_dict = dict(agent.__dict__)

    snapshot = PerceptionSystem.perceive(agent, world, [agent])

    assert isinstance(snapshot, PerceptionSnapshot)
    # Agent domain model must NOT gain an 'agent.perception' attribute
    assert not hasattr(agent, "perception")
    assert agent.__dict__ == initial_dict


# -- Error Handling Tests ---------------------------------------------------


def test_perceive_raises_when_agent_has_no_location():
    world = generate_mvp_world()
    agent = _make_test_agent("Agent 1", location_id=None)

    try:
        PerceptionSystem.perceive(agent, world, [agent])
        assert False, "Should have raised ValueError"
    except ValueError as e:
        assert "no location_id" in str(e)


def test_perceive_raises_when_location_not_in_world():
    world = generate_mvp_world()
    unregistered_id = uuid.uuid4()
    agent = _make_test_agent("Agent 1", location_id=unregistered_id)

    try:
        PerceptionSystem.perceive(agent, world, [agent])
        assert False, "Should have raised ValueError"
    except ValueError as e:
        assert "not registered on the World" in str(e)


# -- Schema Conversion & AgentContext Integration ----------------------------


def test_perception_snapshot_to_schema():
    loc_id = uuid.uuid4()
    nh_id = uuid.uuid4()
    agent_id = uuid.uuid4()

    snapshot = PerceptionSnapshot(
        tick=42,
        agent_id=agent_id,
        location_id=loc_id,
        neighborhood_id=nh_id,
        visible_agents=[],
        visible_locations=[],
        local_prices={"bread": 2.5},
        active_events=["market_day"],
    )

    schema = snapshot.to_schema()
    assert isinstance(schema, PerceivedWorldState)
    assert schema.tick == 42
    assert schema.location_id == loc_id
    assert schema.local_prices == {"bread": 2.5}
    assert schema.active_events == ["market_day"]


def test_build_agent_context_complete_pipeline():
    world = generate_mvp_world()
    rng = SimulationRNG(seed=123)
    agents = generate_mvp_agents(world, rng, population_size=10)

    target_agent = agents[0]
    target_agent.needs = {
        NeedType.HUNGER: Need(NeedType.HUNGER, 0.2, 0.02),
        NeedType.ENERGY: Need(NeedType.ENERGY, 0.9, 0.01),
    }
    target_agent.goals = [
        Goal(
            id=uuid.uuid4(),
            goal_type=GoalType.SATISFY_HUNGER,
            description="Find food",
            priority=80,
            status=GoalStatus.ACTIVE,
        )
    ]

    context = PerceptionSystem.build_agent_context(
        agent=target_agent,
        world=world,
        other_agents=agents,
        tick=5,
    )

    assert isinstance(context, AgentContext)
    assert context.agent_id == target_agent.id
    assert context.tick == 5
    assert context.wealth == target_agent.wealth
    assert len(context.needs) == 2
    assert len(context.goals) == 1
    assert context.goals[0].description == "Find food"
    assert context.goals[0].priority == 80
    assert context.perceived_world.location_id == target_agent.location_id
    assert context.perceived_world.tick == 5


def test_full_population_perception_sanity():
    world = generate_mvp_world(rng=SimulationRNG(seed=1))
    rng = SimulationRNG(seed=1)
    agents = generate_mvp_agents(world, rng, population_size=100)

    # Every agent in the 100 population can perceive without errors
    for agent in agents:
        snapshot = PerceptionSystem.perceive(agent, world, agents)
        assert snapshot.agent_id == agent.id
        assert snapshot.location_id == agent.location_id
        assert len(snapshot.visible_locations) == 8  # 8 locations per neighborhood
        assert isinstance(snapshot.visible_agents, list)


def test_perceive_multi_agent_clustering():
    world = generate_mvp_world()
    loc = world.locations_by_type(LocationType.MARKET)[0]

    # Cluster 5 agents at the same market location
    cluster_agents = [_make_test_agent(f"Agent {i}", location_id=loc.id) for i in range(5)]
    other_agent = _make_test_agent("Far Agent", location_id=world.locations_by_type(LocationType.RESIDENTIAL)[0].id)
    all_agents = cluster_agents + [other_agent]

    for i, agent in enumerate(cluster_agents):
        snapshot = PerceptionSystem.perceive(agent, world, all_agents)
        assert len(snapshot.visible_agents) == 4
        visible_names = {a.name for a in snapshot.visible_agents}
        expected_names = {a.name for a in cluster_agents if a.name != agent.name}
        assert visible_names == expected_names
        assert "Far Agent" not in visible_names


def test_perceive_global_prices_and_state():
    world = generate_mvp_world()
    world.global_state["food_price"] = 12.50
    world.global_state["rent_base"] = 450.0

    res_loc = world.locations_by_type(LocationType.RESIDENTIAL)[0]
    agent = _make_test_agent(location_id=res_loc.id)

    snapshot = PerceptionSystem.perceive(agent, world, [agent])
    assert snapshot.local_prices == {"food_price": 12.50, "rent_base": 450.0}

    schema = snapshot.to_schema()
    assert schema.local_prices == {"food_price": 12.50, "rent_base": 450.0}


def test_perception_is_deterministic_given_same_seed():
    world_a = generate_mvp_world(rng=SimulationRNG(seed=55))
    world_b = generate_mvp_world(rng=SimulationRNG(seed=55))

    agents_a = generate_mvp_agents(world_a, SimulationRNG(seed=55), population_size=20)
    agents_b = generate_mvp_agents(world_b, SimulationRNG(seed=55), population_size=20)

    for i in range(20):
        snap_a = PerceptionSystem.perceive(agents_a[i], world_a, agents_a)
        snap_b = PerceptionSystem.perceive(agents_b[i], world_b, agents_b)

        assert snap_a.agent_id == snap_b.agent_id
        assert snap_a.location_id == snap_b.location_id
        assert snap_a.neighborhood_id == snap_b.neighborhood_id
        assert len(snap_a.visible_agents) == len(snap_b.visible_agents)
        assert len(snap_a.visible_locations) == len(snap_b.visible_locations)
