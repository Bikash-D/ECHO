// Close-up per-archetype building render check, at a much larger scale
// than the establishing view (which compresses too much detail to judge
// fairly). Uses the real projectBuilding()/drawBuilding()/scatterProps()
// pipeline, just with one building filling most of the frame.
import { createCanvas } from "canvas";
import { projectBuilding, IsoBuilding } from "../../lib/isometricAdapter";
import { Camera, drawBuilding, drawLot, toScreen } from "../../lib/isoRenderer";
import { projectIso } from "../../lib/isometricAdapter";
import { LocationLayout } from "../../lib/cityLayout";
import * as fs from "fs";

const DEFAULT_VENUE_KIND_FOR_TYPE: Record<string, string> = {
  residential: "detached_house",
  workplace: "office",
  market: "grocery",
  leisure: "park",
};

function makeTile(id: string, type: string, x: number, y: number): LocationLayout {
  // Realistic tile size -- cityLayout.ts sizes grid cells ~300-500px per
  // side (see isometricAdapter.ts's footprintRect comment); my first
  // pass at this harness used a 70x70 tile, which produces a ~32x32
  // footprint after footprintRect's 0.46 scale-down -- far smaller than
  // any real in-game building, and made the gable roof's fixed-px ridge
  // rise/chimney offsets look disproportionate ("crooked") purely as an
  // artifact of testing at the wrong scale, not a real rendering bug.
  return {
    id,
    name: id,
    type,
    neighborhoodId: "hoodA",
    x,
    y,
    w: 400,
    h: 400,
    centerX: x + 200,
    centerY: y + 200,
    // Phase 0: this closeup harness still groups by coarse `type` (one
    // building per LocationType, not per venue_kind yet) -- Phase 1 is
    // what makes this harness exercise all 14 venue kinds. These are
    // placeholder-but-valid ontology values so the type contract holds.
    venueKind: DEFAULT_VENUE_KIND_FOR_TYPE[type] ?? "detached_house",
    architecturalStyle: "modern",
    floorCount: type === "workplace" ? 3 : 1,
    isPublic: type === "market" || type === "leisure",
    interiorArchetype: type === "residential" ? "residence" : type === "workplace" ? "office_interior" : type === "market" ? "market_interior" : "outdoor_public",
  };
}

const types: [string, string][] = [
  ["residential", "House"],
  ["workplace", "Workplace"],
  ["market", "Market"],
  ["leisure", "Leisure"],
];

const W = 1400,
  H = 420;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#242f28";
ctx.fillRect(0, 0, W, H);

types.forEach(([type, label], i) => {
  const tile = makeTile(`${type}-demo`, type, 0, 0);
  const b: IsoBuilding = projectBuilding(tile);
  const cx = 175 + i * 350;
  const cy = 100; // computed from real projected floor.front.sy (~283) at scale=1, bottom margin ~380px
  const cam: Camera = { scale: 1.0, offsetX: cx, offsetY: cy };
  drawLot(ctx as any, cam, b);
  drawBuilding(ctx as any, cam, b);
  ctx.fillStyle = "#fff";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, cx, 40);
  ctx.textAlign = "left";
});

fs.writeFileSync(__dirname + "/buildings_closeup.png", canvas.toBuffer("image/png"));
const W2 = 900,
  H2 = 420;
const canvas2 = createCanvas(W2, H2);
const ctx2 = canvas2.getContext("2d");
ctx2.fillStyle = "#242f28";
ctx2.fillRect(0, 0, W2, H2);
["hoodA-residential-0", "hoodA-residential-1", "hoodA-residential-2"].forEach((id, i) => {
  const tile = makeTile(id, "residential", 0, 0);
  const b: IsoBuilding = projectBuilding(tile);
  const cx = 175 + i * 280;
  const cy = 100;
  const cam: Camera = { scale: 1.0, offsetX: cx, offsetY: cy };
  drawLot(ctx2 as any, cam, b);
  drawBuilding(ctx2 as any, cam, b);
});
ctx2.fillStyle = "#fff";
ctx2.font = "16px sans-serif";
ctx2.fillText("Two (three) different residences -- roof shape / aspect / fence variation", 10, 24);
fs.writeFileSync(__dirname + "/residences_variety.png", canvas2.toBuffer("image/png"));
console.log("Wrote residences_variety.png");
