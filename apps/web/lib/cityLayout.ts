/**
 * Deterministic client-side layout for the "Living City" visualization.
 *
 * The backend has no x/y coordinates anywhere (World/Location/Neighborhood
 * are topological, not spatial -- see apps/api/app/world/models.py). Rather
 * than invent backend geometry (out of scope, and a bigger change than this
 * milestone calls for), we derive a stable 2D layout purely from the shape
 * that's already there: 5 neighborhoods, each with a fixed list of
 * locations. This file is pure and framework-free so it's trivially
 * testable and re-runs identically for the same World topology -- which
 * never changes between ticks (only agent.location_id does).
 */

import { Location, Neighborhood } from "./types";

export const VIRTUAL_WIDTH = 1600;
export const VIRTUAL_HEIGHT = 950;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NeighborhoodLayout extends Rect {
  id: string;
  name: string;
}

export interface LocationLayout extends Rect {
  id: string;
  name: string;
  type: string;
  neighborhoodId: string;
  centerX: number;
  centerY: number;
  // Living City milestone Phase 0: the semantic ontology fields
  // (apps/api/app/world/enums.py::VenueKind/ArchitecturalStyle/
  // interior_archetype_for) carried through from the source `Location`
  // so every consumer downstream of buildCityLayout (isometricAdapter.ts,
  // isoRenderer.ts) can key off real venue identity instead of only the
  // coarse `type` bucket. Deliberately NOT optional here (unlike
  // `Location.venue_kind?` in types.ts) -- by the time a Location has
  // been through resolveLocationOntology() below, it always has a
  // concrete value, real or explicitly-flagged fallback. A missing value
  // at this layer is a bug, not an expected case.
  venueKind: string;
  architecturalStyle: string;
  floorCount: number;
  isPublic: boolean;
  interiorArchetype: string;
}

export interface CityLayout {
  width: number;
  height: number;
  neighborhoods: NeighborhoodLayout[];
  locations: LocationLayout[];
  locationById: Map<string, LocationLayout>;
}

// ---------------------------------------------------------------------
// Semantic ontology resolution (Living City milestone Phase 0)
//
// Mirrors apps/api/app/world/enums.py's DEFAULT_VENUE_KIND_BY_LOCATION_TYPE
// / INTERIOR_ARCHETYPE_BY_VENUE_KIND / is_public_location_type -- NOT a
// second source of truth for what venue_kind a real Location gets
// (world/generator.py's venue_rng owns that), only a same-shape fallback
// for the defensive case where a Location arrives without these fields
// (e.g. an older cached payload, or a hand-built test double). Every use
// of this fallback path is logged loudly via console.warn so a real
// backend regression that started omitting these fields would surface
// immediately in dev tools / test output, per the Phase 0 requirement
// that there be "no silent loss or accidental fallback."
// ---------------------------------------------------------------------
const VENUE_KIND_FALLBACK_BY_TYPE: Record<string, string> = {
  residential: "detached_house",
  workplace: "office",
  market: "grocery",
  leisure: "park",
};

const INTERIOR_ARCHETYPE_FALLBACK_BY_VENUE_KIND: Record<string, string> = {
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

const PUBLIC_TYPES = new Set(["market", "leisure"]);

export interface ResolvedOntology {
  venueKind: string;
  architecturalStyle: string;
  floorCount: number;
  isPublic: boolean;
  interiorArchetype: string;
}

/**
 * Resolves the 5 ontology fields for one Location, loudly flagging (via
 * console.warn, never silently) any field the source payload is missing
 * so the gap is visible instead of masked by a fallback that looks like
 * real data. Real /api/world responses always populate every field (see
 * LocationResponse in apps/api/app/schemas/world_api.py) -- this path
 * exists only for defensive robustness against non-conforming payloads.
 */
export function resolveLocationOntology(loc: Location): ResolvedOntology {
  const missing: string[] = [];

  let venueKind = loc.venue_kind;
  if (!venueKind) {
    missing.push("venue_kind");
    venueKind = VENUE_KIND_FALLBACK_BY_TYPE[loc.type] ?? VENUE_KIND_FALLBACK_BY_TYPE.residential;
  }

  let architecturalStyle = loc.architectural_style;
  if (!architecturalStyle) {
    missing.push("architectural_style");
    architecturalStyle = "modern";
  }

  let floorCount = loc.floor_count;
  if (floorCount === undefined || floorCount === null) {
    missing.push("floor_count");
    floorCount = 1;
  }

  let isPublic = loc.is_public;
  if (isPublic === undefined || isPublic === null) {
    missing.push("is_public");
    isPublic = PUBLIC_TYPES.has(loc.type);
  }

  let interiorArchetype = loc.interior_archetype;
  if (!interiorArchetype) {
    missing.push("interior_archetype");
    interiorArchetype = INTERIOR_ARCHETYPE_FALLBACK_BY_VENUE_KIND[venueKind] ?? "outdoor_public";
  }

  if (missing.length > 0 && typeof console !== "undefined") {
    console.warn(
      `[cityLayout] Location "${loc.id}" (${loc.name}) is missing ontology field(s) [${missing.join(
        ", "
      )}] from the API payload -- using a deterministic fallback. This should never happen against a real /api/world response; investigate the source payload.`
    );
  }

  return { venueKind, architecturalStyle, floorCount, isPublic, interiorArchetype };
}

// Simple deterministic string hash -> [0, 1). Used only for stable
// per-agent jitter offsets around a building, never for anything that
// affects simulation truth.
export function hash01(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // unsigned 32-bit -> [0, 1)
  return (h >>> 0) / 4294967296;
}

// Tightened for a denser, more "tightly integrated streetscape" read (Phase
// 1 polish pass) -- was 28/18/10, which left visibly loose gutters of empty
// space between districts and between buildings within a row. Still leaves
// clearance for MAJOR_ROAD_WIDTH (20px) + curb (2px) to pass through the
// inter-district gap without touching a building edge.
const DISTRICT_GAP = 24;
const DISTRICT_PADDING = 13;
const DISTRICT_HEADER = 34;
const BUILDING_GAP = 7; // horizontal gap between buildings within the same row

// Vertical gap between building ROWS specifically. Rows flank the local
// street computed in streetForHood() below, and CityCanvas paints that
// street as a real filled road (12px) with sidewalks offset 9px + 5px wide
// on each side (see MAJOR_ROAD_WIDTH/SIDEWALK_GAP in CityCanvas.tsx) -- a
// row gap smaller than that clearance would have the street and sidewalks
// physically overlap the buildings above/below it. ROW_GAP must stay >=
// roughly 2 * (streetHalfWidth + sidewalkGap + sidewalkHalfWidth) = 2 *
// (6 + 9 + 2.5) = 35, so the painted road always has clearance from both
// rows of building tiles. Was 50 (13px of slack beyond the minimum, which
// read as buildings "set back" from the street rather than fronting
// directly onto it); 38 keeps a small 3px safety margin instead. If the
// road paint widths in CityCanvas.tsx change, this must be revisited.
const ROW_GAP = 38;

/**
 * Arrange N neighborhoods into a balanced grid of rows (5 -> 3-then-2,
 * matching the MVP's fixed neighborhood count without hardcoding "5"
 * anywhere structural -- if the population/topology ever changes, this
 * still produces a reasonable grid).
 */
function rowSplit(n: number): number[] {
  if (n <= 3) return [n];
  const cols = Math.ceil(Math.sqrt(n));
  const rows: number[] = [];
  let remaining = n;
  while (remaining > 0) {
    const take = Math.min(cols, remaining);
    rows.push(take);
    remaining -= take;
  }
  return rows;
}

export function buildCityLayout(
  neighborhoods: Neighborhood[],
  locations: Location[]
): CityLayout {
  const sortedHoods = [...neighborhoods].sort((a, b) => a.name.localeCompare(b.name));
  const rows = rowSplit(sortedHoods.length);

  const rowCount = rows.length;
  const districtH = (VIRTUAL_HEIGHT - DISTRICT_GAP * (rowCount + 1)) / rowCount;

  const neighborhoodLayouts: NeighborhoodLayout[] = [];
  let hoodIndex = 0;
  for (let r = 0; r < rowCount; r++) {
    const count = rows[r];
    const districtW = (VIRTUAL_WIDTH - DISTRICT_GAP * (count + 1)) / count;
    const y = DISTRICT_GAP + r * (districtH + DISTRICT_GAP);
    for (let c = 0; c < count; c++) {
      const hood = sortedHoods[hoodIndex];
      const x = DISTRICT_GAP + c * (districtW + DISTRICT_GAP);
      neighborhoodLayouts.push({
        id: hood.id,
        name: hood.name,
        x,
        y,
        w: districtW,
        h: districtH,
      });
      hoodIndex++;
    }
  }

  const locationLayouts: LocationLayout[] = [];
  for (const hoodLayout of neighborhoodLayouts) {
    const hoodLocations = locations
      .filter((l) => l.neighborhood_id === hoodLayout.id)
      .sort((a, b) => a.name.localeCompare(b.name));

    const innerX = hoodLayout.x + DISTRICT_PADDING;
    const innerY = hoodLayout.y + DISTRICT_HEADER;
    const innerW = hoodLayout.w - DISTRICT_PADDING * 2;
    const innerH = hoodLayout.h - DISTRICT_HEADER - DISTRICT_PADDING;

    const cols = Math.ceil(Math.sqrt(hoodLocations.length * (innerW / Math.max(innerH, 1))));
    const safeCols = Math.max(1, Math.min(cols, hoodLocations.length));
    const rowsInHood = Math.ceil(hoodLocations.length / safeCols);

    const tileW = (innerW - BUILDING_GAP * (safeCols - 1)) / safeCols;
    const tileH = (innerH - ROW_GAP * (rowsInHood - 1)) / rowsInHood;

    hoodLocations.forEach((loc, i) => {
      const col = i % safeCols;
      const row = Math.floor(i / safeCols);
      const x = innerX + col * (tileW + BUILDING_GAP);
      const y = innerY + row * (tileH + ROW_GAP);
      const ontology = resolveLocationOntology(loc);
      locationLayouts.push({
        id: loc.id,
        name: loc.name,
        type: loc.type,
        neighborhoodId: hoodLayout.id,
        x,
        y,
        w: tileW,
        h: tileH,
        centerX: x + tileW / 2,
        centerY: y + tileH / 2,
        venueKind: ontology.venueKind,
        architecturalStyle: ontology.architecturalStyle,
        floorCount: ontology.floorCount,
        isPublic: ontology.isPublic,
        interiorArchetype: ontology.interiorArchetype,
      });
    });
  }

  return {
    width: VIRTUAL_WIDTH,
    height: VIRTUAL_HEIGHT,
    neighborhoods: neighborhoodLayouts,
    locations: locationLayouts,
    locationById: new Map(locationLayouts.map((l) => [l.id, l])),
  };
}

/**
 * Stable per-agent offset inside a building's tile, so agents co-located
 * at the same Location don't render exactly stacked on one point. Derived
 * purely from agent id (deterministic hash), not randomness re-rolled
 * every render -- the same agent always renders at the same relative spot
 * within a given building.
 */
export function agentJitter(agentId: string, tile: Rect): { x: number; y: number } {
  const hx = hash01(agentId + ":x");
  const hy = hash01(agentId + ":y");
  const marginX = Math.min(tile.w * 0.32, 22);
  const marginY = Math.min(tile.h * 0.28, 16);
  return {
    x: tile.x + tile.w / 2 + (hx - 0.5) * 2 * marginX,
    y: tile.y + tile.h / 2 + (hy - 0.5) * 2 * marginY,
  };
}

/* ==================================================================
 * ROAD NETWORK (V2.1)
 *
 * The backend has no physical coordinates for anything (see the note
 * at the top of this file), so -- same as the rest of this layout --
 * the road graph is purely a presentation-layer derivation from the
 * topology that already exists (which neighborhood a location belongs
 * to, and the neighborhood boxes we already computed above). It is
 * NOT a general-purpose GIS/pathfinding system; it is the smallest
 * structure that gives every location a deterministic route to every
 * other location:
 *
 *   building entrance -> neighborhood hub -> (tree of hub-to-hub
 *   roads, one unique path between any two hubs) -> neighborhood hub
 *   -> building entrance
 *
 * Hubs are connected with a minimum spanning tree instead of the old
 * "connect if close enough" heuristic specifically so every
 * neighborhood is guaranteed reachable from every other one -- a
 * distance-threshold graph could otherwise strand a district with no
 * route at all, which would silently break agent movement.
 * ================================================================== */

export interface Point {
  x: number;
  y: number;
}

/**
 * A hub-to-hub arterial edge. `elbow` bends the edge into two orthogonal
 * (horizontal-then-vertical, or vertical-then-horizontal) segments instead
 * of one straight diagonal -- a diagonal arterial used to cut directly
 * across whatever sat between two hubs (other districts' interiors,
 * buildings, open terrain), which reads as a road with no relationship to
 * the street grid it's supposedly part of, and gave agents a "floating
 * across rooftops" path for any cross-district trip. Every real street
 * grid meets at right angles; this makes the drawn road AND the walked
 * path (see routeBetweenLocations) follow the same right-angle corner.
 */
export interface RoadEdge {
  aId: string;
  bId: string;
  a: Point;
  b: Point;
  elbow: Point;
}

export interface StreetSegment {
  y: number;
  x1: number;
  x2: number;
}

export interface RoadNetwork {
  hubs: Map<string, Point>; // neighborhoodId -> hub point (inter-district road anchor)
  hubEdges: RoadEdge[]; // MST edges between neighborhood hubs, for drawing
  hubAdjacency: Map<string, string[]>; // neighborhoodId -> connected neighborhoodIds (tree)
  entrances: Map<string, Point>; // locationId -> point on its neighborhood's street where its sidewalk meets the road
  streets: Map<string, StreetSegment>; // neighborhoodId -> the local street its buildings front onto
  /** "hoodIdA|hoodIdB" (both orderings) -> the edge connecting them, so a hood-to-hood path can recover each edge's elbow point. */
  edgeByHoodPair: Map<string, RoadEdge>;
}

/**
 * Every building's sidewalk used to run in a straight diagonal line to a
 * single shared hub POINT per district -- correct for routing, but drawn
 * literally it reads as spokes radiating from one dot, not as buildings
 * sitting along a street (screenshot-confirmed). hubForHood still returns
 * a single anchor Point (needed for the inter-district MST below, and for
 * the hub-adjacency identity lookups in buildRoadNetwork), but it's now
 * defined as the center of that district's local street segment, so the
 * anchor point actually sits on a real drawn road rather than being an
 * arbitrary corner.
 */
/**
 * The horizontal street a district's buildings front onto. Runs through
 * the vertical middle of that district's actual building rows -- for the
 * common 2-row layout this lands exactly in the gap between the rows, so
 * row 1 fronts it from above and row 2 from below, matching a real block
 * (buildings on both sides of one street) instead of every building
 * pointing at one corner. Falls back to the district's own vertical
 * center for a single-row or empty district so the geometry never
 * produces NaN/degenerate segments.
 */
function streetForHood(hood: NeighborhoodLayout, hoodLocations: LocationLayout[]): StreetSegment {
  const x1 = hood.x + DISTRICT_PADDING;
  const x2 = hood.x + hood.w - DISTRICT_PADDING;
  if (hoodLocations.length === 0) {
    return { y: hood.y + hood.h / 2, x1, x2 };
  }
  let minCenterY = Infinity;
  let maxCenterY = -Infinity;
  for (const loc of hoodLocations) {
    const cy = loc.y + loc.h / 2;
    if (cy < minCenterY) minCenterY = cy;
    if (cy > maxCenterY) maxCenterY = cy;
  }
  return { y: (minCenterY + maxCenterY) / 2, x1, x2 };
}

/**
 * Where a single building's sidewalk meets its district's street: the
 * point on that street directly out from the tile's own center-x (clamped
 * to the street's extent), not a line converging toward a shared hub
 * point. Every building on a given side of the street produces a short,
 * roughly-perpendicular stub instead of a diagonal spoke.
 */
function entranceForTile(tile: Rect, street: StreetSegment): Point {
  const cx = tile.x + tile.w / 2;
  const x = Math.min(street.x2, Math.max(street.x1, cx));
  return { x, y: street.y };
}

/**
 * The point on the tile's own edge where its sidewalk stub begins --
 * used only for drawing the short stub itself, so it starts at the
 * building's wall rather than at its center (which would draw the path
 * overlapping the building sprite).
 */
export function tileEdgeTowardStreet(tile: Rect, street: StreetSegment): Point {
  const cx = tile.x + tile.w / 2;
  const cy = tile.y + tile.h / 2;
  const x = Math.min(street.x2, Math.max(street.x1, cx));
  const y = street.y >= cy ? tile.y + tile.h : tile.y;
  return { x, y };
}


/**
 * Minimum spanning tree over neighborhood hubs (Prim's algorithm).
 * With only 5 neighborhoods this is trivially cheap, and a tree
 * guarantees exactly one route between any two districts -- simpler
 * and more predictable to walk than a general graph, and avoids
 * visual clutter from a full mesh of inter-district roads.
 *
 * Deterministic: neighborhoods are iterated in the same sorted order
 * `buildCityLayout` already produced them in, and ties are broken by
 * that same stable order, so the tree shape never changes for a given
 * topology.
 */
/**
 * Orthogonal elbow point for a hub-to-hub edge: bend at whichever corner
 * keeps the longer leg of the trip axis-aligned with more of the actual
 * travel distance (i.e. go horizontal first when the horizontal gap is the
 * larger of the two, vertical first otherwise), so the bend reads as "the
 * road turns once, sensibly" rather than always defaulting to the same
 * corner regardless of geometry.
 */
function elbowFor(a: Point, b: Point): Point {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  return dx >= dy ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
}

function buildHubMST(
  hoods: NeighborhoodLayout[],
  hubs: Map<string, Point>
): RoadEdge[] {
  if (hoods.length <= 1) return [];
  const edges: RoadEdge[] = [];
  const inTree = new Set<string>([hoods[0].id]);
  const remaining = hoods.slice(1).map((h) => h.id);

  while (remaining.length > 0) {
    let bestFrom: string | null = null;
    let bestTo: string | null = null;
    let bestDist = Infinity;
    for (const fromId of inTree) {
      const fromPt = hubs.get(fromId)!;
      for (const toId of remaining) {
        const toPt = hubs.get(toId)!;
        const d = Math.hypot(fromPt.x - toPt.x, fromPt.y - toPt.y);
        if (d < bestDist) {
          bestDist = d;
          bestFrom = fromId;
          bestTo = toId;
        }
      }
    }
    if (!bestFrom || !bestTo) break; // unreachable in practice
    const a = hubs.get(bestFrom)!;
    const b = hubs.get(bestTo)!;
    edges.push({ aId: bestFrom, bId: bestTo, a, b, elbow: elbowFor(a, b) });
    inTree.add(bestTo);
    remaining.splice(remaining.indexOf(bestTo), 1);
  }
  return edges;
}

export function buildRoadNetwork(layout: CityLayout): RoadNetwork {
  const streets = new Map<string, StreetSegment>();
  const hubs = new Map<string, Point>();
  const locationsByHood = new Map<string, LocationLayout[]>();
  for (const loc of layout.locations) {
    const list = locationsByHood.get(loc.neighborhoodId);
    if (list) list.push(loc);
    else locationsByHood.set(loc.neighborhoodId, [loc]);
  }
  for (const hood of layout.neighborhoods) {
    const street = streetForHood(hood, locationsByHood.get(hood.id) || []);
    streets.set(hood.id, street);
    hubs.set(hood.id, { x: (street.x1 + street.x2) / 2, y: street.y });
  }

  const hubEdges = buildHubMST(layout.neighborhoods, hubs);

  const hubAdjacency = new Map<string, string[]>();
  for (const hood of layout.neighborhoods) hubAdjacency.set(hood.id, []);
  const edgeByHoodPair = new Map<string, RoadEdge>();
  for (const edge of hubEdges) {
    hubAdjacency.get(edge.aId)!.push(edge.bId);
    hubAdjacency.get(edge.bId)!.push(edge.aId);
    edgeByHoodPair.set(`${edge.aId}|${edge.bId}`, edge);
    edgeByHoodPair.set(`${edge.bId}|${edge.aId}`, edge);
  }

  const entrances = new Map<string, Point>();
  for (const loc of layout.locations) {
    const street = streets.get(loc.neighborhoodId);
    if (!street) continue;
    entrances.set(loc.id, entranceForTile(loc, street));
  }

  return { hubs, hubEdges, hubAdjacency, entrances, streets, edgeByHoodPair };
}

/**
 * Unique tree path between two neighborhood hubs (BFS -- the graph is
 * a tree, so there is exactly one simple path and BFS is enough; no
 * need for Dijkstra/A*). Returns the sequence of neighborhood ids
 * from `fromHoodId` to `toHoodId` inclusive.
 */
function hoodPath(
  network: RoadNetwork,
  fromHoodId: string,
  toHoodId: string
): string[] {
  if (fromHoodId === toHoodId) return [fromHoodId];
  const queue: string[] = [fromHoodId];
  const cameFrom = new Map<string, string>();
  const visited = new Set<string>([fromHoodId]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toHoodId) break;
    for (const next of network.hubAdjacency.get(current) || []) {
      if (visited.has(next)) continue;
      visited.add(next);
      cameFrom.set(next, current);
      queue.push(next);
    }
  }
  if (!visited.has(toHoodId)) return [fromHoodId]; // disconnected fallback, see routeBetweenLocations
  const path = [toHoodId];
  let cur = toHoodId;
  while (cur !== fromHoodId) {
    const prev = cameFrom.get(cur);
    if (!prev) break;
    path.unshift(prev);
    cur = prev;
  }
  return path;
}

/**
 * Build the ordered list of waypoints an agent should visibly walk
 * through to get from one location to another: its own building's
 * private path onto the street, the hub-to-hub road (if the journey
 * crosses districts), and the destination building's private path
 * back off the street.
 *
 * Returns `null` when a route cannot be determined (e.g. a location
 * id the current layout doesn't know about -- can happen for a single
 * frame right after a reset while topology is being rebuilt). Callers
 * fall back to a direct glide in that case rather than crashing.
 */
export function routeBetweenLocations(
  layout: CityLayout,
  network: RoadNetwork,
  fromLocId: string,
  toLocId: string
): Point[] | null {
  if (fromLocId === toLocId) return [];

  const fromTile = layout.locationById.get(fromLocId);
  const toTile = layout.locationById.get(toLocId);
  if (!fromTile || !toTile) return null;

  const fromEntrance = network.entrances.get(fromLocId);
  const toEntrance = network.entrances.get(toLocId);
  if (!fromEntrance || !toEntrance) return null;

  const waypoints: Point[] = [fromEntrance];

  if (fromTile.neighborhoodId !== toTile.neighborhoodId) {
    const hoods = hoodPath(network, fromTile.neighborhoodId, toTile.neighborhoodId);
    for (let i = 0; i < hoods.length; i++) {
      const hub = network.hubs.get(hoods[i]);
      if (hub) waypoints.push(hub);
      // Walk the actual road corner between consecutive hubs (see
      // elbowFor in buildHubMST) instead of cutting a straight diagonal
      // between them, so the agent's path always tracks the drawn
      // arterial road rather than floating across whatever's between
      // the two hub points.
      if (i < hoods.length - 1) {
        const edge = network.edgeByHoodPair.get(`${hoods[i]}|${hoods[i + 1]}`);
        if (edge) waypoints.push(edge.elbow);
      }
    }
  } else {
    const hub = network.hubs.get(fromTile.neighborhoodId);
    if (hub) waypoints.push(hub);
  }

  waypoints.push(toEntrance);
  return waypoints;
}
