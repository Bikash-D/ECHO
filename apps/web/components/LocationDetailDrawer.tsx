import React from "react";
import { Agent, Location, Neighborhood } from "../lib/types";
import { AgentSprite } from "./AgentSprite";

interface LocationDetailDrawerProps {
  location: Location | null;
  agents: Agent[];
  neighborhoods: Neighborhood[];
  onClose: () => void;
  onSelectAgent: (agent: Agent) => void;
}

export function LocationDetailDrawer({
  location,
  agents,
  neighborhoods,
  onClose,
  onSelectAgent,
}: LocationDetailDrawerProps) {
  if (!location) return null;

  const occupants = agents.filter((a) => a.location_id === location.id);
  const neighborhood = neighborhoods.find((n) => n.id === location.neighborhood_id);

  const typeIcons: Record<string, string> = {
    residential: "🏠",
    workplace: "🏢",
    market: "🏪",
    leisure: "🌳",
  };
  const icon = typeIcons[location.type.toLowerCase()] || "📍";

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-neutral-800 bg-neutral-950 p-6 shadow-2xl backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-neutral-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-2xl shadow-lg shadow-violet-500/20">
            {icon}
          </div>
          <div>
            <h2 className="text-lg font-bold text-neutral-100">{location.name}</h2>
            <p className="text-xs font-mono text-neutral-400 capitalize">
              {location.type} • {neighborhood ? neighborhood.name : "Echo City"}
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

      <div className="flex-1 overflow-y-auto space-y-5 pt-4">
        {/* Occupancy Stats */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-xl border border-neutral-800/80 bg-neutral-900/50 p-3">
            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">Occupancy</span>
            <p className="mt-0.5 font-mono text-base font-bold text-cyan-400">
              {occupants.length}
              <span className="text-neutral-500 text-sm">
                {" "}/ {location.capacity ?? "∞"}
              </span>
            </p>
          </div>
          <div className="rounded-xl border border-neutral-800/80 bg-neutral-900/50 p-3">
            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">District</span>
            <p className="mt-0.5 text-sm font-semibold text-neutral-200">
              {neighborhood ? neighborhood.name : "—"}
            </p>
          </div>
        </div>

        {/* People Currently Here */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300 mb-3">
            People Here ({occupants.length})
          </h3>

          {occupants.length > 0 ? (
            <div className="space-y-2">
              {occupants.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => onSelectAgent(agent)}
                  className="flex w-full items-center gap-3 rounded-lg border border-neutral-800/60 bg-neutral-950/60 p-2.5 text-left hover:bg-neutral-900 hover:border-neutral-700 transition"
                >
                  <AgentSprite agent={agent} onClick={onSelectAgent} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-neutral-100 truncate">
                      {agent.name}
                    </p>
                    <p className="text-[10px] font-mono text-neutral-400 capitalize">
                      {agent.age}yo • {agent.occupation} • ${agent.wealth}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-500 italic text-center py-4">
              No one is currently at this location.
            </p>
          )}
        </div>

        {/* Debug Location UUID */}
        <div className="rounded-lg border border-neutral-900 bg-neutral-950 p-2.5 text-[10px] font-mono text-neutral-500">
          <span className="block text-neutral-400">Location UUID:</span>
          <span className="break-all">{location.id}</span>
        </div>
      </div>
    </div>
  );
}
