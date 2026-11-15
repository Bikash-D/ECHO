"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchWorld,
  startSimulation,
  pauseSimulation,
  stepSimulation,
  resetSimulation,
} from "@/lib/api";
import {
  Agent,
  Location,
  Neighborhood,
  WorldResponse,
} from "@/lib/types";
import { NeighborhoodSection } from "@/components/NeighborhoodSection";
import { AgentProfileDrawer } from "@/components/AgentProfileDrawer";
import { LocationDetailDrawer } from "@/components/LocationDetailDrawer";
import { SocietyStatsPanel } from "@/components/SocietyStatsPanel";

export default function WorldPage() {
  const [world, setWorld] = useState<WorldResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Selection state
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [drawerMode, setDrawerMode] = useState<"agent" | "location" | null>(null);

  // Auto-play state
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadWorld = useCallback(async () => {
    const { data, error: err } = await fetchWorld();
    if (data) {
      setWorld(data);
      setError(null);
      // Update selected items with fresh data
      if (selectedAgent) {
        const fresh = data.agents.find((a) => a.id === selectedAgent.id);
        if (fresh) setSelectedAgent(fresh);
      }
      if (selectedLocation) {
        const fresh = data.locations.find((l) => l.id === selectedLocation.id);
        if (fresh) setSelectedLocation(fresh);
      }
    } else {
      setError(err);
    }
    setIsLoading(false);
  }, [selectedAgent, selectedLocation]);

  useEffect(() => {
    loadWorld();
  }, []);

  // Auto-play loop
  useEffect(() => {
    if (isPlaying) {
      const interval = Math.max(100, 1000 / speed);
      playIntervalRef.current = setInterval(async () => {
        await stepSimulation();
        await loadWorld();
      }, interval);
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [isPlaying, speed, loadWorld]);

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

  const handleSelectNeighborhood = (neighborhood: Neighborhood) => {
    // Scroll to section (neighborhoods are rendered sequentially)
    const el = document.getElementById(`neighborhood-${neighborhood.id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleCloseDrawer = () => {
    setDrawerMode(null);
    setSelectedAgent(null);
    setSelectedLocation(null);
  };

  const handleStep = async () => {
    await stepSimulation();
    await loadWorld();
  };

  const handleStart = async () => {
    await startSimulation();
    setIsPlaying(true);
    await loadWorld();
  };

  const handlePause = async () => {
    setIsPlaying(false);
    await pauseSimulation();
    await loadWorld();
  };

  const handleReset = async () => {
    setIsPlaying(false);
    await resetSimulation();
    await loadWorld();
  };

  // Loading state
  if (isLoading && !world) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          <p className="text-sm text-neutral-400 font-mono">Loading Echo City...</p>
        </div>
      </div>
    );
  }

  // Error state
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
    <div className="flex h-full">
      {/* Main city view */}
      <div className="flex-1 overflow-y-auto">
        {/* City Header */}
        <div className="sticky top-0 z-30 border-b border-neutral-800 bg-neutral-950/90 px-6 py-3 backdrop-blur-lg">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-lg shadow-lg shadow-cyan-500/20">
                🏙️
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-bold tracking-tight text-neutral-100">
                    {world.city.name}
                  </h1>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold tracking-wider uppercase ${
                    world.status === "running"
                      ? "bg-cyan-950/60 text-cyan-300 border-cyan-800/60"
                      : world.status === "paused"
                      ? "bg-amber-950/60 text-amber-300 border-amber-800/60"
                      : "bg-neutral-900 text-neutral-400 border-neutral-700"
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      world.status === "running" ? "bg-cyan-400 animate-pulse" : world.status === "paused" ? "bg-amber-400" : "bg-neutral-500"
                    }`} />
                    {world.status.toUpperCase()}
                  </span>
                </div>
                <p className="text-xs font-mono text-neutral-400 mt-0.5">
                  DAY / TICK: {world.tick} • Agents: {world.statistics.total_population} • Neighborhoods: {world.neighborhoods.length} • Locations: {world.locations.length}
                </p>
              </div>
            </div>

            {/* Simulation Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Transport controls */}
              <div className="flex items-center rounded-lg border border-neutral-800 bg-neutral-900/80 overflow-hidden">
                <button
                  onClick={isPlaying ? handlePause : handleStart}
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
                  onClick={handleStep}
                  disabled={isPlaying}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-600/20 transition disabled:opacity-40"
                  title="Advance one tick"
                >
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M5 4l10 8-10 8V4zm9 0h4v16h-4z"/></svg>
                  <span>STEP</span>
                </button>

                <div className="h-6 w-px bg-neutral-800" />

                <button
                  onClick={handleReset}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-600/20 transition"
                  title="Reset simulation"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                  <span>RESET</span>
                </button>
              </div>

              {/* Speed selector */}
              <div className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900/80 px-1 py-0.5">
                <span className="text-[10px] font-mono text-neutral-500 px-1.5">Speed:</span>
                {[1, 2, 5, 10].map((s) => (
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

              {/* Refresh */}
              <button
                onClick={loadWorld}
                className="rounded-lg border border-neutral-800 bg-neutral-900/80 p-2 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition"
                title="Refresh world state"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Neighborhoods */}
        <div className="space-y-6 p-6">
          {world.neighborhoods.map((hood) => {
            const hoodLocations = world.locations.filter(
              (l) => l.neighborhood_id === hood.id
            );
            const hoodAgents = world.agents.filter(
              (a) => a.neighborhood_id === hood.id
            );

            return (
              <div key={hood.id} id={`neighborhood-${hood.id}`}>
                <NeighborhoodSection
                  neighborhood={hood}
                  locations={hoodLocations}
                  agents={hoodAgents}
                  onSelectNeighborhood={handleSelectNeighborhood}
                  onSelectLocation={handleSelectLocation}
                  onSelectAgent={handleSelectAgent}
                  selectedLocationId={selectedLocation?.id}
                  selectedAgentId={selectedAgent?.id}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Sidebar: Society Stats */}
      <div className="hidden xl:flex w-72 shrink-0 flex-col border-l border-neutral-800 bg-neutral-950 overflow-y-auto p-4">
        <div className="flex items-center gap-2 border-b border-neutral-800/80 pb-3 mb-4">
          <span className="text-sm">📊</span>
          <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-200">
            Society
          </h2>
        </div>
        <SocietyStatsPanel
          stats={world.statistics}
          tick={world.tick}
          status={world.status}
          neighborhoodCount={world.neighborhoods.length}
          locationCount={world.locations.length}
        />
      </div>

      {/* Detail Drawers (Overlays) */}
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
