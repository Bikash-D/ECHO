import React from "react";
import { Agent, Location, Neighborhood } from "../lib/types";
import { BuildingCard } from "./BuildingCard";

interface NeighborhoodSectionProps {
  neighborhood: Neighborhood;
  locations: Location[];
  agents: Agent[];
  onSelectNeighborhood: (neighborhood: Neighborhood) => void;
  onSelectLocation: (location: Location) => void;
  onSelectAgent: (agent: Agent) => void;
  selectedLocationId?: string;
  selectedAgentId?: string;
}

const DISTRICT_THEMES: Record<
  string,
  { gradient: string; border: string; badge: string; icon: string; description: string }
> = {
  Riverside: {
    gradient: "from-teal-950/40 via-neutral-900/60 to-neutral-950/80",
    border: "border-teal-800/40 hover:border-teal-600/60",
    badge: "bg-teal-950/80 text-teal-300 border-teal-800",
    icon: "🌊",
    description: "Scenic waterfront district with riverside residences and fisheries.",
  },
  Downtown: {
    gradient: "from-amber-950/30 via-neutral-900/60 to-neutral-950/80",
    border: "border-amber-800/40 hover:border-amber-600/60",
    badge: "bg-amber-950/80 text-amber-300 border-amber-800",
    icon: "🏙️",
    description: "High-density urban core with corporate plazas and central market.",
  },
  Hillcrest: {
    gradient: "from-emerald-950/30 via-neutral-900/60 to-neutral-950/80",
    border: "border-emerald-800/40 hover:border-emerald-600/60",
    badge: "bg-emerald-950/80 text-emerald-300 border-emerald-800",
    icon: "🌲",
    description: "Elevated residential suburb with garden estates and serene parks.",
  },
  Eastgate: {
    gradient: "from-indigo-950/30 via-neutral-900/60 to-neutral-950/80",
    border: "border-indigo-800/40 hover:border-indigo-600/60",
    badge: "bg-indigo-950/80 text-indigo-300 border-indigo-800",
    icon: "⚙️",
    description: "Industrial sector & transit junction powering metropolitan logistics.",
  },
  Millbrook: {
    gradient: "from-orange-950/30 via-neutral-900/60 to-neutral-950/80",
    border: "border-orange-800/40 hover:border-orange-600/60",
    badge: "bg-orange-950/80 text-orange-300 border-orange-800",
    icon: "🌾",
    description: "Historic artisan quarter with craft workshops and market squares.",
  },
};

export function NeighborhoodSection({
  neighborhood,
  locations,
  agents,
  onSelectNeighborhood,
  onSelectLocation,
  onSelectAgent,
  selectedLocationId,
  selectedAgentId,
}: NeighborhoodSectionProps) {
  const theme = DISTRICT_THEMES[neighborhood.name] || DISTRICT_THEMES.Downtown;

  // Group agents by location
  const agentsByLocation: Record<string, Agent[]> = {};
  locations.forEach((l) => {
    agentsByLocation[l.id] = [];
  });
  agents.forEach((a) => {
    if (agentsByLocation[a.location_id]) {
      agentsByLocation[a.location_id].push(a);
    }
  });

  return (
    <div
      className={`relative rounded-2xl border bg-gradient-to-br p-5 shadow-xl backdrop-blur transition-all duration-200 ${theme.gradient} ${theme.border}`}
    >
      {/* Neighborhood District Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-neutral-800/80 pb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl select-none">{theme.icon}</span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold tracking-tight text-neutral-100">
                {neighborhood.name}
              </h3>
              <button
                onClick={() => onSelectNeighborhood(neighborhood)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-mono font-semibold uppercase transition hover:brightness-125 ${theme.badge}`}
              >
                Inspect District
              </button>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">{theme.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-end sm:self-auto">
          <div className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-950/80 px-3 py-1.5 text-xs font-mono">
            <span className="text-neutral-500">Population:</span>
            <span className="font-bold text-cyan-400">{neighborhood.population}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-950/80 px-3 py-1.5 text-xs font-mono">
            <span className="text-neutral-500">Locations:</span>
            <span className="font-bold text-neutral-200">{locations.length}</span>
          </div>
        </div>
      </div>

      {/* Buildings Grid for this Neighborhood */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {locations.map((loc) => (
          <BuildingCard
            key={loc.id}
            location={loc}
            occupants={agentsByLocation[loc.id] || []}
            onSelectLocation={onSelectLocation}
            onSelectAgent={onSelectAgent}
            isSelected={loc.id === selectedLocationId}
            selectedAgentId={selectedAgentId}
          />
        ))}
      </div>
    </div>
  );
}
