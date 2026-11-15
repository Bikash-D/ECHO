import React from "react";
import { StatusBadge } from "./StatusBadge";

interface TelemetryCardProps {
  title: string;
  category: string;
  endpoint: string;
  phase: string;
  children?: React.ReactNode;
  domainSpecDetails?: { label: string; value: string }[];
  /**
   * True when `endpoint` is a real, wired HTTP route already returning
   * live simulation data (as opposed to a route that genuinely doesn't
   * exist yet). Flips the badge/footer from "pending" framing to "live"
   * framing -- this must only be set when the endpoint actually works,
   * never as decoration.
   */
  live?: boolean;
}

export function TelemetryCard({
  title,
  category,
  endpoint,
  phase,
  children,
  domainSpecDetails,
  live = false,
}: TelemetryCardProps) {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 shadow-lg backdrop-blur">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] font-mono font-semibold tracking-wider text-neutral-300 uppercase">
              {category}
            </span>
            <h3 className="text-sm font-semibold tracking-wide text-neutral-100">
              {title}
            </h3>
          </div>
          {live ? (
            <StatusBadge variant="online" label="LIVE" pulse />
          ) : (
            <StatusBadge variant="pending" label={phase} />
          )}
        </div>

        <div className="mt-4">
          {children ? (
            children
          ) : (
            <div className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 p-4 text-center">
              <p className="text-xs text-neutral-400">
                Telemetry stream pending API route activation.
              </p>
              <div className="mt-2 inline-flex items-center gap-1.5 rounded bg-neutral-900 px-2.5 py-1 text-[11px] font-mono text-neutral-400 border border-neutral-800">
                <span>Required Endpoint:</span>
                <span className="text-cyan-400 font-semibold">{endpoint}</span>
              </div>
            </div>
          )}
        </div>

        {domainSpecDetails && domainSpecDetails.length > 0 && (
          <div className="mt-4 space-y-1.5 border-t border-neutral-800/80 pt-3">
            <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              {live ? "Live Domain Snapshot:" : "Underlying Python Domain Spec:"}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {domainSpecDetails.map((detail, idx) => (
                <div
                  key={idx}
                  className="rounded border border-neutral-800/60 bg-neutral-950/60 p-2 text-xs"
                >
                  <span className="block text-[10px] text-neutral-500 font-mono">
                    {detail.label}
                  </span>
                  <span className="font-semibold text-neutral-200 font-mono">
                    {detail.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-neutral-800/60 pt-3 text-[11px] text-neutral-500 font-mono">
        <span>{live ? "Status: live" : `Target Phase: ${phase}`}</span>
        <span>Route: {endpoint}</span>
      </div>
    </div>
  );
}
