/**
 * Isometric Adapter (Vertical Slice)
 * ====================================================================
 * Projects ECHO's existing, backend-authoritative topology into true
 * isometric (30°/30°) screen space for CityCanvasIso.tsx.
 *
 * This is NOT a new coordinate system for the simulation. It is a second
 * consumer of the exact same client-side plan layout every other
 * renderer already uses:
 *
 *   apps/api/app/world/models.py   -- no x/y/z anywhere (topology only)
 *   lib/cityLayout.ts              -- derives one deterministic 2D plan
 *                                      (buildCityLayout / buildRoadNetwork /
 *                                      routeBetweenLocations) from that
 *                                      topology. UNCHANGED by this file.
 *   lib/adapters/3dAdapter.ts      -- an earlier consumer of the same
 *                                      plan, for the (retired-in-practice)
 *                                      Three.js prototype. This file
 *                                      mirrors its "pick one busy
 *                                      neighborhood, lock it" pattern,
 *                                      just projecting to Canvas2D instead
 *                                      of a WebGL scene graph.
 *
 * Everything below reads plan-space (x, y) rectangles that already exist
 * and produces screen-space (sx, sy) polygons. Agent motion itself
 * (interpolation, path-following) still happens entirely in plan space in
 * CityCanvasIso.tsx, exactly the way CityCanvas.tsx already does it --
 * this module is only ever called at draw time, per frame, to answer
 * "where does this real (x, y) land on screen."
 */

import {
  CityLayout,
  LocationLayout,
  Point,
  RoadNetwork,
  buildCityLayout,
  buildRoadNetwork,
  hash01,
} from "./cityLayout";
import { Agent, Location, Neighborhood } from "./types";

// ---------------------------------------------------------------------
// Core projection
// ---------------------------------------------------------------------

/**
 * True isometric: both plan axes are projected at 30° from horizontal,
 * so a square footprint always becomes a symmetric diamond regardless of
 * which direction you're looking -- this is what makes the result read
 * as "isometric" rather than an arbitrarily skewed rectangle. `worldZ` is
 * a pure visual height in the same px unit as x/y; it only ever shifts
 * screenY upward, which is the standard way 2D isometric renderers fake
 * vertical extrusion without a real 3D camera.
 */
const ISO_COS = Math.cos(Math.PI / 6); // 30°
const ISO_SIN = Math.sin(Math.PI / 6);

export interface ScreenPoint {
  sx: number;
  sy: number;
}

export function projectIso(worldX: number, worldY: number, worldZ = 0): ScreenPoint {
  return {
    sx: (worldX - worldY) * ISO_COS,
    sy: (worldX + worldY) * ISO_SIN - worldZ,
  };
}

/** Depth key for the painter's algorithm: objects further "into" the
 * plan (larger x+y) are nearer the viewer in this projection and must be
 * drawn later (on top). Every drawable -- building, tree, agent -- gets
 * exactly one of these from its ground-anchor plan point. */
export function depthKey(worldX: number, worldY: number): number {
  return worldX + worldY;
}

// ---------------------------------------------------------------------
// Building extrusion
// ---------------------------------------------------------------------

/** Visual-only height per location type. Not simulation data -- purely
 * how tall this building's silhouette reads on screen. Tuned so a
 * workplace/market reads as a small block and a house reads clearly
 * smaller, per the reference image's mixed-height streetscape. */
export const BUILDING_HEIGHT: Record<string, number> = {
  residential: 62,
  workplace: 138,
  market: 88,
  leisure: 34, // park/plaza pavilion -- raised enough that its canopy visibly separates from the ground plane instead of blending into the lot color beneath it
};

export function heightForType(type: string): number {
  return BUILDING_HEIGHT[type] ?? BUILDING_HEIGHT.residential;
}

// ---------------------------------------------------------------------
// LOD tier (Living City milestone scene-architecture hook)
//
// A single, shared "how zoomed in is the camera, relative to this
// scene's own establishing-view scale" classification. Agent sprites
// already had an inline version of this ternary (simple/readable/
// detailed) before this milestone; it's promoted to a named, exported
// function here so building archetypes (Phase C), interiors (Phase F),
// and the follow camera (Phase E) can all key off the exact same three
// tiers instead of each inventing their own scale-ratio thresholds --
// "build the scene architecture so later LOD ... can plug in cleanly"
// per the brief. This function only classifies; it draws nothing and
// changes no visuals by itself.
// ---------------------------------------------------------------------

export type ZoomTier = "overview" | "neighborhood" | "close";

/**
 * @param scale current camera scale (Camera.scale)
 * @param fitScale the scale that fit the *entire* rendered scene to the
 *   viewport at rest (fitScaleRef.current in CityCanvasIso) -- the same
 *   reference point the existing agent-LOD ternary already used.
 */
export function zoomTier(scale: number, fitScale: number): ZoomTier {
  const ratio = fitScale > 0 ? scale / fitScale : 1;
  if (ratio > 1.6) return "close";
  if (ratio > 1.15) return "neighborhood";
  return "overview";
}

// ---------------------------------------------------------------------
// Neighborhood ground identity (Part 4 -- "neighborhoods should have
// subtle identity differences", visual only, no domain data implied).
// A small fixed palette rather than a per-neighborhood-name lookup table
// so it degrades gracefully to any future/renamed neighborhood set
// without needing to be kept in sync with world/generator.py's fixed
// NEIGHBORHOOD_NAMES list.
// ---------------------------------------------------------------------
export const NEIGHBORHOOD_GROUND_TINTS: string[] = [
  "#26332a", // soft green -- greener/residential-leaning
  "#2a2e36", // cool slate -- denser/commercial-leaning
  "#332c26", // warm earth
  "#243330", // teal-green
  "#302a36", // muted plum
];

export function neighborhoodTint(index: number): string {
  return NEIGHBORHOOD_GROUND_TINTS[index % NEIGHBORHOOD_GROUND_TINTS.length];
}

/**
 * cityLayout.ts sizes each location's tile to fill a top-down grid cell
 * (commonly 300-500px on a side) -- correct for a flat plan, but if used
 * directly as a building's iso footprint it dwarfs any believable
 * building height and buildings tile edge-to-edge with no yard/street
 * gap between them (verified visually in the preview harness before
 * this function existed -- it read as a flat diamond mosaic, not
 * separate buildings). This derives a much smaller footprint centered
 * inside the tile, so:
 *   (a) each building reads as a compact volume with height clearly
 *       visible relative to its footprint, matching the reference's
 *       proportions, and
 *   (b) the unused tile margin becomes a real gap between neighboring
 *       buildings for a yard/sidewalk to occupy, instead of buildings
 *       touching.
 * The full tile rect is still used, unchanged, for entrances/sidewalks/
 * routing (see cityLayout.ts) -- only the drawn building volume itself
 * is inset.
 */
export function footprintRect(loc: LocationLayout): { x: number; y: number; w: number; h: number } {
  // Bumped from 150x120 (Phase-1 vertical slice) to 190x150: the smaller
  // cap read as a diorama of separated toy blocks with a lot of empty lot
  // padding around each one. A bigger footprint relative to the same tile
  // still leaves a believable yard gap (lotRect below), but the building
  // itself now occupies enough of its lot to read as "a real building on
  // a real plot" rather than "a small box floating in a big empty tile" --
  // this is the single biggest lever on "the world feels small" without
  // touching cityLayout.ts's actual grid math.
  //
  // Architectural-quality pass: applies archetypeFor's deterministic
  // `aspect` skew (0.82-1.22) so buildings of the same type aren't all
  // the same width:depth proportions -- without this every residence (or
  // every workplace) was a visually identical rectangle just recolored,
  // which read as "one asset, many copies" rather than distinct
  // buildings. Total footprint area is kept roughly constant (w*aspect,
  // h/aspect) so this changes *shape*, not overall building size.
  // Phase 1: aspect and overall footprint size both now also carry a
  // venue_kind-specific bias (VENUE_SHAPE) on top of the existing
  // deterministic per-building random skew -- this is what makes e.g.
  // a townhouse read as narrow+deep and a cafe read as a small corner
  // lot, rather than every venue in a LocationType sharing one shape.
  const shape = shapeFor(loc.venueKind);
  const aspect = archetypeFor(loc).aspect * shape.aspectBias;
  const scale = shape.footprintScale;
  const w = Math.min(loc.w * 0.46, 190) * scale * Math.sqrt(aspect);
  const h = (Math.min(loc.h * 0.46, 150) * scale) / Math.sqrt(aspect);
  const cx = loc.x + loc.w / 2;
  const cy = loc.y + loc.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** The lot beneath a building -- a bit larger than the footprint, used
 * to paint a ground-plane color (grass for houses/parks, pavement for
 * market/workplace) so the gap around each building reads as its own
 * yard rather than empty void. */
export function lotRect(loc: LocationLayout): { x: number; y: number; w: number; h: number } {
  const fp = footprintRect(loc);
  const pad = loc.type === "leisure" ? 46 : 26;
  return { x: fp.x - pad, y: fp.y - pad * 0.7, w: fp.w + pad * 2, h: fp.h + pad * 1.4 };
}

// ---------------------------------------------------------------------
// Building archetype (Phase-2 richness pass)
// ---------------------------------------------------------------------

/**
 * Per-type silhouette language so a workplace, market, house, and leisure
 * pavilion are distinguishable at a glance even before reading their
 * label -- the master prompt's "residential should look like a house,
 * workplace should look different from a house" requirement. This is
 * purely a visual-drawing decision (which primitives isoRenderer.ts uses
 * to build the roof/walls), never simulation data.
 */
export type RoofStyle = "gable" | "flat" | "awning" | "pavilion" | "mansard" | "sawtooth" | "arch" | "plaza";

export const ROOF_STYLE_FOR_TYPE: Record<string, RoofStyle> = {
  residential: "gable", // pitched roof -- reads as "a house"
  workplace: "flat", // flat roof + parapet + rooftop unit -- reads as "an office/factory block"
  market: "awning", // flat roof + street-facing awning + hanging sign -- reads as "a shop"
  leisure: "pavilion", // open pillars + canopy, no solid walls -- reads as "a gathering pavilion"
};

// ---------------------------------------------------------------------
// Phase 1 (Building Identity) -- venue_kind-driven silhouette language.
//
// ROOF_STYLE_FOR_TYPE above stays exactly as-is: it's still the fallback
// for any Location that somehow has no venue_kind (shouldn't happen post
// Phase 0, but keeps this file defensive) and it's still what LocationType
// itself conceptually implies. VENUE_ROOF_STYLE is the finer second axis:
// every one of the 14 real VenueKinds maps to a specific structural
// silhouette. Four of the eight RoofStyle values are new geometry
// (mansard/sawtooth/arch/plaza, drawn in isoRenderer.ts); the other ten
// venue kinds reuse gable/flat/awning/pavilion but are still made
// distinguishable via VENUE_SHAPE below (proportions/height) and
// venue-specific accent details drawn in isoRenderer.ts (a cross sign,
// a garage door, a glass grid, a fountain...). Not every distinguishing
// cue needs a brand-new roof shape -- some read clearly enough from
// massing + palette + one accent detail, and reserving new roof
// geometry for the venues that need it most (apartment block, workshop,
// community hall, plaza) keeps each shape legible rather than diluting
// 14 shapes down to subtle variations no observer would actually catch.
// ---------------------------------------------------------------------
export const VENUE_ROOF_STYLE: Record<string, RoofStyle> = {
  // RESIDENTIAL
  detached_house: "gable",
  family_house: "gable",
  townhouse: "gable",
  small_apartment: "mansard",
  // WORKPLACE
  office: "flat",
  service_office: "flat",
  clinic: "flat",
  workshop: "sawtooth",
  // MARKET
  grocery: "awning",
  cafe: "awning",
  general_store: "awning",
  // LEISURE
  park: "pavilion",
  community_center: "arch",
  small_plaza: "plaza",
};

export function roofStyleFor(loc: { type: string; venueKind?: string }): RoofStyle {
  if (loc.venueKind && VENUE_ROOF_STYLE[loc.venueKind]) return VENUE_ROOF_STYLE[loc.venueKind];
  return ROOF_STYLE_FOR_TYPE[loc.type] || "gable";
}

/**
 * Per-venue_kind massing knobs layered on top of footprintRect's base
 * square-ish tile-derived footprint and heightForType's per-LocationType
 * base height. Every entry is a *multiplier* on what the coarse
 * LocationType would already produce, so e.g. a clinic is still
 * unmistakably a "workplace-scale" building, just a shorter/plainer one
 * than an office -- the two axes compose instead of one replacing the
 * other. Kept as one small table (rather than scattering these numbers
 * across isoRenderer.ts's drawing functions) so the "why is a cafe
 * smaller than a grocery" answer lives in one place.
 */
export interface VenueShape {
  footprintScale: number; // multiplies footprintRect's w/h before the aspect skew
  aspectBias: number; // multiplies the deterministic per-building aspect (>1 = wider/shallower, <1 = narrower/deeper)
  heightMul: number; // multiplies heightForType(loc.type) on top of archetype.heightScale
}

export const DEFAULT_VENUE_SHAPE: VenueShape = { footprintScale: 1, aspectBias: 1, heightMul: 1 };

export const VENUE_SHAPE: Record<string, VenueShape> = {
  // RESIDENTIAL -- family_house is the biggest single-family lot, townhouse
  // is deliberately narrow+deep (attached-unit proportions), small_apartment
  // is both taller (mansard, multi-floor) and a touch larger footprint.
  detached_house: { footprintScale: 1, aspectBias: 1, heightMul: 1 },
  family_house: { footprintScale: 1.22, aspectBias: 1.05, heightMul: 1.05 },
  townhouse: { footprintScale: 0.82, aspectBias: 0.6, heightMul: 1.35 },
  small_apartment: { footprintScale: 1.05, aspectBias: 0.95, heightMul: 1.9 },
  // WORKPLACE -- office is the tallest (glass tower read), clinic
  // deliberately low/plain (a single-story medical block), workshop wide
  // and squat (industrial shed), service_office mid-height.
  office: { footprintScale: 1, aspectBias: 1, heightMul: 1.35 },
  service_office: { footprintScale: 0.92, aspectBias: 1.05, heightMul: 0.85 },
  clinic: { footprintScale: 1, aspectBias: 1.1, heightMul: 0.62 },
  workshop: { footprintScale: 1.25, aspectBias: 1.6, heightMul: 0.55 },
  // MARKET -- cafe is the smallest footprint (a corner shop), grocery the
  // widest (needs street frontage for produce/stalls), general_store
  // in between and plain.
  grocery: { footprintScale: 1.18, aspectBias: 1.25, heightMul: 0.9 },
  cafe: { footprintScale: 0.66, aspectBias: 0.85, heightMul: 0.8 },
  general_store: { footprintScale: 0.95, aspectBias: 1, heightMul: 0.95 },
  // LEISURE -- park stays the existing open pavilion scale; community
  // center is a genuine civic building (bigger + taller than any market);
  // small_plaza has no building volume at all, so its "footprint" only
  // controls the paved area drawn in drawPlaza.
  park: { footprintScale: 1, aspectBias: 1, heightMul: 1 },
  community_center: { footprintScale: 1.3, aspectBias: 1.1, heightMul: 1.15 },
  small_plaza: { footprintScale: 1.15, aspectBias: 1, heightMul: 1 },
};

export function shapeFor(venueKind: string): VenueShape {
  return VENUE_SHAPE[venueKind] ?? DEFAULT_VENUE_SHAPE;
}

export interface BuildingArchetype {
  roofStyle: RoofStyle;
  /** Deterministic per-building height multiplier (0.85-1.18) so a row of
   * same-type buildings isn't a row of visually identical clones -- the
   * reference streetscape's "varied building heights" note. Seeded from
   * the location's own id, so it's stable across renders/re-picks. */
  heightScale: number;
  /** Deterministic small hue/lightness nudge on the base palette so two
   * neighboring houses aren't pixel-identical either. In [-1, 1]. */
  tone: number;
  /** Architectural-quality pass: a per-type structural sub-variant, not
   * just a palette tweak -- residential picks a roof *shape* (gable vs
   * hip), workplace picks single-block vs stepped-back upper massing,
   * market picks storefront glazing width, leisure picks an open vs
   * gathering-nook pavilion layout. 0 or 1. */
  variant: 0 | 1;
  /** Footprint width:depth skew (0.82-1.22) applied on top of
   * footprintRect's base square-ish footprint, so buildings of the same
   * type aren't all identical proportions -- some read as wide/low,
   * others as narrow/deep. */
  aspect: number;
  /** Residential only: whether this lot has a perimeter fence/hedge --
   * not every yard needs one, and having some houses fenced and others
   * open reads as a real street, not a uniform template. */
  hasFence: boolean;
  // ---- Phase 0 passthrough (not yet consumed by any visual decision
  // above -- roofStyle/heightScale/tone/variant/aspect/hasFence are all
  // still computed exactly as before, purely from loc.id/loc.type, so
  // this phase makes zero visual change). Carried here so Phase 1
  // (building identity) can read venue_kind directly off the archetype
  // object it already receives, without a second lookup, and so this
  // link in the data chain (LocationLayout -> archetypeFor ->
  // BuildingArchetype) is verifiable by a test rather than assumed.
  venueKind: string;
  architecturalStyle: string;
  floorCount: number;
  isPublic: boolean;
  interiorArchetype: string;
}

export function archetypeFor(loc: LocationLayout): BuildingArchetype {
  const roofStyle = roofStyleFor(loc);
  const heightScale = 0.85 + hash01(loc.id + ":height") * 0.33;
  const tone = hash01(loc.id + ":tone") * 2 - 1;
  const variant = hash01(loc.id + ":variant") > 0.5 ? 1 : 0;
  const aspect = 0.82 + hash01(loc.id + ":aspect") * 0.4;
  const hasFence = hash01(loc.id + ":fence") > 0.45;
  return {
    roofStyle,
    heightScale,
    tone,
    variant,
    aspect,
    hasFence,
    venueKind: loc.venueKind,
    architecturalStyle: loc.architecturalStyle,
    floorCount: loc.floorCount,
    isPublic: loc.isPublic,
    interiorArchetype: loc.interiorArchetype,
  };
}

export interface IsoBuilding {
  loc: LocationLayout;
  height: number;
  depthKey: number;
  archetype: BuildingArchetype;
  /** Footprint corners on the ground (z=0), screen space, in the fixed
   * back/right/front/left roles derived below. */
  floor: { back: ScreenPoint; right: ScreenPoint; front: ScreenPoint; left: ScreenPoint };
  /** Same 4 corners projected at z=height -- the roof plane. */
  roof: { back: ScreenPoint; right: ScreenPoint; front: ScreenPoint; left: ScreenPoint };
  // Phase 0 passthrough, mirrored at the top level (in addition to
  // being reachable via `loc.*` / `archetype.*`) so the renderer
  // (isoRenderer.ts's drawBuilding/paletteFor, Phase 1's actual
  // consumer) has one obvious, explicit place to read venue identity
  // from an IsoBuilding without reaching into a nested object. Not read
  // by any drawing function yet -- Phase 0 makes no visual change.
  venueKind: string;
  architecturalStyle: string;
  floorCount: number;
  isPublic: boolean;
  interiorArchetype: string;
}

/**
 * Projects one building's rectangular plan footprint into a full iso
 * volume: floor quad + roof quad, from which the renderer draws two
 * visible wall faces (front-left, front-right) plus the roof.
 *
 * The corner-role assignment (which plan corner becomes "back" vs
 * "front" on screen) is NOT computed per-frame by sorting -- it's a
 * fixed consequence of this specific projection's sign convention for
 * any axis-aligned rect with w,h > 0:
 *   screenY = (x + y) * sin30 - z   -> smallest at plan-top-left (back),
 *                                       largest at plan-bottom-right (front)
 *   screenX = (x - y) * cos30       -> largest at plan-top-right (right),
 *                                       smallest at plan-bottom-left (left)
 * so it's computed once with plain arithmetic, not a runtime sort.
 */
export function projectBuilding(loc: LocationLayout): IsoBuilding {
  const archetype = archetypeFor(loc);
  // Phase 1: venue_kind's heightMul composes with the existing per-type
  // base height and per-building random heightScale -- e.g. a clinic is
  // shorter than a generic workplace, an office taller, independent of
  // that specific building's own +/-18% random variance.
  const height = heightForType(loc.type) * archetype.heightScale * shapeFor(loc.venueKind).heightMul;
  const fp = footprintRect(loc);
  const x0 = fp.x;
  const y0 = fp.y;
  const x1 = fp.x + fp.w;
  const y1 = fp.y + fp.h;

  const proj = (px: number, py: number, z: number) => projectIso(px, py, z);

  return {
    loc,
    height,
    archetype,
    venueKind: loc.venueKind,
    architecturalStyle: loc.architecturalStyle,
    floorCount: loc.floorCount,
    isPublic: loc.isPublic,
    interiorArchetype: loc.interiorArchetype,
    depthKey: depthKey(loc.x + loc.w / 2, loc.y + loc.h / 2),
    floor: {
      back: proj(x0, y0, 0),
      right: proj(x1, y0, 0),
      front: proj(x1, y1, 0),
      left: proj(x0, y1, 0),
    },
    roof: {
      back: proj(x0, y0, height),
      right: proj(x1, y0, height),
      front: proj(x1, y1, height),
      left: proj(x0, y1, height),
    },
  };
}

// ---------------------------------------------------------------------
// Full-city slice
// (Living City milestone Phase B. Previously this picked ONE "active"
// neighborhood -- by agent-occupancy -- and rendered only its locations,
// which is the "8-location vertical slice" limitation the milestone
// brief calls out. lib/cityLayout.ts's buildCityLayout/buildRoadNetwork
// already compute a full 5-neighborhood/40-location layout + road graph
// (the legacy 2D CityCanvas.tsx has always used the whole thing); the
// old pickActiveNeighborhood/pickSliceLocations functions that used to
// live here just threw most of that away before CityCanvasIso.tsx ever
// saw it. This is now a straight pass-through of the *entire* real
// world -- every neighborhood, every location, every one of the real
// 100 agents -- with no cap and no truncation. Nothing here regenerates
// or invents world structure; buildCityLayout/buildRoadNetwork remain
// completely untouched.)
// ---------------------------------------------------------------------

export interface WorldSlice {
  neighborhoods: Neighborhood[];
  locations: Location[];
  agents: Agent[];
}

export interface IsoSlice {
  /** Kept for backward compatibility with call sites (render-check
   * harness scripts, tests) that construct a WorldSlice out of a single
   * neighborhood's data and expect a single "the" neighborhood back --
   * this is simply the alphabetically-first neighborhood actually
   * present in this slice. CityCanvasIso.tsx itself no longer treats
   * this as "the" neighborhood being rendered; it iterates
   * `layout.neighborhoods` (below) to draw every real district. */
  neighborhoodId: string;
  neighborhoodName: string;
  layout: CityLayout;
  network: RoadNetwork;
  locationIds: Set<string>;
  tiles: LocationLayout[];
}

/**
 * Pure, stateless full-city pick -- called once by CityCanvasIso and then
 * locked in a ref (scene identity locks on first successful pick, same
 * pattern as before) so the on-screen buildings don't shuffle every tick
 * as occupancy changes. Re-run only when the caller detects a genuine
 * topology change (population reset).
 *
 * Renders EVERY real neighborhood and EVERY real location the backend
 * reports -- no active-neighborhood selection, no occupancy-based
 * truncation. If `world` only contains a single neighborhood's worth of
 * locations (as every existing render-check harness script does), the
 * result is identical to what pickIsoSlice returned before this change;
 * the cap that's being removed only ever activated when *more* than one
 * neighborhood's data was actually passed in, which the real app (via
 * the real /api/world payload) always does.
 */
export function pickIsoSlice(world: WorldSlice): IsoSlice | null {
  if (world.neighborhoods.length === 0) return null;

  const layout = buildCityLayout(world.neighborhoods, world.locations);
  if (layout.locations.length === 0) return null;

  const network = buildRoadNetwork(layout);

  const sortedHoods = [...world.neighborhoods].sort((a, b) => a.name.localeCompare(b.name));
  const primary = sortedHoods[0];

  return {
    neighborhoodId: primary.id,
    neighborhoodName: primary.name,
    layout,
    network,
    locationIds: new Set(layout.locations.map((t) => t.id)),
    tiles: layout.locations,
  };
}

// ---------------------------------------------------------------------
// Street furniture (trees, lamps) -- deterministic scatter, cosmetic
// only, never affects routing or simulation state.
// ---------------------------------------------------------------------

export interface PropPlacement {
  x: number;
  y: number;
  kind: "tree" | "lamp" | "bench" | "stall" | "planter" | "fence" | "sign" | "bush" | "bin";
  depthKey: number;
  /** Deterministic 0-1 seed for per-instance drawing variance (leaf tint,
   * awning stripe color, etc). Never used for anything but cosmetic
   * variety within a single draw call. */
  seed: number;
}

/**
 * Places street furniture around the slice's buildings, deterministically
 * from each tile's own id (same hash01 utility cityLayout.ts already uses
 * for agent jitter) so the same building always gets the same nearby
 * greenery/furniture instead of it re-rolling every render.
 *
 * Phase-2 richness pass: beyond the original tree/lamp/bench set, this now
 * scatters a few type-appropriate props per lot (market stalls near
 * markets, planters near leisure pavilions, low fence posts around yards,
 * a sign near workplaces) so each lot reads as belonging to a specific
 * kind of place, not an interchangeable green rectangle. Every placement
 * is still purely decorative -- none of this affects routing, occupancy,
 * or any simulation state.
 */
export function scatterProps(tiles: LocationLayout[]): PropPlacement[] {
  const props: PropPlacement[] = [];
  tiles.forEach((tile, i) => {
    const seed = `${tile.id}:prop`;
    const hx = hash01(seed + ":x");
    const hy = hash01(seed + ":y");

    // Two trees per lot (was one) at slightly different offsets/sizes
    // (drawTree's own seed-driven size class does the rest), so a lot's
    // greenery reads as an actual planted yard rather than a single
    // token tree standing in for "nature exists here."
    const treeX = tile.x + tile.w * (0.12 + hx * 0.12) - 14;
    const treeY = tile.y + tile.h + 10 + hy * 6;
    props.push({ x: treeX, y: treeY, kind: "tree", depthKey: depthKey(treeX, treeY), seed: hash01(seed + ":t") });
    const tree2X = tile.x + tile.w * (0.62 + hy * 0.16) + 6;
    const tree2Y = tile.y + tile.h + 16 + hx * 8;
    props.push({ x: tree2X, y: tree2Y, kind: "tree", depthKey: depthKey(tree2X, tree2Y), seed: hash01(seed + ":t2") });

    // Every other building also gets a lamp on its opposite side, purely
    // to break up the silhouette the way the reference streetscape does.
    if (i % 2 === 0) {
      const lampX = tile.x + tile.w + 8;
      const lampY = tile.y + tile.h * 0.5;
      props.push({ x: lampX, y: lampY, kind: "lamp", depthKey: depthKey(lampX, lampY), seed: hash01(seed + ":l") });
    } else {
      const benchX = tile.x - 10;
      const benchY = tile.y + tile.h * 0.6;
      props.push({ x: benchX, y: benchY, kind: "bench", depthKey: depthKey(benchX, benchY), seed: hash01(seed + ":b") });
    }

    // Type-appropriate extra dressing so each lot reads as belonging to
    // its kind of place, not an interchangeable green rectangle.
    if (tile.type === "market") {
      const sx = tile.x + tile.w * 0.28;
      const sy = tile.y + tile.h + 26;
      props.push({ x: sx, y: sy, kind: "stall", depthKey: depthKey(sx, sy), seed: hash01(seed + ":s1") });
      const sx2 = tile.x + tile.w * 0.68;
      const sy2 = tile.y + tile.h + 30;
      props.push({ x: sx2, y: sy2, kind: "stall", depthKey: depthKey(sx2, sy2), seed: hash01(seed + ":s2") });
      // Crates/display area cue + a utility bin near the service edge --
      // "market exterior details" beyond just the stalls themselves.
      const bx = tile.x + tile.w * 0.5;
      const by = tile.y + tile.h + 34;
      props.push({ x: bx, y: by, kind: "planter", depthKey: depthKey(bx, by), seed: hash01(seed + ":crate") });
      const binX = tile.x + tile.w + 6;
      const binY = tile.y + tile.h + 4;
      props.push({ x: binX, y: binY, kind: "bin", depthKey: depthKey(binX, binY), seed: hash01(seed + ":bin") });
    } else if (tile.type === "leisure") {
      const px1 = tile.x - 22;
      const py1 = tile.y + tile.h * 0.3;
      props.push({ x: px1, y: py1, kind: "planter", depthKey: depthKey(px1, py1), seed: hash01(seed + ":p1") });
      const px2 = tile.x + tile.w + 22;
      const py2 = tile.y + tile.h * 0.7;
      props.push({ x: px2, y: py2, kind: "planter", depthKey: depthKey(px2, py2), seed: hash01(seed + ":p2") });
      // A denser tree cluster and a second lamp so the park reads as the
      // neighborhood's one real green public space, not just another lot.
      const px3 = tile.x + tile.w * 0.15;
      const py3 = tile.y - 14;
      props.push({ x: px3, y: py3, kind: "tree", depthKey: depthKey(px3, py3), seed: hash01(seed + ":t3") });
      const lampX2 = tile.x - 8;
      const lampY2 = tile.y + tile.h * 0.5;
      props.push({ x: lampX2, y: lampY2, kind: "lamp", depthKey: depthKey(lampX2, lampY2), seed: hash01(seed + ":l2") });
    } else if (tile.type === "residential") {
      // Alternates fence (drawYardFence, drawn as part of the building
      // itself) with a hedge line of individual bush props along the
      // opposite yard edge -- archetypeFor's hasFence already decides
      // fence-or-not on the building side; this adds the greenery
      // variant so a hedge-yard house still gets *some* boundary marker.
      const fx1 = tile.x - 16;
      const fy1 = tile.y + tile.h * 0.15;
      props.push({ x: fx1, y: fy1, kind: "fence", depthKey: depthKey(fx1, fy1), seed: hash01(seed + ":f1") });
      const fx2 = tile.x - 16;
      const fy2 = tile.y + tile.h * 0.85;
      props.push({ x: fx2, y: fy2, kind: "fence", depthKey: depthKey(fx2, fy2), seed: hash01(seed + ":f2") });
      for (let k = 0; k < 3; k++) {
        const bxh = tile.x + tile.w * (0.1 + k * 0.35);
        const byh = tile.y + tile.h + 6;
        props.push({ x: bxh, y: byh, kind: "bush", depthKey: depthKey(bxh, byh), seed: hash01(seed + ":bush" + k) });
      }
    } else if (tile.type === "workplace") {
      const gx = tile.x + tile.w + 14;
      const gy = tile.y + tile.h * 0.2;
      props.push({ x: gx, y: gy, kind: "sign", depthKey: depthKey(gx, gy), seed: hash01(seed + ":sg") });
      const binX = tile.x + tile.w + 10;
      const binY = tile.y + tile.h * 0.85;
      props.push({ x: binX, y: binY, kind: "bin", depthKey: depthKey(binX, binY), seed: hash01(seed + ":bin") });
    }
  });
  return props;
}
