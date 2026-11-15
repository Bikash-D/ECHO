import React from "react";
import { HealthResponse } from "../lib/types";

interface BackendDiagnosticModalProps {
  isOpen: boolean;
  onClose: () => void;
  healthData: HealthResponse | null;
  latencyMs: number;
  error: string | null;
  onRetry: () => void;
}

export function BackendDiagnosticModal({
  isOpen,
  onClose,
  healthData,
  latencyMs,
  error,
  onRetry,
}: BackendDiagnosticModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-xl rounded-2xl border border-neutral-800 bg-neutral-950 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800/80 pb-4">
          <div className="flex items-center gap-2">
            <span className="flex h-3 w-3 rounded-full bg-cyan-400" />
            <h3 className="text-base font-semibold text-neutral-100">
              Backend Telemetry & Diagnostic Inspector
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-900 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
              <span className="text-neutral-500 font-mono">Target Backend URL:</span>
              <p className="mt-0.5 font-mono font-semibold text-neutral-200">
                http://127.0.0.1:8000/api/health
              </p>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
              <span className="text-neutral-500 font-mono">Roundtrip Latency:</span>
              <p className="mt-0.5 font-mono font-semibold text-emerald-400">
                {latencyMs > 0 ? `${latencyMs}ms` : "N/A"}
              </p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider font-mono">
                Live HTTP Response Payload
              </span>
              <span
                className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded ${
                  healthData ? "bg-emerald-950 text-emerald-300 border border-emerald-800" : "bg-rose-950 text-rose-300 border border-rose-800"
                }`}
              >
                {healthData ? "200 OK" : "CONNECTION FAILED"}
              </span>
            </div>
            <pre className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900/80 p-3 text-xs font-mono text-cyan-300">
              {healthData
                ? JSON.stringify(healthData, null, 2)
                : JSON.stringify({ error: error || "No response received" }, null, 2)}
            </pre>
          </div>

          {!healthData && (
            <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-xs text-amber-300">
              <p className="font-semibold">Troubleshooting FastAPI Backend:</p>
              <p className="mt-1 text-neutral-300">
                To spin up the FastAPI service, run:
              </p>
              <code className="mt-1 block rounded bg-neutral-950 p-1.5 font-mono text-amber-200">
                uvicorn app.main:app --app-dir apps/api --reload --port 8000
              </code>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-neutral-800/80 pt-4">
          <button
            onClick={onRetry}
            className="rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-200 hover:bg-neutral-700 hover:text-white"
          >
            Retry Connection
          </button>
          <button
            onClick={onClose}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
