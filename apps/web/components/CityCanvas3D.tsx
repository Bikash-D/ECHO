"use client";

/**
 * CityCanvas3D — Stage 1 vertical slice of a low-poly 3D "Living City"
 * renderer, built alongside (never replacing) CityCanvas.tsx.
 *
 * Scope (per the Stage 1 brief): one real, currently-active micro-district
 * (3-4 real ECHO locations) rendered as a believable miniature
 * neighborhood, with real live agents walking between their actual
 * backend locations. Visual quality over object count.
 *
 * Data contract: this component takes the exact same props as
 * CityCanvas.tsx, so the two are a drop-in swap behind the 2D/3D toggle.
 * Every agent position, action, need, and location fact traces back to
 * the live `WorldResponse` polled from `/api/world` — this component and
 * its adapter (lib/adapters/3dAdapter.ts) never fetch or invent
 * simulation state, only project real state into 3D screen space.
 *
 * ---------------------------------------------------------------------
 * PERFORMANCE PASS (this revision)
 * ---------------------------------------------------------------------
 * Profiling method: I don't have a live browser attached to a running
 * backend in this environment, so this pass is a structural/code-level
 * profile rather than a captured flame graph — I walked the render path
 * end-to-end (React re-render triggers -> Three.js draw calls -> per-frame
 * allocations) and fixed every point where cost scaled with agent count
 * instead of staying flat. An FPS counter (drei's <Stats>) is wired in by
 * default so this can be verified empirically against the real backend
 * with a real, unmodified population.
 *
 * Causes of frame drops identified, and the fix for each:
 *
 * 1. FULL SCENE REBUILT EVERY TICK. `buildMicroDistrictScene` (topology
 *    projection, per-building hashing, prop placement) was re-run on
 *    every poll (~1-4x/sec), which also forced every Building/Tree/Lamp/
 *    Bench mesh to unmount+remount since the whole `scene` object was a
 *    new reference each time. Fix: the micro-district's identity now
 *    locks on first successful pick and only re-derives on a genuine
 *    simulation reset (tick going backwards) — see the effect in
 *    `CityCanvas3D` below. Real occupancy still drives which agents are
 *    visible and where they walk every tick; only the "which 3-4
 *    buildings are on screen" decision is no longer re-litigated 4x/sec.
 *
 * 2. ONE REACT COMPONENT + ONE Html DOM NODE PER AGENT. The previous
 *    version mounted a full React component (with a useFrame subscription)
 *    and a drei <Html> portal (a real DOM element, repositioned via CSS
 *    transform every frame) for every single agent. At 100 agents that's
 *    100 useFrame callbacks and 100 DOM nodes doing per-frame layout work
 *    — by far the largest cost, and it scaled linearly with population.
 *    Fix: agent bodies/heads/shadows/action-rings are now four
 *    THREE.InstancedMesh draw calls total (not 4 * N), updated from a
 *    single useFrame loop that writes directly into shared, preallocated
 *    matrix/vector/quaternion objects (zero per-frame allocation). Name +
 *    icon <Html> labels are capped to the nearest ~8 on-screen agents
 *    (LOD, see #4) plus the selected one, recomputed ~6x/sec instead of
 *    60x/sec — so DOM cost is now bounded by a constant, not by
 *    population size.
 *
 * 3. PER-FRAME OBJECT ALLOCATION. Agent motion state previously did
 *    `pos = {x, y, z}` (a new object literal) every frame, and the frame
 *    loop did `Array.from(map.values())` (a new array) every frame — with
 *    100 agents that's hundreds of short-lived allocations/sec feeding
 *    the garbage collector, which shows up as periodic frame-time spikes
 *    (GC pauses) rather than a low steady frame time. Fix: motion state
 *    is mutated in place; the frame loop iterates the Map directly; a
 *    single shared Matrix4/Quaternion/Vector3 are reused for every
 *    instance write.
 *
 * 4. NO LOD. Every agent got full detail and a label at every distance;
 *    every building's per-window mesh was drawn at every distance. Fix:
 *    (a) buildings use drei's <Detailed> to swap to a plain low-poly box
 *    beyond a distance threshold, and windows are now one baked-texture
 *    facade per building (1 draw call) instead of one mesh per window
 *    (previously up to ~16 draws per building); (b) agent labels are
 *    LOD-gated to the nearest-to-camera subset (see #2).
 *
 * 5. CONTINUOUS DYNAMIC SHADOWS. The directional light's shadow map was
 *    re-rendered every single frame even though the only things casting
 *    real shadows (buildings/props) never move, and drei's
 *    <ContactShadows> was recomputing its blurred shadow texture every
 *    frame too. Fix: `shadow.autoUpdate` freezes to `false` a few frames
 *    after the scene settles (and unfreezes briefly on a real reset), and
 *    <ContactShadows frames={1}> bakes once. Agents were already using
 *    fake "blob" shadows rather than real shadow-casting, so this doesn't
 *    change how agent shadows look.
 *
 * Population handling: `MAX_VISIBLE_AGENTS` is set to the backend's real
 * default population (100) — i.e. the cap is "however many real agents
 * are actually in this micro-district," not an artificial ceiling picked
 * to make the demo faster. If a micro-district is genuinely that busy,
 * the instancing above is what keeps it smooth, not a lower population.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, ThreeEvent } from "@react-three/fiber";
import { Detailed, Html, OrbitControls, ContactShadows, PerspectiveCamera, Stats } from "@react-three/drei";
import * as THREE from "three";
import { Agent, AgentDelta, Location, Neighborhood } from "@/lib/types";
import {
  Building3D,
  MicroDistrictScene,
  PropPlacement3D,
  Vec3,
  actionIcon,
  agentRoute3D,
  agentRouteAny3D,
  agentTargetPosition,
  buildMicroDistrictScene,
  pickVisibleAgents,
} from "@/lib/adapters/3dAdapter";

interface CityCanvas3DProps {
  neighborhoods: Neighborhood[];
  locations: Location[];
  agents: Agent[];
  tick: number;
  selectedAgentId?: string;
  onSelectAgent: (agent: Agent) => void;
  onSelectLocation: (location: Location) => void;
  /** Accepted for prop-parity with CityCanvas; Stage 1 doesn't render
   * causality callouts in 3D yet. */
  latestDeltas?: Map<string, AgentDelta>;
  /** Citizen Follow Mode (real backend agent, never a rendering-only
   * concept): when set, the camera detaches from OrbitControls and
   * chases this agent's real, live position every frame -- see
   * `FollowCameraRig` below. Sourced from the same `agents` list; this
   * component never invents an agent or a path for them. */
  followedAgentId?: string | null;
  /** Called when the user exits Follow Mode from inside the 3D view
   * (the on-canvas "Exit Follow" chip). The page owns the actual state. */
  onExitFollow?: () => void;
}

// Same palette as CityCanvas.tsx, so the 2D/3D toggle reads as one city.
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

const WALK_SPEED = 2.6; // world units / second
const ARRIVE_EPSILON = 0.05;

/** Real backend default population (see apps/api/app/simulation/state.py)
 * — never trimmed below this to fake better performance. A given
 * micro-district will usually show far fewer than this at once (its real
 * occupancy), but the rendering path is built to stay smooth even in the
 * worst case where it doesn't. */
const MAX_VISIBLE_AGENTS = 100;

/** LOD for agent labels: only the nearest-to-camera N (+ the selected
 * agent) get a mounted <Html> name/icon tag; the rest are still fully
 * visible and their action state is still readable via ring color, they
 * just don't carry a DOM label. */
const MAX_LABELS = 8;
/** Recompute which agents are "near" roughly 6x/sec instead of every
 * frame — camera distance doesn't need 60Hz precision to pick a label
 * subset. */
const LABEL_RECOMPUTE_INTERVAL_FRAMES = 10;

// ---------------------------------------------------------------------
// Shared, module-scope geometries/materials — created ONCE, reused by
// every instance. Building these per-component-render (as the previous
// version did with inline JSX <capsuleGeometry>/<meshStandardMaterial>)
// forces Three.js to reconstruct GPU resources on every React re-render.
// ---------------------------------------------------------------------

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const IDENTITY_QUAT = new THREE.Quaternion();

const BODY_GEOMETRY = new THREE.CapsuleGeometry(0.22, 0.55, 4, 8);
const HEAD_GEOMETRY = new THREE.SphereGeometry(0.19, 10, 10);
const SHADOW_GEOMETRY = new THREE.CircleGeometry(0.3, 10);
SHADOW_GEOMETRY.rotateX(-Math.PI / 2);
const RING_GEOMETRY = new THREE.RingGeometry(0.32, 0.4, 16);
RING_GEOMETRY.rotateX(-Math.PI / 2);

const BODY_MATERIAL = new THREE.MeshStandardMaterial({ roughness: 0.8 });
const HEAD_MATERIAL = new THREE.MeshStandardMaterial({ color: "#e7c19c", roughness: 0.9 });
const SHADOW_MATERIAL = new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.25 });
const RING_MATERIAL = new THREE.MeshBasicMaterial({});

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const id of b) if (!setA.has(id)) return false;
  return true;
}

// ---------------------------------------------------------------------
// Building facade texture — one baked canvas texture per (cols, rows)
// combination, cached and reused across every building that shares it.
// Replaces the previous per-window <mesh> loop (up to ~16 draw calls per
// building) with a single textured plane (1 draw call).
// ---------------------------------------------------------------------

const facadeTextureCache = new Map<string, THREE.CanvasTexture>();

function getFacadeTexture(cols: number, rows: number): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null; // SSR guard
  const key = `${cols}x${rows}`;
  const cached = facadeTextureCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, 128, 128);
  const cellW = 128 / cols;
  const cellH = 128 / rows;
  ctx.fillStyle = "#fde68a";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pad = Math.min(cellW, cellH) * 0.18;
      ctx.fillRect(c * cellW + pad, r * cellH + pad, cellW - pad * 2, cellH - pad * 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  facadeTextureCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------
// Building mesh (with LOD)
// ---------------------------------------------------------------------

const BuildingMesh = React.memo(function BuildingMesh({
  building,
  farDistance,
  onSelect,
}: {
  building: Building3D;
  farDistance: number;
  onSelect: () => void;
}) {
  const { position, width, depth, height, rotationY, visual, floors } = building;
  const roofHeight = Math.min(1.6, height * 0.22);
  const cols = Math.max(2, Math.round(width / 1.6));
  const rows = Math.max(1, floors);
  const facadeTex = useMemo(() => getFacadeTexture(cols, rows), [cols, rows]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect();
  };

  // High-detail version: body + roof + baked-window facade + door + plinth.
  const high = (
    <group onClick={handleClick}>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={visual.bodyColor} roughness={0.85} />
      </mesh>
      <mesh position={[0, height + roofHeight / 2, 0]} castShadow>
        <boxGeometry args={[width * 1.05, roofHeight, depth * 1.05]} />
        <meshStandardMaterial color={visual.roofColor} roughness={0.7} />
      </mesh>
      <mesh position={[0, height * 0.5, depth / 2 + 0.02]}>
        <planeGeometry args={[width * 0.86, height * 0.7]} />
        {facadeTex ? (
          <meshStandardMaterial
            map={facadeTex}
            transparent
            emissiveMap={facadeTex}
            emissive="#fde68a"
            emissiveIntensity={0.4}
            toneMapped={false}
          />
        ) : (
          <meshStandardMaterial color={visual.bodyColor} transparent opacity={0} />
        )}
      </mesh>
      <mesh position={[0, 0.9, depth / 2 + 0.04]}>
        <planeGeometry args={[Math.min(1.1, width * 0.22), 1.8]} />
        <meshStandardMaterial color="#3f2a1a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.08, 0]} receiveShadow>
        <boxGeometry args={[width + 0.3, 0.16, depth + 0.3]} />
        <meshStandardMaterial color="#8a8a86" roughness={1} />
      </mesh>
    </group>
  );

  // Low-detail version (beyond farDistance): a single box + roof, no
  // facade texture, no door plane, no plinth -- cheap enough to draw at
  // any distance and to any number of far-away buildings later.
  const low = (
    <group onClick={handleClick}>
      <mesh position={[0, height / 2, 0]} castShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={visual.bodyColor} roughness={0.9} />
      </mesh>
      <mesh position={[0, height + roofHeight / 2, 0]}>
        <boxGeometry args={[width * 1.05, roofHeight, depth * 1.05]} />
        <meshStandardMaterial color={visual.roofColor} roughness={0.8} />
      </mesh>
    </group>
  );

  return (
    <group position={[position.x, 0, position.z]} rotation={[0, rotationY, 0]}>
      <Detailed distances={[0, farDistance]}>
        {high}
        {low}
      </Detailed>
    </group>
  );
});

// ---------------------------------------------------------------------
// Street furniture (unchanged geometry, memoized so a locked `scene`
// means these never re-render after the initial mount).
// ---------------------------------------------------------------------

const TreeMesh = React.memo(function TreeMesh({ prop }: { prop: PropPlacement3D }) {
  return (
    <group position={[prop.position.x, 0, prop.position.z]} rotation={[0, prop.rotationY, 0]}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.13, 1, 6]} />
        <meshStandardMaterial color="#5b4230" roughness={1} />
      </mesh>
      <mesh position={[0, 1.35, 0]} castShadow>
        <coneGeometry args={[0.75, 1.5, 7]} />
        <meshStandardMaterial color="#2f6b3f" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.9, 0]} castShadow>
        <coneGeometry args={[0.55, 1.1, 7]} />
        <meshStandardMaterial color="#3d8250" roughness={0.9} />
      </mesh>
    </group>
  );
});

const LampMesh = React.memo(function LampMesh({ prop }: { prop: PropPlacement3D }) {
  return (
    <group position={[prop.position.x, 0, prop.position.z]}>
      <mesh position={[0, 1.1, 0]}>
        <cylinderGeometry args={[0.04, 0.05, 2.2, 6]} />
        <meshStandardMaterial color="#2b2b2b" roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh position={[0, 2.25, 0]}>
        <sphereGeometry args={[0.14, 8, 8]} />
        <meshStandardMaterial color="#ffe9a8" emissive="#ffd873" emissiveIntensity={0.9} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 2.25, 0]} intensity={1.1} distance={6} decay={2} color="#ffd873" />
    </group>
  );
});

const BenchMesh = React.memo(function BenchMesh({ prop }: { prop: PropPlacement3D }) {
  return (
    <group position={[prop.position.x, 0, prop.position.z]} rotation={[0, prop.rotationY, 0]}>
      <mesh position={[0, 0.32, 0]}>
        <boxGeometry args={[1.2, 0.08, 0.4]} />
        <meshStandardMaterial color="#6b4a30" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.5, -0.17]}>
        <boxGeometry args={[1.2, 0.35, 0.06]} />
        <meshStandardMaterial color="#6b4a30" roughness={0.9} />
      </mesh>
      <mesh position={[-0.5, 0.16, 0]}>
        <boxGeometry args={[0.06, 0.32, 0.4]} />
        <meshStandardMaterial color="#2b2b2b" roughness={0.6} />
      </mesh>
      <mesh position={[0.5, 0.16, 0]}>
        <boxGeometry args={[0.06, 0.32, 0.4]} />
        <meshStandardMaterial color="#2b2b2b" roughness={0.6} />
      </mesh>
    </group>
  );
});

// ---------------------------------------------------------------------
// Ground: grass + paved road + sidewalks (memoized; only depends on the
// now-locked `scene`).
// ---------------------------------------------------------------------

const Ground = React.memo(function Ground({ scene }: { scene: MicroDistrictScene }) {
  const padding = 8;
  const w = scene.bounds.maxX - scene.bounds.minX + padding * 2;
  const d = scene.bounds.maxZ - scene.bounds.minZ + padding * 2;
  const cx = (scene.bounds.minX + scene.bounds.maxX) / 2;
  const cz = (scene.bounds.minZ + scene.bounds.maxZ) / 2;

  const roadLen = Math.hypot(scene.street.b.x - scene.street.a.x, scene.street.b.z - scene.street.a.z);
  const roadMidX = (scene.street.a.x + scene.street.b.x) / 2;
  const roadMidZ = (scene.street.a.z + scene.street.b.z) / 2;
  const roadAngle = Math.atan2(scene.street.b.z - scene.street.a.z, scene.street.b.x - scene.street.a.x);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.02, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#6b8f5a" roughness={1} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, -roadAngle]} position={[roadMidX, 0.01, roadMidZ]} receiveShadow>
        <planeGeometry args={[roadLen + 3, scene.street.width]} />
        <meshStandardMaterial color="#3a3a3d" roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, -roadAngle]} position={[roadMidX, 0.02, roadMidZ]}>
        <planeGeometry args={[roadLen * 0.94, 0.08]} />
        <meshStandardMaterial color="#d8c96a" roughness={0.6} />
      </mesh>

      {scene.sidewalks.map((sw, i) => {
        const len = Math.hypot(sw.b.x - sw.a.x, sw.b.z - sw.a.z);
        const midX = (sw.a.x + sw.b.x) / 2;
        const midZ = (sw.a.z + sw.b.z) / 2;
        const angle = Math.atan2(sw.b.z - sw.a.z, sw.b.x - sw.a.x);
        return (
          <mesh key={i} rotation={[-Math.PI / 2, 0, -angle]} position={[midX, 0.015, midZ]} receiveShadow>
            <planeGeometry args={[len + 3, sw.width]} />
            <meshStandardMaterial color="#9c9c94" roughness={0.9} />
          </mesh>
        );
      })}
    </group>
  );
});

// ---------------------------------------------------------------------
// Agent motion state (plain object, mutated in place every frame)
// ---------------------------------------------------------------------

interface AgentMotionState {
  pos: Vec3;
  waypoints: Vec3[];
  lastLocationId: string;
  facing: number;
}

/** Map of agentId -> live motion state, mutated in place every frame.
 * Owned by the top-level `CityCanvas3D` component (not `AgentInstancedField`)
 * so `FollowCameraRig` can read the exact same positions the rendered
 * agent instances use -- one source of truth for "where is this agent
 * on screen right now", never a second copy that could drift. */
type MotionMap = Map<string, AgentMotionState>;

// ---------------------------------------------------------------------
// Instanced agent field — 4 draw calls total (bodies/heads/shadows/rings)
// regardless of agent count, plus a small capped set of <Html> labels.
// ---------------------------------------------------------------------

function AgentInstancedField({
  visibleAgents,
  scene,
  selectedAgentId,
  onSelectAgent,
  motionRef,
  followedAgentId,
}: {
  visibleAgents: Agent[];
  scene: MicroDistrictScene;
  selectedAgentId?: string;
  onSelectAgent: (agent: Agent) => void;
  /** Shared with `FollowCameraRig` -- see `MotionMap` above. */
  motionRef: React.MutableRefObject<MotionMap>;
  /** The one agent (if any) Follow Mode is currently attached to. Only
   * this agent's route computation is allowed to leave the windowed
   * micro-district (see `agentRouteAny3D`); every other agent keeps the
   * exact unmodified Stage-1 behavior. */
  followedAgentId?: string | null;
}) {
  const { camera } = useThree();

  const bodiesRef = useRef<THREE.InstancedMesh>(null);
  const headsRef = useRef<THREE.InstancedMesh>(null);
  const shadowsRef = useRef<THREE.InstancedMesh>(null);
  const ringsRef = useRef<THREE.InstancedMesh>(null);

  // Stable index <-> agentId assignment. Only reshuffled when the *set*
  // of visible agent ids actually changes (an agent entering/leaving the
  // district) -- not every tick, since `agents` is a brand-new array
  // reference every poll even when nothing material changed.
  const assignRef = useRef<{ idToIndex: Map<string, number>; idsByIndex: (string | null)[] }>({
    idToIndex: new Map(),
    idsByIndex: new Array(MAX_VISIBLE_AGENTS).fill(null),
  });
  const agentsByIdRef = useRef<Map<string, Agent>>(new Map());

  // Reusable scratch objects -- created once, mutated every frame. This
  // is what eliminates the per-frame allocation churn described above.
  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      quat: new THREE.Quaternion(),
      pos: new THREE.Vector3(),
      scale: new THREE.Vector3(1, 1, 1),
      color: new THREE.Color(),
    }),
    []
  );

  const [labelIds, setLabelIds] = useState<string[]>([]);
  const frameCountRef = useRef(0);

  // ---- Reconcile real backend state. Runs on each poll tick (React
  // commit), NOT on each rendered frame -- composition/color/route
  // changes only need to react to new backend data. ----
  useEffect(() => {
    const assign = assignRef.current;
    const currentIds = new Set(visibleAgents.map((a) => a.id));

    for (const [id, idx] of Array.from(assign.idToIndex.entries())) {
      if (!currentIds.has(id)) {
        assign.idToIndex.delete(id);
        assign.idsByIndex[idx] = null;
        motionRef.current.delete(id);
        agentsByIdRef.current.delete(id);
      }
    }
    for (const agent of visibleAgents) {
      agentsByIdRef.current.set(agent.id, agent);
      if (assign.idToIndex.has(agent.id)) continue;
      const freeIdx = assign.idsByIndex.indexOf(null);
      if (freeIdx === -1) continue; // at capacity -- never fabricate a slot
      assign.idToIndex.set(agent.id, freeIdx);
      assign.idsByIndex[freeIdx] = agent.id;
    }

    for (const agent of visibleAgents) {
      const target = agentTargetPosition(scene, agent);
      if (!target) continue;
      const existing = motionRef.current.get(agent.id);
      if (!existing) {
        motionRef.current.set(agent.id, {
          pos: { x: target.x, y: 0, z: target.z },
          waypoints: [],
          lastLocationId: agent.location_id,
          facing: 0,
        });
        continue;
      }
      if (existing.lastLocationId !== agent.location_id) {
        // Real backend truth already happened: `agent.location_id` is
        // where they actually are right now (movement is resolved
        // atomically server-side -- see action_resolver.py). This route
        // is purely the visual path we walk them along to get there.
        let route = agentRoute3D(scene, existing.lastLocationId, agent.location_id);
        // Only the followed agent is allowed off the windowed district:
        // background agents that leave the scene simply stop being
        // rendered (pickVisibleAgents drops them next poll), same as
        // before this change.
        if (!route && followedAgentId && agent.id === followedAgentId) {
          route = agentRouteAny3D(scene, existing.lastLocationId, agent.location_id);
        }
        existing.waypoints = route && route.length > 0 ? [...route, target] : [target];
        existing.lastLocationId = agent.location_id;
      }
    }

    // Colors only need writing to the GPU buffer when they actually
    // change; occupation never changes and action changes only a few
    // times/second, so doing this here (once per poll) rather than in
    // the 60Hz frame loop costs effectively nothing.
    const bodies = bodiesRef.current;
    const rings = ringsRef.current;
    if (bodies) {
      for (const agent of visibleAgents) {
        const idx = assign.idToIndex.get(agent.id);
        if (idx == null) continue;
        scratch.color.set(OCCUPATION_COLORS[agent.occupation?.toLowerCase()] || OCCUPATION_COLORS.unemployed);
        bodies.setColorAt(idx, scratch.color);
      }
      if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    }
    if (rings) {
      for (const agent of visibleAgents) {
        const idx = assign.idToIndex.get(agent.id);
        if (idx == null) continue;
        const actionType = agent.current_action?.action_type;
        scratch.color.set((actionType && ACTION_RING_COLORS[actionType]) || "#525252");
        rings.setColorAt(idx, scratch.color);
      }
      if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
    }

    const count = assign.idToIndex.size;
    if (bodiesRef.current) bodiesRef.current.count = count;
    if (headsRef.current) headsRef.current.count = count;
    if (shadowsRef.current) shadowsRef.current.count = count;
    if (ringsRef.current) ringsRef.current.count = count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAgents, scene]);

  // ---- Per-frame: position/rotation interpolation + instance matrix
  // writes only. No object allocation, no React state (except the
  // throttled label-set update below). ----
  useFrame((_, delta) => {
    const assign = assignRef.current;
    const bodies = bodiesRef.current;
    const heads = headsRef.current;
    const shadows = shadowsRef.current;
    const rings = ringsRef.current;
    if (!bodies || !heads || !shadows || !rings) return;

    const step = WALK_SPEED * Math.min(delta, 0.1);

    for (const [id, idx] of assign.idToIndex) {
      const m = motionRef.current.get(id);
      if (!m) continue;

      if (m.waypoints.length > 0) {
        const target = m.waypoints[0];
        const dx = target.x - m.pos.x;
        const dz = target.z - m.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < ARRIVE_EPSILON) {
          m.waypoints.shift();
        } else {
          const move = Math.min(step, dist);
          m.pos.x += (dx / dist) * move;
          m.pos.z += (dz / dist) * move;
          m.facing = Math.atan2(dx, dz);
        }
      }

      scratch.pos.set(m.pos.x, 0.55, m.pos.z);
      scratch.quat.setFromAxisAngle(UP_AXIS, m.facing);
      scratch.matrix.compose(scratch.pos, scratch.quat, scratch.scale);
      bodies.setMatrixAt(idx, scratch.matrix);

      scratch.pos.set(m.pos.x, 1.12, m.pos.z);
      scratch.matrix.compose(scratch.pos, IDENTITY_QUAT, scratch.scale);
      heads.setMatrixAt(idx, scratch.matrix);

      scratch.pos.set(m.pos.x, 0.01, m.pos.z);
      scratch.matrix.compose(scratch.pos, IDENTITY_QUAT, scratch.scale);
      shadows.setMatrixAt(idx, scratch.matrix);

      scratch.pos.set(m.pos.x, 0.015, m.pos.z);
      scratch.matrix.compose(scratch.pos, IDENTITY_QUAT, scratch.scale);
      rings.setMatrixAt(idx, scratch.matrix);
    }
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    shadows.instanceMatrix.needsUpdate = true;
    rings.instanceMatrix.needsUpdate = true;

    // Throttled LOD label recompute (~6x/sec instead of 60x/sec).
    frameCountRef.current += 1;
    if (frameCountRef.current % LABEL_RECOMPUTE_INTERVAL_FRAMES === 0) {
      const withDist: { id: string; distSq: number }[] = [];
      for (const [id] of assign.idToIndex) {
        const m = motionRef.current.get(id);
        if (!m) continue;
        const dx = m.pos.x - camera.position.x;
        const dz = m.pos.z - camera.position.z;
        withDist.push({ id, distSq: dx * dx + dz * dz });
      }
      withDist.sort((a, b) => a.distSq - b.distSq);
      const nearest = withDist.slice(0, MAX_LABELS).map((d) => d.id);
      if (selectedAgentId && assign.idToIndex.has(selectedAgentId) && !nearest.includes(selectedAgentId)) {
        nearest.push(selectedAgentId);
      }
      setLabelIds((prev) => (sameIds(prev, nearest) ? prev : nearest));
    }
  });

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId == null) return;
    const agentId = assignRef.current.idsByIndex[e.instanceId];
    if (!agentId) return;
    const agent = agentsByIdRef.current.get(agentId);
    if (agent) onSelectAgent(agent);
  };

  const selectedMotion = selectedAgentId ? motionRef.current.get(selectedAgentId) : undefined;

  return (
    <>
      <instancedMesh
        ref={bodiesRef}
        args={[BODY_GEOMETRY, BODY_MATERIAL, MAX_VISIBLE_AGENTS]}
        onPointerDown={handlePointerDown}
      />
      <instancedMesh ref={headsRef} args={[HEAD_GEOMETRY, HEAD_MATERIAL, MAX_VISIBLE_AGENTS]} />
      <instancedMesh ref={shadowsRef} args={[SHADOW_GEOMETRY, SHADOW_MATERIAL, MAX_VISIBLE_AGENTS]} />
      <instancedMesh ref={ringsRef} args={[RING_GEOMETRY, RING_MATERIAL, MAX_VISIBLE_AGENTS]} />

      {labelIds.map((id) => {
        const agent = agentsByIdRef.current.get(id);
        const m = motionRef.current.get(id);
        if (!agent || !m) return null;
        return <AgentLabel key={id} agent={agent} motion={m} />;
      })}

      {selectedMotion && <SelectionRing motion={selectedMotion} />}
    </>
  );
}

/** A single agent's floating name + action-icon tag. Only mounted for the
 * LOD-capped "nearby" subset (see MAX_LABELS) plus the selected agent, so
 * DOM node count never scales with total population. */
function AgentLabel({ agent, motion }: { agent: Agent; motion: AgentMotionState }) {
  const groupRef = useRef<THREE.Group>(null);
  const actionType = agent.current_action?.action_type;
  const ringColor = (actionType && ACTION_RING_COLORS[actionType]) || "#525252";
  const icon = actionIcon(actionType);

  useFrame(() => {
    groupRef.current?.position.set(motion.pos.x, 1.55, motion.pos.z);
  });

  return (
    <group ref={groupRef}>
      <Html center distanceFactor={12} occlude={false}>
        <div
          style={{ display: "flex", flexDirection: "column", alignItems: "center", pointerEvents: "none", userSelect: "none" }}
        >
          <div
            style={{
              fontSize: "13px",
              lineHeight: 1,
              background: "rgba(15,15,17,0.85)",
              borderRadius: "9999px",
              padding: "3px 5px",
              border: `1px solid ${ringColor}`,
            }}
          >
            {icon}
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: "9px",
              fontFamily: "monospace",
              color: "#e5e5e5",
              background: "rgba(15,15,17,0.7)",
              borderRadius: "4px",
              padding: "1px 4px",
              whiteSpace: "nowrap",
            }}
          >
            {agent.name}
          </div>
        </div>
      </Html>
    </group>
  );
}

function SelectionRing({ motion }: { motion: AgentMotionState }) {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    meshRef.current?.position.set(motion.pos.x, 0.02, motion.pos.z);
  });
  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.55, 0.68, 24]} />
      <meshBasicMaterial color="#22d3ee" />
    </mesh>
  );
}

// ---------------------------------------------------------------------
// Camera framing
// ---------------------------------------------------------------------

function CameraRig({ scene }: { scene: MicroDistrictScene }) {
  const cx = (scene.bounds.minX + scene.bounds.maxX) / 2;
  const cz = (scene.bounds.minZ + scene.bounds.maxZ) / 2;
  const span = Math.max(scene.bounds.maxX - scene.bounds.minX, scene.bounds.maxZ - scene.bounds.minZ);
  const dist = Math.max(16, span * 1.05);

  return (
    <OrbitControls
      target={[cx, 0.5, cz]}
      enableZoom
      enablePan
      enableRotate
      minDistance={dist * 0.35}
      maxDistance={dist * 1.8}
      minPolarAngle={Math.PI * 0.18}
      maxPolarAngle={Math.PI * 0.47}
      makeDefault
    />
  );
}

function PerspectiveCameraSetup({ scene }: { scene: MicroDistrictScene }) {
  const cx = (scene.bounds.minX + scene.bounds.maxX) / 2;
  const cz = (scene.bounds.minZ + scene.bounds.maxZ) / 2;
  const span = Math.max(scene.bounds.maxX - scene.bounds.minX, scene.bounds.maxZ - scene.bounds.minZ);
  const dist = Math.max(16, span * 0.95);

  return (
    <PerspectiveCamera
      makeDefault
      fov={38}
      near={0.1}
      far={300}
      position={[cx + dist * 0.75, dist * 0.85, cz + dist * 0.75]}
    />
  );
}

/** The standard "framed district" camera pose -- same numbers
 * `PerspectiveCameraSetup`/`CameraRig` use, factored out so Follow
 * Mode's exit path can restore exactly this pose instead of leaving the
 * camera wherever it ended up chasing an agent across the city. */
function districtCameraPose(scene: MicroDistrictScene) {
  const cx = (scene.bounds.minX + scene.bounds.maxX) / 2;
  const cz = (scene.bounds.minZ + scene.bounds.maxZ) / 2;
  const span = Math.max(scene.bounds.maxX - scene.bounds.minX, scene.bounds.maxZ - scene.bounds.minZ);
  const dist = Math.max(16, span * 0.95);
  return {
    position: new THREE.Vector3(cx + dist * 0.75, dist * 0.85, cz + dist * 0.75),
    target: new THREE.Vector3(cx, 0.5, cz),
  };
}

// ---------------------------------------------------------------------
// Citizen Follow Mode -- camera
// ---------------------------------------------------------------------

/** Distance behind, and height above, the followed agent's real ground
 * position -- a classic third-person chase cam. Offset direction tracks
 * the agent's current facing (from `AgentMotionState.facing`, the exact
 * same value driving their body-instance rotation) so the camera swings
 * around naturally as they turn a corner instead of staying pinned to
 * a world-axis-relative offset. */
const FOLLOW_BEHIND = 5.5;
const FOLLOW_HEIGHT = 3.4;
const FOLLOW_LOOK_HEIGHT = 0.9;
/** Higher = snappier camera, lower = looser/more cinematic. Framerate
 * independent (uses `delta`), so this reads the same at any frame rate. */
const FOLLOW_DAMPING = 3.2;

/**
 * Takes over the default camera every frame while Follow Mode is
 * active, chasing `followedAgentId`'s LIVE position out of the exact
 * same `motionRef` map `AgentInstancedField` writes into for rendering
 * -- this is the single real position, never a second guess at where
 * the agent is. `OrbitControls` is unmounted while this is active (see
 * the top-level JSX) so nothing fights these writes.
 *
 * Architecture this enforces: real simulation state -> location/action
 * -> 3D adapter projection -> `motionRef` (visual interpolation) ->
 * this camera. The camera never reads simulation state directly and
 * never picks its own destination -- it only ever chases the same dot
 * the renderer already computed.
 */
function FollowCameraRig({
  motionRef,
  followedAgentId,
}: {
  motionRef: React.MutableRefObject<MotionMap>;
  followedAgentId: string;
}) {
  const { camera } = useThree();
  const smoothedLookAt = useRef(new THREE.Vector3());
  const hasLookAt = useRef(false);
  const desiredPos = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const m = motionRef.current.get(followedAgentId);
    if (!m) return; // Agent not yet resolved into a rendered instance this frame; hold camera where it is.

    const dirX = Math.sin(m.facing);
    const dirZ = Math.cos(m.facing);
    desiredPos.current.set(m.pos.x - dirX * FOLLOW_BEHIND, FOLLOW_HEIGHT, m.pos.z - dirZ * FOLLOW_BEHIND);

    // Framerate-independent exponential smoothing -- eases the camera
    // toward the agent (satisfies "smoothly move the camera to follow")
    // whether Follow Mode just activated (camera starts far away, at the
    // district overview pose) or the agent is mid-stride (camera is
    // already nearby and just keeps pace).
    const alpha = 1 - Math.exp(-FOLLOW_DAMPING * Math.min(delta, 0.1));
    camera.position.lerp(desiredPos.current, alpha);

    const lookTarget = new THREE.Vector3(m.pos.x, FOLLOW_LOOK_HEIGHT, m.pos.z);
    if (!hasLookAt.current) {
      smoothedLookAt.current.copy(lookTarget);
      hasLookAt.current = true;
    } else {
      smoothedLookAt.current.lerp(lookTarget, alpha);
    }
    camera.lookAt(smoothedLookAt.current);
  });

  // Reset the "have we got a look-at yet" flag whenever the followed
  // agent identity changes, so switching from one citizen to another
  // eases in fresh rather than lerping from the previous agent's spot.
  useEffect(() => {
    hasLookAt.current = false;
  }, [followedAgentId]);

  return null;
}

/** Restores the standard framed-district camera pose the instant Follow
 * Mode is exited, so "return to normal city camera controls" (req. 12)
 * hands OrbitControls a sane starting pose instead of wherever the chase
 * camera last was (which can be arbitrarily far away if the agent
 * traveled out of the windowed district -- see `agentRouteAny3D`). */
function ExitFollowReset({ scene, following }: { scene: MicroDistrictScene; following: boolean }) {
  const { camera } = useThree();
  const wasFollowing = useRef(following);

  useEffect(() => {
    if (wasFollowing.current && !following) {
      const pose = districtCameraPose(scene);
      camera.position.copy(pose.position);
      camera.lookAt(pose.target);
    }
    wasFollowing.current = following;
  }, [following, scene, camera]);

  return null;
}

/** Freezes the directional light's shadow map once the (locked) scene has
 * settled for a few frames, and briefly unfreezes to re-bake if the scene
 * genuinely changes (a simulation reset). Buildings/props never move
 * within a given scene and agents use fake blob shadows, so a static
 * shadow map is visually identical to a continuously-updated one here —
 * it just stops paying a shadow-depth render pass every frame. */
function ShadowFreeze({ lightRef, watch }: { lightRef: React.RefObject<THREE.DirectionalLight>; watch: unknown }) {
  const framesSinceChange = useRef(0);

  useEffect(() => {
    framesSinceChange.current = 0;
    if (lightRef.current) lightRef.current.shadow.autoUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch]);

  useFrame(() => {
    const light = lightRef.current;
    if (!light) return;
    if (framesSinceChange.current < 4) {
      framesSinceChange.current += 1;
    } else if (light.shadow.autoUpdate) {
      light.shadow.autoUpdate = false;
    }
  });

  return null;
}

// ---------------------------------------------------------------------
// Top-level component
// ---------------------------------------------------------------------

export function CityCanvas3D({
  neighborhoods,
  locations,
  agents,
  tick,
  selectedAgentId,
  onSelectAgent,
  onSelectLocation,
  followedAgentId,
  onExitFollow,
}: CityCanvas3DProps) {
  // Micro-district identity locks in on first pick and only re-derives on
  // a genuine simulation reset (tick going backwards). See the perf note
  // at the top of this file (#1) for why this replaced a per-tick rebuild.
  const [scene, setScene] = useState<MicroDistrictScene | null>(() =>
    buildMicroDistrictScene({ neighborhoods, locations, agents })
  );
  const lockedTickRef = useRef(tick);

  useEffect(() => {
    const resetDetected = tick < lockedTickRef.current;
    if (resetDetected || !scene) {
      setScene(buildMicroDistrictScene({ neighborhoods, locations, agents }));
    }
    lockedTickRef.current = tick;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const visibleAgents = useMemo(() => {
    if (!scene) return [];
    return pickVisibleAgents(agents, scene, MAX_VISIBLE_AGENTS);
  }, [scene, agents]);

  // Followed agent, straight from the live `agents` list -- never a
  // cached/stale copy. Real agent lookup only; if the id doesn't
  // resolve (agent no longer exists in this world, e.g. after a reset)
  // this is simply undefined and Follow Mode has nothing to attach to.
  const followedAgent = useMemo(
    () => (followedAgentId ? agents.find((a) => a.id === followedAgentId) : undefined),
    [agents, followedAgentId]
  );
  const isFollowing = !!(followedAgentId && followedAgent);

  // Render set = the normal windowed micro-district population, PLUS the
  // followed agent if the real simulation has currently placed them
  // somewhere outside that window -- Follow Mode must never lose track
  // of them just because Stage 1 only draws one district's buildings.
  // Every id in here is a real agent from `agents`; nothing invented.
  const renderAgents = useMemo(() => {
    if (!followedAgent) return visibleAgents;
    if (visibleAgents.some((a) => a.id === followedAgent.id)) return visibleAgents;
    const combined = [...visibleAgents, followedAgent];
    // Keep within the instanced-mesh capacity; the followed agent always
    // wins the slot over the least-recently-relevant ambient agent.
    return combined.length > MAX_VISIBLE_AGENTS ? combined.slice(combined.length - MAX_VISIBLE_AGENTS) : combined;
  }, [visibleAgents, followedAgent]);

  // Single shared motion map -- see `MotionMap` above. Lives here (not
  // inside AgentInstancedField) so FollowCameraRig reads the identical
  // live positions the rendered agent instances use.
  const motionRef = useRef<MotionMap>(new Map());

  const dirLightRef = useRef<THREE.DirectionalLight>(null);
  const [showStats, setShowStats] = useState(true);

  if (!scene) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500 font-mono">
        No active district to render yet.
      </div>
    );
  }

  const span = Math.max(scene.bounds.maxX - scene.bounds.minX, scene.bounds.maxZ - scene.bounds.minZ);
  const buildingFarDistance = Math.max(18, span * 0.9);

  const followedLocation = followedAgent ? locations.find((l) => l.id === followedAgent.location_id) : undefined;
  const followedIsEnRoute = !!(followedAgentId && (motionRef.current.get(followedAgentId)?.waypoints.length ?? 0) > 0);
  const followedActionType = followedAgent?.current_action?.action_type;

  return (
    <div className="relative h-full w-full">
      <Canvas shadows dpr={[1, 1.75]} onPointerMissed={() => {}}>
        <PerspectiveCameraSetup scene={scene} />
        <color attach="background" args={["#bcd6e8"]} />
        <fog attach="fog" args={["#bcd6e8", 30, 90]} />

        <ambientLight intensity={0.55} />
        <directionalLight
          ref={dirLightRef}
          position={[18, 26, 12]}
          intensity={1.15}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-left={-30}
          shadow-camera-right={30}
          shadow-camera-top={30}
          shadow-camera-bottom={-30}
        />
        <hemisphereLight args={["#dceeff", "#4c5a3f", 0.4]} />
        <ShadowFreeze lightRef={dirLightRef} watch={scene} />

        <Ground scene={scene} />
        <ContactShadows position={[0, 0.001, 0]} opacity={0.35} scale={60} blur={2} far={20} frames={1} />

        {scene.buildings.map((b) => (
          <BuildingMesh
            key={b.id}
            building={b}
            farDistance={buildingFarDistance}
            onSelect={() => {
              const loc = locations.find((l) => l.id === b.id);
              if (loc) onSelectLocation(loc);
            }}
          />
        ))}

        {scene.props.map((p, i) =>
          p.kind === "tree" ? (
            <TreeMesh key={i} prop={p} />
          ) : p.kind === "lamp" ? (
            <LampMesh key={i} prop={p} />
          ) : (
            <BenchMesh key={i} prop={p} />
          )
        )}

        <AgentInstancedField
          visibleAgents={renderAgents}
          scene={scene}
          selectedAgentId={selectedAgentId}
          onSelectAgent={onSelectAgent}
          motionRef={motionRef}
          followedAgentId={followedAgentId}
        />

        {isFollowing && followedAgentId ? (
          <FollowCameraRig motionRef={motionRef} followedAgentId={followedAgentId} />
        ) : (
          <CameraRig scene={scene} />
        )}
        <ExitFollowReset scene={scene} following={isFollowing} />

        {showStats && <Stats className="!absolute !top-16 !left-4 !bg-neutral-950/85 !rounded-lg !overflow-hidden" />}
      </Canvas>

      <div className="pointer-events-none absolute top-4 left-4 rounded-xl border border-neutral-800 bg-neutral-950/85 px-3 py-2 backdrop-blur-md">
        <span className="text-[10px] font-mono text-neutral-300">
          Micro-district: <span className="text-cyan-300">{scene.neighborhoodName}</span> · {scene.buildings.length}{" "}
          buildings · {renderAgents.length} agents live
        </span>
      </div>

      <button
        onClick={() => setShowStats((s) => !s)}
        className="pointer-events-auto absolute top-4 right-4 rounded-lg border border-neutral-800 bg-neutral-950/85 px-2 py-1 text-[10px] font-mono text-neutral-400 hover:text-neutral-200 backdrop-blur-md"
      >
        {showStats ? "Hide FPS" : "Show FPS"}
      </button>

      {/* Citizen Follow Mode HUD -- status + real live state read straight
          off `followedAgent` (the same object AgentProfileDrawer would
          show), plus the one control this mode needs that the reused
          drawer doesn't already provide: a way to stop following without
          having to reopen the drawer. This is a status readout, not a
          second profile UI. */}
      {isFollowing && followedAgent && (
        <div className="pointer-events-auto absolute bottom-4 right-4 max-w-xs rounded-xl border border-cyan-800/60 bg-neutral-950/90 px-4 py-3 backdrop-blur-md shadow-lg shadow-cyan-500/10">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-cyan-300">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
              Following {followedAgent.name}
            </span>
            <button
              onClick={onExitFollow}
              className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] font-mono text-neutral-300 hover:bg-neutral-800"
            >
              Exit
            </button>
          </div>
          <p className="mt-1.5 text-xs text-neutral-200">
            {followedIsEnRoute ? (
              <>
                <span aria-hidden>🚶</span> Walking to{" "}
                <span className="font-semibold">{followedLocation?.name ?? "next location"}</span>
              </>
            ) : (
              <>
                <span aria-hidden>{actionIcon(followedActionType)}</span>{" "}
                {followedActionType ? followedActionType.replace(/_/g, " ") : "idle"} at{" "}
                <span className="font-semibold">{followedLocation?.name ?? "unknown location"}</span>
              </>
            )}
          </p>
          {followedAgent.current_goal && (
            <p className="mt-1 text-[11px] text-neutral-400">Goal: {followedAgent.current_goal.description}</p>
          )}
          {followedAgent.current_action?.reasoning && (
            <p className="mt-1 text-[11px] italic text-cyan-300/80 border-l-2 border-cyan-800 pl-2">
              “{followedAgent.current_action.reasoning}”
            </p>
          )}
        </div>
      )}
    </div>
  );
}
