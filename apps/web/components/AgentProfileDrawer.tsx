import React from "react";
import { Agent, Location, Neighborhood } from "../lib/types";

interface AgentProfileDrawerProps {
  agent: Agent | null;
  locations: Location[];
  neighborhoods: Neighborhood[];
  onClose: () => void;
  onSelectLocation: (location: Location) => void;
  /** Citizen Follow Mode (3D view only). Both optional so this drawer
   * keeps working unchanged anywhere it's used without a follow concept
   * (e.g. if reused from a 2D-only page). */
  isFollowing?: boolean;
  onToggleFollow?: () => void;
}

export function AgentProfileDrawer({
  agent,
  locations,
  neighborhoods,
  onClose,
  onSelectLocation,
  isFollowing,
  onToggleFollow,
}: AgentProfileDrawerProps) {
  if (!agent) return null;

  const currentLocation = locations.find((l) => l.id === agent.location_id);
  const currentNeighborhood = neighborhoods.find((n) => n.id === agent.neighborhood_id);

  // Map needs from real backend data (hunger, energy, social)
  const needColors: Record<string, { gradient: string; icon: string; barColor: string }> = {
    hunger: { gradient: "from-amber-600 to-amber-400", icon: "🍞", barColor: "bg-gradient-to-r from-amber-600 to-amber-400" },
    energy: { gradient: "from-emerald-600 to-emerald-400", icon: "⚡", barColor: "bg-gradient-to-r from-emerald-600 to-emerald-400" },
    social: { gradient: "from-blue-600 to-blue-400", icon: "💬", barColor: "bg-gradient-to-r from-blue-600 to-blue-400" },
    comfort: { gradient: "from-purple-600 to-purple-400", icon: "🛋️", barColor: "bg-gradient-to-r from-purple-600 to-purple-400" },
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-neutral-800 bg-neutral-950 p-6 shadow-2xl backdrop-blur-xl animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-neutral-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 font-mono text-lg font-bold text-white shadow-lg shadow-cyan-500/20">
            {agent.name
              .split(" ")
              .map((n) => n[0])
              .join("")}
          </div>
          <div>
            <h2 className="text-lg font-bold text-neutral-100">{agent.name}</h2>
            <p className="text-xs font-mono text-neutral-400 capitalize">
              {agent.age} years old • {agent.occupation}
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-900 hover:text-white transition"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-5 pt-4 pr-1">
        {/* Citizen Follow Mode control (3D view). Toggles the same real
            agent this drawer is already showing -- no separate identity
            or state to keep in sync. */}
        {onToggleFollow && (
          <button
            onClick={onToggleFollow}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold tracking-wide transition ${
              isFollowing
                ? "border-cyan-700 bg-cyan-950/50 text-cyan-300 hover:bg-cyan-950/70"
                : "border-neutral-700 bg-neutral-900/60 text-neutral-200 hover:border-cyan-700 hover:text-cyan-300"
            }`}
          >
            <span aria-hidden>{isFollowing ? "🎥" : "▶"}</span>
            {isFollowing ? `FOLLOWING ${agent.name.toUpperCase()} · TAP TO STOP` : `FOLLOW ${agent.name.toUpperCase()}`}
          </button>
        )}

        {/* Core Attributes */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-xl border border-neutral-800/80 bg-neutral-900/50 p-3">
            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
              Wealth
            </span>
            <p className="mt-0.5 font-mono text-base font-bold text-emerald-400">
              ${agent.wealth.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-800/80 bg-neutral-900/50 p-3">
            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
              Social Status
            </span>
            <p className="mt-0.5 font-mono text-base font-bold text-blue-400">
              {(agent.social_status * 100).toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Current Location */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Current Location
            </span>
            {currentLocation && (
              <button
                onClick={() => onSelectLocation(currentLocation)}
                className="text-[11px] font-mono text-cyan-400 hover:underline"
              >
                Focus on Map →
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-lg">📍</span>
            <div>
              <p className="text-sm font-semibold text-neutral-100">
                {currentLocation ? currentLocation.name : "Unknown Location"}
              </p>
              <p className="text-xs text-neutral-400">
                District: {currentNeighborhood ? currentNeighborhood.name : "Echo City"}
              </p>
            </div>
          </div>
        </div>

        {/* Current Action / Decision Context — live from the last simulation
            tick's Decision + Action Resolution outcome for this agent. */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Current Action
            </span>
            {agent.current_action && (
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                  agent.current_action.success
                    ? "border-emerald-800 text-emerald-400 bg-emerald-950/40"
                    : "border-rose-800 text-rose-400 bg-rose-950/40"
                }`}
              >
                tick {agent.current_action.tick} · {agent.current_action.success ? "ok" : "failed"}
              </span>
            )}
          </div>
          {agent.current_action ? (
            <div className="mt-2 space-y-1.5">
              <p className="text-sm font-semibold capitalize text-neutral-100">
                {agent.current_action.action_type.replace(/_/g, " ")}
              </p>
              <p className="text-xs text-neutral-400">{agent.current_action.message}</p>
              {agent.current_action.reasoning && (
                <p className="text-xs italic text-cyan-300/80 border-l-2 border-cyan-800 pl-2">
                  “{agent.current_action.reasoning}”
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-neutral-500 italic">
              No action recorded yet — step the simulation to see live decisions.
            </p>
          )}
        </div>

        {/* Employment */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Employment
          </span>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-lg">💼</span>
            <div>
              <p className="text-sm font-semibold capitalize text-neutral-100">
                {agent.occupation}
              </p>
              <p className="text-xs text-neutral-400">
                {agent.employer_name
                  ? `at ${agent.employer_name}${agent.wage != null ? ` · $${agent.wage}/shift` : ""}`
                  : "Unemployed — no workplace"}
              </p>
            </div>
          </div>
        </div>

        {/* Needs — rendered from real backend data */}
        <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
              Needs State
            </h3>
            <span className="text-[10px] font-mono text-neutral-500">
              Per-Tick Decay Active
            </span>
          </div>

          <div className="space-y-2.5">
            {agent.needs.map((need) => {
              const key = need.need_type.toLowerCase();
              const cfg = needColors[key] || { gradient: "from-neutral-600 to-neutral-400", icon: "●", barColor: "bg-gradient-to-r from-neutral-600 to-neutral-400" };
              const pct = need.value * 100;
              return (
                <div key={need.need_type}>
                  <div className="flex justify-between text-xs font-mono mb-1">
                    <span className="text-neutral-400 capitalize">{cfg.icon} {need.need_type}</span>
                    <span className="font-semibold text-neutral-200">{pct.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-neutral-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${cfg.barColor} transition-all duration-300`}
                      style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Personality Big 5 */}
        <div className="space-y-2.5 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
            Personality Traits (Big Five)
          </h3>
          <div className="grid grid-cols-1 gap-2 text-xs font-mono">
            {[
              { label: "Openness", val: agent.personality.openness, color: "bg-cyan-500" },
              { label: "Conscientiousness", val: agent.personality.conscientiousness, color: "bg-indigo-500" },
              { label: "Extraversion", val: agent.personality.extraversion, color: "bg-amber-500" },
              { label: "Agreeableness", val: agent.personality.agreeableness, color: "bg-emerald-500" },
              { label: "Neuroticism", val: agent.personality.neuroticism, color: "bg-rose-500" },
            ].map((trait) => (
              <div key={trait.label} className="space-y-0.5">
                <div className="flex justify-between text-[11px] text-neutral-400">
                  <span>{trait.label}</span>
                  <span className="text-neutral-200">{(trait.val * 100).toFixed(0)}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${trait.color}`}
                    style={{ width: `${trait.val * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Active Goals */}
        <div className="space-y-2.5 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
              Active Goals ({agent.goals.length})
            </h3>
          </div>

          {agent.goals.length > 0 ? (
            <div className="space-y-2">
              {agent.goals.map((g) => {
                const isCurrent = agent.current_goal?.id === g.id;
                return (
                  <div
                    key={g.id}
                    className={`rounded-lg border p-2.5 text-xs font-mono ${
                      isCurrent
                        ? "border-cyan-700 bg-cyan-950/30"
                        : "border-neutral-800 bg-neutral-950"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-neutral-200">
                        {isCurrent && <span className="mr-1 text-cyan-400">▶</span>}
                        {g.description}
                      </span>
                      <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] text-cyan-400 border border-neutral-800">
                        Priority {g.priority}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-neutral-500">
                      <span>Status: {g.status}</span>
                      <span>Progress: {(g.progress * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-neutral-500 italic">
              No active goals triggered (Needs satisfied).
            </p>
          )}
        </div>

        {/* Relationships — bilateral social memory, from society/relationships.py */}
        <div className="space-y-2.5 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
            Relationships ({agent.relationships.length})
          </h3>
          {agent.relationships.length > 0 ? (
            <div className="space-y-2">
              {agent.relationships.slice(0, 8).map((r) => (
                <div
                  key={r.other_agent_id}
                  className="rounded-lg border border-neutral-800 bg-neutral-950 p-2.5 text-xs font-mono"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-neutral-200">{r.other_agent_name}</span>
                    <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] text-blue-400 border border-neutral-800 capitalize">
                      {r.relationship_type.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 text-[10px] text-neutral-500">
                    <span>Strength: {(r.strength * 100).toFixed(0)}%</span>
                    <span>Trust: {(r.trust * 100).toFixed(0)}%</span>
                    <span>Interactions: {r.interactions_count}</span>
                    <span>Last tick: {r.last_interaction_tick}</span>
                  </div>
                </div>
              ))}
              {agent.relationships.length > 8 && (
                <p className="text-[10px] text-neutral-500 italic">
                  +{agent.relationships.length - 8} more relationship(s) not shown.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-neutral-500 italic">
              No relationships formed yet — socializing builds social memory over time.
            </p>
          )}
        </div>

        {/* Debug Agent UUID */}
        <div className="rounded-lg border border-neutral-900 bg-neutral-950 p-2.5 text-[10px] font-mono text-neutral-500">
          <span className="block text-neutral-400">Agent UUID:</span>
          <span className="break-all">{agent.id}</span>
        </div>
      </div>
    </div>
  );
}
