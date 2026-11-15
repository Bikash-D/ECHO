import React, { useState } from "react";
import { SimulationEvent } from "../lib/types";

interface EventFeedProps {
  events?: SimulationEvent[];
  isStreaming?: boolean;
}

export function EventFeed({ events = [], isStreaming = false }: EventFeedProps) {
  const [filter, setFilter] = useState<string>("ALL");

  const filteredEvents =
    filter === "ALL"
      ? events
      : events.filter((e) => e.category === filter || e.level === filter);

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/90 p-5 shadow-lg backdrop-blur">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-neutral-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-wide text-neutral-200 uppercase">
              Simulation Event Stream
            </h2>
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
            </span>
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            Observes <code className="text-neutral-300 font-mono">apps/api/app/simulation/event_queue.py</code>
          </p>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          {["ALL", "ENGINE", "AGENT", "WORLD", "INTERVENTION"].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`rounded px-2.5 py-1 text-[11px] font-mono transition ${
                filter === cat
                  ? "bg-neutral-800 text-neutral-100 font-semibold border border-neutral-700"
                  : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {filteredEvents.length > 0 ? (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {filteredEvents.map((evt) => (
              <div
                key={evt.id}
                className="flex items-start gap-3 rounded-lg border border-neutral-800/60 bg-neutral-900/40 p-2.5 text-xs font-mono"
              >
                <span className="text-neutral-500 shrink-0">
                  TICK {evt.tick.toString().padStart(4, "0")}
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold shrink-0 ${
                    evt.level === "ERROR"
                      ? "bg-rose-950 text-rose-300 border border-rose-800"
                      : evt.level === "WARN"
                      ? "bg-amber-950 text-amber-300 border border-amber-800"
                      : "bg-blue-950 text-blue-300 border border-blue-800"
                  }`}
                >
                  {evt.category}
                </span>
                <span className="text-neutral-300 flex-1">{evt.message}</span>
                <span className="text-neutral-500 text-[10px] shrink-0">
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-800 bg-neutral-900/20 py-8 text-center">
            <svg
              className="h-8 w-8 text-neutral-600 mb-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
            <p className="text-xs font-semibold text-neutral-300">
              No live simulation events recorded yet
            </p>
            <p className="mt-1 text-[11px] text-neutral-500 max-w-sm">
              Event queue will stream tick transitions, need alerts, and agent decisions once engine loop executes.
            </p>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded bg-neutral-900 px-2.5 py-1 text-[11px] font-mono text-neutral-400 border border-neutral-800">
              <span>Required API Route:</span>
              <span className="text-cyan-400 font-semibold">GET /api/events/stream (SSE / WS)</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
