/**
 * 3D Adapter (Stage 1 vertical slice)
 * ====================================================================
 * Maps ECHO's real, backend-authoritative world state into 3D world-space
 * geometry for CityCanvas3D.tsx.
 *
 * IMPORTANT — this is a presentation-layer projection, not a second
 * simulation coordinate system:
 *
 *   - The backend (apps/api/app/world/models.py) has no x/y/z anywhere.
 *     Locations and neighborhoods are purely topological (ids + membership
 *     + occupancy), and agents carry `location_id` / `neighborhood_id`,
 *     never coordinates.
 *   - `apps/web/lib/cityLayout.ts` already solves "derive a stable,
 *     deterministic 2D layout from that topology" for the existing V3
 *     canvas (CityCanvas.tsx) — building rects, per-neighborhood streets,
 *     a hub-to-hub road MST, and `routeBetweenLocations` for walkable
 *     paths. This adapter does NOT reinvent any of that. It calls the
 *     exact same functions, then projects the resulting 2D points
 *     (px, py) -> 3D (X, Z), with Y reserved purely for visual height
 *     (building extrusion, agent capsule height). Two consumers (2D
 *     canvas, 3D scene) read one topology-derived layout.
 *   - Every id, name, type, occupancy, action, need, and relationship
 *     value rendered downstream still comes straight from the live
 *     `WorldResponse` (see lib/api.ts fetchWorld() / useSimulationController).
 *     Nothing here invents simulation state — it only invents *where a
 *     pixel goes on screen* for state that already exists.
 *
 * Stage 1 scope: rather than project all ~40 locations / ~100 agents (the
 * long-term target), this adapter picks ONE real, currently-active
 * micro-district — the neighborhood with the most live agents in it right
 * now — and windows the shared layout down to that neighborhood's busiest
 * 3-4 locations. This is a deliberate scope decision for validating visual
 * quality (see task brief), not a technical limitation of the mapping
 * itself: the same functions below would work unchanged across every
 * neighborhood once Stage 1 is proven out.
 */

import { Agent, Location, Neighborhood } from "@/lib/types";

/** The adapter only ever needs these three live collections — never the
 * whole WorldResponse — so it can be called from any component that
 * already has `neighborhoods`/`locations`/`agents` as props (e.g.
 * CityCanvas3D, which mirrors CityCanvas's prop contract for a clean A/B
 * swap) without constructing a fake WorldResponse. */
export interface WorldSlice {
  neighborhoods: Neighborhood[];
  locations: Location[];
  agents: Agent[];
}
import {
  CityLayout,
  LocationLayout,
  NeighborhoodLayout,
  Point,
  RoadNetwork,
  agentJitter,
  buildCityLayout,
  buildRoadNetwork,
  hash01,
  routeBetweenLocations,
} from "@/lib/cityLayout";

// ---------------------------------------------------------------------
// World-space scale
// ---------------------------------------------------------------------

/** World units per shared-layout pixel. Chosen so a typical ~120-180px
 * building tile in the shared 2D layout becomes a ~7-11 unit footprint —
 * a believable human/building scale when 1 unit ~= 1 meter. */
const WORLD_SCALE = 0.06;

/** Half-width of the paved road surface, in world units. */
export const ROAD_WIDTH = 3.2;
/** Width of the sidewalk strip on each side of the road. */
export const SIDEWALK_WIDTH = 1.4;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function project(p: Point, origin: Point): Vec3 {
  return {
    x: (p.x - origin.x) * WORLD_SCALE,
    y: 0,
    z: (p.y - origin.y) * WORLD_SCALE,
  };
}

// ---------------------------------------------------------------------
// Building presentation (height/color) — deterministic, id-derived
// ---------------------------------------------------------------------

export interface BuildingVisual {
  bodyColor: string;
  roofColor: string;
  /** Number of visible floors, purely cosmetic (window rows). */
  floors: number;
  label: string;
}

/** Same palette as CityCanvas.tsx's BUILDING_COLORS, so the 2D and 3D
 * views read as the same city, not two different art styles. */
const BUILDING_TYPE_VISUAL: Record<string, { body: string; roof: string; label: string }> = {
  residential: { body: "#c9a876", roof: "#7c4a2d", label: "Residence" },
  workplace: { body: "#7d95ad", roof: "#3d5570", label: "Workplace" },
  market: { body: "#d9a441", roof: "#8a5a1e", label: "Market" },
  leisure: { body: "#8fae7d", roof: "#3f6b3f", label: "Leisure" },
};

/** Deterministic per-location height/floor-count so the skyline has real
 * variety without being random-per-render. Derived only from the
 * location's own id and type — never from agent/simulation data. */
function buildingVisual(location: Location): BuildingVisual {
  const palette = BUILDING_TYPE_VISUAL[location.type] || BUILDING_TYPE_VISUAL.residential;
  return { bodyColor: palette.body, roofColor: palette.roof, floors: 0, label: palette.label };
}

function buildingHeight(location: Location): number {
  const base =
    location.type === "workplace" ? 7.5 : location.type === "market" ? 4.5 : location.type === "leisure" ? 3.5 : 5.5;
  const variance = hash01(location.id + ":height") * 3.5;
  return base + variance;
}

function buildingFloors(height: number): number {
  return Math.max(1, Math.round(height / 2.6));
}

// ---------------------------------------------------------------------
// Scene model
// ---------------------------------------------------------------------

export interface Building3D {
  id: string;
  name: string;
  type: string;
  /** Ground-level center of the building footprint. */
  position: Vec3;
  width: number; // X extent
  depth: number; // Z extent
  height: number; // Y extent
  /** Rotation (radians) so the building's entrance/facade faces the street. */
  rotationY: number;
  visual: BuildingVisual;
  floors: number;
  /** Where this building's sidewalk stub meets the road, in world space. */
  entrance: Vec3;
  occupancy: number;
  capacity: number | null;
}

export interface RoadSegment3D {
  a: Vec3;
  b: Vec3;
  width: number;
}

export interface PropPlacement3D {
  kind: "tree" | "lamp" | "bench";
  position: Vec3;
  rotationY: number;
}

export interface MicroDistrictScene {
  neighborhoodId: string;
  neighborhoodName: string;
  buildings: Building3D[];
  /** The one local street this micro-district's buildings front onto. */
  street: RoadSegment3D;
  sidewalks: RoadSegment3D[];
  props: PropPlacement3D[];
  /** Bounding box (world units) of the whole scene, for camera framing. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Internal: shared layout + road network + origin, kept so agent
   * positions/routes can be projected with the exact same transform. */
  _layout: CityLayout;
  _network: RoadNetwork;
  _origin: Point;
  _locationIds: Set<string>;
}

// ---------------------------------------------------------------------
// Step 1 — pick the active micro-district
// ---------------------------------------------------------------------

function pickActiveNeighborhood(world: WorldSlice): Neighborhood | null {
  if (world.neighborhoods.length === 0) return null;
  const counts = new Map<string, number>();
  for (const agent of world.agents) {
    counts.set(agent.neighborhood_id, (counts.get(agent.neighborhood_id) || 0) + 1);
  }
  const sorted = [...world.neighborhoods].sort((a, b) => {
    const diff = (counts.get(b.id) || 0) - (counts.get(a.id) || 0);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id); // deterministic tiebreak
  });
  return sorted[0] || null;
}

/** Within the chosen neighborhood, take its busiest 3-4 real locations
 * (by live occupancy) — busiest, not arbitrary, so the vertical slice is
 * actually populated rather than showing empty buildings while agents
 * cluster somewhere off-screen. */
function pickMicroDistrictLocations(world: WorldSlice, neighborhoodId: string): Location[] {
  const hoodLocations = world.locations.filter((l) => l.neighborhood_id === neighborhoodId);
  const sorted = [...hoodLocations].sort((a, b) => {
    const diff = b.occupant_ids.length - a.occupant_ids.length;
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
  const targetCount = Math.min(4, Math.max(3, sorted.length >= 3 ? 4 : sorted.length));
  return sorted.slice(0, Math.min(targetCount, sorted.length));
}

// ---------------------------------------------------------------------
// Step 2 — build the 3D scene from the shared 2D layout
// ---------------------------------------------------------------------

export function buildMicroDistrictScene(world: WorldSlice): MicroDistrictScene | null {
  const hood = pickActiveNeighborhood(world);
  if (!hood) return null;

  // Same layout + road network the 2D canvas uses — single source of
  // topology-derived truth, no parallel coordinate system.
  const layout = buildCityLayout(world.neighborhoods, world.locations);
  const network = buildRoadNetwork(layout);

  const chosenLocations = pickMicroDistrictLocations(world, hood.id);
  if (chosenLocations.length === 0) return null;
  const locationIds = new Set(chosenLocations.map((l) => l.id));

  const tiles: LocationLayout[] = chosenLocations
    .map((l) => layout.locationById.get(l.id))
    .filter((t): t is LocationLayout => !!t);
  if (tiles.length === 0) return null;

  // Local street: the vertical midpoint of just these tiles' centers, and
  // the horizontal extent of their bounding box (+ margin) — a windowed
  // view of real tile coordinates, not an invented street.
  const centersY = tiles.map((t) => t.y + t.h / 2);
  const minCenterY = Math.min(...centersY);
  const maxCenterY = Math.max(...centersY);
  const streetY = tiles.length > 1 ? (minCenterY + maxCenterY) / 2 : minCenterY + tiles[0].h * 0.9;

  const margin = 30;
  const minTileX = Math.min(...tiles.map((t) => t.x)) - margin;
  const maxTileX = Math.max(...tiles.map((t) => t.x + t.w)) + margin;

  // Origin = top-left of the windowed area, so projected coordinates are
  // small, readable numbers centered near the scene.
  const origin: Point = { x: minTileX, y: streetY - 90 };

  const streetA2D: Point = { x: minTileX, y: streetY };
  const streetB2D: Point = { x: maxTileX, y: streetY };

  const buildings: Building3D[] = chosenLocations.map((loc) => {
    const tile = layout.locationById.get(loc.id)!;
    const centerPx: Point = { x: tile.x + tile.w / 2, y: tile.y + tile.h / 2 };
    const pos3 = project(centerPx, origin);
    const height = buildingHeight(loc);
    const visual = buildingVisual(loc);

    // Face the street: if this tile sits above the street line (smaller
    // py), its facade/entrance points toward +Z (down, toward the
    // street); otherwise it points toward -Z (up, toward the street).
    const facingStreetFromAbove = centerPx.y < streetY;
    const rotationY = facingStreetFromAbove ? 0 : Math.PI;

    const entrance2D = network.entrances.get(loc.id) || { x: centerPx.x, y: streetY };
    const entrance3 = project(entrance2D, origin);

    return {
      id: loc.id,
      name: loc.name,
      type: loc.type,
      position: pos3,
      width: Math.max(3, tile.w * WORLD_SCALE),
      depth: Math.max(3, tile.h * WORLD_SCALE),
      height,
      rotationY,
      visual,
      floors: buildingFloors(height),
      entrance: entrance3,
      occupancy: loc.occupancy,
      capacity: loc.capacity,
    };
  });

  const street: RoadSegment3D = {
    a: project(streetA2D, origin),
    b: project(streetB2D, origin),
    width: ROAD_WIDTH,
  };

  const sidewalkOffset = ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2 + 0.15;
  const sidewalks: RoadSegment3D[] = [
    {
      a: { ...street.a, z: street.a.z - sidewalkOffset },
      b: { ...street.b, z: street.b.z - sidewalkOffset },
      width: SIDEWALK_WIDTH,
    },
    {
      a: { ...street.a, z: street.a.z + sidewalkOffset },
      b: { ...street.b, z: street.b.z + sidewalkOffset },
      width: SIDEWALK_WIDTH,
    },
  ];

  // Street furniture: one lamp + a tree pair near each building's
  // entrance, offset along the sidewalk by a deterministic hash so
  // placement never overlaps a building or another prop but never
  // reshuffles between renders either.
  const props: PropPlacement3D[] = [];
  for (const b of buildings) {
    const sideSign = b.rotationY === 0 ? -1 : 1;
    const lampOffset = (hash01(b.id + ":lamp") - 0.5) * b.width * 0.6;
    props.push({
      kind: "lamp",
      position: { x: b.entrance.x + lampOffset, y: 0, z: b.entrance.z + sideSign * 0.9 },
      rotationY: 0,
    });
    const treeOffset = b.width * 0.5 + 1.1;
    props.push({
      kind: "tree",
      position: { x: b.position.x - treeOffset, y: 0, z: b.entrance.z + sideSign * 1.6 },
      rotationY: hash01(b.id + ":tree1") * Math.PI * 2,
    });
    props.push({
      kind: "tree",
      position: { x: b.position.x + treeOffset, y: 0, z: b.entrance.z + sideSign * 1.6 },
      rotationY: hash01(b.id + ":tree2") * Math.PI * 2,
    });
    if (b.type === "leisure") {
      props.push({
        kind: "bench",
        position: { x: b.entrance.x, y: 0, z: b.entrance.z + sideSign * 1.6 },
        rotationY: b.rotationY,
      });
    }
  }

  const xs = [
    ...buildings.map((b) => b.position.x - b.width / 2),
    ...buildings.map((b) => b.position.x + b.width / 2),
  ];
  const zs = [
    ...buildings.map((b) => b.position.z - b.depth / 2),
    ...buildings.map((b) => b.position.z + b.depth / 2),
    street.a.z - sidewalkOffset - 2,
    street.a.z + sidewalkOffset + 2,
  ];

  return {
    neighborhoodId: hood.id,
    neighborhoodName: hood.name,
    buildings,
    street,
    sidewalks,
    props,
    bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) },
    _layout: layout,
    _network: network,
    _origin: origin,
    _locationIds: locationIds,
  };
}

// ---------------------------------------------------------------------
// Step 3 — live agent selection + position/route projection
// ---------------------------------------------------------------------

/** Agents actually, currently located inside the rendered micro-district
 * (real `location_id` membership — never agents "assigned" for visual
 * padding). Capped at 10 for legibility; if fewer are live there, fewer
 * are shown. */
export function pickVisibleAgents(agents: Agent[], scene: MicroDistrictScene, max = 10): Agent[] {
  const inDistrict = agents.filter((a) => scene._locationIds.has(a.location_id));
  const sorted = [...inDistrict].sort((a, b) => a.id.localeCompare(b.id));
  return sorted.slice(0, max);
}

/** Ground target position for an agent at their current real location,
 * jittered within the building's footprint (same deterministic jitter
 * fn the 2D canvas uses) so co-located agents don't stack on one point. */
export function agentTargetPosition(scene: MicroDistrictScene, agent: Agent): Vec3 | null {
  const tile = scene._layout.locationById.get(agent.location_id);
  if (!tile) return null;
  const jitter2D = agentJitter(agent.id, tile);
  return project(jitter2D, scene._origin);
}

/** Real walkable waypoints (ground plane) between two of this
 * micro-district's locations, reusing the exact same road-network
 * pathing the 2D canvas walks — just projected into 3D. Returns null if
 * either location isn't part of the currently rendered scene (caller
 * should fall back to a direct glide, same as CityCanvas does). */
export function agentRoute3D(scene: MicroDistrictScene, fromLocationId: string, toLocationId: string): Vec3[] | null {
  if (fromLocationId === toLocationId) return [];
  if (!scene._locationIds.has(fromLocationId) || !scene._locationIds.has(toLocationId)) return null;
  const waypoints = routeBetweenLocations(scene._layout, scene._network, fromLocationId, toLocationId);
  if (!waypoints) return null;
  return waypoints.map((p) => project(p, scene._origin));
}

/**
 * Follow-mode variant of `agentRoute3D`: reuses the exact same city-wide
 * layout + road network + `routeBetweenLocations` pathing (this adapter
 * builds `layout`/`network` from the FULL `world.locations` /
 * `world.neighborhoods` up front, in `buildMicroDistrictScene` — the
 * "windowing" down to 3-4 buildings only affects which *meshes* get
 * drawn, never the topology the road graph is built from) but WITHOUT
 * the "both ends must be inside the currently-rendered micro-district"
 * gate that `agentRoute3D` intentionally applies for ambient background
 * agents.
 *
 * Only intended for the one agent the user is actively following: that
 * agent's real `location_id` can legitimately be outside the windowed
 * scene (Stage 1 still only draws one micro-district's buildings), and
 * Follow Mode needs a real, network-following path for that trip rather
 * than silently falling back to a straight-line glide. Background
 * agents keep using `agentRoute3D` unchanged, so this never touches
 * their behavior or the perf characteristics documented at the top of
 * CityCanvas3D.tsx.
 */
export function agentRouteAny3D(scene: MicroDistrictScene, fromLocationId: string, toLocationId: string): Vec3[] | null {
  if (fromLocationId === toLocationId) return [];
  const waypoints = routeBetweenLocations(scene._layout, scene._network, fromLocationId, toLocationId);
  if (!waypoints) return null;
  return waypoints.map((p) => project(p, scene._origin));
}

/** Maps a live `current_action.action_type` to the Stage-1 floating
 * status icon. Falls back to a neutral walking glyph for unrecognized /
 * missing action types rather than guessing at simulation state. */
export function actionIcon(actionType: string | undefined | null): string {
  switch (actionType) {
    case "work":
      return "💼";
    case "consume_food":
      return "🛒";
    case "rest":
      return "💤";
    case "socialize":
      return "💬";
    case "move":
      return "🚶";
    case "idle":
      return "🕐";
    default:
      return "🕐";
  }
}
