"use client";

import React, { useEffect, useRef, useState } from "react";
import { Agent, Location } from "@/lib/types";
import { useSimulationController } from "@/lib/useSimulationController";
import { CityCanvas, CityCanvasHandle } from "@/components/CityCanvas";
import { CityCanvas3D } from "@/components/CityCanvas3D";
import { CityCanvasIso, CityCanvasIsoHandle } from "@/components/CityCanvasIso";
import { AgentProfileDrawer } from "@/components/AgentProfileDrawer";
import { LocationDetailDrawer } from "@/components/LocationDetailDrawer";
import { CityActivityFeed } from "@/components/CityActivityFeed";

const LEGEND_BUILDINGS: { type: string; label: string; color: string }[] = [
  { type: "residential", label: "Residence", color: "#10b981" },
  { type: "workplace", label: "Workplace", color: "#3b82f6" },
  { type: "market", label: "Market", color: "#f59e0b" },
  { type: "leisure", label: "Leisure", color: "#a855f7" },
];

/**
 * Pure display formatting of the backend-authoritative `tick` into a
 * day/hour readout. Mirrors the exact windows RuleBasedDecisionStrategy
 * already uses (apps/api/app/agents/decision.py: hour = tick % 24; day
 * 7-17; evening 18-21; night 22-6) so what the clock shows always matches
 * why agents are actually acting -- this reads the tick, it never invents
 * or drives any behavior itself.
 */
function dayPhase(tick: number) {
  const hour = tick % 24;
  const day = Math.floor(tick / 24) + 1;
  const hourLabel = `${String(hour).padStart(2, "0")}:00`;
  if (hour >= 7 && hour <= 17) {
    return { day, hourLabel, phaseLabel: "Day", icon: "☀️", className: "border-amber-700/60 text-amber-300 bg-amber-950/40" };
  }
  if (hour >= 18 && hour <= 21) {
    return { day, hourLabel, phaseLabel: "Evening", icon: "🌆", className: "border-orange-700/60 text-orange-300 bg-orange-950/40" };
  }
  return { day, hourLabel, phaseLabel: "Night", icon: "🌙", className: "border-indigo-700/60 text-indigo-300 bg-indigo-950/40" };
}

const LEGEND_ACTIONS: { action: string; label: string; color: string }[] = [
  { action: "work", label: "Working", color: "#38bdf8" },
  { action: "consume_food", label: "Buying food", color: "#f59e0b" },
  { action: "rest", label: "Resting", color: "#34d399" },
  { action: "socialize", label: "Socializing", color: "#a78bfa" },
  { action: "move", label: "Moving", color: "#94a3b8" },
  { action: "idle", label: "Idle", color: "#6b7280" },
];

export default function CityPage() {
  const {
    world,
    error,
    isLoading,
    isPlaying,
    speed,
    setSpeed,
    loadWorld,
    step,
    start,
    pause,
    reset,
    activityEvents,
    latestDeltas,
  } = useSimulationController();

  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [drawerMode, setDrawerMode] = useState<"agent" | "location" | null>(null);
  // Citizen Follow Mode (3D view only). Just an id -- the followed
  // agent's live data always comes straight from `world.agents` inside
  // CityCanvas3D, never a snapshot taken at the moment Follow started.
  const [followedAgentId, setFollowedAgentId] = useState<string | null>(null);
  // A/B/C prototype toggle: "iso" is the new isometric vertical-slice
  // renderer (see CityCanvasIso.tsx / lib/isometricAdapter.ts) -- one
  // real neighborhood (its full real location set), real agents, true
  // isometric projection. "3d" is the earlier Three.js prototype, kept only for
  // reference/comparison. CityCanvas.tsx (2D, all locations/agents)
  // stays the default and is untouched.
  const [renderMode, setRenderMode] = useState<"2d" | "3d" | "iso">("2d");

  // V4.1 -- Follow Mode in the 2D view (the primary experience). CityCanvas
  // owns the real camera/motion state; this ref + mirrored boolean just let
  // AgentProfileDrawer's FOLLOW button drive/reflect it, the same way
  // followedAgentId already does for the 3D view below.
  const cityCanvasRef = useRef<CityCanvasHandle>(null);
  const [followingIn2D, setFollowingIn2D] = useState(false);

  // Same pattern as followingIn2D, for the isometric vertical slice.
  const cityCanvasIsoRef = useRef<CityCanvasIsoHandle>(null);
  const [followingInIso, setFollowingInIso] = useState(false);

  // Keep the open drawer's data fresh as new ticks arrive, same pattern
  // as apps/web/app/(dashboard)/world/page.tsx.
  useEffect(() => {
    if (!world) return;
    if (selectedAgent) {
      const fresh = world.agents.find((a) => a.id === selectedAgent.id);
      if (fresh) setSelectedAgent(fresh);
    }
    if (selectedLocation) {
      const fresh = world.locations.find((l) => l.id === selectedLocation.id);
      if (fresh) setSelectedLocation(fresh);
    }
    // A genuine reset (tick resets to 0 with a fresh population) can mean
    // the followed agent's id no longer exists in this world at all --
    // stop following rather than silently pointing Follow Mode at
    // nothing. A normal tick where the agent is still present is a no-op
    // here.
    if (followedAgentId && !world.agents.some((a) => a.id === followedAgentId)) {
      setFollowedAgentId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  const handleToggleFollow = (agentId: string) => {
    setFollowedAgentId((current) => (current === agentId ? null : agentId));
  };

  // Follow Mode is a 3D-camera concept (see CityCanvas3D's FollowCameraRig);
  // switching away from 3D has no camera to attach it to, so exit cleanly
  // rather than leaving a dangling follow target.
  useEffect(() => {
    if (renderMode !== "3d") setFollowedAgentId(null);
  }, [renderMode]);

  // Same problem, same fix, for the 2D and Iso views: `followingIn2D` /
  // `followingInIso` are only ever cleared by the child canvas's own
  // onFollowingChange callback (see CityCanvasIso/CityCanvas's internal
  // `following` state), which never fires on unmount. Since each canvas
  // is only mounted while `renderMode` matches it (conditional render
  // below), switching away mid-follow previously left that boolean stuck
  // at `true` forever -- so re-entering that mode, or the drawer's
  // `isFollowing` check, could show "Following..." even though the
  // freshly-mounted canvas instance actually starts unfollowed. Mirror
  // the 3D reset above for both.
  useEffect(() => {
    if (renderMode !== "2d") setFollowingIn2D(false);
  }, [renderMode]);
  useEffect(() => {
    if (renderMode !== "iso") setFollowingInIso(false);
  }, [renderMode]);

  const handleSelectAgent = (agent: Agent) => {
    setSelectedAgent(agent);
    setSelectedLocation(null);
    setDrawerMode("agent");
  };

  const handleSelectLocation = (location: Location) => {
    setSelectedLocation(location);
    setSelectedAgent(null);
    setDrawerMode("location");
  };

  const handleSelectAgentById = (agentId: string) => {
    if (!world) return;
    const agent = world.agents.find((a) => a.id === agentId);
    if (agent) handleSelectAgent(agent);
  };

  const handleCloseDrawer = () => {
    setDrawerMode(null);
    setSelectedAgent(null);
    setSelectedLocation(null);
  };

  if (isLoading && !world) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          <p className="text-sm text-neutral-400 font-mono">Rendering Echo City...</p>
        </div>
      </div>
    );
  }

  if (error && !world) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4 rounded-xl border border-rose-900/60 bg-rose-950/30 p-8">
          <span className="text-4xl">🏚️</span>
          <h2 className="text-lg font-bold text-rose-200">Cannot Reach Echo City</h2>
          <p className="text-sm text-rose-300/80">{error}</p>
          <p className="text-xs text-neutral-400">
            Start the backend: <code className="text-rose-200 font-mono">uvicorn app.main:app --app-dir apps/api --port 8000</code>
          </p>
          <button
            onClick={loadWorld}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (!world) return null;

  return (
    <div className="flex h-full flex-col">
      {/* Header + controls (same control surface pattern as /world) */}
      <div className="z-30 border-b border-neutral-800 bg-neutral-950/90 px-6 py-3 backdrop-blur-lg">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-lg shadow-lg shadow-cyan-500/20">
              🏙️
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold tracking-tight text-neutral-100">
                  Living City
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold tracking-wider uppercase ${
                    world.status === "running"
                      ? "bg-cyan-950/60 text-cyan-300 border-cyan-800/60"
                      : world.status === "paused"
                      ? "bg-amber-950/60 text-amber-300 border-amber-800/60"
                      : "bg-neutral-900 text-neutral-400 border-neutral-700"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      world.status === "running" ? "bg-cyan-400 animate-pulse" : world.status === "paused" ? "bg-amber-400" : "bg-neutral-500"
                    }`}
                  />
                  {world.status.toUpperCase()}
                </span>
              </div>
              <p className="text-xs font-mono text-neutral-400 mt-0.5 flex items-center gap-2">
                <span>TICK: {world.tick} • {world.statistics.total_population} agents live in {world.city.name}</span>
                <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 border ${dayPhase(world.tick).className}`}>
                  {dayPhase(world.tick).icon} Day {dayPhase(world.tick).day} · {dayPhase(world.tick).hourLabel} · {dayPhase(world.tick).phaseLabel}
                </span>
              </p>
            </div>
          </div>

          {/* Simulation Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center rounded-lg border border-neutral-800 bg-neutral-900/80 overflow-hidden">
              <button
                onClick={isPlaying ? pause : start}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition ${
                  isPlaying
                    ? "bg-amber-600/20 text-amber-300 hover:bg-amber-600/30"
                    : "bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30"
                }`}
                title={isPlaying ? "Pause simulation" : "Start simulation"}
              >
                {isPlaying ? (
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>
                ) : (
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                )}
                <span>{isPlaying ? "PAUSE" : "PLAY"}</span>
              </button>
              <div className="h-6 w-px bg-neutral-800" />
              <button
                onClick={step}
                disabled={isPlaying}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-600/20 transition disabled:opacity-40"
                title="Advance one tick"
              >
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M5 4l10 8-10 8V4zm9 0h4v16h-4z"/></svg>
                <span>STEP</span>
              </button>
              <div className="h-6 w-px bg-neutral-800" />
              <button
                onClick={reset}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-600/20 transition"
                title="Reset simulation"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                <span>RESET</span>
              </button>
            </div>

            <div className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900/80 px-1 py-0.5">
              <span className="text-[10px] font-mono text-neutral-500 px-1.5">Speed:</span>
              {/* Was [1,2,5,10]: with the 250ms poll floor in
                  useSimulationController, 5x and 10x both collapsed to the
                  same 250ms interval (indistinguishable, and already the
                  fastest the walk animation can visually keep up with).
                  [1,2,3,4] gives four buttons that are each actually
                  different (1000/500/333/250ms) and stay inside a speed the
                  city view can still be read at. */}
              {[1, 2, 3, 4].map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`rounded px-2 py-1 text-[11px] font-mono font-semibold transition ${
                    speed === s
                      ? "bg-cyan-600/30 text-cyan-300 border border-cyan-700"
                      : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>

            {/* 2D/Iso/3D prototype toggle */}
            <div className="flex items-center rounded-lg border border-neutral-800 bg-neutral-900/80 overflow-hidden">
              <button
                onClick={() => setRenderMode("2d")}
                className={`px-3 py-2 text-xs font-semibold font-mono transition ${
                  renderMode === "2d"
                    ? "bg-cyan-600/30 text-cyan-300"
                    : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
                }`}
                title="2D Living City (all locations & agents)"
              >
                2D
              </button>
              <div className="h-6 w-px bg-neutral-800" />
              <button
                onClick={() => setRenderMode("iso")}
                className={`px-3 py-2 text-xs font-semibold font-mono transition ${
                  renderMode === "iso"
                    ? "bg-cyan-600/30 text-cyan-300"
                    : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
                }`}
                title="Isometric vertical slice (one real neighborhood, all of its real locations)"
              >
                Iso <span className="opacity-60">(new)</span>
              </button>
              <div className="h-6 w-px bg-neutral-800" />
              <button
                onClick={() => setRenderMode("3d")}
                className={`px-3 py-2 text-xs font-semibold font-mono transition ${
                  renderMode === "3d"
                    ? "bg-cyan-600/30 text-cyan-300"
                    : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
                }`}
                title="3D prototype (Stage 1: one micro-district)"
              >
                3D <span className="opacity-60">(legacy)</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* City canvas + legend + activity feed */}
      <div className="flex flex-1 min-h-0">
        <div className="relative flex-1 min-h-0">
          {renderMode === "2d" && (
            <CityCanvas
              ref={cityCanvasRef}
              neighborhoods={world.neighborhoods}
              locations={world.locations}
              agents={world.agents}
              tick={world.tick}
              selectedAgentId={selectedAgent?.id}
              onSelectAgent={handleSelectAgent}
              onSelectLocation={handleSelectLocation}
              latestDeltas={latestDeltas}
              onFollowingChange={setFollowingIn2D}
            />
          )}
          {renderMode === "iso" && (
            <CityCanvasIso
              ref={cityCanvasIsoRef}
              neighborhoods={world.neighborhoods}
              locations={world.locations}
              agents={world.agents}
              tick={world.tick}
              selectedAgentId={selectedAgent?.id}
              onSelectAgent={handleSelectAgent}
              onSelectLocation={handleSelectLocation}
              latestDeltas={latestDeltas}
              onFollowingChange={setFollowingInIso}
            />
          )}
          {renderMode === "3d" && (
            <CityCanvas3D
              neighborhoods={world.neighborhoods}
              locations={world.locations}
              agents={world.agents}
              tick={world.tick}
              selectedAgentId={selectedAgent?.id}
              onSelectAgent={handleSelectAgent}
              onSelectLocation={handleSelectLocation}
              latestDeltas={latestDeltas}
              followedAgentId={followedAgentId}
              onExitFollow={() => setFollowedAgentId(null)}
            />
          )}

          {/* Legend overlay (2D only -- the 3D scene shows the same info directly in-world) */}
          {renderMode === "2d" && (
          <div className="pointer-events-none absolute bottom-4 left-4 flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-950/85 p-3 backdrop-blur-md">
            <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-neutral-400">
              Buildings
            </span>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {LEGEND_BUILDINGS.map((b) => (
                <div key={b.type} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: b.color }} />
                  <span className="text-[10px] text-neutral-300">{b.label}</span>
                </div>
              ))}
            </div>
            <span className="mt-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-neutral-400">
              Agent action
            </span>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {LEGEND_ACTIONS.map((a) => (
                <div key={a.action} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: a.color }} />
                  <span className="text-[10px] text-neutral-300">{a.label}</span>
                </div>
              ))}
            </div>
          </div>
          )}

          <div className="pointer-events-none absolute top-4 right-4 rounded-xl border border-neutral-800 bg-neutral-950/85 px-3 py-2 backdrop-blur-md">
            <span className="text-[10px] font-mono text-neutral-400">
              {renderMode === "3d"
                ? "Drag to orbit · scroll to zoom · click a person or building for live detail"
                : "Scroll to zoom · drag to pan · click a person or building for live detail"}
            </span>
          </div>
        </div>

        {/* Live activity feed (Step 6) -- derived from real /api/world snapshot diffs, see lib/activityFeed.ts */}
        <div className="hidden lg:block w-72 shrink-0 border-l border-neutral-800 p-3">
          <CityActivityFeed events={activityEvents} onSelectAgent={handleSelectAgentById} />
        </div>
      </div>

      {/* Detail Drawers (Overlays) -- same existing components as /world */}
      {drawerMode === "agent" && selectedAgent && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={handleCloseDrawer}
          />
          <AgentProfileDrawer
            agent={selectedAgent}
            locations={world.locations}
            neighborhoods={world.neighborhoods}
            onClose={handleCloseDrawer}
            onSelectLocation={(loc) => {
              setSelectedLocation(loc);
              setSelectedAgent(null);
              setDrawerMode("location");
            }}
            // V4.1/V5 -- FOLLOW is wired for all three views: 3D drives the
            // FollowCameraRig via followedAgentId, 2D and Iso each drive
            // their own real follow-camera (see CityCanvasHandle /
            // CityCanvasIsoHandle) via the refs above. All three
            // ultimately toggle a real camera around real agent motion;
            // nothing here is simulated in the drawer.
            isFollowing={
              renderMode === "3d"
                ? followedAgentId === selectedAgent.id
                : renderMode === "iso"
                ? followingInIso
                : followingIn2D
            }
            onToggleFollow={
              renderMode === "3d"
                ? () => handleToggleFollow(selectedAgent.id)
                : renderMode === "iso"
                ? () => (followingInIso ? cityCanvasIsoRef.current?.exitFollow() : cityCanvasIsoRef.current?.followSelected())
                : () => (followingIn2D ? cityCanvasRef.current?.exitFollow() : cityCanvasRef.current?.followSelected())
            }
          />
        </>
      )}

      {drawerMode === "location" && selectedLocation && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={handleCloseDrawer}
          />
          <LocationDetailDrawer
            location={selectedLocation}
            agents={world.agents}
            neighborhoods={world.neighborhoods}
            onClose={handleCloseDrawer}
            onSelectAgent={(agent) => {
              setSelectedAgent(agent);
              setSelectedLocation(null);
              setDrawerMode("agent");
            }}
          />
        </>
      )}
    </div>
  );
}
