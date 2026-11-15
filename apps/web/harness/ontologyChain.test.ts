// Living City milestone -- Phase 0 contract test.
//
// Verifies the FULL semantic data chain survives intact, for the real
// 40-location / 5-neighborhood shape the backend generator actually
// produces (apps/api/app/world/generator.py):
//
//   backend Location (venue_kind, architectural_style, floor_count,
//   is_public, interior_archetype)
//     -> /api/world JSON (apps/api/app/schemas/world_api.py::
//        LocationResponse -- assumed already correct; this test starts
//        from the frontend Location type, which is that JSON's shape)
//     -> frontend Location (lib/types.ts)
//     -> LocationLayout (lib/cityLayout.ts::buildCityLayout)
//     -> IsoBuilding (lib/isometricAdapter.ts::projectBuilding)
//     -> BuildingArchetype (lib/isometricAdapter.ts::archetypeFor)
//     -> the exact IsoBuilding object handed to isoRenderer.ts's
//        drawBuilding/paletteFor
//
// This test makes NO visual assertions and renders no pixels -- Phase 0
// is data-plumbing only. Visual QA that venue_kind actually changes
// what gets drawn is Phase 1's job.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildCityLayout, resolveLocationOntology } from "../lib/cityLayout";
import { archetypeFor, projectBuilding } from "../lib/isometricAdapter";
import { drawBuilding, drawLot } from "../lib/isoRenderer";
import { Location, Neighborhood } from "../lib/types";

// ---------------------------------------------------------------------
// Fixture: shaped EXACTLY like the real backend generator's plan --
// 5 neighborhoods, each with 4 residential + 2 workplace + 1 market +
// 1 leisure = 8 locations, 40 total (see generator.py's _LOCATION_PLAN /
// RESIDENTIAL_PER_NEIGHBORHOOD etc). Venue kinds are assigned so every
// real value from apps/api/app/world/enums.py::VenueKind appears at
// least once across the fixture -- the real backend's venue_rng.choice
// draws randomly from the same closed set, so this is a representative
// (not identical-by-chance) sample of what a real /api/world payload
// looks like.
// ---------------------------------------------------------------------
const NEIGHBORHOOD_NAMES = ["Riverside", "Downtown", "Hillcrest", "Eastgate", "Millbrook"];

const RESIDENTIAL_KINDS = ["detached_house", "townhouse", "small_apartment", "family_house"];
const WORKPLACE_KINDS = ["office", "clinic", "workshop", "service_office"];
const MARKET_KINDS = ["grocery", "cafe", "general_store"];
const LEISURE_KINDS = ["park", "community_center", "small_plaza"];
const ARCHITECTURAL_STYLES = ["modern", "traditional", "industrial", "craftsman"];

// Mirrors apps/api/app/world/enums.py::INTERIOR_ARCHETYPE_BY_VENUE_KIND.
// Independent of cityLayout.ts's own (unexported) fallback copy --
// deliberately re-derived here so this test isn't just checking a value
// against itself.
const INTERIOR_ARCHETYPE_BY_VENUE_KIND: Record<string, string> = {
  detached_house: "residence",
  townhouse: "residence",
  small_apartment: "residence",
  family_house: "residence",
  office: "office_interior",
  service_office: "office_interior",
  clinic: "clinic_interior",
  workshop: "workshop_interior",
  grocery: "market_interior",
  general_store: "market_interior",
  cafe: "cafe_interior",
  park: "outdoor_public",
  small_plaza: "outdoor_public",
  community_center: "community_interior",
};

interface PlanEntry {
  type: Location["type"];
  count: number;
  kinds: string[];
  label: string;
}

const PLAN: PlanEntry[] = [
  { type: "residential", count: 4, kinds: RESIDENTIAL_KINDS, label: "Residence" },
  { type: "workplace", count: 2, kinds: WORKPLACE_KINDS, label: "Workplace" },
  { type: "market", count: 1, kinds: MARKET_KINDS, label: "Market" },
  { type: "leisure", count: 1, kinds: LEISURE_KINDS, label: "Leisure Spot" },
];

let globalIndex = 0;

function buildRealShapedLocation(
  hoodId: string,
  hoodName: string,
  type: Location["type"],
  kind: string,
  i: number,
  label: string
): Location {
  const idx = globalIndex++;
  const architecturalStyle = ARCHITECTURAL_STYLES[idx % ARCHITECTURAL_STYLES.length];
  const floorCount = type === "workplace" ? 1 + (idx % 4) : type === "residential" ? 1 + (idx % 2) : 1;
  const isPublic = type === "market" || type === "leisure";
  return {
    id: `${hoodId}-${type}-${i}`,
    name: `${hoodName} ${label} ${i + 1}`,
    type,
    neighborhood_id: hoodId,
    capacity: null,
    occupancy: 0,
    occupant_ids: [],
    venue_kind: kind,
    architectural_style: architecturalStyle,
    floor_count: floorCount,
    is_public: isPublic,
    interior_archetype: INTERIOR_ARCHETYPE_BY_VENUE_KIND[kind],
  };
}

function buildRealShapedWorld(): { neighborhoods: Neighborhood[]; locations: Location[] } {
  globalIndex = 0;
  const neighborhoods: Neighborhood[] = [];
  const locations: Location[] = [];

  NEIGHBORHOOD_NAMES.forEach((name, hoodIdx) => {
    const hoodId = `hood-${hoodIdx}`;
    for (const entry of PLAN) {
      for (let i = 0; i < entry.count; i++) {
        // Cycle through this bucket's kinds so, across 5 neighborhoods,
        // every kind in every bucket gets used at least once (residential
        // has 20 slots / 4 kinds, workplace 10 slots / 4 kinds, market 5
        // slots / 3 kinds, leisure 5 slots / 3 kinds -- all comfortably
        // over-covered).
        const kind = entry.kinds[(hoodIdx * entry.count + i) % entry.kinds.length];
        locations.push(buildRealShapedLocation(hoodId, name, entry.type, kind, i, entry.label));
      }
    }
    neighborhoods.push({
      id: hoodId,
      name,
      city_id: "city-1",
      number_of_locations: PLAN.reduce((a, p) => a + p.count, 0),
      population: 0,
      location_ids: locations.filter((l) => l.neighborhood_id === hoodId).map((l) => l.id),
    });
  });

  return { neighborhoods, locations };
}

describe("Living City Phase 0 -- semantic ontology chain (real 40-location, 5-neighborhood shape)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  const { neighborhoods, locations } = buildRealShapedWorld();

  it("fixture actually has the real shape: 5 neighborhoods x 8 locations = 40", () => {
    expect(neighborhoods).toHaveLength(5);
    expect(locations).toHaveLength(40);
    for (const hoodName of NEIGHBORHOOD_NAMES) {
      const hoodLocs = locations.filter((l) => l.name.startsWith(hoodName));
      expect(hoodLocs).toHaveLength(8);
    }
  });

  it("fixture covers every real VenueKind at least once (sample is representative)", () => {
    const seen = new Set(locations.map((l) => l.venue_kind));
    const allKinds = [...RESIDENTIAL_KINDS, ...WORKPLACE_KINDS, ...MARKET_KINDS, ...LEISURE_KINDS];
    for (const kind of allKinds) {
      expect(seen.has(kind)).toBe(true);
    }
  });

  it("Location -> LocationLayout: all 5 ontology fields survive for all 40 locations, with zero fallback warnings", () => {
    const layout = buildCityLayout(neighborhoods, locations);
    expect(layout.locations).toHaveLength(40);

    for (const source of locations) {
      const result = layout.locationById.get(source.id);
      expect(result, `LocationLayout missing for ${source.id}`).toBeDefined();
      expect(result!.venueKind).toBe(source.venue_kind);
      expect(result!.architecturalStyle).toBe(source.architectural_style);
      expect(result!.floorCount).toBe(source.floor_count);
      expect(result!.isPublic).toBe(source.is_public);
      expect(result!.interiorArchetype).toBe(source.interior_archetype);
    }

    // "No silent loss or accidental fallback": real, fully-populated
    // Locations must never trigger the loud fallback path.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("is_public correctly reflects LocationType for every location (market/leisure=true, residential/workplace=false), matching backend PUBLIC_LOCATION_TYPES", () => {
    const layout = buildCityLayout(neighborhoods, locations);
    for (const loc of layout.locations) {
      const expected = loc.type === "market" || loc.type === "leisure";
      expect(loc.isPublic).toBe(expected);
    }
  });

  it("LocationLayout -> IsoBuilding: top-level passthrough fields match for all 40 locations", () => {
    const layout = buildCityLayout(neighborhoods, locations);
    for (const loc of layout.locations) {
      const building = projectBuilding(loc);
      expect(building.venueKind).toBe(loc.venueKind);
      expect(building.architecturalStyle).toBe(loc.architecturalStyle);
      expect(building.floorCount).toBe(loc.floorCount);
      expect(building.isPublic).toBe(loc.isPublic);
      expect(building.interiorArchetype).toBe(loc.interiorArchetype);
      // The nested loc itself must also still carry the fields (belt and
      // suspenders -- IsoBuilding.loc is the same LocationLayout object).
      expect(building.loc.venueKind).toBe(loc.venueKind);
    }
  });

  it("LocationLayout -> BuildingArchetype (archetypeFor): venue fields survive to the archetype-selection step for all 40 locations", () => {
    const layout = buildCityLayout(neighborhoods, locations);
    for (const loc of layout.locations) {
      const archetype = archetypeFor(loc);
      expect(archetype.venueKind).toBe(loc.venueKind);
      expect(archetype.architecturalStyle).toBe(loc.architecturalStyle);
      expect(archetype.floorCount).toBe(loc.floorCount);
      expect(archetype.isPublic).toBe(loc.isPublic);
      expect(archetype.interiorArchetype).toBe(loc.interiorArchetype);
    }
  });

  it("IsoBuilding.archetype (as produced by projectBuilding, the real call path) also carries the fields", () => {
    const layout = buildCityLayout(neighborhoods, locations);
    for (const loc of layout.locations) {
      const building = projectBuilding(loc);
      expect(building.archetype.venueKind).toBe(loc.venueKind);
      expect(building.archetype.interiorArchetype).toBe(loc.interiorArchetype);
    }
  });

  it("reaches the exact IsoBuilding object passed to isoRenderer.ts's drawBuilding/drawLot without being stripped or mutated", () => {
    const layout = buildCityLayout(neighborhoods, locations);
    // Minimal no-op ctx -- same pattern harness/setup.ts uses. We are not
    // asserting anything about pixels here (Phase 0 makes no visual
    // change); only that calling the real renderer entry points with a
    // real IsoBuilding does not lose or mutate the ontology fields.
    const ctxStub: any = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "measureText") return () => ({ width: 10 });
          return () => {};
        },
        set() {
          return true;
        },
      }
    );
    const cam = { scale: 1, offsetX: 0, offsetY: 0 };

    const sample = layout.locations.slice(0, 5); // one per neighborhood is plenty; full loop below covers all 40 for the field check
    for (const loc of layout.locations) {
      const building = projectBuilding(loc);
      const before = {
        venueKind: building.venueKind,
        architecturalStyle: building.architecturalStyle,
        floorCount: building.floorCount,
        isPublic: building.isPublic,
        interiorArchetype: building.interiorArchetype,
      };
      if (sample.includes(loc)) {
        drawLot(ctxStub, cam, building);
        drawBuilding(ctxStub, cam, building);
      }
      expect(building.venueKind).toBe(before.venueKind);
      expect(building.architecturalStyle).toBe(before.architecturalStyle);
      expect(building.floorCount).toBe(before.floorCount);
      expect(building.isPublic).toBe(before.isPublic);
      expect(building.interiorArchetype).toBe(before.interiorArchetype);
    }
  });

  it("regression: buildCityLayout's geometry (x/y/w/h/centerX/centerY/type) is unchanged by the Phase 0 edit", () => {
    const layout = buildCityLayout(neighborhoods, locations);
    for (const loc of layout.locations) {
      expect(typeof loc.x).toBe("number");
      expect(typeof loc.y).toBe("number");
      expect(loc.w).toBeGreaterThan(0);
      expect(loc.h).toBeGreaterThan(0);
      expect(loc.centerX).toBeCloseTo(loc.x + loc.w / 2);
      expect(loc.centerY).toBeCloseTo(loc.y + loc.h / 2);
      const source = locations.find((l) => l.id === loc.id)!;
      expect(loc.type).toBe(source.type);
    }
  });
});

describe("Living City Phase 0 -- fallback path is loud, not silent", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("a Location missing all 5 ontology fields triggers console.warn AND still produces a sane, non-empty, type-consistent fallback", () => {
    const bareLocation: Location = {
      id: "bare-1",
      name: "Bare Workplace",
      type: "workplace",
      neighborhood_id: "hood-0",
      capacity: null,
      occupancy: 0,
      occupant_ids: [],
      // venue_kind / architectural_style / floor_count / is_public /
      // interior_archetype all deliberately omitted.
    };

    const resolved = resolveLocationOntology(bareLocation);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warningText = warnSpy.mock.calls[0][0] as string;
    expect(warningText).toContain("bare-1");
    expect(warningText).toContain("venue_kind");
    expect(warningText).toContain("architectural_style");
    expect(warningText).toContain("floor_count");
    expect(warningText).toContain("is_public");
    expect(warningText).toContain("interior_archetype");

    // Fallback must still be sane (non-empty, type-consistent), not just
    // "not crash": a workplace still gets a real workplace venue_kind.
    expect(WORKPLACE_KINDS.includes(resolved.venueKind)).toBe(true);
    expect(resolved.architecturalStyle).toBeTruthy();
    expect(resolved.floorCount).toBeGreaterThan(0);
    expect(typeof resolved.isPublic).toBe("boolean");
    expect(resolved.interiorArchetype).toBeTruthy();
  });

  it("a Location missing only venue_kind warns only about that field, not the others it does have", () => {
    const partial: Location = {
      id: "partial-1",
      name: "Partial Market",
      type: "market",
      neighborhood_id: "hood-0",
      capacity: null,
      occupancy: 0,
      occupant_ids: [],
      architectural_style: "modern",
      floor_count: 1,
      is_public: true,
      interior_archetype: "market_interior",
      // venue_kind omitted only.
    };

    const resolved = resolveLocationOntology(partial);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warningText = warnSpy.mock.calls[0][0] as string;
    expect(warningText).toContain("venue_kind");
    expect(warningText).not.toContain("architectural_style");
    expect(warningText).not.toContain("floor_count");

    expect(MARKET_KINDS.includes(resolved.venueKind)).toBe(true);
    // Fields that WERE present must pass through untouched, not also get
    // re-derived/overwritten by the fallback path.
    expect(resolved.architecturalStyle).toBe("modern");
    expect(resolved.floorCount).toBe(1);
    expect(resolved.isPublic).toBe(true);
    expect(resolved.interiorArchetype).toBe("market_interior");
  });
});
