"use client";

import React from "react";
import { HealthResponse } from "../lib/types";
import { StatusBadge } from "./StatusBadge";

interface HeaderProps {
  healthData: HealthResponse | null;
  latencyMs: number;
  isLoading: boolean;
  onRefresh: () => void;
  onOpenDiagnostic: () => void;
  tick?: number;
}

export function Header({
  healthData,
  latencyMs,
  isLoading,
  onRefresh,
  onOpenDiagnostic,
  tick = 0,
}: HeaderProps) {
  const isOnline = healthData !== null && healthData.status === "ok";

  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-950/80 px-6 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Simulation System:
          </span>
          <span className="font-mono text-sm font-bold text-neutral-100">
            {healthData ? healthData.app : "ECHO"}
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-2 border-l border-neutral-800 pl-4">
          <span className="text-xs text-neutral-400 font-mono">Profile:</span>
          {healthData ? (
            <StatusBadge
              variant={healthData.simulation_profile === "mvp" ? "mvp" : "dev"}
              label={`${healthData.simulation_profile.toUpperCase()} (${healthData.population_size} AGENTS)`}
            />
          ) : (
            <StatusBadge variant="standby" label="PROFILE: DEV" />
          )}
        </div>

        <div className="hidden md:flex items-center gap-2 border-l border-neutral-800 pl-4">
          <span className="text-xs text-neutral-400 font-mono">Clock:</span>
          <span className="rounded bg-neutral-900 px-2 py-0.5 font-mono text-xs font-bold text-neutral-200 border border-neutral-800">
            TICK {tick.toString().padStart(4, "0")}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onOpenDiagnostic}
          className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-mono text-neutral-300 hover:bg-neutral-800 transition"
        >
          {isOnline ? (
            <StatusBadge variant="online" label="BACKEND ONLINE" pulse />
          ) : (
            <StatusBadge variant="offline" label="BACKEND OFFLINE" />
          )}
          {isOnline && latencyMs > 0 && (
            <span className="text-neutral-500 text-[10px]">{latencyMs}ms</span>
          )}
        </button>

        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition disabled:opacity-50"
          title="Refresh Backend Telemetry"
        >
          <svg
            className={`h-4 w-4 ${isLoading ? "animate-spin text-cyan-400" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
