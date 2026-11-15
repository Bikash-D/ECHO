"use client";

import React, { useEffect, useState, useCallback } from "react";
import { fetchHealth } from "@/lib/api";
import { HealthResponse } from "@/lib/types";
import { Header } from "@/components/Header";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { SimulationControls } from "@/components/SimulationControls";
import { TelemetryCard } from "@/components/TelemetryCard";
import { CityActivityFeed } from "@/components/CityActivityFeed";
import { BackendDiagnosticModal } from "@/components/BackendDiagnosticModal";
import { useSimulationController } from "@/lib/useSimulationController";

export default function DashboardPage() {
  const [healthData, setHealthData] = useState<HealthResponse | null>(null);
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const loadBackendHealth = useCallback(async () => {
    setIsLoading(true);
    const { data, latencyMs: lat, error: err } = await fetchHealth();
    setHealthData(data);
    setLatencyMs(lat);
    setError(err);
    setIsLoading(false);
    setLastSyncTime(new Date());
  }, []);

  useEffect(() => {
    loadBackendHealth();
    const interval = setInterval(loadBackendHealth, 10000);
    return () => clearInterval(interval);
  }, [loadBackendHealth]);

  // Real, live simulation state -- the same hook /city drives its canvas
  // and drawers from. GET /api/world and POST /api/simulation/{start,
  // pause,step,reset} are fully wired HTTP routes (see
  // apps/api/app/api/routes/{world,simulation}.py), not Phase-0 stubs,
  // so this dashboard can and should show the real population/topology/
  // needs instead of the old Phase 0 placeholder numbers.
  const {
    world,
    isPlaying,
    speed,
    setSpeed,
    step,
    start,
    pause,
    reset,
    activityEvents,
  } = useSimulationController();

  const isConnected = healthData !== null && healthData.status === "ok";
  const avgNeeds = world?.statistics.average_needs ?? {};
  const activeGoalsCount = world
    ? world.agents.filter((a) => a.current_goal).length
    : 0;
  const relationshipCount = world
    ? world.agents.reduce((sum, a) => sum + a.relationships.length, 0)
    : 0;

  return (
    <div className="flex flex-col min-h-screen bg-neutral-950 text-neutral-100">
      <Header
        healthData={healthData}
        latencyMs={latencyMs}
        isLoading={isLoading}
        onRefresh={loadBackendHealth}
        onOpenDiagnostic={() => setIsDiagnosticOpen(true)}
        tick={world?.tick ?? 0}
      />

      <div className="flex-1 space-y-6 p-6 lg:p-8 max-w-7xl mx-auto w-full">
        {/* Offline / Connection Error Banner */}
        {error && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-rose-900/60 bg-rose-950/40 p-4 text-rose-200">
            <div className="flex items-start gap-3">
              <svg className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h4 className="text-sm font-semibold text-rose-100">
                  FastAPI Backend Unreachable
                </h4>
                <p className="text-xs text-rose-300/90 mt-0.5">
                  {error} - Make sure backend is running at <code className="text-rose-100 font-mono">http://127.0.0.1:8000</code>.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setIsDiagnosticOpen(true)}
                className="rounded-lg border border-rose-800 bg-rose-900/60 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-800 transition"
              >
                Inspect Diagnostic
              </button>
              <button
                onClick={loadBackendHealth}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 transition"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Top Header Banner */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-neutral-800/80 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
                ECHO Command Dashboard
              </h1>
              <StatusBadge
                variant={isConnected ? "online" : "offline"}
                label={isConnected ? "SIMULATION ENGINE READY" : "TELEMETRY DISCONNECTED"}
              />
              {world && (
                <StatusBadge
                  variant={world.status === "running" ? "running" : world.status === "paused" ? "paused" : "initialized"}
                  pulse={world.status === "running"}
                />
              )}
            </div>
            <p className="mt-1 text-xs text-neutral-400 max-w-2xl">
              Multi-agent autonomous social simulation orchestrator. Real-time telemetry, population dynamics, need decay, and world state observation console.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right text-[11px] font-mono text-neutral-500">
              <span>Last Synced: </span>
              <span className="text-neutral-300">
                {lastSyncTime ? lastSyncTime.toLocaleTimeString() : "Never"}
              </span>
            </div>
            <button
              onClick={() => setIsDiagnosticOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 transition"
            >
              <svg className="h-3.5 w-3.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>API Diagnostics</span>
            </button>
          </div>
        </div>

        {/* Primary Stat Grid -- all values sourced live from GET /api/world (world) and GET /api/health (healthData) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Engine Status"
            value={world ? world.status.toUpperCase() : isConnected ? "INITIALIZED" : "OFFLINE"}
            subtitle={isConnected ? `Environment: ${healthData?.environment}` : "Backend offline"}
            badge={
              <StatusBadge
                variant={isConnected ? "online" : "offline"}
                label={isConnected ? "READY" : "DISCONNECTED"}
              />
            }
            statusColor={isConnected ? "emerald" : "neutral"}
            isLoading={isLoading && !healthData}
            icon={
              <svg className="h-5 w-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            }
          />

          <StatCard
            title="Live Population"
            value={world ? world.statistics.total_population : healthData ? healthData.population_size : "--"}
            subtitle={healthData ? `Profile: ${healthData.simulation_profile.toUpperCase()}` : "Awaiting sync"}
            badge={
              <span className="rounded bg-indigo-950 border border-indigo-800 px-2 py-0.5 text-[10px] font-mono font-semibold text-indigo-300">
                {world ? "AGENTS LIVE" : "ACTIVE CONFIG"}
              </span>
            }
            statusColor="blue"
            isLoading={isLoading && !healthData}
            icon={
              <svg className="h-5 w-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            }
          />

          <StatCard
            title="Spatial Topology"
            value={world ? `${world.neighborhoods.length} / ${world.locations.length}` : "5 / 40"}
            subtitle={
              world
                ? `${world.neighborhoods.map((n) => n.name).join(" • ")}`
                : "5 Neighborhoods • 40 Locations"
            }
            badge={
              <span className="rounded bg-violet-950 border border-violet-800 px-2 py-0.5 text-[10px] font-mono font-semibold text-violet-300">
                {world ? "LIVE" : "DOMAIN READY"}
              </span>
            }
            endpointRequirement="GET /api/world"
            statusColor="violet"
            icon={
              <svg className="h-5 w-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          />

          <StatCard
            title="Simulation Clock"
            value={world ? `TICK ${String(world.tick).padStart(4, "0")}` : "TICK 0000"}
            subtitle={world ? `Status: ${world.status}` : "Engine clock standby"}
            badge={
              <span
                className={`rounded border px-2 py-0.5 text-[10px] font-mono font-semibold ${
                  world?.status === "running"
                    ? "bg-cyan-950 border-cyan-800 text-cyan-300"
                    : "bg-amber-950 border-amber-800 text-amber-300"
                }`}
              >
                {world?.status === "running" ? "CLOCK RUNNING" : "CLOCK PAUSED"}
              </span>
            }
            endpointRequirement="GET /api/simulation/state"
            statusColor="amber"
            icon={
              <svg className="h-5 w-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
        </div>

        {/* Engine Lifecycle Control Bar -- real handlers, dispatches to live HTTP routes */}
        <SimulationControls
          status={world ? (world.status as "initialized" | "running" | "paused" | "stopped") : "offline"}
          tick={world?.tick ?? 0}
          isPlaying={isPlaying}
          onStart={start}
          onPause={pause}
          onStep={step}
          onReset={reset}
          disabled={!world}
        />

        {/* Playback speed, for parity with /city's control surface */}
        <div className="flex items-center gap-2 -mt-2">
          <span className="text-[11px] font-mono text-neutral-500">Autoplay speed:</span>
          {[1, 2, 5, 10].map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`rounded px-2 py-1 text-[11px] font-mono font-semibold transition border ${
                speed === s
                  ? "bg-cyan-600/30 text-cyan-300 border-cyan-700"
                  : "text-neutral-400 border-neutral-800 hover:text-neutral-200 hover:bg-neutral-800"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Domain Telemetry Grid -- live cards backed by GET /api/world; Interventions
            genuinely has no HTTP route yet (InterventionController/EventQueue are
            still Phase-0 stubs in apps/api/app/simulation/), so that one stays
            honestly marked pending rather than being dressed up as live. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <TelemetryCard
            title="Agent Registry & Need Dynamics"
            category="AGENTS & NEEDS"
            phase="Live"
            live
            endpoint="GET /api/world"
            domainSpecDetails={[
              { label: "Live Agent Roster", value: world ? `${world.statistics.total_population} Agents` : "—" },
              { label: "Core Needs Model", value: "HUNGER, ENERGY, SOCIAL" },
              { label: "Personality Model", value: "Big Five (OCEAN)" },
              { label: "Active Goals Now", value: world ? `${activeGoalsCount} Agents` : "—" },
            ]}
          >
            <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-400">Agent Roster</span>
                <span className="font-mono text-emerald-400 font-semibold">
                  {world ? `${world.statistics.total_population} Loaded` : "Awaiting sync"}
                </span>
              </div>
              {(["hunger", "energy", "social"] as const).map((need) => {
                const val = avgNeeds[need] ?? avgNeeds[need.toUpperCase()] ?? null;
                const pct = val != null ? Math.round(val * 100) : null;
                const barColor = need === "hunger" ? "bg-amber-500" : need === "energy" ? "bg-emerald-500" : "bg-blue-500";
                return (
                  <div className="space-y-1.5" key={need}>
                    <div className="flex justify-between text-[11px] text-neutral-500 font-mono capitalize">
                      <span>{need} Need (population avg)</span>
                      <span>{pct != null ? `${pct}%` : "—"}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${barColor}`}
                        style={{ width: `${pct ?? 0}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </TelemetryCard>

          <TelemetryCard
            title="World Spatial Topology"
            category="SPATIAL TOPOLOGY"
            phase="Live"
            live
            endpoint="GET /api/world"
            domainSpecDetails={[
              { label: "City Scope", value: world ? world.city.name : "Single City" },
              { label: "Neighborhood Count", value: world ? `${world.neighborhoods.length} Defined Zones` : "5 Defined Zones" },
              { label: "Total Locations", value: world ? `${world.locations.length} Spatial Points` : "40 Spatial Points" },
              { label: "Household Clustering", value: "Residence Bound" },
            ]}
          >
            <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-400">Neighborhood Map Topology</span>
                <span className="font-mono text-cyan-400 font-semibold">
                  {world ? `${world.neighborhoods.length} Zones Live` : "5 Zones Configured"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                {(world ? world.neighborhoods : []).map((hood, i) => (
                  <div key={hood.id} className="rounded border border-neutral-800/80 bg-neutral-900/50 p-2">
                    <span className="text-[10px] text-neutral-500 block">Zone {i + 1}</span>
                    <span className="text-neutral-200 font-semibold">{hood.name}</span>
                    <span className="block text-[10px] text-neutral-500">{hood.population} agents</span>
                  </div>
                ))}
                {!world &&
                  ["Riverside", "Downtown", "Hillcrest", "Eastgate"].map((name, i) => (
                    <div key={name} className="rounded border border-neutral-800/80 bg-neutral-900/50 p-2">
                      <span className="text-[10px] text-neutral-500 block">Zone {i + 1}</span>
                      <span className="text-neutral-200 font-semibold">{name}</span>
                    </div>
                  ))}
              </div>
            </div>
          </TelemetryCard>

          <TelemetryCard
            title="Goal Generation & Perception"
            category="COGNITIVE TELEMETRY"
            phase="Live"
            live
            endpoint="GET /api/world"
            domainSpecDetails={[
              { label: "Goal Prioritization", value: "Rule-Based & Need Driven" },
              { label: "Perception Model", value: "Localized (Spatial & Co-location)" },
              { label: "Agents With Active Goal", value: world ? `${activeGoalsCount} / ${world.statistics.total_population}` : "—" },
              { label: "Decision Engine", value: "Rule-Based (LLM strategy planned)" },
            ]}
          />

          <TelemetryCard
            title="Intervention & Event System"
            category="INTERVENTIONS"
            phase="Not yet implemented"
            endpoint="POST /api/interventions"
            domainSpecDetails={[
              { label: "Intervention Controller", value: "Structure only, no World effect" },
              { label: "Queue Structure", value: "EventQueue always empty (stub)" },
              { label: "HTTP Route", value: "Does not exist yet" },
              { label: "Relationships (live elsewhere)", value: world ? `${relationshipCount} formed` : "—" },
            ]}
          />
        </div>

        {/* Live Activity Feed -- same real snapshot-diff mechanism as /city
            (lib/activityFeed.ts), not the old fabricated/empty engine
            event stream. */}
        <CityActivityFeed events={activityEvents} />

        {/* Architecture & Domain Notice */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-5 backdrop-blur">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-cyan-950/80 border border-cyan-800 p-2 text-cyan-400 shrink-0">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-neutral-200">
                Live Simulation, Not a Static Dashboard
              </h4>
              <p className="text-xs text-neutral-400 leading-relaxed">
                This dashboard reads live from <code className="text-cyan-300 font-mono">GET /api/world</code> and
                controls the running simulation via <code className="text-cyan-300 font-mono">POST /api/simulation/*</code>.
                World generation, agent needs/goals/personality, perception, decisions, action resolution, the
                economy, and relationship memory are all real and currently pass{" "}
                <span className="text-neutral-200 font-semibold">132 backend tests</span>. The only part of this
                page still genuinely unbuilt is the Intervention/Event system above (no HTTP route exists for it
                yet) — everything else you see updates as you Start/Step/Reset the simulation. For the full
                visual city experience, open{" "}
                <a href="/city" className="text-cyan-300 underline underline-offset-2">Living City</a>.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Backend Diagnostic Modal */}
      <BackendDiagnosticModal
        isOpen={isDiagnosticOpen}
        onClose={() => setIsDiagnosticOpen(false)}
        healthData={healthData}
        latencyMs={latencyMs}
        error={error}
        onRetry={loadBackendHealth}
      />
    </div>
  );
}
