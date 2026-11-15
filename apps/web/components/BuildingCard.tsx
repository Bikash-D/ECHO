import React from "react";
import { Agent, Location } from "../lib/types";
import { AgentSprite } from "./AgentSprite";

interface BuildingCardProps {
  location: Location;
  occupants: Agent[];
  onSelectLocation: (location: Location) => void;
  onSelectAgent: (agent: Agent) => void;
  isSelected?: boolean;
  selectedAgentId?: string;
}

const TYPE_CONFIG: Record<
  string,
  { icon: string; label: string; headerBg: string; border: string; glow: string }
> = {
  residential: {
    icon: "🏠",
    label: "Residence",
    headerBg: "bg-emerald-950/40 text-emerald-300 border-emerald-800/50",
    border: "hover:border-emerald-500/60",
    glow: "group-hover:shadow-emerald-900/20",
  },
  workplace: {
    icon: "🏢",
    label: "Workplace",
    headerBg: "bg-blue-950/40 text-blue-300 border-blue-800/50",
    border: "hover:border-blue-500/60",
    glow: "group-hover:shadow-blue-900/20",
  },
  market: {
    icon: "🏪",
    label: "Market",
    headerBg: "bg-amber-950/40 text-amber-300 border-amber-800/50",
    border: "hover:border-amber-500/60",
    glow: "group-hover:shadow-amber-900/20",
  },
  leisure: {
    icon: "🌳",
    label: "Leisure Spot",
    headerBg: "bg-purple-950/40 text-purple-300 border-purple-800/50",
    border: "hover:border-purple-500/60",
    glow: "group-hover:shadow-purple-900/20",
  },
};

export function BuildingCard({
  location,
  occupants,
  onSelectLocation,
  onSelectAgent,
  isSelected = false,
  selectedAgentId,
}: BuildingCardProps) {
  const config = TYPE_CONFIG[location.type.toLowerCase()] || TYPE_CONFIG.residential;

  return (
    <div
      onClick={() => onSelectLocation(location)}
      className={`group relative flex flex-col justify-between rounded-xl border bg-neutral-900/80 p-3.5 shadow-md backdrop-blur transition-all duration-200 cursor-pointer ${
        config.border
      } ${
        isSelected
          ? "border-cyan-400 ring-2 ring-cyan-500/40 bg-neutral-850 shadow-cyan-900/30"
          : "border-neutral-800 hover:bg-neutral-850"
      }`}
    >
      <div>
        {/* Top building tag */}
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase ${config.headerBg}`}
          >
            <span>{config.icon}</span>
            <span>{config.label}</span>
          </span>

          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-mono font-semibold ${
              occupants.length > 0
                ? "bg-cyan-950/70 text-cyan-300 border border-cyan-800/50"
                : "bg-neutral-950/50 text-neutral-500 border border-neutral-800/60"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${occupants.length > 0 ? "bg-cyan-400 animate-pulse" : "bg-neutral-600"}`} />
            <span>{occupants.length}</span>
            <span className="text-[9px] text-neutral-400">/ {location.capacity ? location.capacity : "∞"}</span>
          </span>
        </div>

        {/* Building Name */}
        <h4 className="mt-2 text-xs font-semibold text-neutral-100 group-hover:text-cyan-300 transition-colors line-clamp-1">
          {location.name}
        </h4>
      </div>

      {/* Agents inside this building */}
      <div className="mt-3 min-h-[44px] rounded-lg border border-neutral-800/60 bg-neutral-950/60 p-2">
        {occupants.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {occupants.map((agent) => (
              <AgentSprite
                key={agent.id}
                agent={agent}
                onClick={onSelectAgent}
                isSelected={agent.id === selectedAgentId}
                size="sm"
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] font-mono text-neutral-600">
            Empty
          </div>
        )}
      </div>
    </div>
  );
}
