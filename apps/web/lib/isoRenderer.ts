/**
 * Iso Renderer -- pure Canvas2D drawing functions for the isometric
 * vertical slice.
 *
 * Deliberately framework-free (no React, no browser-only globals beyond
 * a standard CanvasRenderingContext2D) so the exact same drawing code
 * that ships inside CityCanvasIso.tsx can also be exercised from a
 * plain Node + node-canvas harness for visual verification before
 * wiring it into the app. Nothing here reads simulation state directly
 * -- every function takes already-projected screen points or plain
 * building/agent view-models as arguments.
 */

import { IsoBuilding, PropPlacement, ScreenPoint, depthKey, footprintRect, lotRect, projectIso } from "./isometricAdapter";
import { Point } from "./cityLayout";

export interface Camera {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function toScreen(p: ScreenPoint, cam: Camera): { x: number; y: number } {
  return { x: p.sx * cam.scale + cam.offsetX, y: p.sy * cam.scale + cam.offsetY };
}

function poly(ctx: any, cam: Camera, pts: ScreenPoint[]) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = toScreen(p, cam);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
}

// Per-type palette: [wallBase, wallShade, roof] -- kept as the fallback
// for any Location without a usable venue_kind (shouldn't happen post
// Phase 0, but this file stays defensive rather than throwing).
const PALETTE: Record<string, { wall: string; wallShade: string; roof: string; trim: string }> = {
  residential: { wall: "#e6c98b", wallShade: "#c9a866", roof: "#b5493f", trim: "#7a5230" },
  workplace: { wall: "#9db4c9", wallShade: "#7c93a8", roof: "#495a6b", trim: "#33404d" },
  market: { wall: "#e0a860", wallShade: "#c08843", roof: "#8a5a3c", trim: "#5c3b26" },
  leisure: { wall: "#a8c98f", wallShade: "#8bab72", roof: "#d9c08a", trim: "#7a5230" },
};

// Phase 1 (Building Identity): one palette per real venue_kind, not just
// per coarse LocationType. Every family (residential/workplace/market)
// stays in its parent's hue range -- a clinic still reads as "workplace
// blue-gray family", a cafe still reads as "market warm-brown family" --
// but each member of the family gets its own wall/roof/trim so a row of
// same-LocationType buildings doesn't collapse into one recolored clone.
// leisure venues intentionally diverge furthest from each other (park
// has no walls at all; small_plaza has no building volume at all) since
// the acceptance test explicitly calls out "parks/public spaces must not
// look like generic buildings."
const VENUE_PALETTE: Record<string, { wall: string; wallShade: string; roof: string; trim: string }> = {
  // RESIDENTIAL family (warm cream/terracotta)
  detached_house: { wall: "#e6c98b", wallShade: "#c9a866", roof: "#b5493f", trim: "#7a5230" },
  family_house: { wall: "#dcb877", wallShade: "#bd9a5c", roof: "#8a4a3a", trim: "#5f3a20" },
  townhouse: { wall: "#c99a72", wallShade: "#ad7f59", roof: "#5c3b2e", trim: "#3d2818" },
  small_apartment: { wall: "#b7bfc4", wallShade: "#98a1a8", roof: "#6b5a4a", trim: "#4a3d30" },
  // WORKPLACE family (cool gray/blue)
  office: { wall: "#9db4c9", wallShade: "#7c93a8", roof: "#495a6b", trim: "#33404d" },
  service_office: { wall: "#a9b6bd", wallShade: "#8b9aa3", roof: "#566670", trim: "#37444c" },
  clinic: { wall: "#dfe6e6", wallShade: "#c3ccce", roof: "#4f8f8a", trim: "#2f5652" },
  workshop: { wall: "#8f8577", wallShade: "#736b60", roof: "#4a4238", trim: "#2e2a22" },
  // MARKET family (warm orange/mustard)
  grocery: { wall: "#e0a860", wallShade: "#c08843", roof: "#8a5a3c", trim: "#5c3b26" },
  cafe: { wall: "#d99a6b", wallShade: "#b87e52", roof: "#6b3f2c", trim: "#472a1c" },
  general_store: { wall: "#cdb45e", wallShade: "#ab9548", roof: "#5c4a2c", trim: "#3d3018" },
  // LEISURE family (green / civic stucco / stone -- deliberately the
  // most divergent family, see comment above)
  park: { wall: "#a8c98f", wallShade: "#8bab72", roof: "#d9c08a", trim: "#7a5230" },
  community_center: { wall: "#c7b892", wallShade: "#a89972", roof: "#7a8f6b", trim: "#4f5c3f" },
  small_plaza: { wall: "#c9bd9e", wallShade: "#ada088", roof: "#6bb0c9", trim: "#3f5c66" },
};

function paletteFor(venueKind: string | undefined, type: string) {
  if (venueKind && VENUE_PALETTE[venueKind]) return VENUE_PALETTE[venueKind];
  return PALETTE[type] || PALETTE.residential;
}

/** Ground-shadow ellipse under any object -- cheap depth cue used for
 * both buildings and agents, drawn before the object itself. */
/** Flat-color ground fill for a location's full lot (grass/pavement),
 * plus its ground shadow -- drawn once per building as an
 * always-background pass (see CityCanvasIso.tsx's render loop for why
 * this must stay outside the depth-sorted building/agent pass). Moved
 * here (was private to CityCanvasIso.tsx) so the same real drawing code
 * can be exercised from a plain node-canvas render-check harness. */
export const LOT_COLOR: Record<string, string> = {
  residential: "#3c4a34",
  workplace: "#3a3d42",
  market: "#4a3f2e",
  leisure: "#39492f",
};

// Phase 1: per-venue_kind lot ground tint, layered the same way
// VENUE_PALETTE layers over PALETTE -- e.g. a clinic's lot reads as a
// paved medical-block apron rather than the same grass a house sits on,
// and small_plaza's lot is stone paving since there is no grass yard
// around a public plaza.
export const VENUE_LOT_COLOR: Record<string, string> = {
  detached_house: "#3c4a34",
  family_house: "#3c4a34",
  townhouse: "#39443a",
  small_apartment: "#3a4038",
  office: "#3a3d42",
  service_office: "#3b3e42",
  clinic: "#43494a",
  workshop: "#3c3a35",
  grocery: "#4a3f2e",
  cafe: "#463a2c",
  general_store: "#463d2c",
  park: "#39492f",
  community_center: "#3d4536",
  small_plaza: "#4a4638",
};

function lotColorFor(venueKind: string | undefined, type: string): string {
  if (venueKind && VENUE_LOT_COLOR[venueKind]) return VENUE_LOT_COLOR[venueKind];
  return LOT_COLOR[type] || LOT_COLOR.residential;
}

export function drawLot(ctx: any, cam: Camera, b: IsoBuilding) {
  const lot = lotRect(b.loc);
  const x0 = lot.x;
  const y0 = lot.y;
  const x1 = lot.x + lot.w;
  const y1 = lot.y + lot.h;
  const corners = [projectIso(x0, y0, 0), projectIso(x1, y0, 0), projectIso(x1, y1, 0), projectIso(x0, y1, 0)];
  ctx.beginPath();
  corners.forEach((p: ScreenPoint, i: number) => {
    const s = toScreen(p, cam);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.fillStyle = lotColorFor(b.venueKind, b.loc.type);
  ctx.fill();

  const cx = b.loc.x + b.loc.w / 2;
  const cy = b.loc.y + b.loc.h / 2;
  const shadowAnchor = projectIso(cx, cy + b.loc.h * 0.12, 0);
  drawGroundShadow(ctx, cam, shadowAnchor as unknown as ScreenPoint, 44, 20);
}

/** A straight ground-level strip (used for the street bed and its two
 * paint-line edges) between two plan-space x positions at a fixed plan
 * y, `halfWidth` plan-units wide. */
export function drawGroundStripLocal(ctx: any, cam: Camera, y: number, x1: number, x2: number, halfWidth: number, color: string) {
  const corners = [projectIso(x1, y - halfWidth, 0), projectIso(x2, y - halfWidth, 0), projectIso(x2, y + halfWidth, 0), projectIso(x1, y + halfWidth, 0)];
  ctx.beginPath();
  corners.forEach((p: ScreenPoint, i: number) => {
    const s = toScreen(p, cam);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * A ground-level ribbon between two arbitrary plan-space points (not
 * restricted to a fixed-y horizontal run like drawGroundStripLocal
 * above) -- the general primitive inter-district arterial roads need,
 * since lib/cityLayout.ts's hub-to-hub RoadEdges are two-segment
 * orthogonal polylines (a -> elbow -> b), not single fixed-y strips.
 * Works for a horizontal, vertical, or (harmlessly) diagonal segment
 * alike; every real RoadEdge segment from buildRoadNetwork happens to be
 * axis-aligned, but nothing here assumes that.
 */
export function drawGroundSegmentStrip(ctx: any, cam: Camera, p1: Point, p2: Point, halfWidth: number, color: string) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return;
  const nx = (-dy / len) * halfWidth;
  const ny = (dx / len) * halfWidth;
  const corners = [
    projectIso(p1.x + nx, p1.y + ny, 0),
    projectIso(p2.x + nx, p2.y + ny, 0),
    projectIso(p2.x - nx, p2.y - ny, 0),
    projectIso(p1.x - nx, p1.y - ny, 0),
  ];
  ctx.beginPath();
  corners.forEach((p: ScreenPoint, i: number) => {
    const s = toScreen(p, cam);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * One inter-district arterial road (Living City milestone Part 13 --
 * "the road network must visually read as an actual network now"): a
 * wider, darker asphalt bed than a local street (drawGroundStripLocal's
 * 7px halfWidth), with two thin curb-line edges, drawn along both real
 * segments of the RoadEdge's elbow polyline. This is the visual
 * counterpart of what CityCanvas.tsx (legacy 2D, untouched) already
 * draws for the same `roadNetwork.hubEdges` -- same source geometry,
 * projected through the iso transform instead of drawn top-down.
 */
export function drawArterialRoad(ctx: any, cam: Camera, edge: { a: Point; b: Point; elbow: Point }) {
  const HALF_WIDTH = 11; // plan-space half-width; wider than a local street's 7
  const segments: [Point, Point][] = [
    [edge.a, edge.elbow],
    [edge.elbow, edge.b],
  ];
  for (const [p1, p2] of segments) {
    drawGroundSegmentStrip(ctx, cam, p1, p2, HALF_WIDTH, "#242629");
  }
  for (const [p1, p2] of segments) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const offset = HALF_WIDTH + 2;
    drawGroundSegmentStrip(
      ctx, cam,
      { x: p1.x + nx * offset, y: p1.y + ny * offset },
      { x: p2.x + nx * offset, y: p2.y + ny * offset },
      1.6, "#8d8a7e"
    );
    drawGroundSegmentStrip(
      ctx, cam,
      { x: p1.x - nx * offset, y: p1.y - ny * offset },
      { x: p2.x - nx * offset, y: p2.y - ny * offset },
      1.6, "#8d8a7e"
    );
  }
}

/**
 * Flat ground-tint fill for one neighborhood's full bounding rect (Part
 * 4 -- "neighborhoods should have subtle identity differences"). Purely
 * a background wash so districts read as visually distinct areas at the
 * full-city establishing view; drawn before streets/lots/buildings, and
 * carries no domain meaning (color choice is a fixed palette index, not
 * derived from any simulation data -- see isometricAdapter.ts's
 * neighborhoodTint).
 */
export function drawNeighborhoodGround(ctx: any, cam: Camera, hood: { x: number; y: number; w: number; h: number }, color: string) {
  const corners = [
    projectIso(hood.x, hood.y, 0),
    projectIso(hood.x + hood.w, hood.y, 0),
    projectIso(hood.x + hood.w, hood.y + hood.h, 0),
    projectIso(hood.x, hood.y + hood.h, 0),
  ];
  ctx.beginPath();
  corners.forEach((p: ScreenPoint, i: number) => {
    const s = toScreen(p, cam);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Neighborhood name label, anchored near a district's top-left corner
 * (same corner CityCanvas.tsx's top-down district header uses) -- fixed
 * screen-space font size regardless of zoom, matching every other
 * chrome label in this renderer (WHY card, delta badges). */
export function drawNeighborhoodLabel(ctx: any, cam: Camera, hood: { x: number; y: number; name: string }) {
  const s = toScreen(projectIso(hood.x + 10, hood.y + 4, 0), cam);
  ctx.save();
  ctx.fillStyle = "rgba(180, 180, 180, 0.5)";
  ctx.font = "700 12px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "top";
  ctx.fillText(hood.name.toUpperCase(), s.x, s.y);
  ctx.restore();
}

export function drawGroundShadow(ctx: any, cam: Camera, anchor: ScreenPoint, rx: number, ry: number) {
  const s = toScreen(anchor, cam);
  ctx.save();
  ctx.fillStyle = "rgba(15, 20, 15, 0.28)";
  ctx.beginPath();
  ctx.ellipse(s.x, s.y, rx * cam.scale, ry * cam.scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function lerpPt(a: ScreenPoint, b: ScreenPoint, t: number): ScreenPoint {
  return { sx: a.sx + (b.sx - a.sx) * t, sy: a.sy + (b.sy - a.sy) * t };
}
function raise(p: ScreenPoint, dz: number): ScreenPoint {
  return { sx: p.sx, sy: p.sy - dz };
}
function toneShift(hex: string, tone: number): string {
  // Cheap deterministic lighten/darken by re-parsing the hex and nudging
  // each channel toward white (tone>0) or black (tone<0) -- purely
  // cosmetic per-building variance, not a real lighting model.
  const n = parseInt(hex.replace("#", ""), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, bl = n & 255;
  const amt = tone * 26;
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  bl = Math.max(0, Math.min(255, bl + amt));
  return `rgb(${r | 0}, ${g | 0}, ${bl | 0})`;
}

/**
 * Draws one full isometric building volume. The wall/roof primitives are
 * shared, but the roof + roofline detail branch on `b.archetype.roofStyle`
 * (see isometricAdapter.ts) so a house, office block, shop, and open
 * pavilion each read as a distinct kind of structure rather than the same
 * box with a different paint color -- residential gets a pitched gable +
 * chimney, workplace a flat roof + parapet + rooftop unit, market a flat
 * roof + street-facing awning + hanging sign, leisure an open pillared
 * canopy with no solid walls.
 */
export function drawBuilding(ctx: any, cam: Camera, b: IsoBuilding) {
  const pal = paletteFor(b.venueKind, b.loc.type);
  const { floor, roof, archetype } = b;
  const wall = toneShift(pal.wall, archetype.tone);
  const wallShade = toneShift(pal.wallShade, archetype.tone);

  if (archetype.roofStyle === "pavilion") {
    drawPavilion(ctx, cam, b, pal);
    return;
  }
  if (archetype.roofStyle === "plaza") {
    drawPlaza(ctx, cam, b, pal);
    return;
  }

  // Entrance apron / service pavement, drawn before the walls so it
  // sits flat on the ground behind the building's silhouette -- a
  // workplace's loading/service strip is a cooler gray, a market's
  // pedestrian apron a warmer stone tone, so the two still read as
  // different kinds of place even though both are "pavement near a
  // door" in the abstract.
  if (archetype.roofStyle === "flat" || archetype.roofStyle === "mansard") {
    drawEntranceApron(ctx, cam, b, "rgba(120, 128, 138, 0.55)");
  } else if (archetype.roofStyle === "awning") {
    drawEntranceApron(ctx, cam, b, "rgba(168, 150, 120, 0.55)");
  } else if (archetype.roofStyle === "sawtooth") {
    drawEntranceApron(ctx, cam, b, "rgba(90, 88, 82, 0.6)");
  } else if (archetype.roofStyle === "arch") {
    drawEntranceApron(ctx, cam, b, "rgba(196, 184, 150, 0.55)");
  }

  // Right wall: floor.right -> floor.front -> roof.front -> roof.right
  poly(ctx, cam, [floor.right, floor.front, roof.front, roof.right]);
  ctx.fillStyle = wallShade;
  ctx.fill();

  // Left wall: floor.left -> floor.front -> roof.front -> roof.left
  poly(ctx, cam, [floor.left, floor.front, roof.front, roof.left]);
  ctx.fillStyle = wall;
  ctx.fill();

  const venueKind = b.venueKind;
  const isWorkshop = venueKind === "workshop";

  if (archetype.roofStyle === "gable") {
    if (archetype.variant === 1) drawHipRoof(ctx, cam, b, pal);
    else drawGableRoof(ctx, cam, b, pal);
    if (venueKind === "family_house") drawPorch(ctx, cam, b, pal);
    if (venueKind === "townhouse") drawRowhouseBands(ctx, cam, b, pal);
  } else if (archetype.roofStyle === "mansard") {
    drawMansardRoof(ctx, cam, b, pal);
  } else if (archetype.roofStyle === "sawtooth") {
    drawSawtoothRoof(ctx, cam, b, pal);
  } else if (archetype.roofStyle === "arch") {
    drawArchRoof(ctx, cam, b, pal);
  } else if (archetype.roofStyle === "awning") {
    drawFlatRoof(ctx, cam, b, pal);
    drawStorefrontGlazing(ctx, cam, b);
    if (venueKind !== "cafe") drawAwning(ctx, cam, b, pal);
    else drawCafeAwning(ctx, cam, b, pal);
  } else {
    drawFlatRoof(ctx, cam, b, pal);
    drawRooftopUnit(ctx, cam, b);
    if (archetype.variant === 1) drawSetbackTier(ctx, cam, b, pal);
  }

  // Windows: a couple of small lit squares on each visible wall,
  // purely decorative, deterministic by building id so they don't
  // flicker between frames. Office gets a denser glazed grid instead --
  // the "glass office tower" cue -- and small_apartment gets an extra
  // window row per visible floor since it's a taller, multi-unit block.
  if (venueKind === "office") {
    drawGlassGrid(ctx, cam, b, "right");
    drawGlassGrid(ctx, cam, b, "left");
  } else {
    drawWindows(ctx, cam, b, "right");
    drawWindows(ctx, cam, b, "left");
  }

  // Ground-floor entrance on the front-facing wall corner. Workshop gets
  // a wide roll-up garage door instead of a house-scale door -- the
  // single strongest "this is industrial, not office" cue short of the
  // sawtooth roofline itself.
  const doorBase = toScreen(floor.front, cam);
  const doorW = isWorkshop ? 14 * cam.scale : 5.4 * cam.scale;
  const doorH = isWorkshop ? 12 * cam.scale : 9.5 * cam.scale;
  if (isWorkshop) {
    drawGarageDoor(ctx, cam, b);
  } else {
    ctx.fillStyle = "#3a2a1a";
    ctx.fillRect(doorBase.x - doorW / 2, doorBase.y - doorH, doorW, doorH);
    // Doorknob
    ctx.fillStyle = "#d9b968";
    ctx.beginPath();
    ctx.arc(doorBase.x + doorW * 0.28, doorBase.y - doorH * 0.5, Math.max(0.6, 0.8 * cam.scale), 0, Math.PI * 2);
    ctx.fill();
  }

  // Clinic: a small red cross badge above the entrance -- the clearest
  // possible "this workplace is medical" cue, since a plain flat-roof
  // block is otherwise ambiguous between clinic/service_office.
  if (venueKind === "clinic") {
    drawCrossSign(ctx, cam, b);
  }

  // Cafe: a small outdoor table + two stools by the entrance, since a
  // cafe's defining cue (street seating) isn't a roof/wall feature at all.
  if (venueKind === "cafe") {
    drawOutdoorTable(ctx, cam, b);
  }

  // Community center: a flagpole beside the entrance -- the civic-building
  // cue that distinguishes it from a private/commercial arch-roofed block.
  if (venueKind === "community_center") {
    drawFlagpole(ctx, cam, b);
  }

  // Residential: a perimeter yard fence/hedge on roughly half of houses
  // (small_apartment/townhouse skip this -- multi-unit buildings read as
  // fronting the street directly, not as a single fenced yard).
  if (b.loc.type === "residential" && archetype.hasFence && venueKind !== "small_apartment" && venueKind !== "townhouse") {
    drawYardFence(ctx, cam, b);
  }

  // Workplaces are the tallest, plainest archetype (flat roof, no gable/
  // awning silhouette to break up the mass) and the closeup render check
  // confirmed they read as a plain rotated box even with windows+door+AC
  // unit. Two more cues, both real architectural signals rather than
  // decoration: (1) a floor-division ledge partway up each wall, so a
  // 2-3 story building actually reads as having stories instead of one
  // undifferentiated slab, and (2) a signage plate above the entrance,
  // since a workplace without any signage is indistinguishable from a
  // house that just happens to be taller.
  if (archetype.roofStyle === "flat" || archetype.roofStyle === "sawtooth") {
    const ledgeT = 0.42;
    const ledgeR = raise(lerpPt(floor.right, roof.right, ledgeT), 0);
    const ledgeFR = raise(lerpPt(floor.front, roof.front, ledgeT), 0);
    const ledgeL = raise(lerpPt(floor.left, roof.left, ledgeT), 0);
    const lr = toScreen(ledgeR, cam);
    const lfr = toScreen(ledgeFR, cam);
    const ll = toScreen(ledgeL, cam);
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = Math.max(1, 1.1 * cam.scale);
    ctx.beginPath();
    ctx.moveTo(lr.x, lr.y);
    ctx.lineTo(lfr.x, lfr.y);
    ctx.lineTo(ll.x, ll.y);
    ctx.stroke();

    // Signage plate, enlarged and given a colored accent bar (was a
    // near-invisible pale rectangle in the previous pass) so it actually
    // reads as signage rather than a smudge above the door.
    const signW = Math.max(14, doorW * 3.2);
    const signH = Math.max(4.5, doorH * 0.38);
    const signY = doorBase.y - doorH - signH - 2.5 * cam.scale;
    ctx.fillStyle = "#eef1f4";
    ctx.fillRect(doorBase.x - signW / 2, signY, signW, signH);
    ctx.strokeStyle = "#33404d";
    ctx.lineWidth = Math.max(0.6, 0.7 * cam.scale);
    ctx.strokeRect(doorBase.x - signW / 2, signY, signW, signH);
    ctx.fillStyle = toneShift(pal.roof, 0.15);
    ctx.fillRect(doorBase.x - signW / 2, signY, signW * 0.22, signH);
  }
}

function drawFlatRoof(ctx: any, cam: Camera, b: IsoBuilding, pal: { roof: string; trim: string }) {
  const { roof } = b;
  poly(ctx, cam, [roof.back, roof.right, roof.front, roof.left]);
  ctx.fillStyle = pal.roof;
  ctx.fill();
  ctx.strokeStyle = pal.trim;
  ctx.lineWidth = Math.max(1, 1.2 * cam.scale);
  ctx.stroke();
}

/** A smaller inset second volume stacked on top of the main flat-roof
 * block, its own walls+flat roof drawn independently -- gives a
 * workplace building genuinely varied massing (a stepped-back upper
 * level, like a real office building's massing break) rather than only
 * varying a single box's height. Selected by archetype.variant so only
 * some workplaces get it. */
function drawSetbackTier(ctx: any, cam: Camera, b: IsoBuilding, pal: { wall: string; wallShade: string; roof: string; trim: string }) {
  const fp = footprintRect(b.loc);
  const insetFrac = 0.24;
  const ix = fp.w * insetFrac;
  const iy = fp.h * insetFrac;
  const x0 = fp.x + ix,
    x1 = fp.x + fp.w - ix;
  const y0 = fp.y + iy,
    y1 = fp.y + fp.h - iy;
  const baseZ = b.height;
  const tierH = Math.max(18, b.height * 0.34);
  const back = projectIso(x0, y0, baseZ);
  const right = projectIso(x1, y0, baseZ);
  const front = projectIso(x1, y1, baseZ);
  const left = projectIso(x0, y1, baseZ);
  const rBack = projectIso(x0, y0, baseZ + tierH);
  const rRight = projectIso(x1, y0, baseZ + tierH);
  const rFront = projectIso(x1, y1, baseZ + tierH);
  const rLeft = projectIso(x0, y1, baseZ + tierH);

  poly(ctx, cam, [right, front, rFront, rRight]);
  ctx.fillStyle = toneShift(pal.wallShade, b.archetype.tone);
  ctx.fill();
  poly(ctx, cam, [left, front, rFront, rLeft]);
  ctx.fillStyle = toneShift(pal.wall, b.archetype.tone);
  ctx.fill();

  poly(ctx, cam, [rBack, rRight, rFront, rLeft]);
  ctx.fillStyle = pal.roof;
  ctx.fill();
  ctx.strokeStyle = pal.trim;
  ctx.lineWidth = Math.max(1, 1 * cam.scale);
  ctx.stroke();
}

/** A paved rectangle at ground level just in front of a building's
 * entrance -- distinct from the surrounding lot color, reading as a
 * service/loading area (workplace) or pedestrian storefront apron
 * (market) rather than the entrance opening directly onto plain grass. */
function drawEntranceApron(ctx: any, cam: Camera, b: IsoBuilding, color: string) {
  const fp = footprintRect(b.loc);
  const depth = 20;
  const inset = fp.w * 0.1;
  const corners = [
    projectIso(fp.x + inset, fp.y + fp.h, 0),
    projectIso(fp.x + fp.w - inset, fp.y + fp.h, 0),
    projectIso(fp.x + fp.w - inset, fp.y + fp.h + depth, 0),
    projectIso(fp.x + inset, fp.y + fp.h + depth, 0),
  ];
  poly(ctx, cam, corners);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Large storefront glazing band on a market's lower front-left wall --
 * reads as a shop window rather than the same small punched windows a
 * house or office uses, the single strongest "this is commercial" cue
 * short of the awning itself. */
function drawStorefrontGlazing(ctx: any, cam: Camera, b: IsoBuilding) {
  const { floor, roof } = b;
  const bandTop = 0.62; // fraction up the wall where glazing stops
  const a = floor.left;
  const c = lerpPt(floor.left, roof.left, bandTop);
  const f = floor.front;
  const rf = lerpPt(floor.front, roof.front, bandTop);
  const inset = 0.14;
  const p0 = lerpPt(a, f, inset);
  const p1 = lerpPt(a, f, 1 - inset * 0.4);
  const p0t = lerpPt(c, rf, inset);
  const p1t = lerpPt(c, rf, 1 - inset * 0.4);
  poly(ctx, cam, [p0, p1, p1t, p0t]);
  ctx.fillStyle = "rgba(180, 215, 225, 0.55)";
  ctx.fill();
  ctx.strokeStyle = "rgba(40, 30, 20, 0.5)";
  ctx.lineWidth = Math.max(1, 1 * cam.scale);
  ctx.stroke();
  // Mullion dividing the glazing into two panes.
  const mid0 = lerpPt(p0, p1, 0.5);
  const mid1 = lerpPt(p0t, p1t, 0.5);
  const m0 = toScreen(mid0, cam);
  const m1 = toScreen(mid1, cam);
  ctx.beginPath();
  ctx.moveTo(m0.x, m0.y);
  ctx.lineTo(m1.x, m1.y);
  ctx.stroke();
}

/** Pitched gable roof: the flat roof quad is replaced by two sloped
 * planes meeting at a raised ridge line, plus a small chimney -- the
 * silhouette cue that reads as "house" at a glance. */
function drawGableRoof(ctx: any, cam: Camera, b: IsoBuilding, pal: { roof: string; wallShade: string; trim: string }) {
  const { roof, height } = b;
  const ridgeRise = Math.max(10, height * 0.32);
  const ridgeLeft = raise(lerpPt(roof.back, roof.left, 0.5), ridgeRise);
  const ridgeRight = raise(lerpPt(roof.right, roof.front, 0.5), ridgeRise);

  // Slope 1 (back+right half) -- catches more "light" in this fixed
  // projection, drawn in the base roof color.
  poly(ctx, cam, [roof.back, roof.right, ridgeRight, ridgeLeft]);
  ctx.fillStyle = pal.roof;
  ctx.fill();
  ctx.strokeStyle = pal.trim;
  ctx.lineWidth = Math.max(1, 1.1 * cam.scale);
  ctx.stroke();

  // Slope 2 (left+front half) -- shaded darker so the ridge itself
  // reads as a visible fold rather than a seam.
  poly(ctx, cam, [roof.left, roof.front, ridgeRight, ridgeLeft]);
  ctx.fillStyle = toneShift(pal.roof, -0.55);
  ctx.fill();
  ctx.stroke();

  // Ridge line + small chimney near the right end.
  const rl = toScreen(ridgeLeft, cam);
  const rr = toScreen(ridgeRight, cam);
  ctx.strokeStyle = pal.trim;
  ctx.lineWidth = Math.max(1, 1 * cam.scale);
  ctx.beginPath();
  ctx.moveTo(rl.x, rl.y);
  ctx.lineTo(rr.x, rr.y);
  ctx.stroke();

  const chimneyBase = lerpPt(ridgeLeft, ridgeRight, 0.72);
  const cBase = toScreen(chimneyBase, cam);
  const cTop = toScreen(raise(chimneyBase, 12), cam);
  const cw = Math.max(2, 3.2 * cam.scale);
  ctx.fillStyle = "#7a5230";
  ctx.fillRect(cBase.x - cw / 2, cTop.y, cw, cBase.y - cTop.y);
}

/** Hip roof: all four eaves slope up to a short ridge (rather than the
 * gable's two full-width slopes) -- a second, genuinely different
 * residential silhouette (not just a recolor) so two neighboring houses
 * can look structurally different, not just differently painted.
 * Selected by `archetype.variant` in drawBuilding. */
function drawHipRoof(ctx: any, cam: Camera, b: IsoBuilding, pal: { roof: string; wallShade: string; trim: string }) {
  const { roof, height } = b;
  const ridgeRise = Math.max(8, height * 0.24);
  const fullLeft = raise(lerpPt(roof.back, roof.left, 0.5), ridgeRise);
  const fullRight = raise(lerpPt(roof.right, roof.front, 0.5), ridgeRise);
  // Shortened ridge -- inset from both ends -- is what turns a gable
  // into a hip: the two "missing" triangular hip-end faces (below) fill
  // in the space a full-width ridge would have left open.
  const ridgeLeft = lerpPt(fullLeft, fullRight, 0.3);
  const ridgeRight = lerpPt(fullLeft, fullRight, 0.7);

  poly(ctx, cam, [roof.back, roof.right, ridgeRight, ridgeLeft]);
  ctx.fillStyle = pal.roof;
  ctx.fill();
  ctx.strokeStyle = pal.trim;
  ctx.lineWidth = Math.max(1, 1.1 * cam.scale);
  ctx.stroke();

  poly(ctx, cam, [roof.left, roof.front, ridgeRight, ridgeLeft]);
  ctx.fillStyle = toneShift(pal.roof, -0.55);
  ctx.fill();
  ctx.stroke();

  // Hip ends: triangular slopes closing off each end where a gable
  // would instead have a vertical wall.
  poly(ctx, cam, [roof.back, roof.left, ridgeLeft]);
  ctx.fillStyle = toneShift(pal.roof, -0.22);
  ctx.fill();
  ctx.stroke();
  poly(ctx, cam, [roof.right, roof.front, ridgeRight]);
  ctx.fillStyle = toneShift(pal.roof, -0.3);
  ctx.fill();
  ctx.stroke();

  const rl = toScreen(ridgeLeft, cam);
  const rr = toScreen(ridgeRight, cam);
  ctx.strokeStyle = pal.trim;
  ctx.lineWidth = Math.max(1, 1 * cam.scale);
  ctx.beginPath();
  ctx.moveTo(rl.x, rl.y);
  ctx.lineTo(rr.x, rr.y);
  ctx.stroke();
}

/** Low perimeter fence/hedge along a residential lot's front edge --
 * present on roughly half of houses (archetype.hasFence), so a street
 * of houses reads as individually-tended yards rather than a uniform
 * template. Alternates a simple picket-fence look and a clipped-hedge
 * look by the same seed, for a little more variety still. */
// ---------------------------------------------------------------------
// Phase 1 (Building Identity) -- new roof geometry + accent details.
//
// Each function below is only ever called for buildings whose
// archetype.roofStyle (derived from venue_kind, see isometricAdapter.ts's
// VENUE_ROOF_STYLE) selects it, so a mansard roof only ever appears on a
// small_apartment, a sawtooth roof only on a workshop, etc. -- these are
// structural silhouette differences, not palette swaps.
// ---------------------------------------------------------------------

/** Small_apartment's roof: a short, steeply-sloped mansard band capping
 * a taller flat-topped block, plus an extra mid-wall ledge (on top of
 * drawBuilding's own workplace ledge, which this building doesn't get
 * since it's roofStyle "mansard" not "flat") so the building reads as
 * having multiple floors -- the "this is a small apartment building,
 * not a tall house" cue. Distinct from drawSetbackTier's stepped-back
 * upper volume: a mansard slopes inward on all four sides to a smaller
 * flat cap, it doesn't step to a second full volume. */
function drawMansardRoof(ctx: any, cam: Camera, b: IsoBuilding, pal: { roof: string; trim: string }) {
  const fp = footprintRect(b.loc);
  const baseZ = b.height;
  const capH = Math.max(10, baseZ * 0.28);
  const inset = 0.24;
  const insetX = fp.w * inset;
  const insetY = fp.h * inset;
  const x0 = fp.x, x1 = fp.x + fp.w, y0 = fp.y, y1 = fp.y + fp.h;
  const cx0 = x0 + insetX, cx1 = x1 - insetX, cy0 = y0 + insetY, cy1 = y1 - insetY;

  const roofBack = projectIso(x0, y0, baseZ);
  const roofRight = projectIso(x1, y0, baseZ);
  const roofFront = projectIso(x1, y1, baseZ);
  const roofLeft = projectIso(x0, y1, baseZ);
  const capBack = projectIso(cx0, cy0, baseZ + capH);
  const capRight = projectIso(cx1, cy0, baseZ + capH);
  const capFront = projectIso(cx1, cy1, baseZ + capH);
  const capLeft = projectIso(cx0, cy1, baseZ + capH);

  // Far two faces (back-right, back-left) are drawn FIRST -- without a
  // real z-buffer, a naive draw order lets whichever face is drawn last
  // paint over everything else on screen even if it's the "far" side of
  // the frustum, which is exactly the bug an earlier version of this
  // function had (the far faces, drawn last, were blotting out the near
  // faces entirely, making the roof read as one flat slope instead of a
  // mansard). Drawing far-then-near, matching the painter's-algorithm
  // convention every other multi-face roof in this file already uses,
  // fixes that.
  poly(ctx, cam, [roofBack, roofRight, capRight, capBack]);
  ctx.fillStyle = toneShift(pal.roof, -0.2);
  ctx.fill();
  ctx.strokeStyle = pal.trim;
  ctx.lineWidth = Math.max(1, cam.scale);
  ctx.stroke();
  poly(ctx, cam, [roofBack, roofLeft, capLeft, capBack]);
  ctx.fillStyle = toneShift(pal.roof, -0.55);
  ctx.fill();
  ctx.stroke();

  // Near two faces (right-front, left-front) drawn second -- these are
  // the primary visible slopes.
  poly(ctx, cam, [roofRight, roofFront, capFront, capRight]);
  ctx.fillStyle = toneShift(pal.roof, -0.05);
  ctx.fill();
  ctx.stroke();
  poly(ctx, cam, [roofLeft, roofFront, capFront, capLeft]);
  ctx.fillStyle = toneShift(pal.roof, -0.4);
  ctx.fill();
  ctx.stroke();

  // Flat cap, drawn last so it sits on top of all four slopes.
  poly(ctx, cam, [capBack, capRight, capFront, capLeft]);
  ctx.fillStyle = toneShift(pal.roof, 0.15);
  ctx.fill();
  ctx.stroke();

  // Extra mid-wall ledge line (small_apartment doesn't pass through
  // drawBuilding's own "flat"-only ledge branch) so the taller block
  // clearly reads as multi-story.
  for (const t of [0.32, 0.66]) {
    const lr = toScreen(lerpPt(b.floor.right, b.roof.right, t), cam);
    const lfr = toScreen(lerpPt(b.floor.front, b.roof.front, t), cam);
    const ll = toScreen(lerpPt(b.floor.left, b.roof.left, t), cam);
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = Math.max(1, cam.scale);
    ctx.beginPath();
    ctx.moveTo(lr.x, lr.y);
    ctx.lineTo(lfr.x, lfr.y);
    ctx.lineTo(ll.x, ll.y);
    ctx.stroke();
  }
}

/** Workshop's roof: a low, wide industrial shed with 2-3 sawtooth
 * skylight ridges running across the flat roof plane -- the classic
 * factory-floor silhouette, unmistakably different from any office/
 * house/shop roof in this renderer.
 *
 * Built entirely in plan space (world x/y/z), like drawAwning, rather
 * than by lerping already-projected screen points -- an earlier version
 * interpolated between roof.back and roof.front, which are DIAGONALLY
 * opposite corners of the footprint rectangle, not an edge, producing
 * self-intersecting "bowtie" quads (visible as the torn/overlapping
 * triangle artifact in the first render-check pass). Interpolating along
 * two actual parallel plan-space edges (the left edge x=x0 and the right
 * edge x=x1, both varying y) avoids that entirely. */
function drawSawtoothRoof(ctx: any, cam: Camera, b: IsoBuilding, pal: { roof: string; trim: string }) {
  const fp = footprintRect(b.loc);
  const baseZ = b.height;
  const teeth = 3;
  const toothH = Math.max(6, baseZ * 0.22);
  const xL = fp.x, xR = fp.x + fp.w;

  // Base roof plane the teeth sit on -- also what's visible at the very
  // front edge beyond the last tooth.
  poly(ctx, cam, [projectIso(xL, fp.y, baseZ), projectIso(xR, fp.y, baseZ), projectIso(xR, fp.y + fp.h, baseZ), projectIso(xL, fp.y + fp.h, baseZ)]);
  ctx.fillStyle = toneShift(pal.roof, -0.3);
  ctx.fill();
  ctx.strokeStyle = pal.trim;
  ctx.lineWidth = Math.max(1, cam.scale);
  ctx.stroke();

  // Teeth drawn back-to-front (increasing y), matching this projection's
  // painter's-algorithm convention (larger x+y = nearer = drawn later),
  // so each tooth correctly sits in front of the previous one.
  for (let i = 0; i < teeth; i++) {
    const y0 = fp.y + (fp.h * i) / teeth;
    const y1 = fp.y + (fp.h * (i + 1)) / teeth;
    const ridgeL = projectIso(xL, y0, baseZ + toothH);
    const ridgeR = projectIso(xR, y0, baseZ + toothH);
    const baseL0 = projectIso(xL, y0, baseZ);
    const baseR0 = projectIso(xR, y0, baseZ);
    const baseL1 = projectIso(xL, y1, baseZ);
    const baseR1 = projectIso(xR, y1, baseZ);

    // Vertical glazed face (the "skylight") at this tooth's back edge.
    poly(ctx, cam, [baseL0, baseR0, ridgeR, ridgeL]);
    ctx.fillStyle = "rgba(190, 215, 225, 0.55)";
    ctx.fill();
    ctx.strokeStyle = pal.trim;
    ctx.stroke();
    // Sloped back of the tooth, down to the next tooth's base.
    poly(ctx, cam, [ridgeL, ridgeR, baseR1, baseL1]);
    ctx.fillStyle = toneShift(pal.roof, -0.1 - i * 0.08);
    ctx.fill();
    ctx.stroke();
  }
}

/** Community_center's roof: a barrel-vault approximation -- several
 * parallel curved-shading strips across the roof plane, capped by a
 * pediment-style raised front edge -- reading as a civic hall, distinct
 * from every flat/gable/pavilion silhouette elsewhere in this set. */
function drawArchRoof(ctx: any, cam: Camera, b: IsoBuilding, pal: { roof: string; trim: string }) {
  const { roof, height } = b;
  const rise = Math.max(10, height * 0.3);
  const strips = 5;
  for (let i = 0; i < strips; i++) {
    const t0 = i / strips;
    const t1 = (i + 1) / strips;
    // Approximate a curve with a per-strip rise following a sine profile.
    const mid0 = (t0 + t1) / 2;
    const curveRise = rise * Math.sin(Math.PI * mid0);
    const l0 = raise(lerpPt(roof.back, roof.left, t0), curveRise);
    const l1 = raise(lerpPt(roof.back, roof.left, t1), curveRise);
    const r0 = raise(lerpPt(roof.right, roof.front, t0), curveRise);
    const r1 = raise(lerpPt(roof.right, roof.front, t1), curveRise);
    poly(ctx, cam, [l0, r0, r1, l1]);
    ctx.fillStyle = toneShift(pal.roof, 0.25 - i * 0.14);
    ctx.fill();
    ctx.strokeStyle = pal.trim;
    ctx.lineWidth = Math.max(1, cam.scale);
    ctx.stroke();
  }
  // Raised pediment triangle over the front entrance -- a civic-hall
  // portico cue.
  const pedW = 0.5;
  const p0 = lerpPt(roof.left, roof.front, 0.5 - pedW / 2);
  const p1 = lerpPt(roof.left, roof.front, 0.5 + pedW / 2);
  const apex = raise(lerpPt(p0, p1, 0.5), rise * 0.55);
  poly(ctx, cam, [p0, p1, apex]);
  ctx.fillStyle = toneShift(pal.roof, 0.35);
  ctx.fill();
  ctx.strokeStyle = pal.trim;
  ctx.stroke();
}

/** Small_plaza: no building volume at all -- a paved civic plaza with a
 * central fountain, radial paving pattern, and a couple of benches. This
 * is the strongest "public space, not a building" cue in the whole set,
 * directly answering the acceptance test's "parks/public spaces must not
 * look like generic buildings" requirement -- a plaza and a park (open
 * pavilion) are also visually distinct from each other: a park is green
 * and treed with a pavilion roof, a plaza is paved stone with a fountain
 * and open sky. */
function drawPlaza(ctx: any, cam: Camera, b: IsoBuilding, pal: { roof: string; trim: string }) {
  const fp = footprintRect(b.loc);
  const cx = fp.x + fp.w / 2;
  const cy = fp.y + fp.h / 2;

  // Paved plaza surface, larger than a normal footprint since it's the
  // entire usable lot, not a building silhouette.
  const pad = 18;
  const corners = [
    projectIso(fp.x - pad, fp.y - pad, 0),
    projectIso(fp.x + fp.w + pad, fp.y - pad, 0),
    projectIso(fp.x + fp.w + pad, fp.y + fp.h + pad, 0),
    projectIso(fp.x - pad, fp.y + fp.h + pad, 0),
  ];
  poly(ctx, cam, corners);
  ctx.fillStyle = "#b8a888";
  ctx.fill();

  // Radial paving rings around the fountain, alternating tone, so the
  // ground itself reads as a designed plaza rather than a plain slab.
  const centerScreen = toScreen(projectIso(cx, cy, 0), cam);
  for (let ring = 3; ring >= 1; ring--) {
    ctx.beginPath();
    ctx.ellipse(centerScreen.x, centerScreen.y, ring * 16 * cam.scale, ring * 9 * cam.scale, 0, 0, Math.PI * 2);
    ctx.fillStyle = ring % 2 === 0 ? "#a8967a" : "#c2b090";
    ctx.fill();
  }

  // Fountain: a raised basin (short cylinder) with a water disc and a
  // small central jet.
  const basinTop = toScreen(projectIso(cx, cy, 6), cam);
  const basinR = Math.max(10, 14 * cam.scale);
  ctx.fillStyle = pal.trim;
  ctx.beginPath();
  ctx.ellipse(centerScreen.x, centerScreen.y, basinR, basinR * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pal.roof; // "#6bb0c9" water-blue from small_plaza's palette
  ctx.beginPath();
  ctx.ellipse(basinTop.x, basinTop.y, basinR * 0.82, basinR * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  const jetTop = toScreen(projectIso(cx, cy, 20), cam);
  ctx.strokeStyle = "rgba(210, 240, 245, 0.8)";
  ctx.lineWidth = Math.max(1, 1.4 * cam.scale);
  ctx.beginPath();
  ctx.moveTo(basinTop.x, basinTop.y);
  ctx.lineTo(jetTop.x, jetTop.y);
  ctx.stroke();

  // A couple of benches facing the fountain.
  const benchOffsets: [number, number][] = [
    [cx - fp.w * 0.38, cy],
    [cx + fp.w * 0.38, cy],
  ];
  for (const [bx, by] of benchOffsets) {
    const s = toScreen(projectIso(bx, by, 0), cam);
    const w = Math.max(7, 11 * cam.scale);
    const h = Math.max(2.4, 3.4 * cam.scale);
    ctx.fillStyle = "#6b4a2e";
    ctx.fillRect(s.x - w / 2, s.y - h / 2, w, h);
  }

  drawGroundShadow(ctx, cam, projectIso(cx, cy + fp.h * 0.12, 0) as unknown as ScreenPoint, 40, 18);
}

/** Family_house-only: a small open porch roof projecting over the front
 * door, on its own short posts -- distinguishes the larger family home
 * from a plain detached_house without changing the base gable/hip roof
 * function both share. */
function drawPorch(ctx: any, cam: Camera, b: IsoBuilding, pal: { roof: string; trim: string }) {
  const fp = footprintRect(b.loc);
  const depth = Math.min(16, fp.h * 0.22);
  const porchH = Math.max(12, b.height * 0.5);
  const inset = fp.w * 0.24;
  const nearL = projectIso(fp.x + inset, fp.y + fp.h, porchH);
  const nearR = projectIso(fp.x + fp.w - inset, fp.y + fp.h, porchH);
  const farL = projectIso(fp.x + inset, fp.y + fp.h + depth, porchH * 0.94);
  const farR = projectIso(fp.x + fp.w - inset, fp.y + fp.h + depth, porchH * 0.94);
  poly(ctx, cam, [nearL, nearR, farR, farL]);
  ctx.fillStyle = toneShift(pal.roof, -0.15);
  ctx.fill();
  ctx.strokeStyle = pal.trim;
  ctx.lineWidth = Math.max(1, cam.scale);
  ctx.stroke();
  // Two support posts down to the ground.
  const postGroundL = projectIso(fp.x + inset, fp.y + fp.h + depth, 0);
  const postGroundR = projectIso(fp.x + fp.w - inset, fp.y + fp.h + depth, 0);
  for (const [top, bottom] of [
    [farL, postGroundL],
    [farR, postGroundR],
  ] as [ScreenPoint, ScreenPoint][]) {
    const pTop = toScreen(top, cam);
    const pBottom = toScreen(bottom, cam);
    ctx.strokeStyle = pal.trim;
    ctx.lineWidth = Math.max(1, 1.4 * cam.scale);
    ctx.beginPath();
    ctx.moveTo(pTop.x, pTop.y);
    ctx.lineTo(pBottom.x, pBottom.y);
    ctx.stroke();
  }
}

/** Townhouse-only: 1-2 vertical seam lines on the front-left wall,
 * suggesting adjoining attached units -- the "this reads as a row of
 * attached homes, not one detached house" cue, paired with townhouse's
 * narrow/deep VENUE_SHAPE proportions. */
function drawRowhouseBands(ctx: any, cam: Camera, b: IsoBuilding, pal: { trim: string }) {
  const { floor, roof } = b;
  for (const t of [0.34, 0.67]) {
    const bottom = toScreen(lerpPt(floor.left, floor.front, t), cam);
    const top = toScreen(lerpPt(roof.left, roof.front, t), cam);
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = Math.max(1, 1.3 * cam.scale);
    ctx.beginPath();
    ctx.moveTo(bottom.x, bottom.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
  }
}

/** Cafe-only: a small, single-panel scalloped awning (narrower and
 * plainer than the full striped shop awning grocery/general_store use)
 * -- a cafe's canopy reads as a cozy storefront accent, not a wide
 * pedestrian arcade. */
function drawCafeAwning(ctx: any, cam: Camera, b: IsoBuilding, pal: { trim: string }) {
  const fp = footprintRect(b.loc);
  const awningDepth = Math.min(14, fp.h * 0.24);
  const awningH = Math.max(14, b.height * 0.5);
  const inset = fp.w * 0.22;
  const nearL = projectIso(fp.x + inset, fp.y + fp.h, awningH);
  const nearR = projectIso(fp.x + fp.w - inset, fp.y + fp.h, awningH);
  const farL = projectIso(fp.x + inset, fp.y + fp.h + awningDepth, awningH * 0.78);
  const farR = projectIso(fp.x + fp.w - inset, fp.y + fp.h + awningDepth, awningH * 0.78);
  poly(ctx, cam, [nearL, nearR, farR, farL]);
  ctx.fillStyle = "#8a5a3c";
  ctx.fill();
  ctx.strokeStyle = pal.trim;
  ctx.lineWidth = Math.max(0.8, cam.scale);
  ctx.stroke();
  // Scalloped front edge -- small semicircle bumps along the near edge.
  const pNL = toScreen(nearL, cam);
  const pNR = toScreen(nearR, cam);
  const scallops = 4;
  ctx.fillStyle = "#f5efe4";
  for (let i = 0; i < scallops; i++) {
    const t0 = i / scallops;
    const t1 = (i + 1) / scallops;
    const mx = pNL.x + (pNR.x - pNL.x) * (t0 + t1) / 2;
    const my = pNL.y + (pNR.y - pNL.y) * (t0 + t1) / 2;
    ctx.beginPath();
    ctx.arc(mx, my, Math.max(1.6, 2.6 * cam.scale), 0, Math.PI);
    ctx.fill();
  }
}

/** Office-only: a denser grid of larger, blue-tinted windows covering
 * most of each visible wall -- the "glass curtain wall" cue that makes
 * an office read as taller/more corporate than a house-scale punched
 * window pattern (drawWindows, used by every other flat/gable venue). */
function drawGlassGrid(ctx: any, cam: Camera, b: IsoBuilding, side: "left" | "right") {
  const { floor, roof } = b;
  const a = side === "right" ? floor.right : floor.left;
  const c = side === "right" ? roof.right : roof.left;
  const f = floor.front;
  const rf = roof.front;
  const rows = 3;
  const cols = 3;
  for (let r = 0; r < rows; r++) {
    const tRow = (r + 0.5) / rows;
    for (let cI = 0; cI < cols; cI++) {
      const tCol = (cI + 0.5) / cols;
      const bx = a.sx + (f.sx - a.sx) * tCol;
      const by = a.sy + (f.sy - a.sy) * tCol;
      const tx = c.sx + (rf.sx - c.sx) * tCol;
      const ty = c.sy + (rf.sy - c.sy) * tCol;
      const wx = bx + (tx - bx) * tRow;
      const wy = by + (ty - by) * tRow;
      const s = toScreen({ sx: wx, sy: wy }, cam);
      const w = 6.5 * cam.scale;
      const h = 8 * cam.scale;
      ctx.fillStyle = "rgba(150, 205, 230, 0.75)";
      ctx.fillRect(s.x - w / 2, s.y - h / 2, w, h);
      ctx.strokeStyle = "rgba(40, 55, 65, 0.5)";
      ctx.lineWidth = Math.max(0.5, 0.6 * cam.scale);
      ctx.strokeRect(s.x - w / 2, s.y - h / 2, w, h);
    }
  }
}

/** Workshop-only: a wide roll-up garage door (segmented panel look)
 * instead of the standard house-scale door every other venue uses --
 * paired with the sawtooth roof, this is the clearest "industrial"
 * silhouette cue. */
function drawGarageDoor(ctx: any, cam: Camera, b: IsoBuilding) {
  const doorBase = toScreen(b.floor.front, cam);
  const w = 14 * cam.scale;
  const h = 12 * cam.scale;
  ctx.fillStyle = "#3a3a38";
  ctx.fillRect(doorBase.x - w / 2, doorBase.y - h, w, h);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = Math.max(0.6, 0.7 * cam.scale);
  const panels = 3;
  for (let i = 1; i < panels; i++) {
    const py = doorBase.y - h + (h * i) / panels;
    ctx.beginPath();
    ctx.moveTo(doorBase.x - w / 2, py);
    ctx.lineTo(doorBase.x + w / 2, py);
    ctx.stroke();
  }
  ctx.strokeRect(doorBase.x - w / 2, doorBase.y - h, w, h);
}

/** Clinic-only: a small red cross badge mounted above the entrance --
 * the single clearest "this is medical" cue on an otherwise plain
 * flat-roof block. */
function drawCrossSign(ctx: any, cam: Camera, b: IsoBuilding) {
  const doorBase = toScreen(b.floor.front, cam);
  const cx = doorBase.x;
  const cy = doorBase.y - 16 * cam.scale;
  const r = Math.max(3, 4.5 * cam.scale);
  ctx.fillStyle = "#f5f8f8";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#4f8f8a";
  ctx.lineWidth = Math.max(0.6, 0.8 * cam.scale);
  ctx.stroke();
  ctx.strokeStyle = "#d9433a";
  ctx.lineWidth = Math.max(1.2, 1.6 * cam.scale);
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, cy);
  ctx.lineTo(cx + r * 0.5, cy);
  ctx.moveTo(cx, cy - r * 0.5);
  ctx.lineTo(cx, cy + r * 0.5);
  ctx.stroke();
}

/** Cafe-only: a small round outdoor table with two stools beside the
 * entrance -- a cafe's defining cue is street seating, not a roof/wall
 * feature, so this is drawn as ground-level furniture instead. */
function drawOutdoorTable(ctx: any, cam: Camera, b: IsoBuilding) {
  const fp = footprintRect(b.loc);
  const wx = fp.x + fp.w * 0.82;
  const wy = fp.y + fp.h + 10;
  const s = toScreen(projectIso(wx, wy, 0), cam);
  drawGroundShadow(ctx, cam, projectIso(wx, wy, 0) as unknown as ScreenPoint, 6, 3);
  ctx.fillStyle = "#5c3b26";
  const legTop = toScreen(projectIso(wx, wy, 6), cam);
  ctx.strokeStyle = "#5c3b26";
  ctx.lineWidth = Math.max(1, 1.1 * cam.scale);
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(legTop.x, legTop.y);
  ctx.stroke();
  const r = Math.max(3.5, 5 * cam.scale);
  ctx.fillStyle = "#e8d9b8";
  ctx.beginPath();
  ctx.ellipse(legTop.x, legTop.y, r, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#7a5230";
  ctx.lineWidth = Math.max(0.6, 0.7 * cam.scale);
  ctx.stroke();
  // Two small stools.
  for (const dx of [-1, 1]) {
    const stoolS = toScreen(projectIso(wx + dx * 8, wy + 6, 0), cam);
    const stoolR = Math.max(1.6, 2.2 * cam.scale);
    ctx.fillStyle = "#8a5a3c";
    ctx.beginPath();
    ctx.arc(stoolS.x, stoolS.y - stoolR, stoolR, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Community_center-only: a flagpole beside the entrance -- the civic-
 * building cue distinguishing it from a private commercial building
 * that happens to share its arch-roof massing. */
function drawFlagpole(ctx: any, cam: Camera, b: IsoBuilding) {
  const fp = footprintRect(b.loc);
  const wx = fp.x - 10;
  const wy = fp.y + fp.h * 0.7;
  const base = toScreen(projectIso(wx, wy, 0), cam);
  const top = toScreen(projectIso(wx, wy, 30), cam);
  ctx.strokeStyle = "#8a8478";
  ctx.lineWidth = Math.max(1, 1.2 * cam.scale);
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(top.x, top.y);
  ctx.stroke();
  // Small pennant.
  ctx.fillStyle = "#c14b3f";
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(top.x + 9 * cam.scale, top.y + 3 * cam.scale);
  ctx.lineTo(top.x, top.y + 6 * cam.scale);
  ctx.closePath();
  ctx.fill();
}

function drawYardFence(ctx: any, cam: Camera, b: IsoBuilding) {
  const lot = lotRect(b.loc);
  const isHedge = b.archetype.tone > 0;
  const segments = 7;
  const p0x = lot.x,
    p1x = lot.x + lot.w,
    y = lot.y + lot.h;
  const postH = isHedge ? 6 : 9;
  ctx.strokeStyle = isHedge ? "#3d5c33" : "#8a7250";
  ctx.lineWidth = Math.max(1, (isHedge ? 2.6 : 1.3) * cam.scale);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const wx = p0x + (p1x - p0x) * t;
    const base = toScreen(projectIso(wx, y, 0), cam);
    const top = toScreen(projectIso(wx, y, postH), cam);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
  }
  if (!isHedge) {
    // Two horizontal rails connecting the pickets.
    const railYs = [postH * 0.4, postH * 0.85];
    for (const ry of railYs) {
      const a = toScreen(projectIso(p0x, y, ry), cam);
      const c = toScreen(projectIso(p1x, y, ry), cam);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
    }
  }
}

/** Flat-roofed office/factory block gets a small rooftop unit (AC box)
 * so a plain flat roof doesn't read as "unfinished". */
function drawRooftopUnit(ctx: any, cam: Camera, b: IsoBuilding) {
  const { roof } = b;
  const center = lerpPt(lerpPt(roof.back, roof.front, 0.5), lerpPt(roof.right, roof.left, 0.5), 0.5);
  const unitBase = toScreen(center, cam);
  const unitTop = toScreen(raise(center, 9), cam);
  const w = Math.max(4, 10 * cam.scale);
  ctx.fillStyle = "#5c6773";
  ctx.fillRect(unitBase.x - w / 2, unitTop.y, w, unitBase.y - unitTop.y);
  ctx.strokeStyle = "#33404d";
  ctx.lineWidth = Math.max(0.6, 0.8 * cam.scale);
  ctx.strokeRect(unitBase.x - w / 2, unitTop.y, w, unitBase.y - unitTop.y);
}

/** Market/shop awning: a striped canopy projecting out over the entrance,
 * plus a small hanging sign board -- the "market should look different
 * from a workplace" cue. */
/** Market/shop awning: a striped canopy projecting out over the entrance,
 * plus a small hanging sign board -- the "market should look different
 * from a workplace" cue.
 *
 * Built entirely in plan space (world x/y/z) and only projected at the
 * end -- an earlier version nudged already-projected screen points
 * outward by hand and the sign/direction math came out wrong (visible
 * as an oversized, misplaced canopy in the Phase-2 render check). Plan
 * space is where "outward, toward the street" is an unambiguous
 * direction, so it's a much safer place to do this construction. */
function drawAwning(ctx: any, cam: Camera, b: IsoBuilding, pal: { trim: string }) {
  const fp = footprintRect(b.loc);
  const awningDepth = Math.min(24, fp.h * 0.3); // how far the canopy projects out from the front wall
  const awningH = Math.max(16, b.height * 0.42); // height above ground the canopy sits at
  const inset = fp.w * 0.12;

  // Front wall spans (fp.x+inset, fp.y+fp.h) -> (fp.x+fp.w-inset, fp.y+fp.h)
  // in plan space; the canopy extends further "into" y (toward the
  // viewer/street) by `awningDepth`.
  const nearTopL = projectIso(fp.x + inset, fp.y + fp.h, awningH);
  const nearTopR = projectIso(fp.x + fp.w - inset, fp.y + fp.h, awningH);
  const farBottomL = projectIso(fp.x + inset, fp.y + fp.h + awningDepth, awningH * 0.72);
  const farBottomR = projectIso(fp.x + fp.w - inset, fp.y + fp.h + awningDepth, awningH * 0.72);

  poly(ctx, cam, [nearTopL, nearTopR, farBottomR, farBottomL]);
  ctx.fillStyle = "#c14b3f";
  ctx.fill();
  ctx.strokeStyle = pal.trim;
  ctx.lineWidth = Math.max(0.8, 1 * cam.scale);
  ctx.stroke();

  // Stripes, clipped to the canopy quad.
  ctx.save();
  const p0 = toScreen(nearTopL, cam), p1 = toScreen(nearTopR, cam), p2 = toScreen(farBottomR, cam), p3 = toScreen(farBottomL, cam);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = Math.max(1, 1.6 * cam.scale);
  const stripes = 4;
  for (let i = 1; i < stripes; i++) {
    const t = i / stripes;
    const a = { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
    const c = { x: p3.x + (p2.x - p3.x) * t, y: p3.y + (p2.y - p3.y) * t };
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
  }
  ctx.restore();

  // Small hanging sign centered under the canopy's outer edge.
  const signWorld = projectIso(fp.x + fp.w / 2, fp.y + fp.h + awningDepth * 0.7, awningH * 0.5);
  const signAnchor = toScreen(signWorld, cam);
  ctx.fillStyle = "#2c1c10";
  const sw = Math.max(10, 20 * cam.scale);
  const sh = Math.max(3, 5 * cam.scale);
  ctx.fillRect(signAnchor.x - sw / 2, signAnchor.y, sw, sh);

  // Support poles from the canopy's two outer corners down to the
  // ground: without these the canopy is a flat colored quad with
  // nothing visibly holding it up, which is exactly the "floating
  // polygon" the closeup render check confirmed it still looked like --
  // a real awning is held up by something, and drawing that something
  // is what makes the shape read as an intentional structure.
  const farGroundL = projectIso(fp.x + inset, fp.y + fp.h + awningDepth, 0);
  const farGroundR = projectIso(fp.x + fp.w - inset, fp.y + fp.h + awningDepth, 0);
  ctx.strokeStyle = pal.trim;
  ctx.lineWidth = Math.max(1, 1.3 * cam.scale);
  [
    [farBottomL, farGroundL],
    [farBottomR, farGroundR],
  ].forEach(([top, bottom]) => {
    const pTop = toScreen(top, cam);
    const pBottom = toScreen(bottom, cam);
    ctx.beginPath();
    ctx.moveTo(pTop.x, pTop.y);
    ctx.lineTo(pBottom.x, pBottom.y);
    ctx.stroke();
  });
}

/** Leisure pavilion: a proper peaked canopy (not a flat translucent
 * slab) on thick corner posts, over a paved plaza patch with two
 * built-in benches and a short entrance path connecting to the
 * sidewalk -- reads as "a place people gather," not a bare frame. */
function drawPavilion(ctx: any, cam: Camera, b: IsoBuilding, pal: { roof: string; trim: string }) {
  const { floor, roof, height } = b;
  const fp = footprintRect(b.loc);

  // Paved plaza patch, inset slightly from the pavilion's own footprint
  // so it reads as an open gathering area the pavilion sits on, not
  // just another lawn.
  const padPad = 14;
  const plazaCorners = [
    projectIso(fp.x - padPad, fp.y - padPad, 0),
    projectIso(fp.x + fp.w + padPad, fp.y - padPad, 0),
    projectIso(fp.x + fp.w + padPad, fp.y + fp.h + padPad, 0),
    projectIso(fp.x - padPad, fp.y + fp.h + padPad, 0),
  ];
  poly(ctx, cam, plazaCorners);
  ctx.fillStyle = "rgba(196, 184, 150, 0.5)";
  ctx.fill();

  // Short entrance path from the plaza's front edge toward the street
  // side of the lot, echoing the sidewalk-stub connection every other
  // building type gets via the road network.
  const pathCorners = [
    projectIso(fp.x + fp.w * 0.4, fp.y + fp.h + padPad, 0),
    projectIso(fp.x + fp.w * 0.6, fp.y + fp.h + padPad, 0),
    projectIso(fp.x + fp.w * 0.6, fp.y + fp.h + padPad + 22, 0),
    projectIso(fp.x + fp.w * 0.4, fp.y + fp.h + padPad + 22, 0),
  ];
  poly(ctx, cam, pathCorners);
  ctx.fillStyle = "rgba(196, 184, 150, 0.5)";
  ctx.fill();

  // Corner posts -- thicker than the previous single hairline, so they
  // read as timber posts rather than wire.
  const corners: [ScreenPoint, ScreenPoint][] = [
    [floor.back, roof.back],
    [floor.right, roof.right],
    [floor.front, roof.front],
    [floor.left, roof.left],
  ];
  ctx.strokeStyle = pal.trim;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(2.2, 3.6 * cam.scale);
  for (const [fpt, rp] of corners) {
    const a = toScreen(fpt, cam);
    const c = toScreen(rp, cam);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
  }
  ctx.lineCap = "butt";

  // Peaked canopy (same hip-style construction as drawHipRoof) instead
  // of a flat slab -- gives the pavilion an actual roof shape rather
  // than a floating pane.
  const ridgeRise = Math.max(8, height * 0.3);
  const fullLeft = raise(lerpPt(roof.back, roof.left, 0.5), ridgeRise);
  const fullRight = raise(lerpPt(roof.right, roof.front, 0.5), ridgeRise);
  const ridgeLeft = lerpPt(fullLeft, fullRight, 0.32);
  const ridgeRight = lerpPt(fullLeft, fullRight, 0.68);

  ctx.globalAlpha = 0.82;
  poly(ctx, cam, [roof.back, roof.right, ridgeRight, ridgeLeft]);
  ctx.fillStyle = pal.roof;
  ctx.fill();
  ctx.strokeStyle = pal.trim;
  ctx.lineWidth = Math.max(1, 1.1 * cam.scale);
  ctx.stroke();
  poly(ctx, cam, [roof.left, roof.front, ridgeRight, ridgeLeft]);
  ctx.fillStyle = toneShift(pal.roof, -0.3);
  ctx.fill();
  ctx.stroke();
  poly(ctx, cam, [roof.back, roof.left, ridgeLeft]);
  ctx.fillStyle = toneShift(pal.roof, -0.12);
  ctx.fill();
  ctx.stroke();
  poly(ctx, cam, [roof.right, roof.front, ridgeRight]);
  ctx.fillStyle = toneShift(pal.roof, -0.18);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Two built-in benches under the canopy, facing each other -- always
  // present (unlike scatterProps' nearby benches, which are placed
  // outside the lot), so the pavilion reads as furnished, not empty.
  const benchOffsets: [number, number][] = [
    [fp.x + fp.w * 0.28, fp.y + fp.h * 0.5],
    [fp.x + fp.w * 0.72, fp.y + fp.h * 0.5],
  ];
  for (const [bx, by] of benchOffsets) {
    const s = toScreen(projectIso(bx, by, 0), cam);
    const w = Math.max(7, 11 * cam.scale);
    const hgt = Math.max(2.4, 3.4 * cam.scale);
    ctx.fillStyle = "#6b4a2e";
    ctx.fillRect(s.x - w / 2, s.y - hgt / 2, w, hgt);
  }
}

function drawWindows(ctx: any, cam: Camera, b: IsoBuilding, side: "left" | "right") {
  const { floor, roof, height } = b;
  const a = side === "right" ? floor.right : floor.left;
  const c = side === "right" ? roof.right : roof.left;
  const f = floor.front;
  const rf = roof.front;
  // Interpolate 2 window points along each wall face (which is a
  // parallelogram a -> f -> rf -> c), placed at fixed fractional
  // positions so they stay put across frames.
  const rows = height > 70 ? 2 : 1;
  const cols = 2;
  for (let r = 0; r < rows; r++) {
    const tRow = (r + 1) / (rows + 1);
    for (let cI = 0; cI < cols; cI++) {
      const tCol = (cI + 1) / (cols + 1);
      // Bottom edge point between a and f; top edge point between c and rf
      const bx = a.sx + (f.sx - a.sx) * tCol;
      const by = a.sy + (f.sy - a.sy) * tCol;
      const tx = c.sx + (rf.sx - c.sx) * tCol;
      const ty = c.sy + (rf.sy - c.sy) * tCol;
      const wx = bx + (tx - bx) * tRow;
      const wy = by + (ty - by) * tRow;
      const s = toScreen({ sx: wx, sy: wy }, cam);
      const size = 3.2 * cam.scale;
      ctx.fillStyle = "rgba(255, 226, 150, 0.85)";
      ctx.fillRect(s.x - size / 2, s.y - size / 2, size, size);
    }
  }
}

const TREE_PALETTES: [string, string, string][] = [
  ["#2f6b34", "#3f7a3a", "#4f8f47"], // standard deciduous
  ["#2a5c3e", "#377050", "#458560"], // cooler/bluer green
  ["#3c6b2a", "#4f8036", "#639943"], // warmer/yellower green
  ["#264a2e", "#345f3c", "#43744a"], // dark evergreen-ish
];

/** Trunk + layered canopy (three overlapping lobes at slightly different
 * depths, not one flat ellipse) + ground shadow + deterministic
 * size/species variance -- the flat "green blob on a stick" from the
 * previous pass didn't read as a tree once anything else was on screen;
 * layering the canopy and varying size/palette per prop.seed does. */
export function drawTree(ctx: any, cam: Camera, prop: PropPlacement) {
  // Deterministic per-tree size class (0.75-1.35x) and species palette,
  // both from the same seed already used elsewhere -- big and small
  // trees mixed together read as a real (uneven) streetscape rather
  // than a row of identical stamps.
  const sizeMul = 0.75 + prop.seed * 0.6;
  const palette = TREE_PALETTES[Math.floor(prop.seed * 97) % TREE_PALETTES.length];
  const treeHeight = 20 * sizeMul;

  drawGroundShadow(ctx, cam, projectIso(prop.x, prop.y, 0) as unknown as ScreenPoint, Math.max(5, 8 * cam.scale * sizeMul), Math.max(2.5, 4 * cam.scale * sizeMul));

  const base = projectIso(prop.x, prop.y, 0);
  const top = projectIso(prop.x, prop.y, treeHeight);
  const trunkBase = toScreen(base, cam);
  const canopy = toScreen(top, cam);
  const trunkW = Math.max(1.3, 1.8 * cam.scale * sizeMul);
  ctx.strokeStyle = "#5a4128";
  ctx.lineWidth = trunkW;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(trunkBase.x, trunkBase.y);
  ctx.lineTo(canopy.x, canopy.y + 6 * cam.scale * sizeMul);
  ctx.stroke();
  ctx.lineCap = "butt";

  // Floored, like building doors/windows and agent sprites already are:
  // a pure `9 * cam.scale` shrinks to a barely-visible 2-3px dot at a
  // zoomed-out establishing-view scale, which is exactly the "trees are
  // too small and sparse" complaint -- a tree needs to stay legible as
  // a tree even far away, the same way a building stays legible as a
  // building.
  const r = Math.max(6, 9 * cam.scale * sizeMul);
  // Back lobe (darkest, sits "behind" -- gives the canopy silhouette
  // depth instead of one flat disc).
  ctx.fillStyle = palette[0];
  ctx.beginPath();
  ctx.ellipse(canopy.x + r * 0.32, canopy.y + r * 0.12, r * 0.72, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  // Main canopy lobe.
  ctx.fillStyle = palette[1];
  ctx.beginPath();
  ctx.ellipse(canopy.x, canopy.y, r, r * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  // Front-left highlight lobe (lightest -- reads as sun-catching foliage).
  ctx.fillStyle = palette[2];
  ctx.beginPath();
  ctx.ellipse(canopy.x - r * 0.3, canopy.y - r * 0.24, r * 0.55, r * 0.46, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawLamp(ctx: any, cam: Camera, prop: PropPlacement) {
  const base = projectIso(prop.x, prop.y, 0);
  const top = projectIso(prop.x, prop.y, 16);
  const b = toScreen(base, cam);
  const t = toScreen(top, cam);
  ctx.strokeStyle = "#3a3f47";
  ctx.lineWidth = Math.max(1, 1.1 * cam.scale);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(t.x, t.y);
  ctx.stroke();
  const bulbR = Math.max(2.1, 3.2 * cam.scale);
  ctx.fillStyle = "#ffe9a8";
  ctx.beginPath();
  ctx.ellipse(t.x, t.y, bulbR, bulbR, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = "#ffe9a8";
  const glowR = Math.max(8, 14 * cam.scale);
  ctx.beginPath();
  ctx.ellipse(t.x, t.y, glowR, glowR, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawBench(ctx: any, cam: Camera, prop: PropPlacement) {
  const base = projectIso(prop.x, prop.y, 0);
  const s = toScreen(base, cam);
  ctx.fillStyle = "#6b4a2e";
  const w = Math.max(8, 12 * cam.scale);
  const h = Math.max(2.6, 3.6 * cam.scale);
  ctx.fillRect(s.x - w / 2, s.y - h / 2, w, h);
}

/** Market stall: a small striped umbrella/awning over a counter -- reads
 * as "vendor" from a distance without needing full geometry. */
export function drawStall(ctx: any, cam: Camera, prop: PropPlacement) {
  const base = toScreen(projectIso(prop.x, prop.y, 0), cam);
  const pole = toScreen(projectIso(prop.x, prop.y, 13), cam);
  drawGroundShadow(ctx, cam, projectIso(prop.x, prop.y, 0) as unknown as ScreenPoint, 8, 4);
  ctx.strokeStyle = "#4a3826";
  ctx.lineWidth = Math.max(1, 1.2 * cam.scale);
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(pole.x, pole.y);
  ctx.stroke();
  const r = Math.max(5, 8 * cam.scale);
  const colors = ["#d9534f", "#e0a34f", "#4f8fd9"];
  const color = colors[Math.floor(prop.seed * colors.length) % colors.length];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pole.x - r, pole.y);
  ctx.quadraticCurveTo(pole.x, pole.y - r * 0.9, pole.x + r, pole.y);
  ctx.lineTo(pole.x, pole.y + r * 0.15);
  ctx.closePath();
  ctx.fill();
  // Counter table
  ctx.fillStyle = "#8a6a45";
  const cw = Math.max(6, 9 * cam.scale);
  const ch = Math.max(2, 3 * cam.scale);
  ctx.fillRect(base.x - cw / 2, base.y - ch, cw, ch);
}

/** Small planter box -- leisure-lot dressing. */
export function drawPlanter(ctx: any, cam: Camera, prop: PropPlacement) {
  const s = toScreen(projectIso(prop.x, prop.y, 0), cam);
  const w = Math.max(6.5, 8.5 * cam.scale);
  const h = Math.max(3.6, 4.8 * cam.scale);
  ctx.fillStyle = "#6b5638";
  ctx.fillRect(s.x - w / 2, s.y - h, w, h);
  ctx.fillStyle = "#4f8f47";
  ctx.beginPath();
  ctx.ellipse(s.x, s.y - h, w * 0.55, h * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Low fence post -- residential yard edge cue. */
export function drawFence(ctx: any, cam: Camera, prop: PropPlacement) {
  const base = toScreen(projectIso(prop.x, prop.y, 0), cam);
  const top = toScreen(projectIso(prop.x, prop.y, 7), cam);
  ctx.strokeStyle = "#8a7250";
  ctx.lineWidth = Math.max(1, 1.4 * cam.scale);
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(top.x, top.y);
  ctx.stroke();
}

/** A single clipped-hedge lobe -- a scatterProps-placed alternative to
 * drawYardFence's line-of-posts fence, for lots that read better with
 * greenery than timber at their boundary. Small and round rather than a
 * tree's height, so it's unambiguous which prop is which at a glance. */
export function drawBush(ctx: any, cam: Camera, prop: PropPlacement) {
  drawGroundShadow(ctx, cam, projectIso(prop.x, prop.y, 0) as unknown as ScreenPoint, Math.max(3.5, 5 * cam.scale), Math.max(1.6, 2.4 * cam.scale));
  const top = toScreen(projectIso(prop.x, prop.y, 4), cam);
  const r = Math.max(3.6, 5.5 * cam.scale);
  ctx.fillStyle = "#3d5c33";
  ctx.beginPath();
  ctx.ellipse(top.x, top.y, r, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4a6e3e";
  ctx.beginPath();
  ctx.ellipse(top.x - r * 0.25, top.y - r * 0.2, r * 0.55, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Small utility bin -- workplace/market service-area dressing. Purely
 * decorative, never affects routing. */
export function drawBin(ctx: any, cam: Camera, prop: PropPlacement) {
  const s = toScreen(projectIso(prop.x, prop.y, 0), cam);
  const w = Math.max(3, 4.4 * cam.scale);
  const h = Math.max(4, 6 * cam.scale);
  ctx.fillStyle = "#3a4048";
  ctx.fillRect(s.x - w / 2, s.y - h, w, h);
  ctx.fillStyle = "#4d545e";
  ctx.fillRect(s.x - w / 2, s.y - h, w, h * 0.18);
}

/** Small freestanding workplace sign board on a post. */
export function drawSign(ctx: any, cam: Camera, prop: PropPlacement) {
  const base = toScreen(projectIso(prop.x, prop.y, 0), cam);
  const top = toScreen(projectIso(prop.x, prop.y, 18), cam);
  ctx.strokeStyle = "#33404d";
  ctx.lineWidth = Math.max(1, 1.2 * cam.scale);
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(top.x, top.y);
  ctx.stroke();
  const w = 12 * cam.scale;
  const h = 6 * cam.scale;
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(top.x - w / 2, top.y, w, h);
  ctx.strokeStyle = "#495a6b";
  ctx.lineWidth = Math.max(0.6, 0.8 * cam.scale);
  ctx.strokeRect(top.x - w / 2, top.y, w, h);
}

/** Ground plaza + road fill for the slice's local street segment,
 * drawn as an iso quad rather than a flat rect. */
export function drawGroundStrip(
  ctx: any,
  cam: Camera,
  y: number,
  x1: number,
  x2: number,
  halfWidth: number,
  color: string
) {
  const corners: ScreenPoint[] = [
    projectIso(x1, y - halfWidth, 0),
    projectIso(x2, y - halfWidth, 0),
    projectIso(x2, y + halfWidth, 0),
    projectIso(x1, y + halfWidth, 0),
  ];
  poly(ctx, cam, corners);
  ctx.fillStyle = color;
  ctx.fill();
}

export function drawSidewalkStub(ctx: any, cam: Camera, a: { x: number; y: number }, b: { x: number; y: number }) {
  // A proper paved-width strip (a quad, not a centerline stroke) so the
  // house-yard-path-sidewalk-road chain actually reads as a walkway you
  // could stand on, not a wire connecting two dots.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * 3.2; // perpendicular half-width in plan-space
  const ny = (dx / len) * 3.2;
  const corners = [
    projectIso(a.x + nx, a.y + ny, 0),
    projectIso(b.x + nx, b.y + ny, 0),
    projectIso(b.x - nx, b.y - ny, 0),
    projectIso(a.x - nx, a.y - ny, 0),
  ];
  poly(ctx, cam, corners);
  ctx.fillStyle = "#c9c3b8";
  ctx.fill();
  // A faint centerline seam -- reads as pavement joints rather than a
  // flat color block.
  const pa = toScreen(projectIso(a.x, a.y, 0), cam);
  const pb = toScreen(projectIso(b.x, b.y, 0), cam);
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = Math.max(1, 0.8 * cam.scale);
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.stroke();
}

const CLOTHING_PALETTE = ["#c05746", "#4c7fd6", "#3a9c6b", "#c98a3a", "#8a5cc9", "#3aa0a0", "#c9557f", "#6b7280"];
const PANTS_PALETTE = ["#2f3b52", "#4a4238", "#33403a", "#3c3c46", "#5a4a3a", "#2c3e50"];
const SHOE_PALETTE = ["#1c1c22", "#3b2a1a", "#5c5c66", "#241c16"];
const HAIR_PALETTE = ["#1c1712", "#3b2a1f", "#5c3f2e", "#7a5c3e", "#a3743f", "#c9a876", "#4a4a4a", "#8a8a8a"];
const SKIN_PALETTE = ["#e7c19c", "#d9a876", "#c98c5e", "#a9694a", "#8a5636", "#f0d2b0"];

/** Small state badge shown above a citizen's head when zoomed in enough
 * to read it -- purely a legibility aid for `agent.current_action.
 * action_type`, never invented behavior.
 *
 * Drawn as a small filled circle + single letter rather than a Unicode
 * emoji: the Phase-2 render check showed emoji glyphs render
 * inconsistently (missing/garbled) depending on the host OS/browser's
 * installed emoji font, which isn't something this app controls. A
 * plain circle+letter badge with the app's own palette renders
 * identically everywhere Canvas2D text does. */
const ACTION_BADGE: Record<string, { letter: string; color: string }> = {
  work: { letter: "W", color: "#38bdf8" },
  consume_food: { letter: "E", color: "#f59e0b" },
  rest: { letter: "Z", color: "#34d399" },
  socialize: { letter: "S", color: "#a78bfa" },
  move: { letter: "\u2192", color: "#67e8f9" },
  idle: { letter: "\u00b7", color: "#9ca3af" },
};

export function actionGlyph(actionType?: string): { letter: string; color: string } | undefined {
  return actionType ? ACTION_BADGE[actionType] : undefined;
}

/** Cheap deterministic pseudo-random derived from a base [0,1) seed plus
 * a small integer salt -- lets one hash01() call per agent (already the
 * existing pattern) fan out into several independent-looking attributes
 * (hair/skin/pants/build/hairstyle) without extra per-agent string
 * hashing every frame. Not cryptographic, just needs to look unrelated
 * across salts and be stable for a given agent. */
function subSeed(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function pick<T>(arr: T[], seed01: number): T {
  return arr[Math.min(arr.length - 1, Math.floor(seed01 * arr.length))];
}

/**
 * Billboarded human sprite: shadow, shoes, legs, torso, arms, head, hair
 * -- always facing the viewer in silhouette (standard 2D-iso convention;
 * bodies don't rotate in true 3D here), but *mirrored* left/right and
 * given a small directional cue based on the agent's real travel
 * heading (`facing`, radians in plan-space) so someone walking toward
 * vs. away from a destination reads differently instead of every
 * citizen looking identical regardless of where they're headed.
 *
 * `identitySeed` (a single hash01(agent.id) call from the caller, same
 * cost as the old clothSeed) fans out via subSeed() into independent
 * clothing/pants/hair-color/hairstyle/skin-tone/build choices per agent,
 * so 100 citizens don't visually clone each other.
 *
 * `lod` controls render cost/detail:
 *  - "simple": capsule body + head only -- cheap, used for agents far
 *    from the followed/selected one in a zoomed-out establishing view.
 *  - "readable": filled limbs, hair, shoes -- the default for most
 *    on-screen citizens.
 *  - "detailed": readable + slightly larger scale + crisper highlight --
 *    reserved for the selected/followed agent so they're unmistakably
 *    the one to watch, without making every one of 100 agents cost the
 *    same to draw.
 */
export function drawAgentSprite(
  ctx: any,
  cam: Camera,
  worldX: number,
  worldY: number,
  opts: {
    phase: number;
    amplitude: number;
    highlight: boolean;
    facing?: number;
    lod?: "simple" | "readable" | "detailed";
    label?: string;
    tint?: string;
    clothSeed?: number;
    glyph?: { letter: string; color: string };
  }
) {
  const feet = toScreen(projectIso(worldX, worldY, 0), cam);
  const scale = cam.scale;
  const lod = opts.lod ?? (opts.highlight ? "detailed" : "readable");

  // Selected/followed citizens get a soft ground halo in addition to the
  // head ring below -- reads clearly even at establishing-view distance,
  // where a thin head outline alone can get lost.
  if (opts.highlight) {
    const s0 = toScreen(projectIso(worldX, worldY, 0), cam);
    ctx.save();
    ctx.fillStyle = "rgba(250, 204, 21, 0.22)";
    ctx.beginPath();
    ctx.ellipse(s0.x, s0.y, 9 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  drawGroundShadow(ctx, cam, projectIso(worldX, worldY, 0) as unknown as ScreenPoint, 6, 3);

  // Sprites use a floor'd minimum pixel size rather than pure `* scale`,
  // so a citizen stays readable as "a small person" even in a
  // zoomed-out establishing view. Detailed (followed) citizens get a
  // modest additional size bump on top of that, per the brief's "the
  // followed agent should be noticeably more readable than distant
  // agents" -- without that bump every agent is the same size and only
  // the highlight ring tells them apart.
  const identitySeed = opts.clothSeed ?? 0;
  const buildMul = 0.92 + subSeed(identitySeed, 1) * 0.22; // ~0.92-1.14x height/build variance
  const detailMul = lod === "detailed" ? 1.12 : 1;
  const swing = Math.sin(opts.phase) * opts.amplitude;
  const bob = Math.abs(Math.sin(opts.phase)) * opts.amplitude * 1.4;
  const bodyH = Math.max(14, 22 * scale) * buildMul * detailMul;
  const headR = Math.max(3.2, 5 * scale) * buildMul * detailMul;
  // Uniform multiplier for every other sprite dimension, derived from
  // the floored bodyH rather than raw `scale` directly, so limbs/torso
  // stay proportional to the body once the floor kicks in.
  const s = bodyH / (22 * buildMul * detailMul);

  const cloth = pick(CLOTHING_PALETTE, subSeed(identitySeed, 2));
  const pants = pick(PANTS_PALETTE, subSeed(identitySeed, 3));
  const shoe = pick(SHOE_PALETTE, subSeed(identitySeed, 4));
  const hair = pick(HAIR_PALETTE, subSeed(identitySeed, 5));
  const skin = pick(SKIN_PALETTE, subSeed(identitySeed, 6));
  const hairstyle = Math.floor(subSeed(identitySeed, 7) * 3); // 0 short-cap, 1 side-part, 2 close-cropped

  // Facing: mirror the (left/right-symmetric-by-default) limb swing and
  // offset a couple of asymmetric details (hair part, nose hint) based
  // on the agent's real plan-space travel heading projected into this
  // projection's screen-space left/right axis. When travel is mostly
  // toward/away from the camera (screen dx ~0, e.g. walking "north" in
  // plan space) we keep the default mirror rather than flicker.
  const facing = opts.facing ?? 0;
  const screenDx = Math.cos(facing) - Math.sin(facing); // matches projectIso's sx = (x - y) * ISO_COS
  const mirror = Math.abs(screenDx) < 0.05 ? 1 : screenDx < 0 ? -1 : 1;

  ctx.save();
  ctx.translate(feet.x, feet.y - bob * s);
  ctx.scale(mirror, 1);

  // shoes/feet -- small dark ellipses at each foot's resting point, sat
  // just behind the leg lines so they read as a shoe rather than a bare
  // line-end.
  ctx.fillStyle = shoe;
  ctx.beginPath();
  ctx.ellipse(-2.2 * s + swing * 2.5 * s, -0.2 * s, 1.6 * s, 1 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(2.2 * s - swing * 2.5 * s, -0.2 * s, 1.6 * s, 1 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // legs -- filled capsules (round-cap thick strokes) in the pants
  // color, not hairline strokes, so they read as limbs rather than wire.
  ctx.strokeStyle = pants;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(2.2, 3.1 * s);
  ctx.beginPath();
  ctx.moveTo(-2.2 * s, 0);
  ctx.lineTo(-2.2 * s + swing * 2.5 * s, -bodyH * 0.35);
  ctx.moveTo(2.2 * s, 0);
  ctx.lineTo(2.2 * s - swing * 2.5 * s, -bodyH * 0.35);
  ctx.stroke();

  // arms (subtle counter-swing), in the shirt color, filled capsules
  ctx.strokeStyle = cloth;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.7, 2.3 * s);
  ctx.beginPath();
  ctx.moveTo(-3.4 * s, -bodyH * 0.55);
  ctx.lineTo(-3.4 * s - swing * 1.6 * s, -bodyH * 0.25);
  ctx.moveTo(3.4 * s, -bodyH * 0.55);
  ctx.lineTo(3.4 * s + swing * 1.6 * s, -bodyH * 0.25);
  ctx.stroke();
  ctx.lineCap = "butt";

  // torso -- a rounded trapezoid (wider at the shoulders, narrower at
  // the waist) rather than a plain ellipse, so it reads as a body, not
  // a bean. Clothing color carries identity; a thin outline carries
  // current-action state so the two never get confused.
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(-3.6 * s, -bodyH * 0.34);
  ctx.quadraticCurveTo(-4.6 * s, -bodyH * 0.62, -3.2 * s, -bodyH * 0.9);
  ctx.quadraticCurveTo(0, -bodyH * 0.98, 3.2 * s, -bodyH * 0.9);
  ctx.quadraticCurveTo(4.6 * s, -bodyH * 0.62, 3.6 * s, -bodyH * 0.34);
  ctx.quadraticCurveTo(0, -bodyH * 0.22, -3.6 * s, -bodyH * 0.34);
  ctx.closePath();
  ctx.fill();
  if (opts.tint) {
    ctx.strokeStyle = opts.tint;
    ctx.lineWidth = Math.max(1, 1.4 * s);
    ctx.stroke();
  }

  // head + hair
  const headCx = 0;
  const headCy = -bodyH - headR * 0.4;
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(headCx, headCy, headR, 0, Math.PI * 2);
  ctx.fill();

  if (lod !== "simple") {
    ctx.fillStyle = hair;
    ctx.beginPath();
    if (hairstyle === 0) {
      // short cap: an arc covering the top half of the head
      ctx.arc(headCx, headCy, headR * 1.02, Math.PI, Math.PI * 2);
    } else if (hairstyle === 1) {
      // side-part: cap shifted toward the mirrored "back" side
      ctx.arc(headCx - headR * 0.15, headCy, headR * 1.05, Math.PI * 0.9, Math.PI * 2.05);
    } else {
      // close-cropped: a thin rim only
      ctx.arc(headCx, headCy, headR * 1.02, Math.PI * 1.05, Math.PI * 1.95);
    }
    ctx.fill();
    // A faint nose-side highlight gives the mirrored silhouette a
    // subtle "which way is this face pointing" cue at readable+ LOD.
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.ellipse(headCx + headR * 0.55, headCy + headR * 0.1, headR * 0.28, headR * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (opts.highlight) {
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = Math.max(1.2, 1.8 * s);
    ctx.beginPath();
    ctx.arc(headCx, headCy, headR + 2.5 * s, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  if (opts.glyph && scale > 0) {
    const bx = feet.x + 7 * s;
    const by = feet.y - bodyH - headR * 2 - 2 * scale - bob * s;
    const r = Math.max(4, 5.5 * scale);
    ctx.fillStyle = opts.glyph.color;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0a0e0c";
    ctx.font = `bold ${Math.max(6, r * 1.1)}px ui-sans-serif, system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(opts.glyph.letter, bx, by + 0.5);
    ctx.textBaseline = "alphabetic";
  }

  if (opts.label) {
    // Font size is capped, not just floored: at Follow Mode's ~5x zoom a
    // pure `10 * scale` size would print a 50px name over the whole
    // scene -- capping keeps it readable without dominating the frame.
    ctx.font = `${Math.min(13, Math.max(9, 10 * scale))}px ui-sans-serif, system-ui`;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.textAlign = "center";
    ctx.fillText(opts.label, feet.x, feet.y - bodyH - headR * 2 - 4 * scale - bob * s);
  }
}

// ---------------------------------------------------------------------
// Causality overlays (Phase-2) -- "make causality visible inside the
// world". Every function below draws only from data the caller already
// derived from real backend fields (needs/goals/current_action/
// location_id/relationships) or from the same real plan-space route the
// agent is actually walking; nothing here invents position, timing, or
// reasoning text.
// ---------------------------------------------------------------------

/** Pulsing marker over an agent's real destination tile while they're
 * mid-route -- `t` is a free-running animation phase, not tied to
 * simulation state. */
export function drawDestinationMarker(ctx: any, cam: Camera, worldX: number, worldY: number, t: number) {
  const s = toScreen(projectIso(worldX, worldY, 2), cam);
  const pulse = (Math.sin(t * 3) + 1) / 2;
  ctx.save();
  ctx.strokeStyle = "#facc15";
  ctx.lineWidth = Math.max(1, 1.6 * cam.scale);
  ctx.globalAlpha = 0.55 + pulse * 0.35;
  ctx.beginPath();
  ctx.arc(s.x, s.y, (8 + pulse * 4) * cam.scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#facc15";
  ctx.beginPath();
  ctx.moveTo(s.x, s.y - 14 * cam.scale);
  ctx.lineTo(s.x - 4 * cam.scale, s.y - 6 * cam.scale);
  ctx.lineTo(s.x + 4 * cam.scale, s.y - 6 * cam.scale);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The remaining real route a followed/selected agent is walking, drawn
 * as a dashed highlighted line from their current interpolated position
 * through every remaining waypoint -- the exact same `Point[]` path
 * CityCanvasIso is stepping them along, just visualized. */
export function drawRoutePath(ctx: any, cam: Camera, current: Point, remaining: Point[]) {
  if (remaining.length === 0) return;
  ctx.save();
  ctx.strokeStyle = "#67e8f9";
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = Math.max(1, 2 * cam.scale);
  ctx.setLineDash([5 * cam.scale, 5 * cam.scale]);
  ctx.beginPath();
  const start = toScreen(projectIso(current.x, current.y, 1), cam);
  ctx.moveTo(start.x, start.y);
  for (const p of remaining) {
    const sp = toScreen(projectIso(p.x, p.y, 1), cam);
    ctx.lineTo(sp.x, sp.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/** Small "WHY?" card near a followed/selected agent, showing real
 * current-goal / current-action text. `lines` are pre-formatted by the
 * caller from actual Agent fields (current_goal.description,
 * current_action.reasoning/message) -- this function only lays out and
 * draws whatever strings it's given.
 *
 * Rewritten in the Phase-2 visual-QA pass: the previous version reserved
 * exactly one row of card height per `lines[]` entry but then word-wrapped
 * long entries into 2 rows anyway, so a wrapped line's second row drew on
 * top of the next entry (visible as garbled overlapping text in the
 * render check). This version measures every entry's actual wrapped row
 * count *before* laying out the card, sizes the card to that real total,
 * and advances the draw cursor by however many rows each entry actually
 * used. */
export function drawWhyCard(
  ctx: any,
  cam: Camera,
  worldX: number,
  worldY: number,
  title: string,
  lines: string[]
) {
  const anchor = toScreen(projectIso(worldX, worldY, 34), cam);
  const padX = 8;
  const padY = 6;
  const lineH = 13;
  const maxCardW = 220;
  ctx.save();

  ctx.font = "bold 11px ui-sans-serif, system-ui";
  const titleRows = wrapLines(ctx, title, maxCardW - padX * 2, 2);
  ctx.font = "11px ui-sans-serif, system-ui";
  const bodyRowSets = lines.map((l) => wrapLines(ctx, l, maxCardW - padX * 2, 2));

  let maxW = 0;
  ctx.font = "bold 11px ui-sans-serif, system-ui";
  for (const r of titleRows) maxW = Math.max(maxW, ctx.measureText(r).width);
  ctx.font = "11px ui-sans-serif, system-ui";
  for (const rows of bodyRowSets) for (const r of rows) maxW = Math.max(maxW, ctx.measureText(r).width);

  const totalRows = titleRows.length + bodyRowSets.reduce((sum, rows) => sum + rows.length, 0);
  const w = Math.min(maxCardW, maxW + padX * 2);
  const h = padY * 2 + lineH * totalRows;
  const x = anchor.x - w / 2;
  const y = anchor.y - h - 10;

  ctx.fillStyle = "rgba(10, 14, 12, 0.92)";
  ctx.strokeStyle = "rgba(103, 232, 249, 0.5)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();

  // Small pointer triangle toward the agent
  ctx.beginPath();
  ctx.moveTo(anchor.x - 6, y + h);
  ctx.lineTo(anchor.x + 6, y + h);
  ctx.lineTo(anchor.x, y + h + 8);
  ctx.closePath();
  ctx.fillStyle = "rgba(10, 14, 12, 0.92)";
  ctx.fill();

  ctx.textAlign = "left";
  let cy = y + padY + 10;
  ctx.fillStyle = "#67e8f9";
  ctx.font = "bold 11px ui-sans-serif, system-ui";
  for (const r of titleRows) {
    ctx.fillText(r, x + padX, cy);
    cy += lineH;
  }
  ctx.fillStyle = "#e5e7eb";
  ctx.font = "11px ui-sans-serif, system-ui";
  for (const rows of bodyRowSets) {
    for (const r of rows) {
      ctx.fillText(r, x + padX, cy);
      cy += lineH;
    }
  }
  ctx.restore();
}

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Pure measurement pass: greedy word-wraps `text` to `maxW` at the
 * ctx's *currently set* font, capped at `maxRows` (extra content is
 * truncated with an ellipsis on the last row). Draws nothing -- callers
 * use this to size a layout before drawing it, which is what the
 * earlier single-pass wrapText got wrong. */
function wrapLines(ctx: any, text: string, maxW: number, maxRows: number): string[] {
  const words = text.split(" ");
  const rows: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      rows.push(line);
      line = word;
      if (rows.length >= maxRows) break;
    } else {
      line = test;
    }
  }
  if (rows.length < maxRows && line) rows.push(line);
  if (rows.length === 0) rows.push("");
  if (rows.length >= maxRows) {
    const last = rows[maxRows - 1];
    // Only append an ellipsis if there was genuinely more text than fit.
    const consumed = rows.slice(0, maxRows).join(" ").length;
    if (consumed < text.length) rows[maxRows - 1] = last.replace(/\s*$/, "") + "\u2026";
  }
  return rows.slice(0, maxRows);
}

/** Expanding, fading ring burst at the moment an agent's real route
 * completes (motion.path.length transitions from >0 to 0) -- `t` in
 * [0, 1] is elapsed-fraction of a short, fixed cosmetic duration owned
 * by the caller, not simulation time. */
export function drawArrivalBurst(ctx: any, cam: Camera, worldX: number, worldY: number, t: number) {
  const s = toScreen(projectIso(worldX, worldY, 0), cam);
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - t);
  ctx.strokeStyle = "#34d399";
  ctx.lineWidth = Math.max(1, 2 * cam.scale);
  ctx.beginPath();
  ctx.arc(s.x, s.y, (4 + t * 22) * cam.scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Floating, rising, fading delta text (e.g. "Hunger 28% \u2192 78%") near
 * an agent -- backed entirely by the real before/after AgentDelta the
 * activity-feed diff already computed (lib/activityFeed.ts). `t` in
 * [0, 1] is the caller-owned fade progress.
 *
 * Offset to the side (not straight up) so it doesn't collide with the
 * WHY card, which is anchored directly above the agent -- an earlier
 * version stacked both vertically and they visibly overlapped in the
 * render check. */
export function drawDeltaBadge(ctx: any, cam: Camera, worldX: number, worldY: number, text: string, t: number) {
  const s = toScreen(projectIso(worldX, worldY, 22 + t * 10), cam);
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - t);
  ctx.font = "bold 11px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = "#0a0e0c";
  ctx.fillText(text, s.x + 14, s.y + 1);
  ctx.fillStyle = "#67e8f9";
  ctx.fillText(text, s.x + 13, s.y);
  ctx.restore();
}

/** Dashed link between two real, currently-co-located agents while both
 * are mid-socialize, with a small speech-bubble mark at the midpoint --
 * the "social connection line when real socialization occurs" cue. Only
 * ever called by the caller for two agents it has already verified are
 * both `current_action.action_type === "socialize"` at the same
 * `location_id`. Drawn with plain Canvas2D primitives rather than an
 * emoji glyph, for the same cross-platform-reliability reason as the
 * action badge above. */
export function drawSocialLink(ctx: any, cam: Camera, a: Point, b: Point, t: number) {
  const pa = toScreen(projectIso(a.x, a.y, 24), cam);
  const pb = toScreen(projectIso(b.x, b.y, 24), cam);
  const pulse = (Math.sin(t * 4) + 1) / 2;
  ctx.save();
  ctx.strokeStyle = "#a78bfa";
  ctx.globalAlpha = 0.5 + pulse * 0.3;
  ctx.lineWidth = Math.max(1, 1.6 * cam.scale);
  ctx.setLineDash([3 * cam.scale, 4 * cam.scale]);
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  const mx = (pa.x + pb.x) / 2;
  const my = (pa.y + pb.y) / 2;
  const r = Math.max(6, 8 * cam.scale);
  roundRect(ctx, mx - r, my - r * 0.75, r * 2, r * 1.5, r * 0.4);
  ctx.fillStyle = "#f5f3ff";
  ctx.fill();
  ctx.strokeStyle = "#a78bfa";
  ctx.lineWidth = Math.max(0.6, 0.8 * cam.scale);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(mx - r * 0.2, my + r * 0.7);
  ctx.lineTo(mx - r * 0.05, my + r * 1.15);
  ctx.lineTo(mx + r * 0.3, my + r * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#a78bfa";
  const dotR = Math.max(0.6, r * 0.11);
  for (const dx of [-0.35, 0, 0.35]) {
    ctx.beginPath();
    ctx.arc(mx + dx * r, my - r * 0.02, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export { depthKey };
