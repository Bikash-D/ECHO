"""
Phase 1 Step 1 tests: World domain model + MVP generator.

Scope: structure only (no agents, no ticking, no persistence -- those are
later Phase 1 steps). These tests exist to prove:
  1. generate_mvp_world() produces the exact MVP layout the architecture
     locks in (1 city, 5 neighborhoods, fixed location mix).
  2. World's query helpers (locations_by_type, locations_in_neighborhood,
     get_*) are correct.
  3. World's construction guardrails (add_location/add_household reject
     references to unregistered parents) actually work.
  4. Household instances are NOT created by the generator (Step 1 scope
     boundary -- documented in generator.py/models.py).
  5. Structural generation is deterministic (same names/counts/types every
     call), even though IDs differ per call since no agents exist yet to
     make ID determinism matter at this step.
"""

import uuid

from app.world.enums import LocationType
from app.world.generator import (
    LEISURE_PER_NEIGHBORHOOD,
    MARKETS_PER_NEIGHBORHOOD,
    NEIGHBORHOOD_NAMES,
    RESIDENTIAL_PER_NEIGHBORHOOD,
    WORKPLACES_PER_NEIGHBORHOOD,
    generate_mvp_world,
)
from app.world.models import City, Household, Location, Neighborhood, World


def _assert_raises(exc_type, fn) -> None:
    """
    Tiny stand-in for `pytest.raises` that has zero third-party dependency.
    Used instead of importing pytest directly so this test module can run
    standalone (via a plain script) in environments where pytest isn't
    installed, while remaining valid, unchanged test code once pytest is
    available in the real project venv.
    """
    try:
        fn()
    except exc_type:
        return
    raise AssertionError(f"Expected {exc_type.__name__} to be raised, but nothing was.")


# -- generator: overall shape ---------------------------------------------


def test_generates_exactly_one_city():
    world = generate_mvp_world()
    assert world.city.name == "Echo City"
    assert isinstance(world.city.id, uuid.UUID)


def test_generates_exactly_five_neighborhoods():
    world = generate_mvp_world()
    assert len(world.neighborhoods) == 5
    assert len(world.city.neighborhood_ids) == 5
    names = {n.name for n in world.neighborhoods.values()}
    assert names == set(NEIGHBORHOOD_NAMES)


def test_every_neighborhood_belongs_to_the_city():
    world = generate_mvp_world()
    for neighborhood in world.neighborhoods.values():
        assert neighborhood.city_id == world.city.id


def test_each_neighborhood_has_the_expected_location_mix():
    world = generate_mvp_world()
    expected_total = (
        RESIDENTIAL_PER_NEIGHBORHOOD
        + WORKPLACES_PER_NEIGHBORHOOD
        + MARKETS_PER_NEIGHBORHOOD
        + LEISURE_PER_NEIGHBORHOOD
    )

    for neighborhood in world.neighborhoods.values():
        locations = world.locations_in_neighborhood(neighborhood.id)
        assert len(locations) == expected_total

        by_type = {}
        for loc in locations:
            by_type[loc.location_type] = by_type.get(loc.location_type, 0) + 1

        assert by_type[LocationType.RESIDENTIAL] == RESIDENTIAL_PER_NEIGHBORHOOD
        assert by_type[LocationType.WORKPLACE] == WORKPLACES_PER_NEIGHBORHOOD
        assert by_type[LocationType.MARKET] == MARKETS_PER_NEIGHBORHOOD
        assert by_type[LocationType.LEISURE] == LEISURE_PER_NEIGHBORHOOD


def test_total_location_count_across_city():
    world = generate_mvp_world()
    per_neighborhood = (
        RESIDENTIAL_PER_NEIGHBORHOOD
        + WORKPLACES_PER_NEIGHBORHOOD
        + MARKETS_PER_NEIGHBORHOOD
        + LEISURE_PER_NEIGHBORHOOD
    )
    assert len(world.locations) == per_neighborhood * 5


def test_generation_has_no_households_yet():
    """
    Step 1 scope boundary: Household instances require agents to assign as
    members, and agent generation is Phase 1 Step 2. The generator must not
    invent placeholder households.
    """
    world = generate_mvp_world()
    assert world.households == {}


def test_structural_generation_is_deterministic_in_shape():
    """
    IDs are freshly random (uuid4) per call by design -- that's fine, since
    no agents exist yet to reference them across runs. What must be
    deterministic is the *shape*: names, counts, and type distribution.
    """
    world_a = generate_mvp_world()
    world_b = generate_mvp_world()

    names_a = sorted(n.name for n in world_a.neighborhoods.values())
    names_b = sorted(n.name for n in world_b.neighborhoods.values())
    assert names_a == names_b

    assert len(world_a.locations) == len(world_b.locations)

    def type_counts(world: World) -> dict:
        counts: dict[LocationType, int] = {}
        for loc in world.locations.values():
            counts[loc.location_type] = counts.get(loc.location_type, 0) + 1
        return counts

    assert type_counts(world_a) == type_counts(world_b)


# -- World: query helpers ---------------------------------------------------


def test_locations_by_type_returns_only_matching_locations():
    world = generate_mvp_world()
    markets = world.locations_by_type(LocationType.MARKET)

    assert len(markets) == MARKETS_PER_NEIGHBORHOOD * 5
    assert all(loc.location_type == LocationType.MARKET for loc in markets)


def test_locations_in_neighborhood_excludes_other_neighborhoods():
    world = generate_mvp_world()
    neighborhoods = list(world.neighborhoods.values())
    first, second = neighborhoods[0], neighborhoods[1]

    first_locations = world.locations_in_neighborhood(first.id)
    second_location_ids = {loc.id for loc in world.locations_in_neighborhood(second.id)}

    assert all(loc.id not in second_location_ids for loc in first_locations)


def test_get_neighborhood_and_get_location_lookup():
    world = generate_mvp_world()
    neighborhood = next(iter(world.neighborhoods.values()))
    location = world.locations_in_neighborhood(neighborhood.id)[0]

    assert world.get_neighborhood(neighborhood.id) is neighborhood
    assert world.get_location(location.id) is location


def test_get_unknown_ids_raise_keyerror():
    world = generate_mvp_world()
    _assert_raises(KeyError, lambda: world.get_neighborhood(uuid.uuid4()))
    _assert_raises(KeyError, lambda: world.get_location(uuid.uuid4()))


# -- World: construction guardrails -----------------------------------------


def test_add_location_rejects_unregistered_neighborhood():
    city = City(id=uuid.uuid4(), name="Test City")
    world = World(city=city)
    orphan_location = Location(
        id=uuid.uuid4(),
        name="Nowhere",
        neighborhood_id=uuid.uuid4(),  # never registered
        location_type=LocationType.RESIDENTIAL,
    )

    _assert_raises(ValueError, lambda: world.add_location(orphan_location))


def test_add_household_rejects_unregistered_location():
    city = City(id=uuid.uuid4(), name="Test City")
    world = World(city=city)
    orphan_household = Household(id=uuid.uuid4(), location_id=uuid.uuid4())

    _assert_raises(ValueError, lambda: world.add_household(orphan_household))


def test_add_household_succeeds_against_a_real_location():
    world = generate_mvp_world()
    residence = world.locations_by_type(LocationType.RESIDENTIAL)[0]
    household = Household(id=uuid.uuid4(), location_id=residence.id)

    world.add_household(household)

    assert world.get_household(household.id) is household
    assert household.id in world.households


# -- World: tick mirror / global_state --------------------------------------


def test_world_starts_at_tick_zero_with_empty_global_state():
    world = generate_mvp_world()
    assert world.tick == 0
    assert world.global_state == {}
