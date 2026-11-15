"""
World domain model.

These are plain Python objects, NOT SQLAlchemy models and NOT Pydantic
schemas. This is a deliberate architectural decision for Phase 1:

- The simulation engine must run headlessly and per-tick without the DB
  (architectural rule #1 and #7 -- engine usable independently of FastAPI,
  persistence decoupled from the tick loop). If World were a SQLAlchemy
  model, every read/mutation during a tick would risk becoming an implicit
  DB operation (lazy-loaded relationships, session-bound attributes).
- Pydantic models are optimized for validated I/O boundaries (which is
  exactly what schemas/ is for), not for objects that get mutated every
  tick during the simulation loop.

`app/models/` (SQLAlchemy) remains the persistence-layer representation.
Phase 2 will add a sync/mapping layer between this domain model and those
tables. This file has zero third-party dependencies on purpose.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.economy.business import Business
from app.world.enums import (
    DEFAULT_VENUE_KIND_BY_LOCATION_TYPE,
    ArchitecturalStyle,
    LocationType,
    VenueKind,
    is_public_location_type,
)

# Location types that host exactly one Business each for MVP. Kept as a
# module-level constant (not hardcoded inline) so world/generator.py and
# World.add_business's validation read the same single source of truth --
# adding a new economic location type later means changing one set, not
# hunting for every place WORKPLACE was written literally.
ECONOMIC_LOCATION_TYPES: frozenset[LocationType] = frozenset(
    {LocationType.WORKPLACE, LocationType.MARKET}
)


@dataclass
class Location:
    """A single place agents can be at: a residence, a workplace, etc.

    `location_type` remains the coarse category the action system keys
    off of (unchanged). The fields below add a real semantic identity on
    top of it -- "this workplace is a clinic," not just "a workplace" --
    for the Living City milestone (Iso-new full-city pass). They are
    presentation/domain-richness metadata: nothing in simulation/,
    agents/, economy/, or society/ reads them, so they carry zero risk
    of changing simulation behavior.

    All four have real, always-populated defaults (never blank/None) so
    every Location -- however it's constructed -- has a genuine identity.
    Callers that want deterministic, generation-time-varied values (the
    normal path) should not rely on the defaults; see
    world/generator.py's `_venue_kind_for`, which is the only call site
    that overrides them intentionally.
    """

    id: uuid.UUID
    name: str
    neighborhood_id: uuid.UUID
    location_type: LocationType
    capacity: int | None = None  # None = unconstrained for MVP
    # Specific identity within location_type (see world/enums.py::VenueKind).
    # Defaulted in __post_init__ to that type's canonical first kind when
    # not explicitly given, rather than left blank -- see class docstring.
    venue_kind: VenueKind | None = None
    # Cosmetic style tag, independent of venue_kind (see ArchitecturalStyle).
    architectural_style: ArchitecturalStyle = ArchitecturalStyle.TRADITIONAL
    # Visual-only floor count (>=1). Not read by any simulation system.
    floor_count: int = 1
    # Whether this venue_kind is open to the general public. Derived from
    # location_type by default (see is_public_location_type) when left
    # None; can be explicitly overridden per-Location (True or False) if
    # a future scenario needs an exception (e.g. a private clinic) --
    # stored as `bool | None` at construction time (not just `bool`)
    # specifically so an explicit `False` on a normally-public type isn't
    # indistinguishable from "not set."
    is_public: bool | None = None

    def __post_init__(self) -> None:
        if self.venue_kind is None:
            self.venue_kind = DEFAULT_VENUE_KIND_BY_LOCATION_TYPE[self.location_type]
        if self.is_public is None:
            self.is_public = is_public_location_type(self.location_type)


@dataclass
class Neighborhood:
    """One of the 5 fixed MVP neighborhoods within the single city."""

    id: uuid.UUID
    name: str
    city_id: uuid.UUID
    location_ids: list[uuid.UUID] = field(default_factory=list)


@dataclass
class Household:
    """
    A group of agents sharing a residence.

    NOTE: Household *instances* are not created by the World generator in
    Phase 1 Step 1 -- there are no agents yet to assign to them. The class
    is defined here (matching architecture.md's ER diagram) so Phase 1
    Step 2 (Agents) can construct and register real households on the
    World as agents are generated, without needing to touch this module
    again.
    """

    id: uuid.UUID
    location_id: uuid.UUID
    member_agent_ids: list[uuid.UUID] = field(default_factory=list)


@dataclass
class City:
    """The single MVP city. Multi-city is explicitly out of scope."""

    id: uuid.UUID
    name: str
    neighborhood_ids: list[uuid.UUID] = field(default_factory=list)


class World:
    """
    Owns the spatial structure (city, neighborhoods, locations) and the
    small amount of shared environmental state that isn't owned by any
    single agent.

    World deliberately does NOT own the agent registry. Keeping agents out
    of World is what makes Phase 1 Step 5 (Perception) meaningful: perceive()
    can build a partial view of (World, other agents) instead of agents
    having a reference to "everything." The AgentRegistry is Phase 1 Step 2
    scope, owned by the SimulationEngine, not by World.
    """

    def __init__(self, city: City) -> None:
        self.city = city
        self.neighborhoods: dict[uuid.UUID, Neighborhood] = {}
        self.locations: dict[uuid.UUID, Location] = {}
        self.households: dict[uuid.UUID, Household] = {}

        # Keyed by Location.id (one Business per economic Location for
        # MVP -- see economy/business.py's docstring). Registered by
        # world/generator.py alongside each WORKPLACE or MARKET Location
        # it creates, the same way Households are registered by
        # agents/generator.py alongside the agents that need them.
        # WORKPLACE businesses earn revenue from work shifts (see
        # simulation/action_resolver.py's "work" branch); MARKET
        # businesses earn revenue from food purchases (see its
        # "consume_food" branch). Not every Location type hosts a
        # Business -- RESIDENTIAL and LEISURE do not, for MVP.
        self.businesses: dict[uuid.UUID, Business] = {}

        # Mirrors the engine's Clock.current_tick. World doesn't advance
        # this itself -- the SimulationEngine sets it each tick so any
        # code that only has a World reference (e.g. an action handler)
        # can still know "when" it is without reaching into the engine.
        self.tick: int = 0

        # Small bag of world-level environmental scalars (e.g. a flat
        # food price) that Phase 1's minimal action set may need to read.
        # This is NOT the real economy/market system (businesses,
        # per-location pricing, wages) -- that's economy/ scope, later.
        # Kept as a plain dict rather than a class so it doesn't imply
        # more structure than actually exists yet.
        self.global_state: dict[str, float] = {}

    # -- construction helpers -------------------------------------------------

    def add_neighborhood(self, neighborhood: Neighborhood) -> None:
        self.neighborhoods[neighborhood.id] = neighborhood
        self.city.neighborhood_ids.append(neighborhood.id)

    def add_location(self, location: Location) -> None:
        if location.neighborhood_id not in self.neighborhoods:
            raise ValueError(
                f"Cannot add location '{location.name}': neighborhood "
                f"{location.neighborhood_id} is not registered on this World."
            )
        self.locations[location.id] = location
        self.neighborhoods[location.neighborhood_id].location_ids.append(location.id)

    def add_household(self, household: Household) -> None:
        if household.location_id not in self.locations:
            raise ValueError(
                f"Cannot add household: location {household.location_id} "
                "is not registered on this World."
            )
        self.households[household.id] = household

    def add_business(self, business: Business) -> None:
        if business.location_id not in self.locations:
            raise ValueError(
                f"Cannot add business: location {business.location_id} "
                "is not registered on this World."
            )
        location = self.locations[business.location_id]
        if location.location_type not in ECONOMIC_LOCATION_TYPES:
            raise ValueError(
                f"Cannot add business: location {business.location_id} "
                f"is a {location.location_type}, which does not host a Business."
            )
        self.businesses[business.location_id] = business

    # -- read/query helpers -----------------------------------------------

    def get_neighborhood(self, neighborhood_id: uuid.UUID) -> Neighborhood:
        return self.neighborhoods[neighborhood_id]

    def get_location(self, location_id: uuid.UUID) -> Location:
        return self.locations[location_id]

    def get_household(self, household_id: uuid.UUID) -> Household:
        return self.households[household_id]

    def get_business(self, location_id: uuid.UUID) -> Business | None:
        """Return the Business occupying a location, or None if unregistered."""
        return self.businesses.get(location_id)

    def locations_by_type(self, location_type: LocationType) -> list[Location]:
        return [loc for loc in self.locations.values() if loc.location_type == location_type]

    def locations_in_neighborhood(self, neighborhood_id: uuid.UUID) -> list[Location]:
        neighborhood = self.get_neighborhood(neighborhood_id)
        return [self.locations[loc_id] for loc_id in neighborhood.location_ids]
