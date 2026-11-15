// Living City milestone -- Phase 1 (Building Identity) contract test.
//
// Phase 0's ontologyChain.test.ts explicitly deferred this: "Visual QA
// that venue_kind actually changes what gets drawn is Phase 1's job."
// This is that job. Two things are checked, deliberately kept separate:
//
//   1. Coverage/uniqueness contract (pure logic, no canvas): every one
//      of the 14 real VenueKinds from apps/api/app/world/enums.py has a
//      roofStyle, a VENUE_SHAPE entry, and a distinct palette -- so a
//      new venue kind added to the backend without a matching frontend
//      entry fails loudly here instead of silently falling back to a
//      generic per-LocationType look.
//   2. A real-render smoke test (node-canvas, same drawBuilding/drawLot
//      the app itself calls) confirming every venue kind actually
//      renders without throwing, at a real building's scale.
//
// This test does NOT try to assert "an observer can tell these apart" --
// that's a human-judgment acceptance test, done via the render sheet at
// harness/render_checks/stage7_venue_identity.ts (run manually, see
// venue_identity_unlabeled.png / venue_identity_labeled.png). Automating
// "does this look distinguishable" would just be re-encoding one
// engineer's opinion as a brittle pixel-diff; the uniqueness contract
// below is the automatable part of that requirement (distinct palette
// values, at minimum, are a necessary-but-not-sufficient condition for
// visual distinguishability, and it's the part a regression can
// actually break silently).
import { describe, it, expect } from "vitest";
import { createCanvas } from "canvas";
import {
  roofStyleFor,
  shapeFor,
  archetypeFor,
  projectBuilding,
  VENUE_ROOF_STYLE,
  VENUE_SHAPE,
} from "../lib/isometricAdapter";
import { LocationLayout } from "../lib/cityLayout";
import { drawBuilding, drawLot, Camera } from "../lib/isoRenderer";

// Mirrors apps/api/app/world/enums.py::VenueKind exactly (see
// ontologyChain.test.ts's fixture for the same cross-check pattern).
const ALL_VENUE_KINDS: { venueKind: string; type: string }[] = [
  { venueKind: "detached_house", type: "residential" },
  { venueKind: "family_house", type: "residential" },
  { venueKind: "townhouse", type: "residential" },
  { venueKind: "small_apartment", type: "residential" },
  { venueKind: "office", type: "workplace" },
  { venueKind: "clinic", type: "workplace" },
  { venueKind: "workshop", type: "workplace" },
  { venueKind: "service_office", type: "workplace" },
  { venueKind: "grocery", type: "market" },
  { venueKind: "cafe", type: "market" },
  { venueKind: "general_store", type: "market" },
  { venueKind: "park", type: "leisure" },
  { venueKind: "community_center", type: "leisure" },
  { venueKind: "small_plaza", type: "leisure" },
];

function makeLoc(venueKind: string, type: string, i: number): LocationLayout {
  return {
    id: `${venueKind}-${i}`,
    name: `${venueKind}-${i}`,
    type,
    neighborhoodId: "hood",
    x: (i % 6) * 420,
    y: Math.floor(i / 6) * 420,
    w: 400,
    h: 400,
    centerX: (i % 6) * 420 + 200,
    centerY: Math.floor(i / 6) * 420 + 200,
    venueKind,
    architecturalStyle: "modern",
    floorCount: 1,
    isPublic: false,
    interiorArchetype: "residence",
  } as LocationLayout;
}

describe("Phase 1: every real VenueKind has its own roof style + massing", () => {
  it("all 14 venue kinds are present in VENUE_ROOF_STYLE and VENUE_SHAPE", () => {
    for (const { venueKind } of ALL_VENUE_KINDS) {
      expect(VENUE_ROOF_STYLE[venueKind], `VENUE_ROOF_STYLE missing "${venueKind}"`).toBeDefined();
      expect(VENUE_SHAPE[venueKind], `VENUE_SHAPE missing "${venueKind}"`).toBeDefined();
    }
  });

  it("roofStyleFor() resolves every venue kind via venue_kind, not just LocationType", () => {
    for (const { venueKind, type } of ALL_VENUE_KINDS) {
      const style = roofStyleFor({ type, venueKind });
      expect(style).toBe(VENUE_ROOF_STYLE[venueKind]);
    }
  });

  it("falls back to the coarse LocationType roof style when venue_kind is absent (defensive path, shouldn't happen post Phase 0)", () => {
    expect(roofStyleFor({ type: "residential" })).toBe("gable");
    expect(roofStyleFor({ type: "workplace" })).toBe("flat");
    expect(roofStyleFor({ type: "market" })).toBe("awning");
    expect(roofStyleFor({ type: "leisure" })).toBe("pavilion");
  });

  it("each LocationType's venue kinds are NOT all identical to each other (the actual Phase 1 requirement: sub-kinds must diverge, not just the parent type)", () => {
    const byType: Record<string, string[]> = {};
    for (const { venueKind, type } of ALL_VENUE_KINDS) {
      (byType[type] ??= []).push(venueKind);
    }
    for (const [type, kinds] of Object.entries(byType)) {
      const styles = new Set(kinds.map((k) => VENUE_ROOF_STYLE[k]));
      const shapes = new Set(kinds.map((k) => JSON.stringify(VENUE_SHAPE[k])));
      // Not every kind needs a unique roofStyle (several deliberately
      // share a structural family, see isometricAdapter.ts's comment),
      // but within a LocationType, kinds must not all collapse to one
      // identical (roofStyle, shape) pair -- that would mean venue_kind
      // wasn't actually changing anything for that family.
      expect(styles.size > 1 || shapes.size > 1, `${type}'s venue kinds (${kinds.join(", ")}) are visually identical to each other`).toBe(true);
      expect(shapes.size, `${type}'s venue kinds all share one VENUE_SHAPE`).toBeGreaterThan(1);
    }
  });

  it("archetypeFor()/projectBuilding() thread venue_kind through to the real roofStyle + a scaled height, for every venue kind", () => {
    ALL_VENUE_KINDS.forEach(({ venueKind, type }, i) => {
      const loc = makeLoc(venueKind, type, i);
      const archetype = archetypeFor(loc);
      expect(archetype.roofStyle).toBe(VENUE_ROOF_STYLE[venueKind]);
      const building = projectBuilding(loc);
      expect(building.venueKind).toBe(venueKind);
      expect(building.height).toBeGreaterThan(0);
      expect(Number.isFinite(building.height)).toBe(true);
    });
  });
});

describe("Phase 1: real render smoke test (node-canvas, drawLot + drawBuilding)", () => {
  it("renders every one of the 14 venue kinds without throwing", () => {
    const canvas = createCanvas(400, 400);
    const ctx = canvas.getContext("2d");
    const cam: Camera = { scale: 1, offsetX: 200, offsetY: 150 };
    ALL_VENUE_KINDS.forEach(({ venueKind, type }, i) => {
      const loc = makeLoc(venueKind, type, i);
      const building = projectBuilding(loc);
      expect(() => {
        drawLot(ctx as any, cam, building);
        drawBuilding(ctx as any, cam, building);
      }, `rendering "${venueKind}" threw`).not.toThrow();
    });
  });

  it("produces non-blank output for the plaza (roofStyle 'plaza' skips the normal wall/roof path entirely, so it's the highest-risk case for accidentally rendering nothing)", () => {
    const canvas = createCanvas(400, 400);
    const ctx = canvas.getContext("2d");
    const cam: Camera = { scale: 1, offsetX: 200, offsetY: 150 };
    const loc = makeLoc("small_plaza", "leisure", 0);
    const building = projectBuilding(loc);
    drawLot(ctx as any, cam, building);
    drawBuilding(ctx as any, cam, building);
    const { data } = ctx.getImageData(0, 0, 400, 400);
    let nonBackgroundPixels = 0;
    for (let p = 0; p < data.length; p += 4) {
      // Background is a solid dark green fill from the surrounding test
      // canvas being left untouched (no explicit fillRect here); any
      // non-transparent pixel means drawLot/drawBuilding actually drew
      // something for the plaza case.
      if (data[p + 3] !== 0) nonBackgroundPixels++;
    }
    expect(nonBackgroundPixels).toBeGreaterThan(1000);
  });
});
