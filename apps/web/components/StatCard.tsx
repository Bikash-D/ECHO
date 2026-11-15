import React from "react";

interface StatCardProps {
  title: string;
  value: string | number | React.ReactNode;
  subtitle?: string;
  badge?: React.ReactNode;
  endpointRequirement?: string;
  icon?: React.ReactNode;
  isLoading?: boolean;
  statusColor?: "emerald" | "blue" | "amber" | "cyan" | "violet" | "neutral";
}

export function StatCard({
  title,
  value,
  subtitle,
  badge,
  endpointRequirement,
  icon,
  isLoading = false,
  statusColor = "neutral",
}: StatCardProps) {
  const accentGradients = {
    emerald: "from-emerald-500/10 to-transparent border-emerald-900/50 hover:border-emerald-700/60",
    blue: "from-blue-500/10 to-transparent border-blue-900/50 hover:border-blue-700/60",
    amber: "from-amber-500/10 to-transparent border-amber-900/50 hover:border-amber-700/60",
    cyan: "from-cyan-500/10 to-transparent border-cyan-900/50 hover:border-cyan-700/60",
    violet: "from-violet-500/10 to-transparent border-violet-900/50 hover:border-violet-700/60",
    neutral: "from-neutral-800/20 to-transparent border-neutral-800 hover:border-neutral-700",
  };

  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-gradient-to-b bg-neutral-900/90 p-5 shadow-lg backdrop-blur transition-all duration-200 ${accentGradients[statusColor]}`}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-wider text-neutral-400 uppercase">
            {title}
          </p>
          {isLoading ? (
            <div className="h-8 w-24 animate-pulse rounded bg-neutral-800" />
          ) : (
            <div className="text-2xl font-bold font-mono tracking-tight text-neutral-100">
              {value}
            </div>
          )}
        </div>
        {icon && (
          <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-neutral-400">
            {icon}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-800/80 pt-3">
        {subtitle && (
          <p className="text-xs text-neutral-400 truncate max-w-[200px]" title={subtitle}>
            {subtitle}
          </p>
        )}
        {badge && <div>{badge}</div>}
      </div>

      {endpointRequirement && (
        <div className="mt-2.5 flex items-center gap-1.5 rounded bg-neutral-950/80 px-2 py-1 text-[11px] font-mono text-neutral-500 border border-neutral-800/60">
          <span className="text-neutral-400 font-semibold">API:</span>
          <span className="truncate">{endpointRequirement}</span>
        </div>
      )}
    </div>
  );
}
