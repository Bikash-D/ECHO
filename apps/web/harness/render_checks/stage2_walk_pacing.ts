// Stage 2 (walking pace) verification: uses the REAL buildCityLayout,
// buildRoadNetwork, and routeBetweenLocations from lib/cityLayout.ts
// against a synthetic 8-location neighborhood (same shape as the real
// backend generator) to get real plan-space path lengths, then applies
// the exact duration formula from CityCanvasIso.tsx's beginWalk() (also
// copied verbatim below, since it isn't exported) to check the new
// WALK_SPEED_PX_PER_S/MIN_WALK_MS/MAX_WALK_MS constants actually land in
// a "several seconds, watchable" range for realistic hops, not just in
// theory.
import { buildCityLayout, buildRoadNetwork, routeBetweenLocations, Point } from "../../lib/cityLayout";
import { Location, Neighborhood } from "../../lib/types";

const WALK_SPEED_PX_PER_S = 180;
const MIN_WALK_MS = 1500;
const MAX_WALK_MS = 8500;

function pathLength(path: Point[], from: Point): number {
  let total = 0;
  let prev = from;
  for (const p of path) {
    total += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return total;
}

function durationMsFor(len: number): number {
  const raw = len > 0 ? (len / WALK_SPEED_PX_PER_S) * 1000 : 0;
  return Math.max(MIN_WALK_MS, Math.min(MAX_WALK_MS, raw || MIN_WALK_MS));
}

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
      locations.push({
        id: `${id}-${type}-${i}`,
        name: `${name} ${label} ${i + 1}`,
        type,
        neighborhood_id: id,
        capacity: null,
        occupancy: 0,
        occupant_ids: [],
      });
    }
  }
  return {
    neighborhood: { id, name, city_id: "c1", number_of_locations: locations.length, population: 0, location_ids: locations.map((l) => l.id) } as Neighborhood,
    locations,
  };
}

const HOOD = buildHood("hoodA", "Riverside");
const layout = buildCityLayout([HOOD.neighborhood], HOOD.locations);
const network = buildRoadNetwork(layout);

console.log("=== Stage 2: real route lengths -> walk duration (new constants) ===");
console.log(`WALK_SPEED_PX_PER_S=${WALK_SPEED_PX_PER_S}  MIN_WALK_MS=${MIN_WALK_MS}  MAX_WALK_MS=${MAX_WALK_MS}\n`);

const ids = HOOD.locations.map((l) => l.id);
let shortest = Infinity,
  longest = 0,
  shortestMs = 0,
  longestMs = 0;
let count = 0,
  sumMs = 0;

for (const from of ids) {
  for (const to of ids) {
    if (from === to) continue;
    const route = routeBetweenLocations(layout, network, from, to);
    if (!route) continue;
    const fromTile = layout.locationById.get(from)!;
    const start = { x: fromTile.x + fromTile.w / 2, y: fromTile.y + fromTile.h / 2 };
    const len = pathLength(route, start);
    const ms = durationMsFor(len);
    count++;
    sumMs += ms;
    if (len < shortest) {
      shortest = len;
      shortestMs = ms;
    }
    if (len > longest) {
      longest = len;
      longestMs = ms;
    }
  }
}

console.log(`Sampled ${count} real routes among the 8 real locations.`);
console.log(`Shortest real route: ${shortest.toFixed(0)}px plan-space -> ${(shortestMs / 1000).toFixed(1)}s`);
console.log(`Longest real route:  ${longest.toFixed(0)}px plan-space -> ${(longestMs / 1000).toFixed(1)}s`);
console.log(`Average duration across all routes: ${(sumMs / count / 1000).toFixed(1)}s`);
console.log("\nTarget (from brief): short ~2-3s, medium ~4-6s, long ~7-9s, nothing instant, nothing endless.");
