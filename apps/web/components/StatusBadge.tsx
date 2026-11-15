import React from "react";

export type StatusVariant =
  | "online"
  | "offline"
  | "connecting"
  | "running"
  | "paused"
  | "stopped"
  | "initialized"
  | "standby"
  | "pending"
  | "dev"
  | "mvp";

interface StatusBadgeProps {
  variant: StatusVariant;
  label?: string;
  pulse?: boolean;
  size?: "sm" | "md";
}

const VARIANT_CONFIGS: Record<
  StatusVariant,
  { bg: string; text: string; dot: string; defaultLabel: string; border: string }
> = {
  online: {
    bg: "bg-emerald-950/60",
    text: "text-emerald-300",
    dot: "bg-emerald-400",
    border: "border-emerald-800/60",
    defaultLabel: "ONLINE",
  },
  offline: {
    bg: "bg-rose-950/60",
    text: "text-rose-300",
    dot: "bg-rose-400",
    border: "border-rose-800/60",
    defaultLabel: "OFFLINE",
  },
  connecting: {
    bg: "bg-amber-950/60",
    text: "text-amber-300",
    dot: "bg-amber-400",
    border: "border-amber-800/60",
    defaultLabel: "CONNECTING",
  },
  running: {
    bg: "bg-cyan-950/60",
    text: "text-cyan-300",
    dot: "bg-cyan-400",
    border: "border-cyan-800/60",
    defaultLabel: "RUNNING",
  },
  paused: {
    bg: "bg-amber-950/60",
    text: "text-amber-300",
    dot: "bg-amber-400",
    border: "border-amber-800/60",
    defaultLabel: "PAUSED",
  },
  stopped: {
    bg: "bg-neutral-900",
    text: "text-neutral-400",
    dot: "bg-neutral-500",
    border: "border-neutral-700",
    defaultLabel: "STOPPED",
  },
  initialized: {
    bg: "bg-blue-950/60",
    text: "text-blue-300",
    dot: "bg-blue-400",
    border: "border-blue-800/60",
    defaultLabel: "INITIALIZED",
  },
  standby: {
    bg: "bg-violet-950/60",
    text: "text-violet-300",
    dot: "bg-violet-400",
    border: "border-violet-800/60",
    defaultLabel: "STANDBY",
  },
  pending: {
    bg: "bg-amber-950/40",
    text: "text-amber-400",
    dot: "bg-amber-500",
    border: "border-amber-700/50",
    defaultLabel: "PHASE PENDING",
  },
  dev: {
    bg: "bg-indigo-950/60",
    text: "text-indigo-300",
    dot: "bg-indigo-400",
    border: "border-indigo-800/60",
    defaultLabel: "PROFILE: DEV",
  },
  mvp: {
    bg: "bg-purple-950/60",
    text: "text-purple-300",
    dot: "bg-purple-400",
    border: "border-purple-800/60",
    defaultLabel: "PROFILE: MVP",
  },
};

export function StatusBadge({
  variant,
  label,
  pulse = false,
  size = "sm",
}: StatusBadgeProps) {
  const config = VARIANT_CONFIGS[variant] || VARIANT_CONFIGS.standby;
  const displayLabel = label || config.defaultLabel;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-mono font-medium tracking-wider uppercase ${
        config.bg
      } ${config.text} ${config.border} ${
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${config.dot} ${
          pulse ? "animate-ping" : ""
        }`}
      />
      {displayLabel}
    </span>
  );
}
