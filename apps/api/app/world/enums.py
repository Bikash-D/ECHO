"""
World-related enums.

Kept separate from models.py so schemas/ or other modules can reference
`LocationType` without importing the mutable World/Location classes.
"""

from __future__ import annotations

from enum import Enum


class LocationType(str, Enum):
    """
    The minimum set of location categories the Phase 1 MVP action set
    (work / eat / rest / buy / socialize / move) actually needs.

    This remains the coarse category the simulation's action logic keys
    off of (a WORKPLACE hosts "work", a MARKET hosts "consume_food",
    etc.) -- it is NOT being replaced. `VenueKind` below adds a second,
    finer-grained axis ("what specific kind of workplace is this") that
    sits underneath it, for presentation and future domain richness,
    without touching what the action system already depends on.
    """

    RESIDENTIAL = "residential"
    WORKPLACE = "workplace"
    MARKET = "market"
    LEISURE = "leisure"


class VenueKind(str, Enum):
    """
    A Location's specific identity beyond its coarse LocationType --
    "this workplace is a clinic," not just "this is a workplace."

    Introduced for the Living City milestone (Iso-new full-city pass):
    the Iso renderer needs a semantic peg to hang a distinct building
    silhouette/interior on later (Phase C/F of that milestone), and
    "workplace" alone can't carry that distinction. This enum is the
    controlled vocabulary every venue_kind value must come from --
    deliberately small and closed (not free-text) so it stays
    deterministic and testable, matching LocationType's own style.

    Every member belongs to exactly one LocationType bucket; see
    VENUE_KINDS_BY_LOCATION_TYPE below for that mapping, which is the
    single source of truth VenueKindAssigner reads from -- add a new
    kind by adding it to both this enum and that dict's matching tuple,
    never to just one.
    """

    # RESIDENTIAL
    DETACHED_HOUSE = "detached_house"
    TOWNHOUSE = "townhouse"
    SMALL_APARTMENT = "small_apartment"
    FAMILY_HOUSE = "family_house"

    # WORKPLACE
    OFFICE = "office"
    CLINIC = "clinic"
    WORKSHOP = "workshop"
    SERVICE_OFFICE = "service_office"

    # MARKET
    GROCERY = "grocery"
    CAFE = "cafe"
    GENERAL_STORE = "general_store"

    # LEISURE
    PARK = "park"
    COMMUNITY_CENTER = "community_center"
    SMALL_PLAZA = "small_plaza"


VENUE_KINDS_BY_LOCATION_TYPE: dict[LocationType, tuple[VenueKind, ...]] = {
    LocationType.RESIDENTIAL: (
        VenueKind.DETACHED_HOUSE,
        VenueKind.TOWNHOUSE,
        VenueKind.SMALL_APARTMENT,
        VenueKind.FAMILY_HOUSE,
    ),
    LocationType.WORKPLACE: (
        VenueKind.OFFICE,
        VenueKind.CLINIC,
        VenueKind.WORKSHOP,
        VenueKind.SERVICE_OFFICE,
    ),
    LocationType.MARKET: (
        VenueKind.GROCERY,
        VenueKind.CAFE,
        VenueKind.GENERAL_STORE,
    ),
    LocationType.LEISURE: (
        VenueKind.PARK,
        VenueKind.COMMUNITY_CENTER,
        VenueKind.SMALL_PLAZA,
    ),
}

# The default venue_kind used when a Location is constructed without one
# explicitly assigned (e.g. hand-built in a test, or by any future call
# site that doesn't go through world/generator.py's deterministic
# assignment). Always the first entry of that type's tuple, so it's a
# fixed, predictable fallback rather than implicitly "whatever happens
# to be first in dict iteration."
DEFAULT_VENUE_KIND_BY_LOCATION_TYPE: dict[LocationType, VenueKind] = {
    location_type: kinds[0] for location_type, kinds in VENUE_KINDS_BY_LOCATION_TYPE.items()
}


class ArchitecturalStyle(str, Enum):
    """
    A purely cosmetic style tag layered on top of venue_kind (e.g. "this
    office is MODERN" vs "this office is INDUSTRIAL") so buildings of the
    same venue_kind aren't visually identical. Deliberately generic
    (applies across every LocationType) rather than per-type, since it
    only ever drives paint/silhouette-variant choices downstream, never
    simulation behavior.
    """

    MODERN = "modern"
    TRADITIONAL = "traditional"
    INDUSTRIAL = "industrial"
    CRAFTSMAN = "craftsman"


# Interior archetype a venue_kind implies -- the label a future interior/
# cutaway renderer (Living City milestone Phase F/G, explicitly NOT part
# of this Phase A/B pass) would key off of to pick furniture and layout.
# Included now, alongside venue_kind, because it's a pure deterministic
# function of venue_kind (no new randomness, no new stored state) and the
# brief asks for this metadata to exist on Location/exposed via the API
# in this same ontology pass -- but nothing in this milestone renders an
# interior yet.
INTERIOR_ARCHETYPE_BY_VENUE_KIND: dict[VenueKind, str] = {
    VenueKind.DETACHED_HOUSE: "residence",
    VenueKind.TOWNHOUSE: "residence",
    VenueKind.SMALL_APARTMENT: "residence",
    VenueKind.FAMILY_HOUSE: "residence",
    VenueKind.OFFICE: "office_interior",
    VenueKind.SERVICE_OFFICE: "office_interior",
    VenueKind.CLINIC: "clinic_interior",
    VenueKind.WORKSHOP: "workshop_interior",
    VenueKind.GROCERY: "market_interior",
    VenueKind.GENERAL_STORE: "market_interior",
    VenueKind.CAFE: "cafe_interior",
    VenueKind.PARK: "outdoor_public",
    VenueKind.SMALL_PLAZA: "outdoor_public",
    VenueKind.COMMUNITY_CENTER: "community_interior",
}

# Venue kinds that are open to the general public (a citizen who doesn't
# live/work there can walk in), vs. private property. Pure presentation/
# future-gameplay metadata, derived here as a function of LocationType
# rather than randomized -- "is this kind of place public" is a fact
# about the category, not a per-building coin flip.
PUBLIC_LOCATION_TYPES: frozenset[LocationType] = frozenset({LocationType.MARKET, LocationType.LEISURE})


def is_public_location_type(location_type: LocationType) -> bool:
    return location_type in PUBLIC_LOCATION_TYPES


def interior_archetype_for(venue_kind: VenueKind | str) -> str:
    """Deterministic venue_kind -> interior archetype label lookup."""
    if not isinstance(venue_kind, VenueKind):
        venue_kind = VenueKind(venue_kind)
    return INTERIOR_ARCHETYPE_BY_VENUE_KIND[venue_kind]
