import React from "react";
import { Agent } from "../lib/types";

interface AgentSpriteProps {
  agent: Agent;
  onClick: (agent: Agent) => void;
  isSelected?: boolean;
  size?: "sm" | "md" | "lg";
}

const OCCUPATION_COLORS: Record<string, { bg: string; border: string; text: string; emoji: string }> = {
  farmer: { bg: "bg-amber-900/60", border: "border-amber-600", text: "text-amber-300", emoji: "🌾" },
  trader: { bg: "bg-emerald-900/60", border: "border-emerald-500", text: "text-emerald-300", emoji: "⚖️" },
  artisan: { bg: "bg-purple-900/60", border: "border-purple-500", text: "text-purple-300", emoji: "🎨" },
  laborer: { bg: "bg-orange-900/60", border: "border-orange-500", text: "text-orange-300", emoji: "🔨" },
  clerk: { bg: "bg-blue-900/60", border: "border-blue-500", text: "text-blue-300", emoji: "👔" },
  healer: { bg: "bg-rose-900/60", border: "border-rose-500", text: "text-rose-300", emoji: "🩺" },
  unemployed: { bg: "bg-neutral-800/80", border: "border-neutral-600", text: "text-neutral-300", emoji: "🚶" },
};

export function AgentSprite({
  agent,
  onClick,
  isSelected = false,
  size = "md",
}: AgentSpriteProps) {
  const occ = OCCUPATION_COLORS[agent.occupation.toLowerCase()] || OCCUPATION_COLORS.unemployed;

  const sizeClasses = {
    sm: "h-6 w-6 text-[10px]",
    md: "h-8 w-8 text-xs",
    lg: "h-11 w-11 text-sm",
  };

  const nameInitials = agent.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(agent);
      }}
      className={`group relative flex items-center justify-center rounded-full border shadow-md transition-all duration-150 transform hover:scale-125 hover:z-30 cursor-pointer ${
        sizeClasses[size]
      } ${occ.bg} ${occ.border} ${
        isSelected
          ? "ring-2 ring-cyan-400 ring-offset-2 ring-offset-neutral-950 scale-125 z-20 border-cyan-300"
          : "hover:border-white"
      }`}
      title={`${agent.name} (${agent.age}yo ${agent.occupation}) - Wealth: $${agent.wealth}`}
    >
      <span className="font-mono font-bold tracking-tight text-white select-none">
        {nameInitials}
      </span>

      {/* Mini occupation badge */}
      <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-neutral-900 border border-neutral-700 text-[8px]">
        {occ.emoji}
      </span>

      {/* Hover floating nameplate */}
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col items-center rounded-md border border-neutral-700 bg-neutral-950/95 px-2 py-1 text-center shadow-xl backdrop-blur-sm z-40 whitespace-nowrap">
        <span className="text-[11px] font-bold text-neutral-100">{agent.name}</span>
        <span className="text-[9px] font-mono text-neutral-400">
          {agent.age}yo • {agent.occupation} • ${agent.wealth}
        </span>
      </div>
    </button>
  );
}
