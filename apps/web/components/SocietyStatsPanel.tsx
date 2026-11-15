import React from "react";
import { SocietyStatistics } from "../lib/types";

interface SocietyStatsPanelProps {
  stats: SocietyStatistics | null;
  tick: number;
  status: string;
  neighborhoodCount: number;
  locationCount: number;
}

export function SocietyStatsPanel({
  stats,
  tick,
  status,
  neighborhoodCount,
  locationCount,
}: SocietyStatsPanelProps) {
  if (!stats) return null;

  // Sort occupations by count descending
  const sortedOccupations = Object.entries(stats.occupation_distribution).sort(
    ([, a], [, b]) => b - a
  );

  return (
    <div className="space-y-4">
      {/* Population & Geography */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
          Society Overview
        </h3>
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-neutral-400">Population</span>
            <span className="font-bold text-neutral-100">{stats.total_population}</span>
          </div>
          <div className="flex justify-between text-xs font-mono">
            <span className="text-neutral-400">Neighborhoods</span>
            <span className="font-bold text-neutral-100">{neighborhoodCount}</span>
          </div>
          <div className="flex justify-between text-xs font-mono">
            <span className="text-neutral-400">Locations</span>
            <span className="font-bold text-neutral-100">{locationCount}</span>
          </div>
        </div>
      </div>

      {/* Economy */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
          Economy
        </h3>
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-neutral-400">Avg Wealth</span>
            <span className="font-bold text-emerald-400">${stats.average_wealth.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-xs font-mono">
            <span className="text-neutral-400">Avg Status</span>
            <span className="font-bold text-blue-400">{(stats.average_social_status * 100).toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* Needs Average */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
          Population Needs
        </h3>
        <div className="space-y-2.5">
          {Object.entries(stats.average_needs).map(([need, val]) => {
            const colors: Record<string, string> = {
              hunger: "from-amber-600 to-amber-400",
              energy: "from-emerald-600 to-emerald-400",
              social: "from-blue-600 to-blue-400",
              comfort: "from-purple-600 to-purple-400",
            };
            const gradient = colors[need.toLowerCase()] || "from-neutral-600 to-neutral-400";
            const pct = val * 100;
            return (
              <div key={need}>
                <div className="flex justify-between text-[11px] font-mono mb-0.5">
                  <span className="text-neutral-400 capitalize">{need}</span>
                  <span className="text-neutral-200">{pct.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${gradient} transition-all duration-500`}
                    style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Occupations */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
          Occupations
        </h3>
        <div className="space-y-1.5">
          {sortedOccupations.map(([occ, count]) => (
            <div key={occ} className="flex items-center justify-between text-xs font-mono">
              <span className="text-neutral-300 capitalize">{occ}</span>
              <div className="flex items-center gap-2">
                <div className="h-1 w-16 rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-cyan-500"
                    style={{ width: `${(count / stats.total_population) * 100}%` }}
                  />
                </div>
                <span className="text-neutral-400 w-6 text-right">{count}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
