"use client";

/**
 * CityCanvasIso -- Isometric vertical-slice renderer ("Living City" v5).
 *
 * Scope (per the approved vertical-slice plan): ONE real, currently-active
 * ECHO neighborhood, windowed to that neighborhood's full set of real
 * locations (see lib/isometricAdapter.ts's pickIsoSlice, which mirrors the selection
 * logic lib/adapters/3dAdapter.ts already used for the earlier Three.js
 * prototype). Real agents currently at those locations are drawn as
 * small isometric sprites and walk real routes between them.
 *
 * Everything spatial still comes from the existing, untouched
 * lib/cityLayout.ts (buildCityLayout / buildRoadNetwork /
 * routeBetweenLocations / agentJitter / hash01). This component's ONLY
 * job is: (a) pick+lock a small slice of that layout via
 * lib/isometricAdapter.ts, (b) run the exact same plan-space motion
 * interpolation CityCanvas.tsx already uses, and (c) project the result
 * through a true isometric transform (lib/isometricAdapter.ts +
 * lib/isoRenderer.ts) instead of drawing it top-down.
 *
 * Nothing here invents agent position, routes, or simulation state --
 * see the module docs on isometricAdapter.ts / isoRenderer.ts for the
 * exact boundary between "real backend truth" and "presentation-only."
 */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Agent, AgentDelta, Location, Neighborhood } from "@/lib/types";
import {
  Point,
  agentJitter,
  routeBetweenLocations,
} from "@/lib/cityLayout";
import {
  IsoBuilding,
  IsoSlice,
  PropPlacement,
  depthKey,
  lotRect,
  neighborhoodTint,
  pickIsoSlice,
  projectBuilding,
  projectIso,
  scatterProps,
  zoomTier,
} from "@/lib/isometricAdapter";
import {
  Camera,
  actionGlyph,
  drawAgentSprite,
  drawArrivalBurst,
  drawArterialRoad,
  drawBench,
  drawBin,
  drawBuilding,
  drawBush,
  drawDeltaBadge,
  drawDestinationMarker,
  drawFence,
  drawGroundShadow,
  drawGroundStripLocal,
  drawLamp,
  drawLot,
  drawNeighborhoodGround,
  drawNeighborhoodLabel,
  drawPlanter,
  drawRoutePath,
  drawSidewalkStub,
  drawSign,
  drawSocialLink,
  drawStall,
  drawTree,
  drawWhyCard,
  toScreen,
} from "@/lib/isoRenderer";
import { hash01 } from "@/lib/cityLayout";

interface CityCanvasIsoProps {
  neighborhoods: Neighborhood[];
  locations: Location[];
  agents: Agent[];
  tick: number;
  selectedAgentId?: string;
  onSelectAgent: (agent: Agent) => void;
  onSelectLocation: (location: Location) => void;
  latestDeltas?: Map<string, AgentDelta>;
  onFollowingChange?: (following: boolean) => void;
}

export interface CityCanvasIsoHandle {
  followSelected: () => void;
  exitFollow: () => void;
}

interface AgentMotion {
  pos: Point; // plan-space (x, y) -- same unit lib/cityLayout.ts uses everywhere else
  path: Point[];
  lastLocationId: string;
  facing: number;
  walkPhase: number;
  walkAmplitude: number;
  /** Real backend location_id the agent has actually moved to but whose
   * walk animation hasn't started yet, because a previous walk is still
   * mid-flight. We never interrupt an in-progress route (that would snap
   * the sprite backward mid-stride); instead the next destination waits
   * here and is picked up the instant the current path empties. The
   * agent's true authoritative location (`agent.location_id`) is already
   * correct the moment it arrives from the API -- this queue only paces
   * how the *visualization* catches up, exactly the kind of
   * presentation-only timing change the brief calls for. */
  pendingLocationId: string | null;
  /** Total plan-space length of the path currently being walked, frozen
   * at assignment time -- used to derive an ease-in/ease-out speed curve
   * so a walk visibly accelerates away from its start and decelerates
   * into its destination instead of moving at one constant dial-tone
   * speed. */
  pathLength: number;
  pathTraveled: number;
  /** Plan-px/second for *this* leg specifically, derived once in
   * beginWalk() from pathLength so every walk's real-world duration
   * lands inside [MIN_WALK_MS, MAX_WALK_MS] -- a short next-door hop
   * isn't instant, and a long cross-slice trek doesn't drag on forever,
   * while still reading as one consistent human walking pace for
   * typical distances. */
  speedPxPerS: number;
  /** True the instant `path` empties after having had at least one
   * waypoint -- used to fire a one-shot arrival visual. */
  wasMoving: boolean;
  arrivedAt: number | null; // performance.now() timestamp, for the arrival-burst fade
}

// --- Movement pacing (Step 1: "citizens move too fast") ---------------
// The previous build advanced every agent by a fixed 16 plan-space px on
// *every animation frame* regardless of real elapsed time -- at 60fps
// that is ~960 plan-px/s, fast enough to cross this slice's entire
// visible area in well under a second, far faster than a viewer can
// track "they left A, they're passing B, they're arriving at C." This
// pass switches to a real-time-driven (delta-time) speed so pacing is
// stable across refresh rates.
//
// Visual milestone pass: 150px/s + a 900ms floor still read as "NPC
// sprinting." These constants (95px/s, 2000/8500ms) were a first guess
// that turned out too slow once checked against real route lengths --
// harness/render_checks/stage2_walk_pacing.ts runs the actual
// buildCityLayout/buildRoadNetwork/routeBetweenLocations against a real
// 8-location neighborhood and found real routes cluster 607-1373
// plan-px, which at 95px/s all crowded into 6.4-8.5s (average 8.0s,
// pinned near the cap) instead of spreading across the brief's
// short/medium/long bands. 180px/s + a 1500ms floor, checked against
// that same real data, spreads real routes 3.4-7.6s (average 5.5s) --
// actually inside the target short(~2-3s)/medium(~4-6s)/long(~7-9s)
// range instead of guessed at.
const WALK_SPEED_PX_PER_S = 180; // plan-space px/second (was 150, then 95, originally ~960)
const MIN_WALK_MS = 1500; // even a same-row hop takes at least this long to animate (was 900, then 2000)
const MAX_WALK_MS = 8500; // a full cross-slice trek is capped so it never drags (was 4200)
const WALK_PHASE_PER_PX = 0.14;
const FOLLOW_ZOOM = 5.2; // multiple of the slice's establishing-fit scale
const FOLLOW_TRANSITION_MS = 550;
const ARRIVAL_BURST_MS = 900;
const WHY_CARD_MIN_SCALE_FACTOR = 1.3; // only draw the WHY card once zoomed in a bit past the establishing view

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Total plan-space length of a waypoint path (used to derive walk
 * duration/pacing -- see AgentMotion.pathLength docs above). */
function pathLength(path: Point[], from: Point): number {
  let total = 0;
  let prev = from;
  for (const p of path) {
    total += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return total;
}

/**
 * Starts a fresh visible walk toward `newLocationId`, computing the real
 * route through `slice.network` (the same road graph every other
 * renderer already routes through) from the motion's last completed
 * location. Mutates `motion` in place. If a route can't be resolved
 * (e.g. a location id momentarily missing from the layout right after a
 * population reset), falls back to a direct glide to `target` rather
 * than leaving the sprite stuck -- the same fallback the original build
 * already relied on.
 */
function beginWalk(motion: AgentMotion, slice: IsoSlice, target: Point | undefined, newLocationId: string) {
  const route = target ? routeBetweenLocations(slice.layout, slice.network, motion.lastLocationId, newLocationId) : null;
  motion.path = route && target ? [...route, target] : target ? [target] : [];
  motion.lastLocationId = newLocationId;
  motion.pathLength = pathLength(motion.path, motion.pos);
  motion.pathTraveled = 0;
  const rawDurationMs = motion.pathLength > 0 ? (motion.pathLength / WALK_SPEED_PX_PER_S) * 1000 : 0;
  const clampedDurationMs = Math.max(MIN_WALK_MS, Math.min(MAX_WALK_MS, rawDurationMs || MIN_WALK_MS));
  motion.speedPxPerS = motion.pathLength > 0 ? (motion.pathLength / clampedDurationMs) * 1000 : WALK_SPEED_PX_PER_S;
}

type Drawable =
  | { kind: "building"; key: number; b: IsoBuilding }
  | { kind: "prop"; key: number; p: PropPlacement }
  | { kind: "agent"; key: number; agent: Agent; pos: Point; motion: AgentMotion };

export const CityCanvasIso = forwardRef<CityCanvasIsoHandle, CityCanvasIsoProps>(function CityCanvasIso(
  { neighborhoods, locations, agents, selectedAgentId, onSelectAgent, onSelectLocation, latestDeltas, onFollowingChange },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const selectedIdRef = useRef(selectedAgentId);
  selectedIdRef.current = selectedAgentId;
  const deltasRef = useRef(latestDeltas);
  deltasRef.current = latestDeltas;

  const topologySignature = useMemo(
    () => neighborhoods.map((n) => n.id).sort().join(",") + "|" + locations.map((l) => l.id).sort().join(","),
    [neighborhoods, locations]
  );

  // --- Lock the vertical-slice scene once, like 3dAdapter's
  // "scene identity locks on first successful pick" -- re-picked only on
  // a genuine topology change (population reset), never re-litigated
  // every tick just because occupancy shifted. ---
  const sliceRef = useRef<IsoSlice | null>(null);
  const sliceSignatureRef = useRef<string | null>(null);
  const buildingsRef = useRef<IsoBuilding[]>([]);
  const propsRef = useRef<PropPlacement[]>([]);
  const [sliceReady, setSliceReady] = useState(false);
  // Bumped every time a *new* slice is actually picked (population reset
  // -> new topologySignature), as opposed to `sliceReady`, which only
  // ever flips false->true once. The fit/follow-reset effect below needs
  // to re-run on every fresh pick, not just the first one -- keying it
  // off a boolean that's already `true` after the first slice meant a
  // reset's dependency array never changed, so that effect silently
  // stopped re-firing on subsequent resets (see report, "reset" finding).
  const [sliceVersion, setSliceVersion] = useState(0);

  useEffect(() => {
    if (sliceSignatureRef.current === topologySignature && sliceRef.current) return;
    const slice = pickIsoSlice({ neighborhoods, locations, agents });
    if (!slice) return;
    sliceRef.current = slice;
    sliceSignatureRef.current = topologySignature;
    buildingsRef.current = slice.tiles.map(projectBuilding);
    propsRef.current = scatterProps(slice.tiles);
    motionRef.current = new Map();
    setSliceReady(true);
    setSliceVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologySignature]);

  const motionRef = useRef<Map<string, AgentMotion>>(new Map());
  const renderedAgentsRef = useRef<{ agent: Agent; sx: number; sy: number; r: number }[]>([]);
  const lastFrameTimeRef = useRef<number | null>(null);
  // First-seen wall-clock time for each (agentId, delta label) pair we've
  // already rendered a fading badge for, so the badge fades out once and
  // doesn't restart every frame just because latestDeltas still holds it.
  const deltaSeenRef = useRef<Map<string, number>>(new Map());
  const clockPhaseRef = useRef(0); // free-running phase for looping cosmetic animations (pulses, dashes)
  const [followNotice, setFollowNotice] = useState<string | null>(null);
  const followNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hovered, setHovered] = useState<{ kind: "agent" | "location"; name: string; sub: string; x: number; y: number } | null>(null);
  const [following, setFollowing] = useState(false);
  const followingRef = useRef(following);
  followingRef.current = following;

  const camRef = useRef<Camera>({ scale: 1, offsetX: 0, offsetY: 0 });
  const fitScaleRef = useRef(1);
  const hasUserAdjustedRef = useRef(false);
  const dragRef = useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number; moved: boolean } | null>(null);
  const followTransitionRef = useRef<{ active: boolean; start: number; fromScale: number; fromX: number; fromY: number; mode: "in" | "out" } | null>(null);
  const explicitExitRef = useRef(false);
  const prevFollowingRef = useRef(false);

  const fitToSlice = useCallback((cw: number, ch: number) => {
    const slice = sliceRef.current;
    const buildings = buildingsRef.current;
    if (!slice || buildings.length === 0) return;
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
    const scale = Math.min((cw - pad * 2) / contentW, (ch - pad * 2) / contentH);
    fitScaleRef.current = scale;
    camRef.current = {
      scale,
      offsetX: cw / 2 - ((minX + maxX) / 2) * scale,
      offsetY: ch / 2 - ((minY + maxY) / 2) * scale,
    };
  }, []);

  useEffect(() => {
    hasUserAdjustedRef.current = false;
    explicitExitRef.current = false;
    followTransitionRef.current = null;
    setFollowing(false);
    const container = containerRef.current;
    if (container && sliceReady) fitToSlice(container.clientWidth, container.clientHeight);
    // sliceVersion (not sliceReady) drives this: sliceReady only ever
    // flips false->true once, so a later reset -- which picks a genuine
    // new slice but leaves sliceReady already true -- would otherwise
    // never re-trigger this refit/Follow-clear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliceVersion, fitToSlice]);

  const MIN_SCALE_FACTOR = 0.7;
  const MAX_SCALE_FACTOR = 8;

  const zoomAt = useCallback((screenX: number, screenY: number, factor: number) => {
    const cam = camRef.current;
    const fit = fitScaleRef.current || cam.scale;
    const newScale = Math.min(fit * MAX_SCALE_FACTOR, Math.max(fit * MIN_SCALE_FACTOR, cam.scale * factor));
    if (newScale === cam.scale) return;
    const worldX = (screenX - cam.offsetX) / cam.scale;
    const worldY = (screenY - cam.offsetY) / cam.scale;
    camRef.current = { scale: newScale, offsetX: screenX - worldX * newScale, offsetY: screenY - worldY * newScale };
    hasUserAdjustedRef.current = true;
  }, []);

  const resetView = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    fitToSlice(container.clientWidth, container.clientHeight);
    hasUserAdjustedRef.current = false;
    explicitExitRef.current = false;
    followTransitionRef.current = null;
    setFollowing(false);
  }, [fitToSlice]);

  const showFollowNotice = useCallback((msg: string) => {
    setFollowNotice(msg);
    if (followNoticeTimerRef.current) clearTimeout(followNoticeTimerRef.current);
    followNoticeTimerRef.current = setTimeout(() => setFollowNotice(null), 4200);
  }, []);

  const startFollow = useCallback(() => {
    const selectedId = selectedIdRef.current;
    const slice = sliceRef.current;
    if (!selectedId || !slice) return;
    const agent = agentsRef.current.find((a) => a.id === selectedId);
    // Guard: Follow Mode only works on a citizen whose real location_id
    // this scene actually renders, or who's already mid-transit and
    // tracked. As of Phase B (Living City milestone), this slice renders
    // every real location across every real neighborhood, so any real
    // agent's location_id is always present here -- this branch is now
    // effectively unreachable in normal operation. Left in place as a
    // defensive guard (rather than removed) in case a future change
    // narrows what a slice renders again (e.g. a deliberate
    // single-district view mode), so Follow Mode fails loudly with a
    // message instead of silently doing nothing.
    const trackable = (agent && slice.locationIds.has(agent.location_id)) || motionRef.current.has(selectedId);
    if (!trackable) {
      showFollowNotice(`${agent?.name || "This citizen"} isn't in a location this view currently renders, so there's nothing to follow yet.`);
      return;
    }
    explicitExitRef.current = false;
    setFollowing(true);
  }, [showFollowNotice]);
  const exitFollow = useCallback(() => {
    explicitExitRef.current = true;
    setFollowing(false);
  }, []);

  useImperativeHandle(ref, () => ({ followSelected: startFollow, exitFollow }), [startFollow, exitFollow]);
  useEffect(() => onFollowingChange?.(following), [following, onFollowingChange]);

  // --- Pointer interaction: wheel zoom, drag pan, click to select ------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    };
    const onPointerDown = (e: PointerEvent) => {
      dragRef.current = { startX: e.clientX, startY: e.clientY, startOffsetX: camRef.current.offsetX, startOffsetY: camRef.current.offsetY, moved: false };
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      if (drag.moved) {
        camRef.current = { ...camRef.current, offsetX: drag.startOffsetX + dx, offsetY: drag.startOffsetY + dy };
        hasUserAdjustedRef.current = true;
        if (followingRef.current) exitFollow();
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || drag.moved) return;
      const rect = canvas.getBoundingClientRect();
      handleClick(e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomAt, exitFollow]);

  const handleClick = (screenX: number, screenY: number) => {
    // Hit-test agents first (they're drawn on top), by screen-space
    // distance to each one's last-rendered projected position.
    let bestAgent: Agent | null = null;
    let bestDist = Infinity;
    for (const r of renderedAgentsRef.current) {
      const d = Math.hypot(screenX - r.sx, screenY - r.sy);
      if (d < r.r && d < bestDist) {
        bestDist = d;
        bestAgent = r.agent;
      }
    }
    if (bestAgent) {
      onSelectAgent(bestAgent);
      return;
    }
    const slice = sliceRef.current;
    if (!slice) return;
    for (const b of buildingsRef.current) {
      const corners = [b.floor.back, b.floor.right, b.floor.front, b.floor.left].map((p) => toScreen(p, camRef.current));
      if (pointInPolygon(screenX, screenY, corners)) {
        const loc = locations.find((l) => l.id === b.loc.id);
        if (loc) onSelectLocation(loc);
        return;
      }
    }
  };

  // --- Main draw loop ----------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!hasUserAdjustedRef.current) fitToSlice(cw, ch);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const frame = () => {
      const slice = sliceRef.current;
      if (!slice) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }
      const cw = container.clientWidth;
      const ch = container.clientHeight;

      const now = performance.now();
      const dtMs = lastFrameTimeRef.current === null ? 16 : Math.min(100, now - lastFrameTimeRef.current);
      lastFrameTimeRef.current = now;
      clockPhaseRef.current += dtMs / 1000;

      // --- Advance real agent motion for every real agent, across every
      // real neighborhood -- as of Phase B (Living City milestone) this
      // slice covers the whole city, not one windowed neighborhood, so
      // all real, currently-placed agents are eligible to be drawn. ---
      const currentAgents = agentsRef.current.filter(
        (a) => slice.locationIds.has(a.location_id) || motionRef.current.has(a.id)
      );
      const motions = motionRef.current;
      const nextRendered: { agent: Agent; sx: number; sy: number; r: number }[] = [];
      const drawableAgents: Drawable[] = [];

      for (const agent of currentAgents) {
        const tile = slice.layout.locationById.get(agent.location_id);
        const stillInSlice = slice.locationIds.has(agent.location_id);
        if (!stillInSlice && !motions.has(agent.id)) continue; // left the slice and was never tracked
        const target = tile ? agentJitter(agent.id, tile) : undefined;

        let motion = motions.get(agent.id);
        if (!motion) {
          if (!target) continue;
          motion = {
            pos: { ...target },
            path: [],
            lastLocationId: agent.location_id,
            facing: 0,
            walkPhase: 0,
            walkAmplitude: 0,
            pendingLocationId: null,
            pathLength: 0,
            pathTraveled: 0,
            speedPxPerS: WALK_SPEED_PX_PER_S,
            wasMoving: false,
            arrivedAt: null,
          };
          motions.set(agent.id, motion);
        } else if (agent.location_id !== motion.lastLocationId) {
          // The backend already moved this agent (its authoritative
          // location_id has changed) -- but if the visualization is
          // still mid-walk on a *previous* hop, don't rip that walk out
          // from under the viewer; queue this destination and start it
          // the moment the current path finishes. If several backend
          // ticks land while a slow visual walk is still in flight
          // (possible at high playback speeds), only the latest queued
          // destination is kept -- the agent's true final position is
          // never in doubt, only how many intermediate hops get
          // individually animated.
          if (motion.path.length > 0) {
            motion.pendingLocationId = agent.location_id;
          } else {
            beginWalk(motion, slice, target, agent.location_id);
          }
        } else if (motion.path.length === 0 && target && motion.pendingLocationId === null) {
          motion.pos = { ...target };
        }

        // A previous walk just finished and another real destination is
        // already queued -- start it now instead of sitting idle.
        if (motion.path.length === 0 && motion.pendingLocationId) {
          const nextLoc = motion.pendingLocationId;
          motion.pendingLocationId = null;
          beginWalk(motion, slice, target, nextLoc);
        }

        // --- Time-driven step (real elapsed ms * a fixed plan-space
        // speed), replacing the old fixed-px-per-*frame* budget. This is
        // the core fix for "movement is too fast / hard to observe":
        // frame-based stepping ran at whatever the display's refresh
        // rate was (960 plan-px/s @60fps), while this is a real-time
        // rate (150 plan-px/s) that reads as an actual walking pace and
        // stays correct at any frame rate. `easeScale` gently slows the
        // very start and end of each leg so a walk doesn't begin/end at
        // a dead-stop-to-full-speed snap. ---
        let distanceThisFrame = 0;
        if (motion.path.length > 0) {
          const totalLen = Math.max(1, motion.pathLength);
          const progress = Math.min(1, motion.pathTraveled / totalLen);
          const easeScale = 0.55 + 0.45 * Math.sin(Math.min(1, progress) * Math.PI); // slow start/end, full speed mid-leg
          let budget = (motion.speedPxPerS * dtMs * easeScale) / 1000;
          while (motion.path.length > 0 && budget > 0) {
            const next = motion.path[0];
            const dx = next.x - motion.pos.x;
            const dy = next.y - motion.pos.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= budget) {
              motion.pos = { ...next };
              if (dist > 0.001) motion.facing = Math.atan2(dy, dx);
              motion.path.shift();
              budget -= dist;
              distanceThisFrame += dist;
              motion.pathTraveled += dist;
            } else {
              motion.facing = Math.atan2(dy, dx);
              const stepPos = { x: motion.pos.x + (dx / dist) * budget, y: motion.pos.y + (dy / dist) * budget };
              distanceThisFrame += Math.hypot(stepPos.x - motion.pos.x, stepPos.y - motion.pos.y);
              motion.pathTraveled += Math.hypot(stepPos.x - motion.pos.x, stepPos.y - motion.pos.y);
              motion.pos = stepPos;
              budget = 0;
            }
          }
        }
        const isMoving = motion.path.length > 0;
        motion.walkPhase += distanceThisFrame * WALK_PHASE_PER_PX;
        motion.walkAmplitude += ((isMoving ? 1 : 0) - motion.walkAmplitude) * 0.25;

        if (motion.wasMoving && !isMoving) {
          motion.arrivedAt = now;
        }
        motion.wasMoving = isMoving;

        // Drop tracking once a departed agent's path is fully walked out
        // of frame-relevance (they've reached their off-slice location).
        if (!stillInSlice && motion.path.length === 0 && !motion.pendingLocationId) {
          motions.delete(agent.id);
          continue;
        }

        drawableAgents.push({
          kind: "agent",
          // +0.01 epsilon: with a single depthKey per drawable, an agent
          // standing right at a building's own anchor point (e.g. under
          // a leisure pavilion's translucent canopy, or at a market
          // stall) can tie with that building's depthKey and the
          // painter's algorithm's draw order becomes arbitrary -- the
          // render check showed agents disappearing under a pavilion
          // roof because of exactly this. A tiny bias makes agents
          // reliably win close ties (drawn after/on top of whatever
          // building they're standing at) without disturbing ordering
          // against anything actually farther away.
          key: depthKey(motion.pos.x, motion.pos.y) + 0.01,
          agent,
          pos: motion.pos,
          motion,
        });
      }

      // --- Follow camera ---------------------------------------------------
      // The camera tracks the agent's real interpolated motion.pos every
      // frame. Now that the slice renders the full city's real location
      // set (Phase B; see pickIsoSlice in isometricAdapter.ts), a
      // followed agent's motion entry should never legitimately
      // disappear mid-follow -- but this fallback is kept as a genuine
      // safety net (e.g. the agent is removed from the world entirely,
      // as on a population reset): if the followed agent's motion
      // vanishes, Follow Mode exits itself gracefully with an on-screen
      // notice instead of silently freezing on their last position.
      //  - a small forward "lead" offset in the direction of travel, so
      //    the destination side of the screen has room to see where
      //    they're headed rather than centering exactly on their feet.
      const selectedId = selectedIdRef.current;
      const followedMotion = selectedId ? motions.get(selectedId) : undefined;
      if (following && selectedId && !followedMotion) {
        const agentName = agentsRef.current.find((a) => a.id === selectedId)?.name || "This citizen";
        showFollowNotice(`Lost track of ${agentName} -- returning to the establishing view.`);
        explicitExitRef.current = true;
        setFollowing(false);
      }
      if (following !== prevFollowingRef.current) {
        const cam = camRef.current;
        followTransitionRef.current = {
          active: true,
          start: performance.now(),
          fromScale: cam.scale,
          fromX: cam.offsetX,
          fromY: cam.offsetY,
          mode: following ? "in" : "out",
        };
        prevFollowingRef.current = following;
      }
      if (following && followedMotion) {
        const leadDist = followedMotion.path.length > 0 ? 46 : 0;
        const leadX = Math.cos(followedMotion.facing) * leadDist;
        const leadY = Math.sin(followedMotion.facing) * leadDist;
        const proj = projectIso(followedMotion.pos.x + leadX, followedMotion.pos.y + leadY, 0);
        const targetScale = (fitScaleRef.current || 1) * FOLLOW_ZOOM;
        const targetX = cw / 2 - proj.sx * targetScale;
        const targetY = ch / 2 - proj.sy * targetScale + ch * 0.08;
        const trans = followTransitionRef.current;
        if (trans?.active) {
          const t = Math.min(1, (performance.now() - trans.start) / FOLLOW_TRANSITION_MS);
          const e = easeInOutCubic(t);
          camRef.current = {
            scale: trans.fromScale + (targetScale - trans.fromScale) * e,
            offsetX: trans.fromX + (targetX - trans.fromX) * e,
            offsetY: trans.fromY + (targetY - trans.fromY) * e,
          };
          if (t >= 1) followTransitionRef.current = null;
        } else {
          // Smoothly ease toward the live target every frame (rather than
          // snapping straight onto it) so small per-frame position deltas
          // don't read as camera jitter while still tracking the agent's
          // *real* interpolated position with no perceptible lag.
          const cam = camRef.current;
          const smooth = 1 - Math.pow(0.001, dtMs / 1000);
          camRef.current = {
            scale: targetScale,
            offsetX: cam.offsetX + (targetX - cam.offsetX) * smooth,
            offsetY: cam.offsetY + (targetY - cam.offsetY) * smooth,
          };
        }
      } else if (!following && explicitExitRef.current) {
        // Explicit "stop following" -- ease back to the establishing
        // slice-fit view, computed fresh each frame (cheap: a handful of
        // building corners) rather than cached, since the transition is
        // only a few frames long.
        const trans = followTransitionRef.current;
        if (trans?.active) {
          fitToSlice(cw, ch);
          const target = { ...camRef.current };
          const t = Math.min(1, (performance.now() - trans.start) / FOLLOW_TRANSITION_MS);
          const e = easeInOutCubic(t);
          camRef.current = {
            scale: trans.fromScale + (target.scale - trans.fromScale) * e,
            offsetX: trans.fromX + (target.offsetX - trans.fromX) * e,
            offsetY: trans.fromY + (target.offsetY - trans.fromY) * e,
          };
          if (t >= 1) {
            followTransitionRef.current = null;
            explicitExitRef.current = false;
          }
        }
      }

      const cam = camRef.current;

      // --- Draw ------------------------------------------------------------
      ctx.save();
      ctx.fillStyle = "#1b2420";
      ctx.fillRect(0, 0, cw, ch);

      // Ground plaza backdrop behind the whole slice
      ctx.fillStyle = "#242f28";
      ctx.fillRect(0, 0, cw, ch);

      // Full-city establishing view (Living City milestone Phase B):
      // ground tint + label per real neighborhood, every real
      // neighborhood's own local street, and the inter-district arterial
      // roads connecting them (slice.network.hubEdges) -- previously
      // only a single "active" neighborhood's street was ever drawn here.
      for (let i = 0; i < slice.layout.neighborhoods.length; i++) {
        const hood = slice.layout.neighborhoods[i];
        drawNeighborhoodGround(ctx, cam, hood, neighborhoodTint(i));
      }
      for (const edge of slice.network.hubEdges) {
        drawArterialRoad(ctx, cam, edge);
      }
      for (const hood of slice.layout.neighborhoods) {
        const street = slice.network.streets.get(hood.id);
        if (street) {
          drawGroundStripLocal(ctx, cam, street.y, street.x1, street.x2, 7, "#3d4147");
          drawGroundStripLocal(ctx, cam, street.y - 12, street.x1, street.x2, 3, "#8d8a7e");
          drawGroundStripLocal(ctx, cam, street.y + 12, street.x1, street.x2, 3, "#8d8a7e");
        }
      }
      for (const hood of slice.layout.neighborhoods) {
        drawNeighborhoodLabel(ctx, cam, hood);
      }
      for (const tile of slice.tiles) {
        const entrance = slice.network.entrances.get(tile.id);
        if (entrance) {
          drawSidewalkStub(ctx, cam, { x: tile.x + tile.w / 2, y: tile.y + tile.h / 2 }, entrance);
        }
      }

      // Ground-plane lot fills (grass/pavement) are painted here, as an
      // always-background pass, deliberately *outside* the depth-sorted
      // loop below. They used to be drawn immediately before each
      // building inside that loop, sharing the building's own depthKey
      // slot -- which put a solid ground fill later in paint order than
      // any agent standing on that same lot with a smaller depthKey
      // (agents nearer the "back" of their tile than its center), so the
      // opaque lot silently erased them before the building/canopy even
      // drew. The render check caught this as agents disappearing
      // completely under a leisure pavilion's canopy. Lots are always
      // ground-level, so they belong in the background pass with the
      // street/sidewalks, never interleaved with agents.
      for (const b of buildingsRef.current) {
        drawLot(ctx, cam, b);
      }

      const drawables: Drawable[] = [
        ...buildingsRef.current.map((b) => ({ kind: "building" as const, key: b.depthKey, b })),
        ...propsRef.current.map((p) => ({ kind: "prop" as const, key: p.depthKey, p })),
        ...drawableAgents,
      ];
      drawables.sort((a, b) => a.key - b.key);

      for (const d of drawables) {
        if (d.kind === "building") {
          drawBuilding(ctx as any, cam, d.b);
        } else if (d.kind === "prop") {
          if (d.p.kind === "tree") drawTree(ctx as any, cam, d.p);
          else if (d.p.kind === "lamp") drawLamp(ctx as any, cam, d.p);
          else if (d.p.kind === "bench") drawBench(ctx as any, cam, d.p);
          else if (d.p.kind === "stall") drawStall(ctx as any, cam, d.p);
          else if (d.p.kind === "planter") drawPlanter(ctx as any, cam, d.p);
          else if (d.p.kind === "fence") drawFence(ctx as any, cam, d.p);
          else if (d.p.kind === "sign") drawSign(ctx as any, cam, d.p);
          else if (d.p.kind === "bush") drawBush(ctx as any, cam, d.p);
          else if (d.p.kind === "bin") drawBin(ctx as any, cam, d.p);
        } else {
          const isSelected = d.agent.id === selectedIdRef.current;
          const s = toScreen(projectIso(d.pos.x, d.pos.y, 0), cam);
          drawAgentSprite(ctx as any, cam, d.pos.x, d.pos.y, {
            phase: d.motion.walkPhase,
            amplitude: d.motion.walkAmplitude,
            highlight: isSelected,
            facing: d.motion.facing,
            // LOD: the selected/followed citizen always gets full detail
            // (hair, shoes, size bump) regardless of zoom -- that's the
            // one the viewer is meant to be reading closely. Everyone
            // else gets "simple" (capsule body, no hair/shoe detail,
            // cheapest to draw) at the city-overview tier, and
            // "readable" (filled limbs + hair, no extra size) once
            // zoomed past neighborhood scale -- so 100 agents spread
            // across the full city don't all cost detailed-tier render
            // time in the wide shot, but nobody in a close-in view reads
            // as a blob either. zoomTier() (isometricAdapter.ts) is the
            // same shared tier building archetypes/interiors will key
            // off of in later phases of this milestone.
            lod: isSelected ? "detailed" : zoomTier(cam.scale, fitScaleRef.current || 1) === "overview" ? "simple" : "readable",
            // The WHY card (drawn later, on top, for the selected agent
            // once zoomed in) already headlines with the agent's name --
            // suppress the plain floating label in that case so the two
            // don't visually stack on top of each other.
            label:
              isSelected && cam.scale > (fitScaleRef.current || 1) * WHY_CARD_MIN_SCALE_FACTOR
                ? undefined
                : isSelected || cam.scale > (fitScaleRef.current || 1) * 1.6
                  ? d.agent.name
                  : undefined,
            tint: isSelected ? "#f97316" : actionTint(d.agent),
            clothSeed: hash01(d.agent.id + ":cloth"),
            glyph: cam.scale > (fitScaleRef.current || 1) * 1.4 ? actionGlyph(d.agent.current_action?.action_type) : undefined,
          });
          nextRendered.push({ agent: d.agent, sx: s.x, sy: s.y, r: Math.max(14, 20 * cam.scale) });
        }
      }

      // --- Causality overlays (Step 6/7: "make causality visible inside
      // the world") -- drawn once, on top, for only the selected/followed
      // agent so cost stays bounded regardless of population size (Step
      // 12 perf requirement: highest detail only where the viewer is
      // actually looking). Every value drawn below comes straight off
      // the real Agent record or the same route/position data already
      // driving the sprite -- see lib/isoRenderer.ts's module docs for
      // the real-data boundary this respects. ---
      const selectedDrawable = selectedId ? drawableAgents.find((d) => d.kind === "agent" && d.agent.id === selectedId) : undefined;
      if (selectedDrawable && selectedDrawable.kind === "agent") {
        const { agent, motion, pos } = selectedDrawable;
        const t = clockPhaseRef.current;

        if (motion.path.length > 0) {
          drawRoutePath(ctx as any, cam, pos, motion.path);
          const dest = motion.path[motion.path.length - 1];
          drawDestinationMarker(ctx as any, cam, dest.x, dest.y, t);
        }

        if (motion.arrivedAt !== null && now - motion.arrivedAt < ARRIVAL_BURST_MS) {
          drawArrivalBurst(ctx as any, cam, pos.x, pos.y, (now - motion.arrivedAt) / ARRIVAL_BURST_MS);
        }

        // WHY card: real current_goal + current_action, only once zoomed
        // in past the establishing view so it doesn't clutter the wide
        // shot (kept subtle per Step 7 -- "the city remains the primary
        // experience").
        if (cam.scale > (fitScaleRef.current || 1) * WHY_CARD_MIN_SCALE_FACTOR) {
          const lines: string[] = [];
          if (agent.current_goal?.description) {
            lines.push(`Goal: ${agent.current_goal.description}`);
          }
          const actionText = agent.current_action?.reasoning || agent.current_action?.message;
          if (actionText) {
            const verb = motion.path.length > 0 ? "Heading out" : "Right now";
            lines.push(`${verb}: ${actionText}`);
          }
          if (lines.length > 0) {
            drawWhyCard(ctx as any, cam, pos.x, pos.y, agent.name, lines);
          }
        }

        // Need-change pulse -- reuses the exact same real before/after
        // AgentDelta the activity feed already computes.
        const delta = deltasRef.current?.get(agent.id);
        if (delta) {
          const seenKey = `${agent.id}:${delta.label}`;
          let seenAt = deltaSeenRef.current.get(seenKey);
          if (seenAt === undefined) {
            seenAt = now;
            deltaSeenRef.current.set(seenKey, seenAt);
          }
          const fadeT = (now - seenAt) / 2500;
          if (fadeT < 1) drawDeltaBadge(ctx as any, cam, pos.x, pos.y, delta.label, fadeT);
        }

        // Social connection line -- only drawn when the real
        // current_action says "socialize" AND another currently-rendered
        // real agent is both co-located (same location_id) and also
        // socializing this tick. No invented relationship graph, no
        // fabricated partner -- if no such agent is on screen, nothing
        // is drawn.
        if (agent.current_action?.action_type === "socialize") {
          let partner: { pos: Point } | null = null;
          let partnerDist = Infinity;
          for (const d of drawableAgents) {
            if (d.kind !== "agent" || d.agent.id === agent.id) continue;
            if (d.agent.location_id !== agent.location_id) continue;
            if (d.agent.current_action?.action_type !== "socialize") continue;
            const dist = Math.hypot(d.pos.x - pos.x, d.pos.y - pos.y);
            if (dist < partnerDist) {
              partnerDist = dist;
              partner = d;
            }
          }
          if (partner) drawSocialLink(ctx as any, cam, pos, partner.pos, t);
        }
      }

      ctx.restore();
      renderedAgentsRef.current = nextRendered;
      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following, fitToSlice, sliceReady]);

  const slice = sliceRef.current;

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[#1b2420]">
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        onMouseMove={(e) => {
          const rect = canvasRef.current?.getBoundingClientRect();
          if (!rect) return;
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const hit = renderedAgentsRef.current.find((r) => Math.hypot(x - r.sx, y - r.sy) < r.r);
          if (hit) setHovered({ kind: "agent", name: hit.agent.name, sub: hit.agent.occupation, x: e.clientX, y: e.clientY });
          else setHovered(null);
        }}
        onMouseLeave={() => setHovered(null)}
      />

      {!slice && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-400">
          Waiting for Echo City to populate…
        </div>
      )}

      {slice && (
        <div className="pointer-events-none absolute top-4 left-4 rounded-lg border border-neutral-800 bg-neutral-950/85 px-3 py-1.5 backdrop-blur-md">
          <span className="text-[11px] font-mono text-neutral-300">
            Echo City · <span className="text-cyan-300">{slice.layout.neighborhoods.length} neighborhoods</span> · {slice.tiles.length} locations
          </span>
        </div>
      )}

      {followNotice && (
        <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-lg border border-amber-700/60 bg-amber-950/85 px-3 py-1.5 backdrop-blur-md">
          <span className="text-[11px] font-mono text-amber-200">{followNotice}</span>
        </div>
      )}

      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        <button
          onClick={resetView}
          className="rounded-lg border border-neutral-800 bg-neutral-950/85 px-3 py-1.5 text-[11px] font-mono text-neutral-300 backdrop-blur-md hover:bg-neutral-800"
        >
          Reset camera
        </button>
        {selectedIdRef.current && (
          <button
            onClick={() => (following ? exitFollow() : startFollow())}
            className={`rounded-lg border px-3 py-1.5 text-[11px] font-mono backdrop-blur-md ${
              following ? "border-cyan-700 bg-cyan-950/60 text-cyan-300" : "border-neutral-800 bg-neutral-950/85 text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            {following ? "Following…" : "Follow"}
          </button>
        )}
      </div>

      {hovered && (
        <div
          className="pointer-events-none fixed z-50 rounded-md border border-neutral-800 bg-neutral-950/95 px-2 py-1 text-[11px] text-neutral-200"
          style={{ left: hovered.x + 12, top: hovered.y + 12 }}
        >
          <div className="font-semibold">{hovered.name}</div>
          <div className="text-neutral-400">{hovered.sub}</div>
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------
// Small local helpers (kept in-file since they're one-liners specific
// to this component's draw pass; the shared, reusable drawing primitives
// live in lib/isoRenderer.ts)
// ---------------------------------------------------------------------

function pointInPolygon(x: number, y: number, pts: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function actionTint(agent: Agent): string {
  switch (agent.current_action?.action_type) {
    case "work":
      return "#38bdf8";
    case "consume_food":
      return "#f59e0b";
    case "rest":
      return "#34d399";
    case "socialize":
      return "#a78bfa";
    default:
      return "#4c7fd6";
  }
}


