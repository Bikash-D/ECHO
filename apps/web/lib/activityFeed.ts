/**
 * Derives real activity-feed events and causality deltas by diffing two
 * consecutive /api/world snapshots.
 *
 * Why diffing instead of a backend event stream: apps/api/app/simulation
 * /event_queue.py is a Phase-0 stub (its own docstring says so) that
 * always returns an empty pending list -- there is no real backend
 * event/delta feed to subscribe to yet. Rather than fabricate one, this
 * module treats each /api/world response as a full snapshot of ground
 * truth and reports only what verifiably changed between two of them:
 * location_id changes, current_action changes, and numeric deltas in
 * wealth/needs. Nothing here is invented -- an agent with no change
 * produces no event.
 *
 * Pure and framework-free so it is trivially testable in isolation from
 * React.
 */

import { Agent, AgentDelta, CityActivityEvent, Location, WorldResponse } from "./types";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function locationName(locations: Location[], id: string): string {
  return locations.find((l) => l.id === id)?.name ?? "an unknown location";
}

function needValue(agent: Agent, needType: string): number | undefined {
  return agent.needs.find((n) => n.need_type.toLowerCase() === needType.toLowerCase())?.value;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

const ACTION_VERBS: Record<string, string> = {
  work: "started working",
  consume_food: "bought food",
  rest: "started resting",
  socialize: "started socializing",
  move: "started moving",
  idle: "went idle",
};

const SOCIAL_ACTIONS = new Set(["socialize"]);
const ECONOMY_ACTIONS = new Set(["work", "consume_food"]);

export interface DiffResult {
  events: CityActivityEvent[];
  deltas: AgentDelta[];
}

/**
 * Compare `prev` (the snapshot before this tick) against `next` (the
 * snapshot just fetched) and produce the real events/deltas implied by
 * what actually changed. `prev` is null on the very first load (nothing
 * to diff against yet -- returns no events, which is correct: we don't
 * know what "before" looked like).
 */
export function diffWorldSnapshots(prev: WorldResponse | null, next: WorldResponse): DiffResult {
  const events: CityActivityEvent[] = [];
  const deltas: AgentDelta[] = [];
  if (!prev) return { events, deltas };

  const prevAgentsById = new Map(prev.agents.map((a) => [a.id, a]));

  for (const agent of next.agents) {
    const before = prevAgentsById.get(agent.id);
    if (!before) continue; // agent didn't exist in prior snapshot (shouldn't happen mid-run, but be safe)

    // --- Movement: location_id actually changed on the backend. ---
    if (before.location_id !== agent.location_id) {
      const fromName = locationName(prev.locations, before.location_id);
      const toName = locationName(next.locations, agent.location_id);
      events.push({
        id: nextId("evt"),
        tick: next.tick,
        category: "MOVEMENT",
        agentId: agent.id,
        agentName: agent.name,
        message: `${agent.name} moved from ${fromName} to ${toName}`,
      });
    }

    // --- Action change: current_action.action_type actually changed. ---
    const beforeAction = before.current_action?.action_type;
    const afterAction = agent.current_action?.action_type;
    if (afterAction && afterAction !== beforeAction) {
      const verb = ACTION_VERBS[afterAction] ?? `began ${afterAction.replace(/_/g, " ")}`;
      const category: CityActivityEvent["category"] = SOCIAL_ACTIONS.has(afterAction)
        ? "SOCIAL"
        : ECONOMY_ACTIONS.has(afterAction)
        ? "ECONOMY"
        : "ACTION";

      // Real before/after deltas for the two actions the brief calls out
      // explicitly (buying food, working) -- only included when both
      // values are actually present in the two snapshots.
      let detail: string | undefined;
      if (afterAction === "consume_food") {
        const wealthDelta = agent.wealth - before.wealth;
        const hungerBefore = needValue(before, "hunger");
        const hungerAfter = needValue(agent, "hunger");
        const parts: string[] = [];
        if (wealthDelta !== 0) parts.push(`$${Math.abs(wealthDelta).toFixed(2)} spent`);
        if (hungerBefore !== undefined && hungerAfter !== undefined && hungerBefore !== hungerAfter) {
          parts.push(`Hunger ${pct(hungerBefore)} \u2192 ${pct(hungerAfter)}`);
        }
        if (parts.length > 0) detail = parts.join(" \u00b7 ");
      } else if (afterAction === "work") {
        const wageDelta = agent.wealth - before.wealth;
        const parts: string[] = [];
        if (wageDelta !== 0) parts.push(`${wageDelta > 0 ? "+" : ""}$${wageDelta.toFixed(2)} wage`);
        if (parts.length > 0) detail = parts.join(" \u00b7 ");
      } else if (afterAction === "rest") {
        const energyBefore = needValue(before, "energy");
        const energyAfter = needValue(agent, "energy");
        if (energyBefore !== undefined && energyAfter !== undefined && energyBefore !== energyAfter) {
          detail = `Energy ${pct(energyBefore)} \u2192 ${pct(energyAfter)}`;
        }
      } else if (afterAction === "socialize") {
        const socialBefore = needValue(before, "social");
        const socialAfter = needValue(agent, "social");
        if (socialBefore !== undefined && socialAfter !== undefined && socialBefore !== socialAfter) {
          detail = `Social ${pct(socialBefore)} \u2192 ${pct(socialAfter)}`;
        }
      }

      events.push({
        id: nextId("evt"),
        tick: next.tick,
        category,
        agentId: agent.id,
        agentName: agent.name,
        message: `${agent.name} ${verb}`,
        detail,
      });

      if (detail) {
        deltas.push({ tick: next.tick, agentId: agent.id, label: detail });
      }
    }

    // --- Goal formed/changed: current_goal actually changed on the
    // backend (V4.4 -- causality). agent.current_goal is a real field
    // already present on every /api/world snapshot; this was previously
    // fetched but never diffed, so goal formation was invisible outside
    // the profile drawer. Compared by id (falls back to description, in
    // case a backend revision ever omits id) so a goal merely continuing
    // across ticks doesn't re-fire every snapshot. ---
    const beforeGoalKey = before.current_goal?.id ?? before.current_goal?.description;
    const afterGoalKey = agent.current_goal?.id ?? agent.current_goal?.description;
    if (agent.current_goal && afterGoalKey && afterGoalKey !== beforeGoalKey) {
      const label = `Goal \u2192 ${agent.current_goal.description}`;
      events.push({
        id: nextId("evt"),
        tick: next.tick,
        category: "GOAL",
        agentId: agent.id,
        agentName: agent.name,
        message: `${agent.name} formed a new goal: ${agent.current_goal.description}`,
      });
      // Reuses the same transient per-agent delta the canvas already
      // renders next to an agent for the tick it lands on (see
      // CityCanvas.tsx's `delta` param) -- no new rendering plumbing
      // needed for this to show up in-world. If an action-change delta
      // for the same agent lands the same tick, that one wins the single
      // deltas-by-agentId slot below (last write in loadWorld's Map
      // construction); this only affects which one flashes for that one
      // tick, not correctness -- both events are still in the feed.
      deltas.push({ tick: next.tick, agentId: agent.id, label });
    }
  }

  return { events, deltas };
}
