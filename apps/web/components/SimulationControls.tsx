import React from "react";

interface SimulationControlsProps {
  status: "initialized" | "running" | "paused" | "stopped" | "offline";
  tick: number;
  isPlaying: boolean;
  onStart: () => void;
  onPause: () => void;
  onStep: () => void;
  onReset: () => void;
  disabled?: boolean;
}

/**
 * Real simulation lifecycle console: every button here dispatches to
 * apps/api/app/api/routes/simulation.py (start/step/pause/reset), the
 * same live endpoints apps/web/lib/useSimulationController.ts already
 * drives on /city and /world. Nothing here is decorative -- if a click
 * doesn't visibly move `tick`, that's a real bug, not an intentional
 * "pending" state.
 */
export function SimulationControls({
  status,
  tick,
  isPlaying,
  onStart,
  onPause,
  onStep,
  onReset,
  disabled = false,
}: SimulationControlsProps) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/80 p-5 shadow-lg backdrop-blur">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-wide text-neutral-200 uppercase">
              Simulation Control Console
            </h2>
            <span className="inline-flex items-center gap-1.5 rounded bg-emerald-950/50 border border-emerald-800/60 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              LIVE — HTTP WIRED
            </span>
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            Dispatches directly to <code className="text-neutral-300">POST /api/simulation/*</code>. Current tick:{" "}
            <span className="font-mono text-neutral-200">{tick}</span> · Status:{" "}
            <span className="font-mono text-neutral-200">{status}</span>
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-neutral-800/80">
        <button
          onClick={isPlaying ? onPause : onStart}
          disabled={disabled}
          className="group flex flex-col items-center justify-center rounded-lg border border-neutral-800/80 bg-neutral-900/50 p-3 transition hover:border-emerald-700/60 hover:bg-emerald-950/30 disabled:opacity-40 disabled:cursor-not-allowed"
          title={isPlaying ? "POST /api/simulation/pause" : "POST /api/simulation/start"}
        >
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
            {isPlaying ? (
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>
            ) : (
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            )}
            <span>{isPlaying ? "Pause" : "Start"}</span>
          </div>
          <span className="mt-1 text-[10px] font-mono text-neutral-500">
            POST /simulation/{isPlaying ? "pause" : "start"}
          </span>
        </button>

        <button
          onClick={onStep}
          disabled={disabled || isPlaying}
          className="group flex flex-col items-center justify-center rounded-lg border border-neutral-800/80 bg-neutral-900/50 p-3 transition hover:border-cyan-700/60 hover:bg-cyan-950/30 disabled:opacity-40 disabled:cursor-not-allowed"
          title="POST /api/simulation/step"
        >
          <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
            <span>Step (1 Tick)</span>
          </div>
          <span className="mt-1 text-[10px] font-mono text-neutral-500">POST /simulation/step</span>
        </button>

        <button
          onClick={onPause}
          disabled={disabled || !isPlaying}
          className="group flex flex-col items-center justify-center rounded-lg border border-neutral-800/80 bg-neutral-900/50 p-3 transition hover:border-amber-700/60 hover:bg-amber-950/30 disabled:opacity-40 disabled:cursor-not-allowed"
          title="POST /api/simulation/pause"
        >
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Pause</span>
          </div>
          <span className="mt-1 text-[10px] font-mono text-neutral-500">POST /simulation/pause</span>
        </button>

        <button
          onClick={onReset}
          disabled={disabled}
          className="group flex flex-col items-center justify-center rounded-lg border border-neutral-800/80 bg-neutral-900/50 p-3 transition hover:border-rose-700/60 hover:bg-rose-950/30 disabled:opacity-40 disabled:cursor-not-allowed"
          title="POST /api/simulation/reset"
        >
          <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Reset</span>
          </div>
          <span className="mt-1 text-[10px] font-mono text-neutral-500">POST /simulation/reset</span>
        </button>
      </div>
    </div>
  );
}
