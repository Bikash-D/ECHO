"""
Living City milestone -- Phase A tests: location semantic ontology.

Scope: proves the venue_kind/architectural_style/floor_count/is_public
metadata added to Location (world/models.py) and its deterministic
assignment (world/generator.py) actually hold the properties Part 2 of
the brief requires:
  1. Every Location has a real venue_kind belonging to its LocationType's
     controlled vocabulary (never blank, never cross-type).
  2. Assignment is deterministic: the same seed produces the same
     venue_kind/architectural_style/floor_count for every location, run
     after run.
  3. A default-constructed Location (no venue_kind passed) still gets a
     real, valid venue_kind -- never None/blank -- via __post_init__.
  4. is_public is correctly derived per LocationType.
  5. interior_archetype_for() is a pure, total function over every
     VenueKind (every kind maps to something, and it's deterministic).
  6. Generation remains reproducible: two generate_mvp_world() calls
     with no seed (both default to seed=0) produce identical ontology
     assignments across every one of the 40 real locations.

Kept in the same zero-pytest-dependency style as test_world.py (plain
functions + a local _assert_raises) so it can run standalone in
environments without pytest installed.
"""

import uuid

from app.core.rng import SimulationRNG
from app.world.enums import (
    VENUE_KINDS_BY_LOCATION_TYPE,
    ArchitecturalStyle,
    LocationType,
    VenueKind,
    interior_archetype_for,
    is_public_location_type,
)
from app.world.generator import generate_mvp_world
from app.world.models import City, Location, Neighborhood, World


def _assert_raises(exc_type, fn) -> None:
    try:
        fn()
    except exc_type:
        return
    raise AssertionError(f"Expected {exc_type.__name__} to be raised, but nothing was.")


# -- controlled vocabulary shape -------------------------------------------


def test_every_location_type_has_a_nonempty_venue_kind_set():
    for location_type in LocationType:
        kinds = VENUE_KINDS_BY_LOCATION_TYPE[location_type]
        assert len(kinds) >= 3, f"{location_type} has too small a controlled vocabulary"
        assert len(set(kinds)) == len(kinds), f"{location_type} has duplicate venue kinds"


def test_venue_kind_sets_are_disjoint_across_location_types():
    # A given VenueKind belongs to exactly one LocationType bucket --
    # "office" can't also be a residential kind.
    seen: dict[VenueKind, LocationType] = {}
    for location_type, kinds in VENUE_KINDS_BY_LOCATION_TYPE.items():
        for kind in kinds:
            assert kind not in seen, (
                f"{kind} appears under both {seen.get(kind)} and {location_type}"
            )
            seen[kind] = location_type


def test_every_venue_kind_enum_member_is_assigned_to_some_location_type():
    all_mapped = {k for kinds in VENUE_KINDS_BY_LOCATION_TYPE.values() for k in kinds}
    assert all_mapped == set(VenueKind)


# -- generator: real, deterministic assignment -----------------------------


def test_generated_world_gives_every_location_a_venue_kind_matching_its_type():
    world = generate_mvp_world()
    assert len(world.locations) == 40  # sanity: still the real MVP world shape

    for loc in world.locations.values():
        assert loc.venue_kind is not None
        allowed = VENUE_KINDS_BY_LOCATION_TYPE[loc.location_type]
        assert loc.venue_kind in allowed, (
            f"{loc.name} is a {loc.location_type} with venue_kind {loc.venue_kind}, "
            f"not in {allowed}"
        )


def test_generated_world_gives_every_location_a_valid_architectural_style_and_floor_count():
    world = generate_mvp_world()
    for loc in world.locations.values():
        assert loc.architectural_style in set(ArchitecturalStyle)
        assert isinstance(loc.floor_count, int)
        assert loc.floor_count >= 1


def test_venue_kind_assignment_is_deterministic_for_a_fixed_seed():
    world_a = generate_mvp_world(rng=SimulationRNG(seed=42))
    world_b = generate_mvp_world(rng=SimulationRNG(seed=42))

    # Locations are generated in the same fixed order every call (see
    # generator.py's NEIGHBORHOOD_NAMES / _LOCATION_PLAN iteration), so
    # zipping the two location lists in insertion order compares "the
    # Nth location generated" across both runs.
    locs_a = list(world_a.locations.values())
    locs_b = list(world_b.locations.values())
    assert len(locs_a) == len(locs_b)

    for a, b in zip(locs_a, locs_b):
        assert a.name == b.name
        assert a.venue_kind == b.venue_kind
        assert a.architectural_style == b.architectural_style
        assert a.floor_count == b.floor_count


def test_venue_kind_assignment_varies_within_a_location_type():
    # Not a hard requirement of any single seed, but with 20 residential
    # locations (4 per neighborhood x 5) drawn from a 4-member controlled
    # vocabulary, seed=0's real assignment should not collapse to a
    # single repeated kind -- this catches an accidental "always picks
    # index 0" bug in the RNG wiring without pinning to one exact
    # sequence (which would make this test change every time the
    # vocabulary is edited).
    world = generate_mvp_world()
    residential_kinds = {
        loc.venue_kind for loc in world.locations.values() if loc.location_type == LocationType.RESIDENTIAL
    }
    assert len(residential_kinds) > 1


def test_different_seeds_can_produce_different_venue_kind_assignments():
    world_a = generate_mvp_world(rng=SimulationRNG(seed=1))
    world_b = generate_mvp_world(rng=SimulationRNG(seed=2))
    kinds_a = [loc.venue_kind for loc in world_a.locations.values()]
    kinds_b = [loc.venue_kind for loc in world_b.locations.values()]
    assert kinds_a != kinds_b


# -- Location defaults (__post_init__) --------------------------------------


def test_location_constructed_without_venue_kind_gets_a_real_default():
    loc = Location(
        id=uuid.uuid4(),
        name="Bare Location",
        neighborhood_id=uuid.uuid4(),
        location_type=LocationType.WORKPLACE,
    )
    assert loc.venue_kind is not None
    assert loc.venue_kind in VENUE_KINDS_BY_LOCATION_TYPE[LocationType.WORKPLACE]


def test_location_is_public_defaults_from_location_type():
    residential = Location(
        id=uuid.uuid4(), name="House", neighborhood_id=uuid.uuid4(), location_type=LocationType.RESIDENTIAL
    )
    market = Location(
        id=uuid.uuid4(), name="Shop", neighborhood_id=uuid.uuid4(), location_type=LocationType.MARKET
    )
    leisure = Location(
        id=uuid.uuid4(), name="Park", neighborhood_id=uuid.uuid4(), location_type=LocationType.LEISURE
    )
    workplace = Location(
        id=uuid.uuid4(), name="Office", neighborhood_id=uuid.uuid4(), location_type=LocationType.WORKPLACE
    )
    assert residential.is_public is False
    assert market.is_public is True
    assert leisure.is_public is True
    assert workplace.is_public is False


def test_location_is_public_can_be_explicitly_overridden():
    private_market = Location(
        id=uuid.uuid4(),
        name="Members-only shop",
        neighborhood_id=uuid.uuid4(),
        location_type=LocationType.MARKET,
        is_public=False,
    )
    assert private_market.is_public is False


def test_generated_world_locations_have_is_public_matching_their_type():
    world = generate_mvp_world()
    for loc in world.locations.values():
        assert loc.is_public == is_public_location_type(loc.location_type)


# -- interior_archetype_for() ------------------------------------------------


def test_interior_archetype_is_defined_for_every_venue_kind():
    for kind in VenueKind:
        archetype = interior_archetype_for(kind)
        assert isinstance(archetype, str)
        assert archetype != ""


def test_interior_archetype_accepts_the_raw_string_value_too():
    assert interior_archetype_for("office") == interior_archetype_for(VenueKind.OFFICE)


def test_interior_archetype_is_deterministic():
    assert interior_archetype_for(VenueKind.CAFE) == interior_archetype_for(VenueKind.CAFE)


def test_interior_archetype_rejects_unknown_string():
    _assert_raises(ValueError, lambda: interior_archetype_for("not_a_real_venue_kind"))


# -- World construction guardrails are unaffected by the new fields --------


def test_add_location_with_full_ontology_fields_still_enforces_neighborhood_guard():
    city = City(id=uuid.uuid4(), name="Test City")
    world = World(city=city)
    orphan_location = Location(
        id=uuid.uuid4(),
        name="Nowhere",
        neighborhood_id=uuid.uuid4(),  # never registered
        location_type=LocationType.RESIDENTIAL,
        venue_kind=VenueKind.TOWNHOUSE,
        architectural_style=ArchitecturalStyle.MODERN,
        floor_count=2,
    )
    _assert_raises(ValueError, lambda: world.add_location(orphan_location))
