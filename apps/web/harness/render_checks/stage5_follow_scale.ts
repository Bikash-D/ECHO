// Computes the REAL fitToSlice scale (same formula, copied from
// CityCanvasIso.tsx since it's a component-internal useCallback, not
// exported) for a realistic viewport and a real 8-location neighborhood,
// then checks what FOLLOW_ZOOM actually produces in on-screen pixels for
// a citizen vs. a building -- the concrete version of "don't let the
// citizen be 20px next to a 150px house."
import { pickIsoSlice, projectBuilding, IsoBuilding } from "../../lib/isometricAdapter";
import { Location, Neighborhood, Agent } from "../../lib/types";

const FOLLOW_ZOOM = 5.2;

function buildHood(id: string, name: string) {
  const plan: [Location["type"], number, string][] = [
    ["residential", 4, "Residence"],
    ["workplace", 2, "Workplace"],
    ["market", 1, "Market"],
    ["leisure", 1, "Leisure Spot"],
  ];
  const locations: Location[] = [];
  for (const [type, count, label] of plan) {
    for (let i = 0; i < count; i++) {
      locations.push({ id: `${id}-${type}-${i}`, name: `${name} ${label} ${i + 1}`, type, neighborhood_id: id, capacity: null, occupancy: 0, occupant_ids: [] });
    }
  }
  return {
    neighborhood: { id, name, city_id: "c1", number_of_locations: locations.length, population: 0, location_ids: locations.map((l) => l.id) } as Neighborhood,
    locations,
  };
}

const HOOD = buildHood("hoodA", "Riverside");
const agents: Agent[] = [{ id: "kavya", name: "Kavya", age: 30, occupation: "worker", wealth: 0, social_status: 0, location_id: HOOD.locations[0].id, neighborhood_id: "hoodA", personality: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 }, needs: [], goals: [], relationships: [] } as unknown as Agent];

const slice = pickIsoSlice({ neighborhoods: [HOOD.neighborhood], locations: HOOD.locations, agents });
if (!slice) throw new Error("no slice");

const buildings: IsoBuilding[] = slice.tiles.map(projectBuilding);

// Real fitToSlice formula (copied) at a realistic desktop viewport.
function fitScaleFor(cw: number, ch: number): number {
  const pts = buildings.flatMap((b) => [b.floor.back, b.floor.right, b.floor.front, b.floor.left, b.roof.back, b.roof.right, b.roof.front, b.roof.left]);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.sx);
    maxX = Math.max(maxX, p.sx);
    minY = Math.min(minY, p.sy);
    maxY = Math.max(maxY, p.sy);
  }
  const pad = 90;
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);
  return Math.min((cw - pad * 2) / contentW, (ch - pad * 2) / contentH);
}

console.log("=== Stage 5: Follow-zoom pixel-size check (real formulas, real data) ===\n");
for (const [cw, ch, label] of [
  [1200, 800, "typical desktop"],
  [1600, 900, "wide desktop"],
  [390, 700, "mobile portrait"],
] as [number, number, string][]) {
  const fitScale = fitScaleFor(cw, ch);
  const followScale = fitScale * FOLLOW_ZOOM;
  // Citizen sprite size formula (from isoRenderer.ts's drawAgentSprite),
  // detailed tier (followed agent):
  const buildMul = 1.0; // approx (0.92-1.14 range, using midpoint)
  const detailMul = 1.12;
  const bodyH = Math.max(14, 22 * followScale) * buildMul * detailMul;
  const headR = Math.max(3.2, 5 * followScale) * buildMul * detailMul;
  const citizenTotalPx = bodyH + headR * 2;

  // A typical house's on-screen height at this scale: real wall height
  // (b.height, ~65-95 plan-units depending on heightScale) + roof rise,
  // projected through ISO_SIN, times scale.
  const house = buildings.find((b) => b.loc.type === "residential")!;
  const wallHeightPlan = house.height;
  const ISO_SIN = 0.5; // matches isometricAdapter.ts's ISO_SIN constant
  const roofRise = Math.max(10, wallHeightPlan * 0.32);
  const houseTotalPx = (wallHeightPlan + roofRise) * ISO_SIN * followScale;

  console.log(`${label} (${cw}x${ch}): fitScale=${fitScale.toFixed(3)}  followScale=${followScale.toFixed(3)}`);
  console.log(`  citizen on-screen height: ~${citizenTotalPx.toFixed(0)}px`);
  console.log(`  house on-screen height:   ~${houseTotalPx.toFixed(0)}px`);
  console.log(`  ratio citizen:house = 1:${(houseTotalPx / citizenTotalPx).toFixed(1)}\n`);
}
