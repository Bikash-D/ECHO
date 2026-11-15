"use client";

import React, { useState } from "react";
import { CityActivityEvent } from "@/lib/types";

interface CityActivityFeedProps {
  events: CityActivityEvent[];
  onSelectAgent?: (agentId: string) => void;
}

const CATEGORY_STYLE: Record<CityActivityEvent["category"], string> = {
  MOVEMENT: "border-slate-700 text-slate-300 bg-slate-900/60",
  ACTION: "border-sky-800 text-sky-300 bg-sky-950/50",
  SOCIAL: "border-violet-800 text-violet-300 bg-violet-950/50",
  ECONOMY: "border-amber-800 text-amber-300 bg-amber-950/50",
  GOAL: "border-fuchsia-800 text-fuchsia-300 bg-fuchsia-950/50",
};

/**
 * Live activity feed for /city. Every row here comes from a real change
 * observed between two consecutive /api/world snapshots (see
 * lib/activityFeed.ts) -- there is no scripted or invented content.
 * Distinct component from components/EventFeed.tsx, which mirrors the
 * backend's (currently stub) engine event_queue and lives on the
 * dashboard; this one is purpose-built for the city page's "what are
 * people actually doing right now" need called out in the V3 brief.
 */
export function CityActivityFeed({ events, onSelectAgent }: CityActivityFeedProps) {
  const [filter, setFilter] = useState<"ALL" | CityActivityEvent["category"]>("ALL");
  const filtered = filter === "ALL" ? events : events.filter((e) => e.category === filter);

  return (
    <div className="flex h-full flex-col rounded-xl border border-neutral-800 bg-neutral-950/90 backdrop-blur">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-800/80 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-1.5 w-1.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-500" />
          </span>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-300">
            Live Activity
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {(["ALL", "MOVEMENT", "GOAL", "ACTION", "SOCIAL", "ECONOMY"] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`rounded px-1.5 py-0.5 text-[9px] font-mono transition ${
                filter === cat
                  ? "bg-neutral-800 text-neutral-100 border border-neutral-700"
                  : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
              }`}
            >
              {cat === "ALL" ? "ALL" : cat.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {filtered.length === 0 ? (
          <p className="p-3 text-[11px] text-neutral-500 italic">
            No activity yet — press Play or Step to advance the simulation.
          </p>
        ) : (
          filtered.map((evt) => (
            <button
              key={evt.id}
              onClick={() => onSelectAgent?.(evt.agentId)}
              className="block w-full rounded-lg border border-neutral-800/60 bg-neutral-900/40 px-2.5 py-1.5 text-left transition hover:border-neutral-700 hover:bg-neutral-900"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide border ${CATEGORY_STYLE[evt.category]}`}
                >
                  {evt.category}
                </span>
                <span className="text-[9px] font-mono text-neutral-600">T{evt.tick}</span>
                <span className="text-[11px] text-neutral-200 truncate">{evt.message}</span>
              </div>
              {evt.detail && (
                <p className="mt-0.5 pl-1 text-[10px] font-mono text-emerald-400/90">{evt.detail}</p>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
