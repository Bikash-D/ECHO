"use client";

import React, { useCallback, useEffect, useState } from "react";
import { fetchWorld } from "@/lib/api";
import { Location, WorldResponse } from "@/lib/types";
import { StatCard } from "@/components/StatCard";

export default function EconomyPage() {
  const [world, setWorld] = useState<WorldResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadWorld = useCallback(async () => {
    const { data, error: err } = await fetchWorld();
    if (data) {
      setWorld(data);
      setError(null);
    } else {
      setError(err);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadWorld();
    const interval = setInterval(loadWorld, 4000);
    return () => clearInterval(interval);
  }, [loadWorld]);

  const businesses: Location[] = (world?.locations || []).filter(
    (loc) => loc.type === "workplace" || loc.type === "market"
  );
  const neighborhoodName = (id: string) =>
    world?.neighborhoods.find((n) => n.id === id)?.name || "Unknown";

  const sortedBusinesses = [...businesses].sort(
    (a, b) => (b.business?.cash ?? 0) - (a.business?.cash ?? 0)
  );

  const businessesWithCash = businesses.filter((w) => (w.business?.cash ?? 0) !== 0);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-neutral-100">Economy</h1>
        <p className="text-xs font-mono text-neutral-500">
          Tick {world?.tick ?? "—"} · {world?.status ?? "—"}
        </p>
      </div>
      <p className="mt-2 text-sm text-neutral-500">
        Every workplace and market is backed by a Business. A work shift
        produces deterministic output before an agent is paid: output value
        flows into the employer&apos;s cash as revenue, wage is deducted as a
        labor cost, and the difference is retained profit. A food purchase
        works the other direction: an agent physically at a market pays for
        food, and that payment is recorded as the market&apos;s revenue —
        closing the loop between what businesses pay out in wages and what
        they take back in as agents spend. Not yet implemented: variable
        pricing, hiring/firing, or a labor market — see the project
        roadmap.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
          Failed to load world state: {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title="Total Business Cash"
          value={
            world ? `$${world.statistics.total_business_cash.toLocaleString()}` : "—"
          }
          subtitle="Sum of all workplace + market cash, this tick"
          statusColor="emerald"
          isLoading={isLoading}
        />
        <StatCard
          title="Businesses"
          value={businesses.length}
          subtitle={`${businessesWithCash.length} with recorded activity`}
          statusColor="blue"
          isLoading={isLoading}
        />
        <StatCard
          title="Avg. Agent Wealth"
          value={world ? `$${world.statistics.average_wealth.toLocaleString()}` : "—"}
          subtitle="Across the full population"
          statusColor="cyan"
          isLoading={isLoading}
        />
      </div>

      <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Businesses by Cash
        </h3>
        {isLoading ? (
          <div className="h-32 animate-pulse rounded bg-neutral-800" />
        ) : sortedBusinesses.length === 0 ? (
          <p className="text-sm text-neutral-500">No businesses found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="text-neutral-500">
                  <th className="pb-2 pr-4 font-semibold uppercase tracking-wider">Business</th>
                  <th className="pb-2 pr-4 font-semibold uppercase tracking-wider">Type</th>
                  <th className="pb-2 pr-4 font-semibold uppercase tracking-wider">Neighborhood</th>
                  <th className="pb-2 pr-4 font-semibold uppercase tracking-wider">Agents Present</th>
                  <th className="pb-2 pr-4 font-semibold uppercase tracking-wider text-right">
                    Cash
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedBusinesses.map((loc) => (
                  <tr key={loc.id} className="border-t border-neutral-800/60">
                    <td className="py-2 pr-4 text-neutral-200">
                      {loc.business?.name ?? loc.name}
                    </td>
                    <td className="py-2 pr-4 capitalize text-neutral-400">{loc.type}</td>
                    <td className="py-2 pr-4 text-neutral-400">
                      {neighborhoodName(loc.neighborhood_id)}
                    </td>
                    <td className="py-2 pr-4 text-neutral-400">{loc.occupancy}</td>
                    <td
                      className={`py-2 pr-4 text-right font-bold ${
                        (loc.business?.cash ?? 0) > 0
                          ? "text-emerald-400"
                          : (loc.business?.cash ?? 0) < 0
                          ? "text-red-400"
                          : "text-neutral-500"
                      }`}
                    >
                      ${(loc.business?.cash ?? 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
