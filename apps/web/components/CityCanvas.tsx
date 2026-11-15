"use client";

/**
 * CityCanvas: the visual representation of ECHO City ("Living City").
 *
 * V3 (Human-Scale Living City) builds on the V2.1 road network without
 * touching it: buildCityLayout / buildRoadNetwork / routeBetweenLocations
 * in lib/cityLayout.ts are unchanged. What changed here is purely
 * presentational:
 *
 *  - a user-controlled camera (wheel zoom, drag pan, reset, follow
 *    selected agent) layered on top of the existing fit-to-container
 *    transform
 *  - agents drawn as small humanoid figures (head/torso/arms/legs) with
 *    a walk animation instead of a plain capsule+dot, so "the city is
 *    full of people" reads at a glance once zoomed in
 *  - more distinct building silhouettes per type, and a light visual
 *    theme per neighborhood (Step 9/10) -- cosmetic only, no new
 *    simulation mechanics
 *  - an optional short-lived causality callout above an agent
 *    ("$5 spent, Hunger 28% -> 78%") when a real delta was observed for
 *    that agent on the tick that just landed (see lib/activityFeed.ts;
 *    passed in via `latestDeltas`, never computed or guessed here)
 *
 * Movement is still real, not decorative: an agent's on-canvas TARGET
 * position is always `agentJitter(agent.id, tile)` for the tile of
 * `agent.location_id` -- derived directly from backend truth. The only
 * invented parts are (a) interpolation between an agent's previous
 * rendered position and that target after a tick advances, and (b) the
 * walk-cycle limb phase, which advances only while (a) is happening and
 * freezes the instant the agent is stationary. Nothing here moves an
 * agent that the backend hasn't moved.
 */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Agent, AgentDelta, Location, Neighborhood } from "@/lib/types";
import {
  CityLayout,
  LocationLayout,
  Point,
  RoadNetwork,
  agentJitter,
  buildCityLayout,
  buildRoadNetwork,
  hash01,
  routeBetweenLocations,
  tileEdgeTowardStreet,
} from "@/lib/cityLayout";

interface CityCanvasProps {
  neighborhoods: Neighborhood[];
  locations: Location[];
  agents: Agent[];
  tick: number;
  selectedAgentId?: string;
  onSelectAgent: (agent: Agent) => void;
  onSelectLocation: (location: Location) => void;
  /** Real per-agent deltas for the tick that just landed, keyed by agent id. Sourced from lib/activityFeed.ts's snapshot diff -- never fabricated here. */
  latestDeltas?: Map<string, AgentDelta>;
  /**
   * V4.1 -- lets a parent (AgentProfileDrawer's "FOLLOW" button, via
   * city/page.tsx) mirror this canvas's own internal `following` boolean,
   * so the drawer can show accurate Following/Follow state and offer the
   * same toggle the canvas's own on-canvas button already has. This is
   * purely a state mirror; CityCanvas itself remains the sole owner of
   * whether the camera is actually following.
   */
  onFollowingChange?: (following: boolean) => void;
}

/**
 * Imperative handle so an external control (AgentProfileDrawer's FOLLOW
 * button) can trigger the same real follow-camera behavior as the
 * on-canvas Follow button, without lifting the camera/motion state itself
 * out of CityCanvas. Both methods are the exact same callbacks the
 * on-canvas button already calls.
 */
export interface CityCanvasHandle {
  followSelected: () => void;
  exitFollow: () => void;
}

const BUILDING_COLORS: Record<string, { body: string; roof: string; label: string }> = {
  residential: { body: "#10b981", roof: "#047857", label: "Residence" },
  workplace: { body: "#3b82f6", roof: "#1d4ed8", label: "Workplace" },
  market: { body: "#f59e0b", roof: "#b45309", label: "Market" },
  // Was #a855f7/#7e22ce (purple). Purple reads as an artificial/candy
  // accent color, not foliage -- the single most "this isn't a real place"
  // note in a park/tree shape. Two natural leaf-green tones instead.
  leisure: { body: "#22c55e", roof: "#15803d", label: "Leisure" },
};

const OCCUPATION_COLORS: Record<string, string> = {
  farmer: "#d97706",
  trader: "#059669",
  artisan: "#9333ea",
  laborer: "#ea580c",
  clerk: "#2563eb",
  healer: "#e11d48",
  unemployed: "#737373",
};

const ACTION_RING_COLORS: Record<string, string> = {
  work: "#38bdf8",
  consume_food: "#f59e0b",
  rest: "#34d399",
  socialize: "#a78bfa",
  move: "#94a3b8",
  idle: "#6b7280",
};

const ACTION_LABELS: Record<string, string> = {
  work: "Working",
  consume_food: "Buying Food",
  rest: "Resting",
  socialize: "Socializing",
  move: "Moving",
  idle: "Idle",
};

/**
 * Visual-only neighborhood flavor (Step 10). Keyed by the real
 * neighborhood name from apps/api/app/world/generator.py
 * (NEIGHBORHOOD_NAMES) -- never invents new districts, just a tint +
 * motif for the five that already exist. Falls back to a neutral tint
 * for any name not in this table so a topology change can't crash the
 * renderer.
 */
const NEIGHBORHOOD_THEME: Record<string, { tint: string; accent: string; motif: "grid" | "stripes" | "grass" | "waves" | "brick" }> = {
  Downtown: { tint: "rgba(96,165,250,0.05)", accent: "rgba(96,165,250,0.18)", motif: "grid" },
  Eastgate: { tint: "rgba(245,158,11,0.04)", accent: "rgba(245,158,11,0.16)", motif: "stripes" },
  Hillcrest: { tint: "rgba(74,222,128,0.05)", accent: "rgba(74,222,128,0.16)", motif: "grass" },
  Riverside: { tint: "rgba(56,189,248,0.06)", accent: "rgba(56,189,248,0.2)", motif: "waves" },
  Millbrook: { tint: "rgba(217,119,6,0.05)", accent: "rgba(217,119,6,0.16)", motif: "brick" },
};
const DEFAULT_THEME = { tint: "rgba(255,255,255,0.03)", accent: "rgba(255,255,255,0.08)", motif: "grid" as const };

/**
 * V4.2 -- Street life. Static, deterministic decoration (trees/bushes/
 * benches/planters) along each neighborhood's local-street sidewalks, so
 * the gaps between buildings stop reading as empty asphalt margin. These
 * are purely cosmetic Canvas primitives keyed off real layout geometry
 * (never simulated, never animated, never polled) -- same determinism
 * pattern as the existing lamp posts and asphalt speckle. Computed once
 * per layout via useMemo, not regenerated per frame.
 *
 * The type mix per neighborhood also does double duty as Step 5 (district
 * identity): greener districts (Hillcrest/Riverside) get mostly
 * trees/bushes, the artisan district (Millbrook) leans benches/planters,
 * and the industrial district (Eastgate) stays deliberately sparse.
 */
interface StreetDecoration {
  x: number;
  y: number;
  type: "tree" | "bush" | "bench" | "planter";
  scale: number;
  flip: boolean;
}

// Mirrors the sidewalk offsets used in the local-street paint pass in the
// draw loop below. Kept as separate constants (not a shared ref) so this
// generator can run once, outside the per-frame draw closure.
const DECO_LOCAL_STREET_WIDTH = 12;
const DECO_SIDEWALK_GAP = 9;
const DECO_SIDEWALK_WIDTH = 5;
const DECO_ROW_INSET = 6; // extra clearance beyond the sidewalk band itself

function buildStreetDecorations(layout: CityLayout, roadNetwork: RoadNetwork): StreetDecoration[] {
  const decos: StreetDecoration[] = [];
  const STEP = 42;

  for (const hood of layout.neighborhoods) {
    const street = roadNetwork.streets.get(hood.id);
    if (!street) continue;
    const theme = NEIGHBORHOOD_THEME[hood.name] || DEFAULT_THEME;

    const weights: Record<StreetDecoration["type"], number> =
      theme.motif === "grass" // Hillcrest -- suburban gardens
        ? { tree: 0.4, bush: 0.32, bench: 0.1, planter: 0.08 }
        : theme.motif === "waves" // Riverside -- waterfront greenery
        ? { tree: 0.46, bush: 0.24, bench: 0.14, planter: 0.08 }
        : theme.motif === "brick" // Millbrook -- artisan/market-square
        ? { tree: 0.1, bush: 0.14, bench: 0.26, planter: 0.4 }
        : theme.motif === "stripes" // Eastgate -- industrial, deliberately sparse
        ? { tree: 0.04, bush: 0.04, bench: 0.03, planter: 0.03 }
        : { tree: 0.16, bush: 0.14, bench: 0.3, planter: 0.24 }; // Downtown -- dense commercial

    const density = theme.motif === "stripes" ? 0.14 : theme.motif === "waves" || theme.motif === "grass" ? 0.58 : 0.36;

    const topY = street.y - DECO_LOCAL_STREET_WIDTH / 2 - DECO_SIDEWALK_GAP - DECO_SIDEWALK_WIDTH - DECO_ROW_INSET;
    const botY = street.y + DECO_LOCAL_STREET_WIDTH / 2 + DECO_SIDEWALK_GAP + DECO_SIDEWALK_WIDTH + DECO_ROW_INSET;
    const hoodLocations = layout.locations.filter((l) => l.neighborhoodId === hood.id);

    let i = 0;
    for (let x = street.x1 + 10; x < street.x2 - 10; x += STEP) {
      for (const rowY of [topY, botY]) {
        const key = `${hood.id}:deco:${i++}`;
        if (hash01(key) > density) continue;

        const px = x + (hash01(key + ":jx") - 0.5) * 16;
        const py = rowY + (hash01(key + ":jy") - 0.5) * 6;

        const blocked = hoodLocations.some(
          (loc) => px > loc.x - 7 && px < loc.x + loc.w + 7 && py > loc.y - 7 && py < loc.y + loc.h + 7
        );
        if (blocked) continue;

        const roll = hash01(key + ":type");
        let type: StreetDecoration["type"] | null = null;
        let acc = 0;
        for (const t of ["tree", "bush", "bench", "planter"] as const) {
          acc += weights[t];
          if (roll <= acc) {
            type = t;
            break;
          }
        }
        if (!type) continue; // remaining probability mass is deliberately empty pavement

        decos.push({
          x: px,
          y: py,
          type,
          scale: 0.85 + hash01(key + ":scale") * 0.45,
          flip: hash01(key + ":flip") > 0.5,
        });
      }
    }
  }
  return decos;
}

function drawStreetDecoration(ctx: CanvasRenderingContext2D, d: StreetDecoration) {
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.scale(d.flip ? -d.scale : d.scale, d.scale);

  if (d.type === "tree") {
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.ellipse(0, 2, 5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#5b3a21";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(0, -4);
    ctx.stroke();
    ctx.fillStyle = "#14532d";
    ctx.beginPath();
    ctx.arc(-1.6, -7, 4.4, 0, Math.PI * 2);
    ctx.arc(2, -8.4, 3.6, 0, Math.PI * 2);
    ctx.arc(0.4, -5.6, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(74,222,128,0.55)";
    ctx.beginPath();
    ctx.arc(-1, -8.6, 1.9, 0, Math.PI * 2);
    ctx.fill();
  } else if (d.type === "bush") {
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(0, 1.6, 4, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#166534";
    ctx.beginPath();
    ctx.arc(-2, -0.4, 2.6, 0, Math.PI * 2);
    ctx.arc(1.8, -0.8, 2.9, 0, Math.PI * 2);
    ctx.arc(0, -2, 2.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (d.type === "bench") {
    ctx.fillStyle = "rgba(0,0,0,0.26)";
    ctx.fillRect(-5, 1.6, 10, 1.3);
    ctx.strokeStyle = "#a8a29e";
    ctx.lineWidth = 1;
    ctx.strokeRect(-5, -1, 10, 2);
    ctx.beginPath();
    ctx.moveTo(-4.5, 1);
    ctx.lineTo(-4.5, 3.2);
    ctx.moveTo(4.5, 1);
    ctx.lineTo(4.5, 3.2);
    ctx.moveTo(-4.5, -1);
    ctx.lineTo(-4.5, -3.6);
    ctx.moveTo(4.5, -1);
    ctx.lineTo(4.5, -3.6);
    ctx.stroke();
  } else {
    ctx.fillStyle = "#57534e";
    roundRect(ctx, -3.6, -1.4, 7.2, 4, 1);
    ctx.fill();
    ctx.fillStyle = "#22c55e";
    ctx.beginPath();
    ctx.arc(-1.3, -2, 1.6, 0, Math.PI * 2);
    ctx.arc(1.3, -2.3, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const MONO_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

interface RenderedAgent {
  agent: Agent;
  x: number;
  y: number;
  r: number;
}

/**
 * Per-agent visual movement state (V2.1 road-following, V3 adds walk
 * animation fields).
 *
 *  - `pos`            current rendered position (px, virtual space)
 *  - `path`           remaining waypoints ahead of `pos`
 *  - `lastLocationId` the location_id this state was last computed for
 *  - `facing`         last movement heading in radians
 *  - `walkPhase`      accumulated gait phase, advanced only by real
 *                      distance walked each frame (not by wall-clock
 *                      time), so limb swing speed always matches actual
 *                      on-screen travel speed rather than drifting
 *  - `walkAmplitude`  eased 0->1 while moving / 1->0 while stationary,
 *                      purely so legs settle into a neutral stance
 *                      instead of freezing mid-stride -- smoothing of a
 *                      real state (moving vs not), not invented motion
 */
interface AgentMotion {
  pos: Point;
  path: Point[];
  lastLocationId: string;
  facing: number;
  walkPhase: number;
  walkAmplitude: number;
}

// Was 9px/frame (~540px/s @60fps). A cross-district walk along the road
// network (through a hub) commonly runs 800-1200px, which took ~1.5-2.2s
// to animate -- longer than the default 1 tick/s poll interval below. That
// meant most inter-district trips never finished animating before the next
// backend tick retargeted them, so agents looked like they were perpetually
// catching up / darting rather than completing a walk. Raised so a typical
// trip finishes inside one default-speed tick interval instead of trailing
// behind it.
const WALK_SPEED = 16;
const WALK_PHASE_PER_PX = 0.14;

/**
 * V4.1 -- dedicated Follow Mode camera.
 *
 * FOLLOW_ZOOM_FACTOR is a multiple of the whole-city fit scale (same base
 * unit heroFitToContainer and zoomAt already use), not of the current
 * view -- so "Follow" always lands on the same human-scale framing
 * regardless of what zoom level the user happened to be at when they
 * pressed it, and regardless of how big any one neighborhood's box is
 * (heroScale varies per-neighborhood; this doesn't). Tuned so a walking
 * figure (r=13) renders at a clearly human size while several building
 * tiles remain visible around them -- "close enough to see them as a
 * person, wide enough to still see the block they're walking through."
 */
const FOLLOW_ZOOM_FACTOR = 2.6;
const FOLLOW_TRANSITION_MS = 650;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export const CityCanvas = forwardRef<CityCanvasHandle, CityCanvasProps>(function CityCanvas(
  {
    neighborhoods,
    locations,
    agents,
    selectedAgentId,
    onSelectAgent,
    onSelectLocation,
    latestDeltas,
    onFollowingChange,
  },
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

  const motionRef = useRef<Map<string, AgentMotion>>(new Map());
  const renderedAgentsRef = useRef<RenderedAgent[]>([]);
  const renderedLocationsRef = useRef<LocationLayout[]>([]);

  const [hovered, setHovered] = useState<{ kind: "agent" | "location"; name: string; sub: string; x: number; y: number } | null>(null);
  const [following, setFollowing] = useState(false);
  const [, forceRerenderForZoomLabel] = useState(0);

  // V4.1 follow-camera bookkeeping. `following` is the real UI state (same
  // boolean as before); everything below only governs HOW the camera gets
  // to/from a view around that state, never WHERE the agent actually is.
  const prevFollowingRef = useRef(false);
  const followTransitionRef = useRef<{
    active: boolean;
    startTime: number;
    fromScale: number;
    fromOffsetX: number;
    fromOffsetY: number;
    mode: "in" | "out";
  } | null>(null);
  const preFollowViewRef = useRef<{ scale: number; offsetX: number; offsetY: number } | null>(null);
  // True only when Follow was turned off via the button/badge (an explicit
  // "take me back" action) rather than by the user dragging/panning the
  // map themselves. A manual drag should keep the user's new camera
  // position, not animate back underneath their cursor.
  const explicitExitRef = useRef(false);
  const followingRef = useRef(following);
  followingRef.current = following;

  const topologySignature = useMemo(
    () => neighborhoods.map((n) => n.id).sort().join(",") + "|" + locations.map((l) => l.id).sort().join(","),
    [neighborhoods, locations]
  );
  const layout: CityLayout = useMemo(
    () => buildCityLayout(neighborhoods, locations),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topologySignature]
  );

  const roadNetwork: RoadNetwork = useMemo(() => buildRoadNetwork(layout), [layout]);

  // V4.2 -- static street furniture, computed once per layout (see
  // buildStreetDecorations above), not regenerated per frame.
  const decorations: StreetDecoration[] = useMemo(() => buildStreetDecorations(layout, roadNetwork), [layout, roadNetwork]);

  useEffect(() => {
    motionRef.current = new Map();
  }, [topologySignature]);

  // --- Camera (V3) ------------------------------------------------------
  const viewRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });
  const hasUserAdjustedRef = useRef(false);
  const dragRef = useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number; moved: boolean } | null>(null);

  const fitToContainer = useCallback(
    (cw: number, ch: number) => {
      const scale = Math.min(cw / layout.width, ch / layout.height);
      viewRef.current = {
        scale,
        offsetX: (cw - layout.width * scale) / 2,
        offsetY: (ch - layout.height * scale) / 2,
      };
    },
    [layout]
  );

  /**
   * The default view used to be "fit the whole 1600x950 city into the
   * container" -- at typical container sizes that's roughly 0.65-0.7x
   * scale, which puts every building at a fraction of its drawn size and
   * every agent's 8-16px radius at ~5-10 screen px. The humanoid drawing
   * code (drawAgent, below) was never the problem; at that scale its
   * limbs are sub-pixel regardless of how detailed the function is. This
   * opens instead on ONE neighborhood (the first alphabetically, which
   * `buildCityLayout` already produces deterministically -- no new
   * randomness or invented data), scaled to fill most of the container
   * with a little breathing room. Reachable range still includes the
   * whole city: MIN_SCALE_FACTOR below is relative to the whole-city fit
   * scale computed in draw(), so scrolling out still reaches (and slightly
   * past) the full skyline. RESET returns here, not to the whole-city fit,
   * since "an immediately recognizable town" is the intended default, not
   * a zoomed-out diagram.
   */
  const heroFitToContainer = useCallback(
    (cw: number, ch: number) => {
      const hood = layout.neighborhoods[0];
      if (!hood) {
        fitToContainer(cw, ch);
        return;
      }
      const pad = 70;
      const boxW = hood.w + pad * 2;
      const boxH = hood.h + pad * 2;
      const wholeCityScale = Math.min(cw / layout.width, ch / layout.height);
      const heroScale = Math.min(cw / boxW, ch / boxH);
      // Never end up more zoomed out than the whole-city fit (a tiny
      // container shouldn't invert this into a worse view than before),
      // and cap how far it can zoom in on a very large/wide screen.
      const scale = Math.min(Math.max(heroScale, wholeCityScale), wholeCityScale * 4.5);
      const cx = hood.x + hood.w / 2;
      const cy = hood.y + hood.h / 2;
      viewRef.current = {
        scale,
        offsetX: cw / 2 - cx * scale,
        offsetY: ch / 2 - cy * scale,
      };
    },
    [layout, fitToContainer]
  );

  useEffect(() => {
    hasUserAdjustedRef.current = false;
    setFollowing(false);
    const container = containerRef.current;
    if (container) heroFitToContainer(container.clientWidth, container.clientHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologySignature, heroFitToContainer]);

  const MIN_SCALE_FACTOR = 0.6;
  const MAX_SCALE_FACTOR = 10;
  const fitScaleRef = useRef(1);

  const zoomAt = useCallback((screenX: number, screenY: number, factor: number) => {
    const v = viewRef.current;
    const fitScale = fitScaleRef.current || v.scale;
    const minScale = fitScale * MIN_SCALE_FACTOR;
    const maxScale = fitScale * MAX_SCALE_FACTOR;
    const newScale = Math.min(maxScale, Math.max(minScale, v.scale * factor));
    if (newScale === v.scale) return;
    const worldX = (screenX - v.offsetX) / v.scale;
    const worldY = (screenY - v.offsetY) / v.scale;
    viewRef.current = {
      scale: newScale,
      offsetX: screenX - worldX * newScale,
      offsetY: screenY - worldY * newScale,
    };
    hasUserAdjustedRef.current = true;
    forceRerenderForZoomLabel((n) => n + 1);
  }, []);

  const resetView = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    heroFitToContainer(container.clientWidth, container.clientHeight);
    hasUserAdjustedRef.current = false;
    // Reset already places the final view directly above; don't also let
    // the draw-loop's follow-exit detection ease away from it.
    explicitExitRef.current = false;
    followTransitionRef.current = null;
    preFollowViewRef.current = null;
    setFollowing(false);
    forceRerenderForZoomLabel((n) => n + 1);
  }, [heroFitToContainer]);

  const startFollow = useCallback(() => {
    explicitExitRef.current = false;
    setFollowing(true);
  }, []);

  const exitFollow = useCallback(() => {
    explicitExitRef.current = true;
    setFollowing(false);
  }, []);

  // V4.1 -- expose the exact same startFollow/exitFollow the on-canvas
  // button uses, so AgentProfileDrawer's FOLLOW button can drive this
  // canvas's real follow-camera from the 2D view too (previously only
  // wired for the 3D renderer -- see city/page.tsx).
  useImperativeHandle(ref, () => ({ followSelected: startFollow, exitFollow }), [startFollow, exitFollow]);

  // Mirror `following` outward so the drawer can render accurate
  // Following/Follow state without owning any of the camera logic itself.
  useEffect(() => {
    onFollowingChange?.(following);
  }, [following, onFollowingChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (followingRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = Math.pow(1.0015, -e.deltaY);
      zoomAt(sx, sy, factor);
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [zoomAt]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (canvas.width !== Math.floor(cw * dpr) || canvas.height !== Math.floor(ch * dpr)) {
      canvas.width = Math.floor(cw * dpr);
      canvas.height = Math.floor(ch * dpr);
    }

    const fitScale = Math.min(cw / layout.width, ch / layout.height);
    fitScaleRef.current = fitScale;
    if (!hasUserAdjustedRef.current) {
      heroFitToContainer(cw, ch);
    }

    // V4.1 -- edge-triggered detection of Follow engaging/disengaging, so a
    // transition only ever starts once per toggle rather than restarting
    // every frame. `mode: "in"` eases scale+offset from wherever the
    // camera currently is into the dedicated follow zoom; `mode: "out"`
    // (only for an *explicit* exit -- see explicitExitRef) eases back to
    // the view captured the instant Follow was pressed.
    if (following && !prevFollowingRef.current) {
      preFollowViewRef.current = { ...viewRef.current };
      followTransitionRef.current = {
        active: true,
        startTime: performance.now(),
        fromScale: viewRef.current.scale,
        fromOffsetX: viewRef.current.offsetX,
        fromOffsetY: viewRef.current.offsetY,
        mode: "in",
      };
      hasUserAdjustedRef.current = true;
    } else if (!following && prevFollowingRef.current) {
      if (explicitExitRef.current) {
        followTransitionRef.current = {
          active: true,
          startTime: performance.now(),
          fromScale: viewRef.current.scale,
          fromOffsetX: viewRef.current.offsetX,
          fromOffsetY: viewRef.current.offsetY,
          mode: "out",
        };
      } else {
        // Disengaged by the user dragging/panning: keep exactly where
        // they moved the camera to, don't fight them with a snap-back.
        followTransitionRef.current = null;
        preFollowViewRef.current = null;
      }
      explicitExitRef.current = false;
    }
    prevFollowingRef.current = following;

    if (following && selectedIdRef.current) {
      const motion = motionRef.current.get(selectedIdRef.current);
      if (motion) {
        const followScale = Math.min(cw / layout.width, ch / layout.height) * FOLLOW_ZOOM_FACTOR;
        const liveOffsetX = cw / 2 - motion.pos.x * followScale;
        const liveOffsetY = ch / 2 - motion.pos.y * followScale;

        const trans = followTransitionRef.current;
        if (trans && trans.active && trans.mode === "in") {
          const t = Math.min(1, (performance.now() - trans.startTime) / FOLLOW_TRANSITION_MS);
          const e = easeInOutCubic(t);
          viewRef.current = {
            scale: trans.fromScale + (followScale - trans.fromScale) * e,
            offsetX: trans.fromOffsetX + (liveOffsetX - trans.fromOffsetX) * e,
            offsetY: trans.fromOffsetY + (liveOffsetY - trans.fromOffsetY) * e,
          };
          if (t >= 1) trans.active = false;
        } else {
          // Transition finished (or none needed): track the agent's real,
          // already-smoothly-interpolated position 1:1 every frame at the
          // fixed follow scale. No further easing here -- the smoothness
          // comes from the position itself moving smoothly, same as the
          // walk animation below.
          viewRef.current = { scale: followScale, offsetX: liveOffsetX, offsetY: liveOffsetY };
        }
      }
    } else {
      const trans = followTransitionRef.current;
      if (trans && trans.active && trans.mode === "out" && preFollowViewRef.current) {
        const target = preFollowViewRef.current;
        const t = Math.min(1, (performance.now() - trans.startTime) / FOLLOW_TRANSITION_MS);
        const e = easeInOutCubic(t);
        viewRef.current = {
          scale: trans.fromScale + (target.scale - trans.fromScale) * e,
          offsetX: trans.fromOffsetX + (target.offsetX - trans.fromOffsetX) * e,
          offsetY: trans.fromOffsetY + (target.offsetY - trans.fromOffsetY) * e,
        };
        if (t >= 1) {
          trans.active = false;
          preFollowViewRef.current = null;
        }
      }
    }

    const { scale, offsetX, offsetY } = viewRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // District ground: previously a stroked, filled roundRect "card" per
    // neighborhood -- the single strongest "this is five separate dashboard
    // panels" cue in the whole scene, since a hard border reads as a
    // container edge regardless of what roads do outside it. A district in
    // a real city has no drawn boundary; only a soft tonal shift and the
    // road network itself communicate where one neighborhood gives way to
    // the next. Fill only, no stroke, so neighboring districts visually
    // bleed into the shared street between them instead of butting up
    // against two parallel borders with a dead gap in between.
    for (const hood of layout.neighborhoods) {
      const theme = NEIGHBORHOOD_THEME[hood.name] || DEFAULT_THEME;
      ctx.fillStyle = theme.tint;
      roundRect(ctx, hood.x, hood.y, hood.w, hood.h, 18);
      ctx.fill();
      drawNeighborhoodMotif(ctx, hood, theme.motif, theme.accent);

      ctx.fillStyle = "#a3a3a3";
      ctx.font = `600 15px ${MONO_FONT}`;
      ctx.textBaseline = "top";
      ctx.fillText(hood.name.toUpperCase(), hood.x + 14, hood.y + 9);
    }

    // Road hierarchy (V4 -- Phase 1 urban structure pass). Same MST/
    // hub/street geometry as before (cityLayout.ts is untouched); only the
    // paint changed, from thin centered strokes to filled bands with curb
    // edges, so width/material actually communicates "major road" vs.
    // "local street" vs. "sidewalk" instead of three line-widths of the
    // same near-black color.
    const MAJOR_ROAD_WIDTH = 20;
    const LOCAL_STREET_WIDTH = 12;
    const SIDEWALK_GAP = 9; // distance from street edge to sidewalk centerline
    const SIDEWALK_WIDTH = 5;

    // Inter-district roads: wide dark-asphalt band with lighter curb edges
    // on both sides, capped square so two roads meeting at a hub tile
    // together into a clean corner rather than rounding apart. Each edge is
    // now a two-segment orthogonal polyline (a -> elbow -> b, see elbowFor
    // in cityLayout.ts) instead of one straight diagonal, so the arterial
    // actually turns a corner like a real street instead of cutting across
    // whatever sits between two districts.
    ctx.lineCap = "square";
    ctx.lineJoin = "miter";
    ctx.strokeStyle = "#1c1c1f";
    ctx.lineWidth = MAJOR_ROAD_WIDTH;
    ctx.beginPath();
    for (const edge of roadNetwork.hubEdges) {
      ctx.moveTo(edge.a.x, edge.a.y);
      ctx.lineTo(edge.elbow.x, edge.elbow.y);
      ctx.lineTo(edge.b.x, edge.b.y);
    }
    ctx.stroke();
    ctx.strokeStyle = "#52525b";
    ctx.lineWidth = MAJOR_ROAD_WIDTH + 2;
    ctx.globalCompositeOperation = "destination-over";
    ctx.beginPath();
    for (const edge of roadNetwork.hubEdges) {
      ctx.moveTo(edge.a.x, edge.a.y);
      ctx.lineTo(edge.elbow.x, edge.elbow.y);
      ctx.lineTo(edge.b.x, edge.b.y);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";

    // Asphalt texture: a sparse, deterministic speckle of dark/light flecks
    // along each arterial segment so the road reads as worn pavement
    // instead of a flat vector fill -- the single biggest "this is a UI
    // element, not a material" cue on the major roads. Deterministic per
    // segment (hash01 keyed by segment index + step), so it doesn't
    // shimmer/re-roll every animation frame.
    for (let ei = 0; ei < roadNetwork.hubEdges.length; ei++) {
      const edge = roadNetwork.hubEdges[ei];
      drawAsphaltSpeckle(ctx, edge.a, edge.elbow, MAJOR_ROAD_WIDTH, `arterial:${ei}:0`);
      drawAsphaltSpeckle(ctx, edge.elbow, edge.b, MAJOR_ROAD_WIDTH, `arterial:${ei}:1`);
    }

    // Lane centerline -- reserved for the major road only now (removed
    // from local streets below) so the dashed yellow line itself becomes
    // part of the hierarchy signal: "this specific line means through-road."
    ctx.strokeStyle = "rgba(250, 204, 21, 0.6)";
    ctx.lineWidth = 1.3;
    ctx.setLineDash([11, 9]);
    ctx.beginPath();
    for (const edge of roadNetwork.hubEdges) {
      ctx.moveTo(edge.a.x, edge.a.y);
      ctx.lineTo(edge.elbow.x, edge.elbow.y);
      ctx.lineTo(edge.b.x, edge.b.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Local streets: same StreetSegment geometry, now a narrower filled
    // band (visibly thinner than the major road) with its own curb edge
    // and no centerline -- the absence of a lane stripe is itself part of
    // reading this as "smaller than the through-road."
    ctx.lineCap = "butt";
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = LOCAL_STREET_WIDTH;
    ctx.beginPath();
    for (const street of roadNetwork.streets.values()) {
      ctx.moveTo(street.x1, street.y);
      ctx.lineTo(street.x2, street.y);
    }
    ctx.stroke();
    ctx.strokeStyle = "#46464c";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const street of roadNetwork.streets.values()) {
      ctx.moveTo(street.x1, street.y - LOCAL_STREET_WIDTH / 2);
      ctx.lineTo(street.x2, street.y - LOCAL_STREET_WIDTH / 2);
      ctx.moveTo(street.x1, street.y + LOCAL_STREET_WIDTH / 2);
      ctx.lineTo(street.x2, street.y + LOCAL_STREET_WIDTH / 2);
    }
    ctx.stroke();

    // Sidewalks: previously only a stub per building straight to the
    // street; now a continuous concrete band on BOTH sides of each local
    // street (a real sidewalk you could trace end to end), plus the short
    // wall-to-curb connector per building crossing it to reach the road --
    // matching building -> sidewalk -> local street rather than
    // building -> street directly.
    ctx.strokeStyle = "rgba(148, 152, 160, 0.55)";
    ctx.lineWidth = SIDEWALK_WIDTH;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const street of roadNetwork.streets.values()) {
      const topY = street.y - LOCAL_STREET_WIDTH / 2 - SIDEWALK_GAP;
      const botY = street.y + LOCAL_STREET_WIDTH / 2 + SIDEWALK_GAP;
      ctx.moveTo(street.x1, topY);
      ctx.lineTo(street.x2, topY);
      ctx.moveTo(street.x1, botY);
      ctx.lineTo(street.x2, botY);
    }
    ctx.stroke();

    // Building connector paths: wall -> sidewalk -> curb. Drawn as
    // concrete-toned, thinner than the sidewalk band itself so it reads as
    // a footpath crossing the sidewalk, not another road.
    ctx.strokeStyle = "#8b8f98";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const loc of layout.locations) {
      const entrance = roadNetwork.entrances.get(loc.id);
      const street = roadNetwork.streets.get(loc.neighborhoodId);
      if (!entrance || !street) continue;
      const wallPoint = tileEdgeTowardStreet(loc, street);
      ctx.moveTo(wallPoint.x, wallPoint.y);
      ctx.lineTo(entrance.x, entrance.y);
    }
    ctx.stroke();

    // Crosswalks: a real zebra ladder (multiple painted stripes spanning
    // the full street width) across the local street at every point a
    // building's footpath actually crosses it, instead of just two ticks
    // near the curb edges -- placed only where a real path exists rather
    // than decoratively scattered.
    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.lineWidth = 2;
    ctx.lineCap = "butt";
    ctx.beginPath();
    for (const loc of layout.locations) {
      const entrance = roadNetwork.entrances.get(loc.id);
      if (!entrance) continue;
      const half = LOCAL_STREET_WIDTH / 2 - 1;
      const stripeCount = 4;
      for (let s = 0; s < stripeCount; s++) {
        const yy = entrance.y - half + (half * 2 * s) / (stripeCount - 1);
        ctx.moveTo(entrance.x - 4.5, yy);
        ctx.lineTo(entrance.x + 4.5, yy);
      }
    }
    ctx.stroke();
    ctx.lineCap = "round";

    // Entrance nodes: a small lit marker exactly where each building's
    // sidewalk stub meets the sidewalk band -- the explicit "front door
    // connects here" node Phase 1 calls for, distinct from the door
    // indicator drawn on the building facade itself (drawBuilding).
    for (const loc of layout.locations) {
      const entrance = roadNetwork.entrances.get(loc.id);
      const street = roadNetwork.streets.get(loc.neighborhoodId);
      if (!entrance || !street) continue;
      const wallPoint = tileEdgeTowardStreet(loc, street);
      ctx.fillStyle = "#fde68a";
      ctx.beginPath();
      ctx.arc(wallPoint.x, wallPoint.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Junction plazas: where a local street meets an inter-district road,
    // widen into an actual paved junction (a filled rounded square sized
    // to the wider road) instead of a 4px dot -- so the geometry visibly
    // forms a real intersection rather than several lines merely crossing.
    // Curb radius widened (4 -> 7) and given a double-stroke curb (a dark
    // inner line plus a lighter outer fillet) so the corner reads as a
    // poured curb radius rather than a thin outline, and a four-way zebra
    // crosswalk is stamped across the local-street approach so a real hub
    // (which is always where a local street meets the arterial) looks like
    // a real signalized intersection rather than a plain paved square.
    for (const hub of roadNetwork.hubs.values()) {
      drawJunctionPlaza(ctx, hub, MAJOR_ROAD_WIDTH, LOCAL_STREET_WIDTH, true);
    }
    // Elbow corners: the bend point of each orthogonal arterial edge (see
    // elbowFor in cityLayout.ts) is itself a real street corner where the
    // road changes direction -- paved the same way as a hub junction, just
    // without the local-street crosswalk stamp since no building street
    // meets it there.
    for (const edge of roadNetwork.hubEdges) {
      drawJunctionPlaza(ctx, edge.elbow, MAJOR_ROAD_WIDTH, LOCAL_STREET_WIDTH, false);
    }

    // Lamp posts: purely decorative street furniture along each building's
    // (now short) sidewalk stub, offset perpendicular to the path so they
    // read as "beside the path" rather than sitting on top of it.
    // Placement is deterministic per location id (hash01), not randomized
    // per frame, and is skipped for very short stubs where a lamp would
    // visually collide with the building itself.
    for (const loc of layout.locations) {
      const entrance = roadNetwork.entrances.get(loc.id);
      const street = roadNetwork.streets.get(loc.neighborhoodId);
      if (!entrance || !street) continue;
      const wallPoint = tileEdgeTowardStreet(loc, street);
      const dx = entrance.x - wallPoint.x;
      const dy = entrance.y - wallPoint.y;
      const len = Math.hypot(dx, dy);
      if (len < 10) continue;
      const t = 0.35 + hash01(loc.id + ":lamp") * 0.3;
      const px = wallPoint.x + dx * t;
      const py = wallPoint.y + dy * t;
      const nx = -dy / len;
      const ny = dx / len;
      const side = hash01(loc.id + ":side") > 0.5 ? 1 : -1;
      const lx = px + nx * side * 7;
      const ly = py + ny * side * 7;
      ctx.strokeStyle = "#3f3f46";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx, ly - 9);
      ctx.stroke();
      ctx.fillStyle = "rgba(253, 224, 71, 0.85)";
      ctx.beginPath();
      ctx.arc(lx, ly - 10, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(253, 224, 71, 0.12)";
      ctx.beginPath();
      ctx.arc(lx, ly - 10, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // V4.2 -- street life. Drawn after lamps/before buildings, same layer
    // order as the rest of the decorative street furniture, so building
    // facades still read as the foreground layer.
    for (const d of decorations) drawStreetDecoration(ctx, d);

    const selectedMotion = selectedIdRef.current ? motionRef.current.get(selectedIdRef.current) : undefined;
    if (selectedMotion && selectedMotion.path.length > 0) {
      ctx.save();
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 5]);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(selectedMotion.pos.x, selectedMotion.pos.y);
      for (const wp of selectedMotion.path) ctx.lineTo(wp.x, wp.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const dest = selectedMotion.path[selectedMotion.path.length - 1];
      ctx.fillStyle = "#22d3ee";
      ctx.beginPath();
      ctx.arc(dest.x, dest.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // V4.1 -- outline the real destination BUILDING (not just the point
      // the route line ends at), so "where they're going" reads as an
      // actual place in the city, not an abstract dot. This is the same
      // agent.location_id the backend already reports as the target of
      // the in-flight move; the tile is looked up from the same layout
      // everything else is drawn from, nothing new is inferred.
      const selectedAgentForDest = agentsRef.current.find((a) => a.id === selectedIdRef.current);
      const destTile = selectedAgentForDest ? layout.locationById.get(selectedAgentForDest.location_id) : undefined;
      if (destTile) {
        const pulse = 2 + Math.sin(performance.now() / 350) * 1.5;
        ctx.save();
        ctx.strokeStyle = "rgba(34,211,238,0.85)";
        ctx.lineWidth = 2.5;
        roundRect(ctx, destTile.x - pulse, destTile.y - pulse, destTile.w + pulse * 2, destTile.h + pulse * 2, 8);
        ctx.stroke();
        ctx.restore();

        // V4.2 -- name the real destination in the world itself (not just
        // the drawer), so "where they're going" is answerable without a
        // click: the actual location name/type from backend layout data.
        ctx.save();
        ctx.font = `700 8px ${MONO_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const label = `\u2192 ${destTile.name}`;
        const labelX = destTile.x + destTile.w / 2;
        const labelY = destTile.y - pulse - 4;
        const metrics = ctx.measureText(label);
        ctx.fillStyle = "rgba(8,8,8,0.72)";
        roundRect(ctx, labelX - metrics.width / 2 - 4, labelY - 10, metrics.width + 8, 12, 4);
        ctx.fill();
        ctx.fillStyle = "#67e8f9";
        ctx.fillText(label, labelX, labelY + 1);
        ctx.restore();
      }
    }

    renderedLocationsRef.current = layout.locations;
    const occupancy = new Map<string, number>();
    for (const a of agentsRef.current) {
      occupancy.set(a.location_id, (occupancy.get(a.location_id) || 0) + 1);
    }
    for (const loc of layout.locations) {
      drawBuilding(ctx, loc, occupancy.get(loc.id) || 0);
    }

    const currentAgents = agentsRef.current;
    const motions = motionRef.current;
    const nextRendered: RenderedAgent[] = [];
    const zoomRatio = scale / (fitScaleRef.current || scale);
    const nowSec = performance.now() / 1000;

    // V4.3 -- social interaction visibility (section 9). Grouped strictly
    // by two real backend fields: agent.location_id (co-location) and
    // agent.current_action.action_type === "socialize". Nothing here
    // infers who is talking to whom -- it's just "these real agents are
    // at the same real place doing the real socialize action right now."
    const socialGroups = new Map<string, { x: number; y: number }[]>();

    for (const agent of currentAgents) {
      const tile = layout.locationById.get(agent.location_id);
      const target = tile ? agentJitter(agent.id, tile) : { x: layout.width / 2, y: layout.height / 2 };

      let motion = motions.get(agent.id);
      if (!motion) {
        motion = { pos: { ...target }, path: [], lastLocationId: agent.location_id, facing: 0, walkPhase: 0, walkAmplitude: 0 };
        motions.set(agent.id, motion);
      } else if (agent.location_id !== motion.lastLocationId) {
        const route = routeBetweenLocations(layout, roadNetwork, motion.lastLocationId, agent.location_id);
        motion.path = route ? [...route, target] : [target];
        motion.lastLocationId = agent.location_id;
      } else if (motion.path.length === 0) {
        motion.pos = { ...target };
      }

      let budget = WALK_SPEED;
      let distanceThisFrame = 0;
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
        } else {
          motion.facing = Math.atan2(dy, dx);
          const stepPos = { x: motion.pos.x + (dx / dist) * budget, y: motion.pos.y + (dy / dist) * budget };
          distanceThisFrame += Math.hypot(stepPos.x - motion.pos.x, stepPos.y - motion.pos.y);
          motion.pos = stepPos;
          budget = 0;
        }
      }

      const isMoving = motion.path.length > 0;
      motion.walkPhase += distanceThisFrame * WALK_PHASE_PER_PX;
      motion.walkAmplitude += ((isMoving ? 1 : 0) - motion.walkAmplitude) * 0.25;

      // Was 8. At the default camera (now heroFitToContainer, ~1.7x the old
      // whole-city fit scale) an 8-unit-radius figure was still only ~14px
      // on screen -- barely enough for the eye to register "person" over
      // "dot" even with correct limb geometry. 13 puts a walking figure at
      // a size where the head/torso/limb silhouette actually reads at the
      // new default zoom, without the tile-packed buildings starting to
      // feel cramped by oversized people.
      const r = 13;
      const delta = deltasRef.current?.get(agent.id);
      const showLabel = zoomRatio > 1.6;
      // Idle bob: purely cosmetic "still alive" sway for a stationary
      // agent, faded in as walkAmplitude -> 0 and faded out the instant
      // real movement resumes, so it's never mistaken for the actual walk
      // cycle. Per-agent phase offset (hash01) keeps a crowd of idle
      // agents from bobbing in unison. Doesn't touch or infer any backend
      // state -- agent.location_id / current_action are unchanged either
      // way, this only affects how a state the backend already reports
      // ("not moving") is drawn.
      const idlePhase = nowSec * 1.6 + hash01(agent.id) * Math.PI * 2;
      if (agent.current_action?.action_type === "socialize") {
        const g = socialGroups.get(agent.location_id) || [];
        g.push({ x: motion.pos.x, y: motion.pos.y });
        socialGroups.set(agent.location_id, g);
      }
      drawAgent(ctx, agent, motion.pos.x, motion.pos.y, r, agent.id === selectedIdRef.current, motion.facing, motion.walkPhase, motion.walkAmplitude, showLabel, delta, idlePhase);
      nextRendered.push({ agent, x: motion.pos.x, y: motion.pos.y, r: r + 4 });
    }
    renderedAgentsRef.current = nextRendered;

    // Draw the connections after all real positions for this frame are
    // known, so the line always reflects each agent's actual current
    // interpolated position, not a stale one from the previous frame.
    for (const group of socialGroups.values()) {
      if (group.length < 2) continue; // real state, but only 1 agent -- nothing to connect
      const cx = group.reduce((s, p) => s + p.x, 0) / group.length;
      const cy = group.reduce((s, p) => s + p.y, 0) / group.length;
      ctx.strokeStyle = "rgba(167,139,250,0.55)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      if (group.length === 2) {
        ctx.moveTo(group[0].x, group[0].y);
        ctx.lineTo(group[1].x, group[1].y);
      } else {
        for (const p of group) {
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(cx, cy);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Small speech-bubble dots at the midpoint/centroid -- the
      // "conversation indicator" -- pulsing gently so a stationary group
      // still reads as an active interaction rather than a static prop.
      const pulse = (Math.sin(performance.now() / 260) + 1) / 2;
      ctx.fillStyle = `rgba(196,181,253,${0.5 + pulse * 0.35})`;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(cx - 3 + i * 3, cy - 16, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }, [layout, roadNetwork, decorations, following, heroFitToContainer]);

  useEffect(() => {
    const loop = () => {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  const toVirtual = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { scale, offsetX, offsetY } = viewRef.current;
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    return { x: (cssX - offsetX) / scale, y: (cssY - offsetY) / scale };
  };

  const findAgentAt = (vx: number, vy: number): RenderedAgent | null => {
    let best: RenderedAgent | null = null;
    let bestDist = Infinity;
    for (const ra of renderedAgentsRef.current) {
      const d = Math.hypot(ra.x - vx, ra.y - vy);
      if (d <= ra.r + 6 && d < bestDist) {
        best = ra;
        bestDist = d;
      }
    }
    return best;
  };

  const findLocationAt = (vx: number, vy: number): LocationLayout | null => {
    for (const loc of renderedLocationsRef.current) {
      if (vx >= loc.x && vx <= loc.x + loc.w && vy >= loc.y && vy <= loc.y + loc.h) {
        return loc;
      }
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffsetX: viewRef.current.offsetX,
      startOffsetY: viewRef.current.offsetY,
      moved: false,
    };
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && drag.moved) return;
    const v = toVirtual(e.clientX, e.clientY);
    if (!v) return;
    const hitAgent = findAgentAt(v.x, v.y);
    if (hitAgent) {
      onSelectAgent(hitAgent.agent);
      return;
    }
    const hitLoc = findLocationAt(v.x, v.y);
    if (hitLoc) {
      const full = locations.find((l) => l.id === hitLoc.id);
      if (full) onSelectLocation(full);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.hypot(dx, dy) > 3) {
        drag.moved = true;
        hasUserAdjustedRef.current = true;
        setFollowing(false);
        viewRef.current = {
          ...viewRef.current,
          offsetX: drag.startOffsetX + dx,
          offsetY: drag.startOffsetY + dy,
        };
      }
      return;
    }

    const v = toVirtual(e.clientX, e.clientY);
    if (!v) return;
    const hitAgent = findAgentAt(v.x, v.y);
    if (hitAgent) {
      setHovered({
        kind: "agent",
        name: hitAgent.agent.name,
        sub: `${hitAgent.agent.age}yo · ${hitAgent.agent.occupation} · ${hitAgent.agent.current_action?.action_type.replace(/_/g, " ") ?? "no action yet"}`,
        x: e.clientX,
        y: e.clientY,
      });
      return;
    }
    const hitLoc = findLocationAt(v.x, v.y);
    if (hitLoc) {
      setHovered({ kind: "location", name: hitLoc.name, sub: BUILDING_COLORS[hitLoc.type]?.label || hitLoc.type, x: e.clientX, y: e.clientY });
      return;
    }
    setHovered(null);
  };

  const zoomButton = (factor: number) => {
    const container = containerRef.current;
    if (!container) return;
    zoomAt(container.clientWidth / 2, container.clientHeight / 2, factor);
  };

  const zoomPercent = Math.round(((viewRef.current.scale || fitScaleRef.current) / (fitScaleRef.current || 1)) * 100);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          setHovered(null);
          dragRef.current = null;
        }}
      />

      <div className="pointer-events-auto absolute top-4 left-4 flex flex-col gap-1 rounded-xl border border-neutral-800 bg-neutral-950/85 p-1.5 backdrop-blur-md">
        <button
          onClick={() => zoomButton(1.35)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold text-neutral-300 hover:bg-neutral-800 hover:text-white"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => zoomButton(1 / 1.35)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold text-neutral-300 hover:bg-neutral-800 hover:text-white"
          title="Zoom out"
        >
          −
        </button>
        <div className="my-0.5 h-px bg-neutral-800" />
        <button
          onClick={resetView}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-300 hover:bg-neutral-800 hover:text-white"
          title="Reset camera"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
        <button
          onClick={() => (following ? exitFollow() : startFollow())}
          disabled={!selectedIdRef.current}
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition disabled:opacity-30 ${
            following ? "bg-cyan-600/30 text-cyan-300" : "text-neutral-300 hover:bg-neutral-800 hover:text-white"
          }`}
          title={selectedIdRef.current ? "Follow selected person" : "Select a person to follow"}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </button>
      </div>

      <div className="pointer-events-none absolute top-4 left-16 rounded-lg border border-neutral-800 bg-neutral-950/70 px-2 py-1 text-[10px] font-mono text-neutral-400">
        {zoomPercent}%
      </div>

      {following && selectedAgentId && (() => {
        const followedAgent = agents.find((a) => a.id === selectedAgentId);
        if (!followedAgent) return null;
        return (
          <div className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border border-cyan-800/60 bg-neutral-950/85 px-3 py-1.5 backdrop-blur-md shadow-lg">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-xs font-mono text-cyan-300">Following {followedAgent.name}</span>
            <button
              onClick={exitFollow}
              className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-mono text-neutral-400 hover:bg-neutral-800 hover:text-white"
            >
              Exit
            </button>
          </div>
        );
      })()}

      {/*
       * V4.4 -- in-world causality card ("WHY?"). Deliberately scoped to
       * ONLY the followed agent (not all 100), per "do not add
       * unnecessary UI" -- this is the one citizen the viewer is actually
       * asking "why" about. Every line is a real field already present on
       * the Agent object this component receives as a prop; nothing here
       * is computed, inferred, or invented:
       *   - lowest current need + value  -> agent.needs
       *   - current goal                 -> agent.current_goal.description
       *   - current action + reasoning   -> agent.current_action.{action_type,reasoning}
       *   - destination                  -> layout.locationById.get(agent.location_id).name
       *     (the same real tile the route line / destination outline on
       *     the canvas itself already point at)
       * A DOM overlay rather than a canvas draw for the same reason the
       * "Following X" chip above is DOM: crisp text at any zoom, no
       * per-frame canvas font-scaling to get right, and it only needs to
       * re-render when `agents` changes (once per tick), not per
       * animation frame.
       */}
      {following && selectedAgentId && (() => {
        const followedAgent = agents.find((a) => a.id === selectedAgentId);
        if (!followedAgent) return null;

        const lowestNeed = followedAgent.needs.length
          ? [...followedAgent.needs].sort((a, b) => a.value - b.value)[0]
          : null;
        const goalDescription = followedAgent.current_goal?.description ?? null;
        const actionType = followedAgent.current_action?.action_type;
        const actionLabel = actionType ? ACTION_LABELS[actionType] ?? actionType.replace(/_/g, " ") : null;
        const reasoning = followedAgent.current_action?.reasoning?.trim() || null;
        const destTile = layout.locationById.get(followedAgent.location_id);

        if (!lowestNeed && !goalDescription && !reasoning) return null; // nothing real to show

        return (
          <div className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 w-[min(320px,88%)] rounded-lg border border-fuchsia-900/50 bg-neutral-950/90 px-3 py-2.5 backdrop-blur-md shadow-xl">
            <div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-fuchsia-400">
              <span>Why {followedAgent.name}?</span>
            </div>
            <div className="space-y-1 text-[10.5px] leading-snug font-mono">
              {lowestNeed && (
                <div className="text-neutral-400">
                  <span className="text-neutral-500">Need </span>
                  <span className="text-amber-300">{lowestNeed.need_type}</span>
                  <span className="text-neutral-500"> is </span>
                  <span className="text-amber-300">{Math.round(lowestNeed.value * 100)}%</span>
                </div>
              )}
              {goalDescription && (
                <div className="text-neutral-300">
                  <span className="text-neutral-500">Goal </span>
                  {goalDescription}
                </div>
              )}
              {destTile && (
                <div className="text-neutral-300">
                  <span className="text-neutral-500">Destination </span>
                  {destTile.name}
                </div>
              )}
              {actionLabel && (
                <div className="text-neutral-300">
                  <span className="text-neutral-500">Doing </span>
                  {actionLabel}
                </div>
              )}
              {reasoning && (
                <div className="mt-1 border-t border-neutral-800 pt-1 text-neutral-400 italic">
                  “{reasoning.length > 140 ? `${reasoning.slice(0, 140)}\u2026` : reasoning}”
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {hovered && (
        <div
          className="pointer-events-none fixed z-50 flex flex-col rounded-md border border-neutral-700 bg-neutral-950/95 px-2.5 py-1.5 text-left shadow-xl backdrop-blur-sm"
          style={{ left: hovered.x + 14, top: hovered.y + 14 }}
        >
          <span className="text-[11px] font-bold text-neutral-100">{hovered.name}</span>
          <span className="text-[9px] font-mono capitalize text-neutral-400">{hovered.sub}</span>
        </div>
      )}
    </div>
  );
});

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Sparse, deterministic asphalt speckle along one road segment: small
 * dark/light flecks scattered across the road's width, spaced along its
 * length at a fixed pixel step. Deterministic (hash01 keyed by `seed` +
 * index) so it never shimmers between frames -- purely a static material
 * texture, not decoration that re-rolls. Kept sparse (one fleck roughly
 * every 14px) to stay cheap inside the render loop.
 */
function drawAsphaltSpeckle(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  roadWidth: number,
  seed: string
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const step = 14;
  const count = Math.floor(len / step);
  const halfW = roadWidth / 2 - 2;
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const along = t * len;
    const px = a.x + ux * along;
    const py = a.y + uy * along;
    const jitter = (hash01(`${seed}:${i}`) - 0.5) * 2 * halfW;
    const fx = px + nx * jitter;
    const fy = py + ny * jitter;
    const light = hash01(`${seed}:${i}:c`) > 0.5;
    ctx.fillStyle = light ? "rgba(120,120,128,0.10)" : "rgba(0,0,0,0.14)";
    const size = 0.6 + hash01(`${seed}:${i}:s`) * 0.8;
    ctx.beginPath();
    ctx.arc(fx, fy, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * A single paved intersection corner: filled asphalt square with a
 * double-stroke curb (dark inner line, lighter outer fillet) so the corner
 * reads as a poured curb radius rather than a thin single outline. When
 * `withCrosswalk` is true (real hub junctions, where a local street meets
 * the arterial) a four-way zebra crosswalk is stamped across the
 * local-street approach so it reads as a real signalized intersection
 * rather than a plain paved square; elbow corners (no local street meets
 * them) skip the crosswalk.
 */
function drawJunctionPlaza(
  ctx: CanvasRenderingContext2D,
  center: Point,
  majorRoadWidth: number,
  localStreetWidth: number,
  withCrosswalk: boolean
) {
  const jr = majorRoadWidth / 2 + 3.5;
  ctx.fillStyle = "#1c1c1f";
  roundRect(ctx, center.x - jr, center.y - jr, jr * 2, jr * 2, 7);
  ctx.fill();
  ctx.strokeStyle = "#3f3f46";
  ctx.lineWidth = 1;
  roundRect(ctx, center.x - jr + 1.5, center.y - jr + 1.5, jr * 2 - 3, jr * 2 - 3, 6);
  ctx.stroke();
  ctx.strokeStyle = "#6b6b74";
  ctx.lineWidth = 1.6;
  roundRect(ctx, center.x - jr, center.y - jr, jr * 2, jr * 2, 7);
  ctx.stroke();

  if (!withCrosswalk) return;

  const half = localStreetWidth / 2 - 1;
  const stripeCount = 5;
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1.8;
  ctx.lineCap = "butt";
  ctx.beginPath();
  for (let s = 0; s < stripeCount; s++) {
    const yy = center.y - half + (half * 2 * s) / (stripeCount - 1);
    ctx.moveTo(center.x - jr - 5, yy);
    ctx.lineTo(center.x - jr + 1, yy);
    ctx.moveTo(center.x + jr - 1, yy);
    ctx.lineTo(center.x + jr + 5, yy);
  }
  ctx.stroke();
  ctx.lineCap = "round";
}

function drawNeighborhoodMotif(
  ctx: CanvasRenderingContext2D,
  hood: { x: number; y: number; w: number; h: number },
  motif: "grid" | "stripes" | "grass" | "waves" | "brick",
  color: string
) {
  ctx.save();
  roundRect(ctx, hood.x, hood.y, hood.w, hood.h, 14);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;

  if (motif === "grid") {
    const step = 34;
    ctx.beginPath();
    for (let x = hood.x; x < hood.x + hood.w; x += step) {
      ctx.moveTo(x, hood.y);
      ctx.lineTo(x, hood.y + hood.h);
    }
    for (let y = hood.y; y < hood.y + hood.h; y += step) {
      ctx.moveTo(hood.x, y);
      ctx.lineTo(hood.x + hood.w, y);
    }
    ctx.stroke();
  } else if (motif === "stripes") {
    ctx.beginPath();
    for (let x = hood.x - hood.h; x < hood.x + hood.w; x += 22) {
      ctx.moveTo(x, hood.y + hood.h);
      ctx.lineTo(x + hood.h, hood.y);
    }
    ctx.stroke();
  } else if (motif === "grass") {
    ctx.fillStyle = color;
    const cols = Math.floor(hood.w / 26);
    const rows = Math.floor(hood.h / 26);
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      for (let rIdx = 0; rIdx < rows; rIdx++) {
        ctx.beginPath();
        ctx.arc(hood.x + 13 + cIdx * 26, hood.y + 13 + rIdx * 26, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (motif === "waves") {
    ctx.beginPath();
    for (let y = hood.y + 20; y < hood.y + hood.h; y += 26) {
      for (let x = hood.x; x < hood.x + hood.w; x += 20) {
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 10, y - 6, x + 20, y);
      }
    }
    ctx.stroke();
  } else if (motif === "brick") {
    const bw = 24;
    const bh = 12;
    let row = 0;
    for (let y = hood.y; y < hood.y + hood.h; y += bh) {
      const offset = row % 2 === 0 ? 0 : bw / 2;
      ctx.beginPath();
      for (let x = hood.x - bw + offset; x < hood.x + hood.w; x += bw) {
        ctx.rect(x, y, bw, bh);
      }
      ctx.stroke();
      row++;
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Every building body was a single flat ctx.fillStyle = cfg.body rect fill
 * -- the biggest remaining "flat color chip" cue once camera/agent scale
 * was fixed (screenshot-confirmed: roofs/doors/awnings/window-lights read
 * fine, but the body itself has zero sense of light or volume). A cheap
 * top-lit vertical gradient on the same real geometry gives buildings a
 * lit-facade read instead of a solid swatch, with no new shapes or data.
 */
function lightenHex(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 255) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amt));
  const b = Math.min(255, Math.max(0, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

function facadeGradient(ctx: CanvasRenderingContext2D, color: string, y: number, h: number) {
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, lightenHex(color, 26));
  grad.addColorStop(1, lightenHex(color, -22));
  return grad;
}

function drawBuilding(ctx: CanvasRenderingContext2D, loc: LocationLayout, occupancy: number) {
  const cfg = BUILDING_COLORS[loc.type] || BUILDING_COLORS.residential;
  const { x, y, w, h } = loc;

  if (loc.type === "leisure") {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const baseR = Math.min(w, h) * 0.28;
    ctx.fillStyle = "#14532d";
    ctx.beginPath();
    ctx.ellipse(cx, y + h - 4, w * 0.36, h * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#78350f";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy + baseR * 0.4);
    ctx.lineTo(cx, y + h - 6);
    ctx.stroke();
    ctx.fillStyle = cfg.roof;
    ctx.beginPath();
    ctx.arc(cx, cy - baseR * 0.15, baseR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = cfg.body;
    ctx.beginPath();
    ctx.arc(cx - baseR * 0.35, cy + baseR * 0.05, baseR * 0.68, 0, Math.PI * 2);
    ctx.arc(cx + baseR * 0.4, cy + baseR * 0.1, baseR * 0.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (loc.type === "residential") {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(ctx, x + 3, y + 6, w - 6, h - 6, 5);
    ctx.fill();

    const roofH = Math.min(h * 0.34, 16);
    const bodyY = y + roofH;
    ctx.fillStyle = facadeGradient(ctx, cfg.body, bodyY, h - roofH - 4);
    roundRect(ctx, x + 4, bodyY, w - 8, h - roofH - 4, 4);
    ctx.fill();

    ctx.fillStyle = cfg.roof;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + 1);
    ctx.lineTo(x + w - 2, bodyY + 2);
    ctx.lineTo(x + 2, bodyY + 2);
    ctx.closePath();
    ctx.fill();

    // V4.3 -- roof overhang: a short eave lip a couple px past the wall
    // line on both slopes, the cheapest possible "this roof has depth,
    // it isn't just a flat triangle glued to a box" cue.
    ctx.strokeStyle = shade(cfg.roof, -0.3);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, bodyY + 2.5);
    ctx.lineTo(x + w, bodyY + 2.5);
    ctx.stroke();

    const doorW = Math.min(w * 0.18, 10);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x + w / 2 - doorW / 2, y + h - 14, doorW, 10);

    // V4.2 -- a couple of small lit windows either side of the door, the
    // single cheapest cue that flips a "house-shaped rectangle" into
    // something that reads as an actual home rather than a generic box.
    const winSize = Math.min(w * 0.12, 7);
    const winY = bodyY + (h - roofH - 4) * 0.32;
    ctx.fillStyle = "rgba(255,241,180,0.85)";
    if (w > 34) {
      ctx.fillRect(x + w * 0.22 - winSize / 2, winY, winSize, winSize);
      ctx.fillRect(x + w * 0.78 - winSize / 2, winY, winSize, winSize);
    } else {
      ctx.fillRect(x + w * 0.5 - winSize / 2 - winSize * 1.1, winY, winSize, winSize);
    }

    // Small yard strip where the tile has room for one, distinguishing a
    // detached house from a plain apartment block sharing the same shape.
    if (h - roofH - 4 > 26 && w > 30) {
      ctx.fillStyle = "rgba(34,197,94,0.16)";
      ctx.fillRect(x + 4, y + h - 5, w - 8, 3);
      // V4.3 -- a thin hedge line along the yard's outer edge, the
      // "fence/hedge where appropriate" cue, cheap enough to be a single
      // stroked line rather than a new shape.
      ctx.strokeStyle = "rgba(21,128,61,0.5)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + h - 5);
      ctx.lineTo(x + w - 4, y + h - 5);
      ctx.stroke();
    }
  } else if (loc.type === "workplace") {
    // V4.3 -- a slightly deeper, offset footprint shadow than the other
    // building types (workplaces are the tallest/largest footprint in the
    // set), so scale alone gives a depth cue before any facade detail.
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    roundRect(ctx, x + 4, y + 6, w - 6, h - 4, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(ctx, x + 3, y + 4, w - 6, h - 4, 3);
    ctx.fill();
    ctx.fillStyle = facadeGradient(ctx, cfg.body, y + 2, h - 6);
    roundRect(ctx, x + 4, y + 2, w - 8, h - 6, 3);
    ctx.fill();

    // Side shading: a vertical darker strip along the right edge of the
    // facade, simulating a building corner catching less light -- the
    // same "this has volume" trick as the roof overhang above, applied to
    // a taller box instead of a peaked roof.
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(x + w - 10, y + 2, 6, h - 6);

    ctx.fillStyle = cfg.roof;
    ctx.fillRect(x + 4, y + 2, w - 8, 4);

    const cols = Math.max(2, Math.floor((w - 12) / 10));
    const rows = Math.max(1, Math.floor((h - 16) / 9));
    const lit = Math.min(cols * rows, Math.max(1, occupancy));
    ctx.fillStyle = "rgba(255,241,150,0.9)";
    let count = 0;
    outer: for (let ri = 0; ri < rows; ri++) {
      for (let ci = 0; ci < cols; ci++) {
        if (count >= lit) break outer;
        ctx.fillRect(x + 6 + ci * ((w - 12) / cols), y + 10 + ri * ((h - 18) / Math.max(rows, 1)), 4, 4);
        count++;
      }
    }
  } else if (loc.type === "market") {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(ctx, x + 3, y + 10, w - 6, h - 10, 4);
    ctx.fill();
    ctx.fillStyle = facadeGradient(ctx, cfg.body, y + 12, h - 14);
    roundRect(ctx, x + 4, y + 12, w - 8, h - 14, 4);
    ctx.fill();

    const scallops = Math.max(3, Math.floor((w - 8) / 10));
    const scallopW = (w - 8) / scallops;
    for (let i = 0; i < scallops; i++) {
      ctx.fillStyle = i % 2 === 0 ? cfg.roof : "#fde68a";
      ctx.beginPath();
      ctx.moveTo(x + 4 + i * scallopW, y + 2);
      ctx.lineTo(x + 4 + (i + 1) * scallopW, y + 2);
      ctx.lineTo(x + 4 + (i + 0.5) * scallopW, y + 12);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 5, y + h - 8);
    ctx.lineTo(x + w - 5, y + h - 8);
    ctx.stroke();

    // V4.3 -- a couple of small outdoor stall marks in front of the
    // counter line, when there's room, so the "small outdoor area /
    // stalls" cue reads without adding a whole new shape category.
    if (h - 8 > 14 && w > 40) {
      const stallCount = 2;
      const stallW = 7;
      for (let i = 0; i < stallCount; i++) {
        const sx = x + w * (0.32 + i * 0.36) - stallW / 2;
        ctx.fillStyle = i % 2 === 0 ? "#f97316" : "#0ea5e9";
        ctx.fillRect(sx, y + h - 6, stallW, 4);
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1;
        ctx.strokeRect(sx, y + h - 6, stallW, 4);
      }
    }
  } else {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(ctx, x + 3, y + 6, w - 6, h - 6, 6);
    ctx.fill();
    ctx.fillStyle = facadeGradient(ctx, cfg.body, y + 2, h - 6);
    roundRect(ctx, x + 3, y + 2, w - 6, h - 6, 6);
    ctx.fill();
  }

  if (occupancy > 0) {
    ctx.fillStyle = "rgba(8,145,178,0.92)";
    const pillW = 18;
    roundRect(ctx, x + w - pillW - 3, y + 3, pillW, 13, 6);
    ctx.fill();
    ctx.fillStyle = "#ecfeff";
    ctx.font = `700 9px ${MONO_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(occupancy), x + w - pillW / 2 - 3, y + 3 + 7);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  if (w > 54) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = `600 9px ${MONO_FONT}`;
    ctx.textBaseline = "top";
    const label = loc.name.length > 16 ? loc.name.slice(0, 15) + "…" : loc.name;
    ctx.fillText(label, x + 5, y + h - 22 >= y ? y + h - 22 : y + h - 12);
  }
}

function drawAgent(
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  x: number,
  y: number,
  r: number,
  isSelected: boolean,
  facing: number,
  walkPhase: number,
  walkAmplitude: number,
  showLabel: boolean,
  delta: AgentDelta | undefined,
  idlePhase: number
) {
  const bodyColor = OCCUPATION_COLORS[agent.occupation?.toLowerCase()] || OCCUPATION_COLORS.unemployed;
  const actionType = agent.current_action?.action_type;
  const ringColor = (actionType && ACTION_RING_COLORS[actionType]) || "#525252";
  const facingRight = Math.cos(facing) >= 0;

  // Idle sway: a slow ~2px vertical breathe, only present once walkAmplitude
  // has settled near 0 (i.e. the agent has actually stopped, per the real
  // path-empty state), so it never overlaps or competes with the real walk
  // bounce.
  const idleAmount = 1 - walkAmplitude;
  const idleBob = Math.sin(idlePhase) * 1.6 * idleAmount;
  y += idleBob;

  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(x, y + r * 1.15, r * 0.85, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  if (isSelected) {
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y - r * 0.1, r * 2.1, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(x, y);
  if (!facingRight) ctx.scale(-1, 1);

  const swing = Math.sin(walkPhase) * walkAmplitude;
  const legLen = r * 1.05;
  const armLen = r * 0.85;
  const hipY = r * 0.15;
  const shoulderY = -r * 0.35;

  ctx.lineCap = "round";

  ctx.lineWidth = r * 0.32;
  ctx.strokeStyle = shade(bodyColor, -0.25);
  ctx.beginPath();
  ctx.moveTo(-r * 0.18, hipY);
  ctx.lineTo(-r * 0.18 + Math.sin(-swing) * legLen * 0.5, hipY + legLen * Math.cos(swing * 0.6));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 0.32, shoulderY);
  ctx.lineTo(-r * 0.32 + Math.sin(swing) * armLen * 0.55, shoulderY + armLen * Math.cos(swing * 0.5));
  ctx.stroke();

  ctx.fillStyle = bodyColor;
  roundRect(ctx, -r * 0.5, shoulderY, r, r * (0.15 - shoulderY / r) + r * 0.5, r * 0.32);
  ctx.fill();

  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = r * 0.32;
  ctx.beginPath();
  ctx.moveTo(r * 0.18, hipY);
  ctx.lineTo(r * 0.18 + Math.sin(swing) * legLen * 0.5, hipY + legLen * Math.cos(swing * 0.6));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(r * 0.32, shoulderY);
  ctx.lineTo(r * 0.32 + Math.sin(-swing) * armLen * 0.55, shoulderY + armLen * Math.cos(swing * 0.5));
  ctx.stroke();

  ctx.fillStyle = "#f5d0a9";
  ctx.beginPath();
  ctx.arc(0, shoulderY - r * 0.45, r * 0.55, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, shoulderY - r * 0.45, r * 0.55 + 2.2, 0, Math.PI * 2);
  ctx.stroke();

  // V4.2 -- distinct icon shape per real current_action, not just ring
  // color, so "what are they doing" doesn't require reading the label
  // text at all. Badge sits at the same spot the old generic flag used.
  const badgeX = r * 0.62;
  const badgeY = shoulderY - r * 0.45;
  ctx.fillStyle = "#0a0a0a";
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(badgeX, badgeY, r * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = ringColor;
  ctx.fillStyle = ringColor;
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.lineCap = "round";
  const s = r * 0.22;
  if (actionType === "work") {
    // briefcase
    ctx.strokeRect(badgeX - s, badgeY - s * 0.7, s * 2, s * 1.4);
    ctx.beginPath();
    ctx.moveTo(badgeX - s * 0.4, badgeY - s * 0.7);
    ctx.lineTo(badgeX - s * 0.4, badgeY - s * 1.05);
    ctx.lineTo(badgeX + s * 0.4, badgeY - s * 1.05);
    ctx.lineTo(badgeX + s * 0.4, badgeY - s * 0.7);
    ctx.stroke();
  } else if (actionType === "consume_food") {
    // cup
    ctx.beginPath();
    ctx.moveTo(badgeX - s * 0.7, badgeY - s * 0.8);
    ctx.lineTo(badgeX - s * 0.5, badgeY + s * 0.9);
    ctx.lineTo(badgeX + s * 0.5, badgeY + s * 0.9);
    ctx.lineTo(badgeX + s * 0.7, badgeY - s * 0.8);
    ctx.stroke();
  } else if (actionType === "rest") {
    // zzz
    ctx.font = `700 ${Math.max(4, s * 2.6)}px ${MONO_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("z", badgeX, badgeY + s * 0.05);
  } else if (actionType === "socialize") {
    // two people
    ctx.beginPath();
    ctx.arc(badgeX - s * 0.45, badgeY - s * 0.15, s * 0.4, 0, Math.PI * 2);
    ctx.arc(badgeX + s * 0.45, badgeY - s * 0.15, s * 0.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (actionType === "move") {
    // arrow
    ctx.beginPath();
    ctx.moveTo(badgeX - s * 0.7, badgeY);
    ctx.lineTo(badgeX + s * 0.6, badgeY);
    ctx.moveTo(badgeX + s * 0.1, badgeY - s * 0.55);
    ctx.lineTo(badgeX + s * 0.7, badgeY);
    ctx.lineTo(badgeX + s * 0.1, badgeY + s * 0.55);
    ctx.stroke();
  } else {
    // idle
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, s * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  if (showLabel) {
    const labelY = y + shoulderY - r * 0.45 - r * 0.95;
    const name = agent.name;
    const actionLabel = actionType ? ACTION_LABELS[actionType] ?? actionType.replace(/_/g, " ") : null;

    ctx.textAlign = "center";
    ctx.font = `700 3.6px ${MONO_FONT}`;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillText(name, x + 0.15, labelY - 3.85);
    ctx.fillStyle = "#f4f4f5";
    ctx.fillText(name, x, labelY - 4);

    if (actionLabel) {
      ctx.font = `600 3.1px ${MONO_FONT}`;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(actionLabel, x + 0.15, labelY + 0.15);
      ctx.fillStyle = ringColor;
      ctx.fillText(actionLabel, x, labelY);
    }

    if (delta) {
      ctx.font = `600 2.9px ${MONO_FONT}`;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillText(delta.label, x + 0.15, labelY + 3.65);
      ctx.fillStyle = "#34d399";
      ctx.fillText(delta.label, x, labelY + 3.5);
    }
    ctx.textAlign = "left";
  }
}

function shade(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const adjust = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amount < 0 ? c : 255 - c) * amount)));
  r = adjust(r);
  g = adjust(g);
  b = adjust(b);
  return `rgb(${r},${g},${b})`;
}
