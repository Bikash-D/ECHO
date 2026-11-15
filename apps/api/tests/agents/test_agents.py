"""
Phase 1 Step 2 tests: Agent domain model + MVP agent generator.

Scope: agent data structure, personality validation, and agent<->World/
Household integration (household grouping, location assignment,
reproducibility of RNG-driven attributes). No Needs/Goals/Perception/
Actions/decision logic -- those are later Phase 1 steps.
"""

import uuid

from app.agents.agent import Agent
from app.agents.generator import generate_mvp_agents
from app.agents.personality import Personality
from app.core.rng import SimulationRNG
from app.world.enums import LocationType
from app.world.generator import generate_mvp_world


def _assert_raises(exc_type, fn) -> None:
    """Dependency-free stand-in for pytest.raises -- see tests/world/test_world.py."""
    try:
        fn()
    except exc_type:
        return
    raise AssertionError(f"Expected {exc_type.__name__} to be raised, but nothing was.")


def _valid_personality() -> Personality:
    return Personality(
        openness=0.5,
        conscientiousness=0.5,
        extraversion=0.5,
        agreeableness=0.5,
        neuroticism=0.5,
    )


# -- Personality: validation -------------------------------------------------


def test_personality_accepts_values_in_unit_range():
    p = Personality(
        openness=0.0, conscientiousness=1.0, extraversion=0.5,
        agreeableness=0.25, neuroticism=0.75,
    )
    assert p.openness == 0.0
    assert p.conscientiousness == 1.0


def test_personality_rejects_out_of_range_values():
    _assert_raises(ValueError, lambda: Personality(
        openness=1.5, conscientiousness=0.5, extraversion=0.5,
        agreeableness=0.5, neuroticism=0.5,
    ))
    _assert_raises(ValueError, lambda: Personality(
        openness=0.5, conscientiousness=-0.1, extraversion=0.5,
        agreeableness=0.5, neuroticism=0.5,
    ))


def test_personality_as_dict_matches_agent_context_shape():
    p = _valid_personality()
    d = p.as_dict()
    assert d == {
        "openness": 0.5,
        "conscientiousness": 0.5,
        "extraversion": 0.5,
        "agreeableness": 0.5,
        "neuroticism": 0.5,
    }
    assert all(isinstance(v, float) for v in d.values())


# -- Agent: construction + invariants ----------------------------------------


def test_agent_constructs_with_defaults():
    agent = Agent(
        id=uuid.uuid4(),
        name="Test Agent",
        age=30,
        personality=_valid_personality(),
        occupation="trader",
        wealth=1000.0,
    )
    assert agent.location_id is None
    assert agent.household_id is None
    assert agent.emotional_state == {"mood": 0.5}
    assert agent.social_status == 0.5


def test_agent_rejects_non_positive_age():
    _assert_raises(ValueError, lambda: Agent(
        id=uuid.uuid4(), name="X", age=0, personality=_valid_personality(),
        occupation="trader", wealth=100.0,
    ))
    _assert_raises(ValueError, lambda: Agent(
        id=uuid.uuid4(), name="X", age=-5, personality=_valid_personality(),
        occupation="trader", wealth=100.0,
    ))


def test_agent_rejects_negative_wealth():
    _assert_raises(ValueError, lambda: Agent(
        id=uuid.uuid4(), name="X", age=30, personality=_valid_personality(),
        occupation="trader", wealth=-1.0,
    ))


def test_agent_rejects_out_of_range_social_status():
    _assert_raises(ValueError, lambda: Agent(
        id=uuid.uuid4(), name="X", age=30, personality=_valid_personality(),
        occupation="trader", wealth=100.0, social_status=1.2,
    ))


# -- generate_mvp_agents: population shape -----------------------------------


def test_generates_requested_population_size():
    world = generate_mvp_world()
    rng = SimulationRNG(seed=1)
    agents = generate_mvp_agents(world, rng, population_size=15)
    assert len(agents) == 15
    assert all(isinstance(a, Agent) for a in agents)


def test_every_agent_has_valid_personality_traits():
    world = generate_mvp_world()
    rng = SimulationRNG(seed=1)
    agents = generate_mvp_agents(world, rng, population_size=20)
    for agent in agents:
        for value in agent.personality.as_dict().values():
            assert 0.0 <= value <= 1.0


def test_every_agent_age_within_adult_range():
    world = generate_mvp_world()
    rng = SimulationRNG(seed=1)
    agents = generate_mvp_agents(world, rng, population_size=20)
    for agent in agents:
        assert 18 <= agent.age <= 75


def test_every_agent_has_nonnegative_wealth():
    world = generate_mvp_world()
    rng = SimulationRNG(seed=1)
    agents = generate_mvp_agents(world, rng, population_size=20)
    for agent in agents:
        assert agent.wealth >= 0.0


# -- generate_mvp_agents: World/Household integration ------------------------


def test_every_agent_is_assigned_to_a_household_registered_on_world():
    world = generate_mvp_world()
    rng = SimulationRNG(seed=1)
    agents = generate_mvp_agents(world, rng, population_size=20)

    for agent in agents:
        assert agent.household_id is not None
        assert agent.household_id in world.households


def test_agent_location_matches_their_household_location():
    world = generate_mvp_world()
    rng = SimulationRNG(seed=1)
    agents = generate_mvp_agents(world, rng, population_size=20)

    for agent in agents:
        household = world.get_household(agent.household_id)
        assert agent.location_id == household.location_id


def test_every_household_location_is_a_real_residential_location():
    world = generate_mvp_world()
    rng = SimulationRNG(seed=1)
    generate_mvp_agents(world, rng, population_size=20)

    residential_ids = {loc.id for loc in world.locations_by_type(LocationType.RESIDENTIAL)}
    for household in world.households.values():
        assert household.location_id in residential_ids


def test_household_membership_round_trips_with_agent_household_id():
    world = generate_mvp_world()
    rng = SimulationRNG(seed=1)
    agents = generate_mvp_agents(world, rng, population_size=20)
    agents_by_id = {a.id: a for a in agents}

    for household in world.households.values():
        for member_id in household.member_agent_ids:
            assert agents_by_id[member_id].household_id == household.id


def test_every_agent_is_placed_in_exactly_one_household():
    world = generate_mvp_world()
    rng = SimulationRNG(seed=1)
    agents = generate_mvp_agents(world, rng, population_size=23)  # not evenly divisible

    all_member_ids: list[uuid.UUID] = []
    for household in world.households.values():
        all_member_ids.extend(household.member_agent_ids)

    assert sorted(all_member_ids) == sorted(a.id for a in agents)
    assert len(all_member_ids) == len(set(all_member_ids))  # no duplicates


def test_raises_if_world_has_no_residential_locations():
    from app.world.models import City, World

    empty_world = World(city=City(id=uuid.uuid4(), name="Empty"))
    rng = SimulationRNG(seed=1)
    _assert_raises(ValueError, lambda: generate_mvp_agents(empty_world, rng, population_size=5))


# -- reproducibility ----------------------------------------------------------


def test_same_seed_produces_identical_agent_attribute_sequence():
    """
    With deterministic SimulationRNG.uuid(), the same seed reproduces the exact
    same sequence of IDs, names, ages, wealth, personality traits, occupations,
    and household groupings.
    """
    world_a = generate_mvp_world(rng=SimulationRNG(seed=99))
    world_b = generate_mvp_world(rng=SimulationRNG(seed=99))

    agents_a = generate_mvp_agents(world_a, SimulationRNG(seed=99), population_size=20)
    agents_b = generate_mvp_agents(world_b, SimulationRNG(seed=99), population_size=20)

    def fingerprint(agent: Agent) -> tuple:
        return (
            agent.id,
            agent.name,
            agent.age,
            agent.occupation,
            agent.wealth,
            agent.social_status,
            agent.household_id,
            agent.location_id,
            tuple(agent.personality.as_dict().values()),
        )

    assert [fingerprint(a) for a in agents_a] == [fingerprint(a) for a in agents_b]

    household_ids_a = sorted(world_a.households.keys())
    household_ids_b = sorted(world_b.households.keys())
    assert household_ids_a == household_ids_b


def test_different_seeds_produce_different_agent_attributes():
    world_a = generate_mvp_world()
    world_b = generate_mvp_world()

    agents_a = generate_mvp_agents(world_a, SimulationRNG(seed=1), population_size=20)
    agents_b = generate_mvp_agents(world_b, SimulationRNG(seed=2), population_size=20)

    ages_a = [a.age for a in agents_a]
    ages_b = [a.age for a in agents_b]
    assert ages_a != ages_b  # astronomically unlikely to collide by chance


def test_agent_generation_does_not_consume_the_parent_rng_stream():
    """
    Enforces core/rng.py's subsystem-isolation rule: generate_mvp_agents
    must draw only from rng.spawn_child('agent_generation'), never from
    `rng` directly, so a caller's own subsequent use of `rng` is
    unaffected by how many agents were generated.
    """
    world = generate_mvp_world()

    rng_untouched = SimulationRNG(seed=42)
    baseline_sequence = [rng_untouched.random() for _ in range(5)]

    rng_used_for_generation = SimulationRNG(seed=42)
    generate_mvp_agents(world, rng_used_for_generation, population_size=20)
    post_generation_sequence = [rng_used_for_generation.random() for _ in range(5)]

    assert baseline_sequence == post_generation_sequence
