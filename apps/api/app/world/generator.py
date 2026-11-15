"""
Deterministic MVP world generator.

Builds the fixed Phase 1 spatial layout defined by the approved MVP scope:
1 city, 5 neighborhoods, and a minimal set of locations per neighborhood
covering the location types the Phase 1 action set needs (residential,
workplace, market, leisure).

NOT randomized: the layout (neighborhood names, location counts/types) is
static, so this module does not consume SimulationRNG. Structure is not a
"decision" in the reproducibility sense -- it's fixed scenario configuration,
the same way `simulation/scenarios/` configs will be later. If a future
phase needs a randomized/varying layout (e.g. neighborhood sizes drawn from
a distribution), that randomness MUST go through SimulationRNG per
core/rng.py's rule -- this module would need to accept an rng argument at
that point. Not needed for Phase 1.
"""

from __future__ import annotations

from app.core.rng import SimulationRNG
from app.economy.business import Business
from app.world.enums import VENUE_KINDS_BY_LOCATION_TYPE, ArchitecturalStyle, LocationType
from app.world.models import ECONOMIC_LOCATION_TYPES, City, Location, Neighborhood, World

# Fixed per finalized MVP scope (architecture.md Section 8): exactly 5
# neighborhoods in the single MVP city.
NEIGHBORHOOD_NAMES: list[str] = ["Riverside", "Downtown", "Hillcrest", "Eastgate", "Millbrook"]

# Per-neighborhood location counts. Small and fixed for MVP: enough for a
# 100-agent population to plausibly have somewhere to live/work/shop/relax
# without modeling real capacity/real-estate constraints yet (out of MVP
# scope -- see architecture.md Section 8, "advanced ... " exclusions).
RESIDENTIAL_PER_NEIGHBORHOOD = 4
WORKPLACES_PER_NEIGHBORHOOD = 2
MARKETS_PER_NEIGHBORHOOD = 1
LEISURE_PER_NEIGHBORHOOD = 1

_LOCATION_PLAN: list[tuple[LocationType, int, str]] = [
    (LocationType.RESIDENTIAL, RESIDENTIAL_PER_NEIGHBORHOOD, "Residence"),
    (LocationType.WORKPLACE, WORKPLACES_PER_NEIGHBORHOOD, "Workplace"),
    (LocationType.MARKET, MARKETS_PER_NEIGHBORHOOD, "Market"),
    (LocationType.LEISURE, LEISURE_PER_NEIGHBORHOOD, "Leisure Spot"),
]

# Visual-only floor-count range per LocationType (inclusive), used to give
# each Location a deterministic, plausible floor count for the Living
# City milestone's building-archetype work -- e.g. an office can
# plausibly be 1-4 floors, a market/leisure venue is realistically always
# single-storey for MVP's scale. Not read by any simulation system.
_FLOOR_COUNT_RANGE: dict[LocationType, tuple[int, int]] = {
    LocationType.RESIDENTIAL: (1, 2),
    LocationType.WORKPLACE: (1, 4),
    LocationType.MARKET: (1, 1),
    LocationType.LEISURE: (1, 1),
}


def generate_mvp_world(city_name: str = "Echo City", rng: SimulationRNG | None = None) -> World:
    """
    Build and return a fully-populated (structurally) MVP World: 1 city,
    5 neighborhoods, and each neighborhood's fixed location mix.

    Does NOT create any Households -- those require agents to assign as
    members, and agent generation is Phase 1 Step 2. Calling code should
    generate agents first, then create+register Households on this World
    as agents are assigned residences.
    """
    if rng is None:
        rng = SimulationRNG(seed=0)
    world_rng = rng.spawn_child("world_generation")
    # Separate RNG stream for venue_kind/architectural_style/floor_count
    # assignment (see core/rng.py's rule: different subsystems don't
    # share a stream, so this ontology pass can't accidentally perturb
    # the id-generation sequence world_rng is already used for above, or
    # vice versa). Deterministic given the top-level seed, same as every
    # other spawn_child call in this codebase.
    venue_rng = world_rng.spawn_child("venue_kind_assignment")

    city = City(id=world_rng.uuid(), name=city_name)
    world = World(city=city)

    for name in NEIGHBORHOOD_NAMES:
        neighborhood = Neighborhood(id=world_rng.uuid(), name=name, city_id=city.id)
        world.add_neighborhood(neighborhood)

        for location_type, count, label in _LOCATION_PLAN:
            _add_locations(world, neighborhood, location_type, count, label, world_rng, venue_rng)

    return world


def _add_locations(
    world: World,
    neighborhood: Neighborhood,
    location_type: LocationType,
    count: int,
    label: str,
    world_rng: SimulationRNG,
    venue_rng: SimulationRNG,
) -> None:
    for i in range(count):
        venue_kind = venue_rng.choice(VENUE_KINDS_BY_LOCATION_TYPE[location_type])
        architectural_style = venue_rng.choice(list(ArchitecturalStyle))
        floor_lo, floor_hi = _FLOOR_COUNT_RANGE[location_type]
        floor_count = venue_rng.randint(floor_lo, floor_hi)

        location = Location(
            id=world_rng.uuid(),
            name=f"{neighborhood.name} {label} {i + 1}",
            neighborhood_id=neighborhood.id,
            location_type=location_type,
            venue_kind=venue_kind,
            architectural_style=architectural_style,
            floor_count=floor_count,
        )
        world.add_location(location)

        # Every economic Location (WORKPLACE or MARKET -- see
        # world/models.py::ECONOMIC_LOCATION_TYPES) hosts exactly one
        # Business (MVP cardinality -- see economy/business.py's
        # docstring). Created here, not lazily, so a workplace an agent
        # is assigned to at generation time
        # (agents/generator.py::_assign_workplaces) always has somewhere
        # for its work shifts' economic output to go, and a market an
        # agent travels to for food always has somewhere for that
        # payment to go -- there is never an economic Location without a
        # Business backing it. Not RNG-derived (like the Location's own
        # name): this is fixed scenario structure, not a modeled decision.
        if location_type in ECONOMIC_LOCATION_TYPES:
            business = Business(
                id=world_rng.uuid(),
                location_id=location.id,
                name=f"{location.name} Co.",
            )
            world.add_business(business)
