// Phase 1 (Building Identity) acceptance-test render sheet.
//
// Renders all 14 real VenueKinds (apps/api/app/world/enums.py::VenueKind)
// through the exact real pipeline every other renderer uses --
// projectBuilding() / drawLot() / drawBuilding() / scatterProps() /
// drawTree() etc, nothing reimplemented or mocked -- at a large enough
// scale to actually judge architecture, not silhouette-at-a-glance.
//
// Produces two PNGs:
//   venue_identity_unlabeled.png -- the actual acceptance test artifact:
//     no text anywhere, so a human can judge purely from the architecture
//     whether they can tell a clinic from an office, a cafe from a
//     grocery, a park from a plaza, etc.
//   venue_identity_labeled.png -- the same 14 buildings, same layout,
//     same random seeds, with venue_kind + LocationType labels so the
//     mapping used above can be checked against this sheet.
import { createCanvas } from "canvas";
import * as fs from "fs";
import { projectBuilding, IsoBuilding, scatterProps } from "../../lib/isometricAdapter";
import { Camera, drawBuilding, drawLot, drawTree, drawLamp, drawBench, drawStall, drawPlanter, drawFence, drawBush, drawBin, drawSign } from "../../lib/isoRenderer";
import { LocationLayout } from "../../lib/cityLayout";

// Mirrors apps/api/app/world/enums.py::INTERIOR_ARCHETYPE_BY_VENUE_KIND
// and VENUE_KINDS_BY_LOCATION_TYPE -- independently re-derived here (not
// imported from a frontend copy) so this harness is checking against the
// real backend contract, matching harness/ontologyChain.test.ts's own
// pattern for the same reason.
interface VenueSpec {
  venueKind: string;
  type: string;
  label: string;
  floorCount: number;
  isPublic: boolean;
  interiorArchetype: string;
}

const VENUE_SPECS: VenueSpec[] = [
  // RESIDENTIAL
  { venueKind: "detached_house", type: "residential", label: "Detached House", floorCount: 1, isPublic: false, interiorArchetype: "residence" },
  { venueKind: "family_house", type: "residential", label: "Family House", floorCount: 1, isPublic: false, interiorArchetype: "residence" },
  { venueKind: "townhouse", type: "residential", label: "Townhouse", floorCount: 2, isPublic: false, interiorArchetype: "residence" },
  { venueKind: "small_apartment", type: "residential", label: "Small Apartment", floorCount: 3, isPublic: false, interiorArchetype: "residence" },
  // WORKPLACE
  { venueKind: "office", type: "workplace", label: "Office", floorCount: 3, isPublic: false, interiorArchetype: "office_interior" },
  { venueKind: "clinic", type: "workplace", label: "Clinic", floorCount: 1, isPublic: false, interiorArchetype: "clinic_interior" },
  { venueKind: "workshop", type: "workplace", label: "Workshop", floorCount: 1, isPublic: false, interiorArchetype: "workshop_interior" },
  { venueKind: "service_office", type: "workplace", label: "Service Office", floorCount: 2, isPublic: false, interiorArchetype: "office_interior" },
  // MARKET
  { venueKind: "grocery", type: "market", label: "Grocery", floorCount: 1, isPublic: true, interiorArchetype: "market_interior" },
  { venueKind: "cafe", type: "market", label: "Cafe", floorCount: 1, isPublic: true, interiorArchetype: "cafe_interior" },
  { venueKind: "general_store", type: "market", label: "General Store", floorCount: 1, isPublic: true, interiorArchetype: "market_interior" },
  // LEISURE
  { venueKind: "park", type: "leisure", label: "Park", floorCount: 1, isPublic: true, interiorArchetype: "outdoor_public" },
  { venueKind: "community_center", type: "leisure", label: "Community Center", floorCount: 1, isPublic: true, interiorArchetype: "community_interior" },
  { venueKind: "small_plaza", type: "leisure", label: "Small Plaza", floorCount: 1, isPublic: true, interiorArchetype: "outdoor_public" },
];

function makeTile(spec: VenueSpec, x: number, y: number): LocationLayout {
  // Same 400x400 realistic tile size stage4_buildings_closeup.ts uses
  // (see that file's comment for why -- matches real cityLayout.ts grid
  // cell scale, not an arbitrary small test rect).
  const id = `${spec.venueKind}-demo`;
  return {
    id,
    name: id,
    type: spec.type,
    neighborhoodId: "hoodA",
    x,
    y,
    w: 400,
    h: 400,
    centerX: x + 200,
    centerY: y + 200,
    venueKind: spec.venueKind,
    architecturalStyle: "modern",
    floorCount: spec.floorCount,
    isPublic: spec.isPublic,
    interiorArchetype: spec.interiorArchetype,
  };
}

const COLS = 7;
const ROWS = 2;
const CELL_W = 340;
const CELL_H = 460;
const W = COLS * CELL_W;
const H = ROWS * CELL_H;

function renderSheet(labeled: boolean): Buffer {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1c231d";
  ctx.fillRect(0, 0, W, H);

  VENUE_SPECS.forEach((spec, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const cx = col * CELL_W + CELL_W / 2;
    const cy = row * CELL_H + 120;
    const cam: Camera = { scale: 0.62, offsetX: cx, offsetY: cy };

    const tile = makeTile(spec, 0, 0);
    const b: IsoBuilding = projectBuilding(tile);
    drawLot(ctx as any, cam, b);

    // Real scattered props (trees/benches/stalls/etc), same function
    // every real render uses -- draw only the ones for this single tile
    // (scatterProps takes an array of tiles) so a lot reads as a real
    // lot, not a bare building floating in void.
    const props = scatterProps([tile]);
    const drawers: Record<string, (ctx: any, cam: Camera, p: any) => void> = {
      tree: drawTree,
      lamp: drawLamp,
      bench: drawBench,
      stall: drawStall,
      planter: drawPlanter,
      fence: drawFence,
      bush: drawBush,
      bin: drawBin,
      sign: drawSign,
    };
    // Draw props behind, then the building, then nothing further --
    // this is a static single-building card, not a depth-sorted scene,
    // so a simple back-then-building order (matching how CityCanvasIso
    // handles a single isolated lot at the edge of a slice) is enough.
    for (const p of props) {
      const fn = drawers[p.kind];
      if (fn) fn(ctx as any, cam, p);
    }
    drawBuilding(ctx as any, cam, b);

    if (labeled) {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 15px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(spec.label, col * CELL_W + CELL_W / 2, row * CELL_H + 24);
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "#9db4c9";
      ctx.fillText(`venue_kind: ${spec.venueKind}  (LocationType: ${spec.type})`, col * CELL_W + CELL_W / 2, row * CELL_H + 40);
      ctx.textAlign = "left";
    }
  });

  return canvas.toBuffer("image/png");
}

const unlabeled = renderSheet(false);
fs.writeFileSync(__dirname + "/venue_identity_unlabeled.png", unlabeled);
console.log("Wrote venue_identity_unlabeled.png");

const labeled = renderSheet(true);
fs.writeFileSync(__dirname + "/venue_identity_labeled.png", labeled);
console.log("Wrote venue_identity_labeled.png");
