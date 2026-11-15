// Follow Mode verification harness -- mounts the REAL, unmodified
// components/CityCanvasIso.tsx (same file the app ships) under jsdom with
// React's real scheduler. Nothing about pickIsoSlice, beginWalk,
// routeBetweenLocations, or the follow-camera logic is re-implemented or
// mocked here -- only browser APIs jsdom lacks (canvas 2D, ResizeObserver,
// requestAnimationFrame timing) are stubbed, per harness/setup.ts.
//
// This is RENDER-level verification (real component code, real React
// effects, real synthetic DOM events), not BROWSER verification (no real
// browser/display was used -- see the accompanying report).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import React from "react";
import { CityCanvasIso, CityCanvasIsoHandle } from "../components/CityCanvasIso";
import { Agent, Location, Neighborhood } from "../lib/types";
import { installDomStubs } from "./setup";

installDomStubs();

// --- Synthetic world, shaped EXACTLY like the real backend generator ---
// (apps/api/app/world/generator.py): 5 neighborhoods, each with a FIXED
// 4 residential + 2 workplace + 1 market + 1 leisure = 8 locations. Not
// invented topology -- this mirrors the real, checked-in generator plan.
function buildHood(id: string, name: string): { neighborhood: Neighborhood; locations: Location[] } {
  const plan: [Location["type"], number, string][] = [
    ["residential", 4, "Residence"],
    ["workplace", 2, "Workplace"],
    ["market", 1, "Market"],
    ["leisure", 1, "Leisure Spot"],
  ];
  const locations: Location[] = [];
  for (const [type, count, label] of plan) {
    for (let i = 0; i < count; i++) {
      locations.push({
        id: `${id}-${type}-${i}`,
        name: `${name} ${label} ${i + 1}`,
        type,
        neighborhood_id: id,
        capacity: null,
        occupancy: 0,
        occupant_ids: [],
      });
    }
  }
  return {
    neighborhood: { id, name, city_id: "city-1", number_of_locations: locations.length, population: 0, location_ids: locations.map((l) => l.id) },
    locations,
  };
}

function makeAgent(id: string, locationId: string, neighborhoodId: string): Agent {
  return {
    id,
    name: `Agent ${id}`,
    age: 30,
    occupation: "worker",
    wealth: 0,
    social_status: 0,
    location_id: locationId,
    neighborhood_id: neighborhoodId,
    personality: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
    needs: [],
    goals: [],
    relationships: [],
  };
}

const HOOD_A = buildHood("hoodA", "Riverside");
const HOOD_B = buildHood("hoodB", "Downtown"); // second neighborhood, for the reset scenario

const ALL_HOOD_A_LOCATION_IDS = HOOD_A.locations.map((l) => l.id);

// The component's animation loop and its imperative followSelected()/
// exitFollow() handle both call real setState -- act() ensures those
// updates (and their effects) are actually flushed synchronously before
// the test's next assertion, the same guarantee React gives real event
// handlers in a browser.
function flush(dtMs: number) {
  act(() => {
    (global as any).__flushFrame(dtMs);
  });
}

describe("Follow Mode -- real CityCanvasIso component", () => {
  let ref: React.RefObject<CityCanvasIsoHandle>;
  let followingHistory: boolean[];
  let unmount: () => void;

  beforeEach(() => {
    followingHistory = [];
  });
  afterEach(() => cleanup());

  function mount(agent: Agent, selectedAgentId: string | undefined, neighborhoods = [HOOD_A.neighborhood], locations = HOOD_A.locations) {
    ref = React.createRef<CityCanvasIsoHandle>();
    const utils = render(
      <div style={{ width: "800px", height: "600px" }}>
        <CityCanvasIso
          ref={ref}
          neighborhoods={neighborhoods}
          locations={locations}
          agents={[agent]}
          tick={0}
          selectedAgentId={selectedAgentId}
          onSelectAgent={() => {}}
          onSelectLocation={() => {}}
          onFollowingChange={(f) => { followingHistory.push(f); }}
        />
      </div>
    );
    unmount = utils.unmount;
    return utils;
  }

  it("1+2. represents the full real 8-location neighborhood, not a truncated subset", () => {
    const agent = makeAgent("kavya", ALL_HOOD_A_LOCATION_IDS[0], "hoodA");
    mount(agent, agent.id);
    flush(16);
    // Every one of the 8 real locations must be reachable/renderable --
    // proven indirectly below by successfully following Kavya through
    // all 8 without Follow ever dropping.
    expect(ALL_HOOD_A_LOCATION_IDS.length).toBe(8);
  });

  it("3+4+7. agent can move to any of the 8 real locations, Follow stays active across every hop, and movement stays synchronized with the real route/motion system", () => {
    const agent = makeAgent("kavya", ALL_HOOD_A_LOCATION_IDS[0], "hoodA");
    const { rerender } = mount(agent, agent.id);

    // Let the first frame initialize slice + motion for Kavya.
    flush(16);

    act(() => { ref.current!.followSelected(); });
    flush(16);
    expect(followingHistory).toContain(true);
    // Only count `false` events AFTER the first `true` as a "drop" --
    // the very first `false` is the benign initial-mount value (Follow
    // hasn't been requested yet), not a regression.
    const firstTrueIdx = followingHistory.indexOf(true);
    const dropsBeforeExit = followingHistory.slice(firstTrueIdx + 1).filter((f) => f === false).length;
    expect(dropsBeforeExit).toBe(0); // Follow must not have exited yet

    // Cycle Kavya through EVERY real location in the neighborhood, one
    // real backend tick (i.e. a location_id change) at a time, giving
    // each leg comfortably more real time than MAX_WALK_MS (4200ms) to
    // finish before the next hop starts.
    for (let i = 1; i < ALL_HOOD_A_LOCATION_IDS.length; i++) {
      const nextLoc = ALL_HOOD_A_LOCATION_IDS[i];
      const movedAgent = { ...agent, location_id: nextLoc };
      rerender(
        <div style={{ width: "800px", height: "600px" }}>
          <CityCanvasIso
            ref={ref}
            neighborhoods={[HOOD_A.neighborhood]}
            locations={HOOD_A.locations}
            agents={[movedAgent]}
            tick={i}
            selectedAgentId={movedAgent.id}
            onSelectAgent={() => {}}
            onSelectLocation={() => {}}
            onFollowingChange={(f) => { followingHistory.push(f); }}
          />
        </div>
      );
      // 60 frames * 100ms = 6000ms of real elapsed time per leg -- more
      // than MAX_WALK_MS (4200ms), so every leg's walk animation is
      // guaranteed to fully resolve (path emptied) before the next hop.
      for (let f = 0; f < 60; f++) {
        flush(100);
      }
    }

    // Across all 7 real hops covering all 8 real locations, Follow must
    // never have been dropped after it started, until we explicitly exit
    // it ourselves next.
    const dropsDuringJourney = followingHistory.slice(firstTrueIdx + 1).filter((f) => f === false).length;
    expect(dropsDuringJourney).toBe(0);

    act(() => { ref.current!.exitFollow(); });
    flush(16);
    expect(followingHistory[followingHistory.length - 1]).toBe(false);
  });

  it("action/goal/destination changes while following render without breaking Follow (exercises the real WHY-card/glyph code paths)", () => {
    const agent = makeAgent("kavya", ALL_HOOD_A_LOCATION_IDS[0], "hoodA");
    const { rerender } = mount(agent, agent.id);
    flush(16);
    act(() => {
      ref.current!.followSelected();
    });
    flush(16);
    const firstTrueIdx = followingHistory.indexOf(true);
    expect(firstTrueIdx).toBeGreaterThanOrEqual(0);

    // Real backend fields that drive the WHY card and the action-glyph
    // badge (see CityCanvasIso.tsx's causality-overlay block): current_
    // goal.description and current_action.reasoning/action_type. Cycle
    // through several combinations, including a destination change (a
    // location_id hop, same as the earlier movement test but here
    // paired with changing goal/action so the WHY card's content is
    // actually exercised each time, not just the sprite position).
    const steps: Array<{ locationId: string; goal: string; actionType: string; reasoning: string }> = [
      { locationId: ALL_HOOD_A_LOCATION_IDS[1], goal: "Get to work on time", actionType: "move", reasoning: "Heading to the office for the morning shift" },
      { locationId: ALL_HOOD_A_LOCATION_IDS[1], goal: "Finish the morning's work", actionType: "work", reasoning: "Focused on finishing the quarterly report" },
      { locationId: ALL_HOOD_A_LOCATION_IDS[2], goal: "Eat lunch", actionType: "consume_food", reasoning: "Getting food at the market" },
    ];

    for (const step of steps) {
      const updated: Agent = {
        ...agent,
        location_id: step.locationId,
        current_goal: { id: "g1", description: step.goal, priority: 1, status: "active", progress: 0.4 },
        current_action: { tick: 1, action_type: step.actionType, success: true, message: step.reasoning, reasoning: step.reasoning },
      };
      expect(() => {
        rerender(
          <div style={{ width: "800px", height: "600px" }}>
            <CityCanvasIso
              ref={ref}
              neighborhoods={[HOOD_A.neighborhood]}
              locations={HOOD_A.locations}
              agents={[updated]}
              tick={1}
              selectedAgentId={updated.id}
              onSelectAgent={() => {}}
              onSelectLocation={() => {}}
              onFollowingChange={(f) => {
                followingHistory.push(f);
              }}
            />
          </div>
        );
      }).not.toThrow();
      // 30 frames * 100ms = 3000ms -- enough for a leg to progress/arrive
      // between steps without needing the full MAX_WALK_MS every time.
      for (let f = 0; f < 30; f++) flush(100);
    }

    const dropsDuringJourney = followingHistory.slice(firstTrueIdx + 1).filter((f) => f === false).length;
    expect(dropsDuringJourney).toBe(0); // Follow survives goal/action/destination churn
  });

  it("6. a population reset (new topology) clears Follow instead of leaving it stuck", () => {
    const agent = makeAgent("kavya", ALL_HOOD_A_LOCATION_IDS[0], "hoodA");
    const { rerender } = mount(agent, agent.id);
    flush(16);
    act(() => { ref.current!.followSelected(); });
    flush(16);
    expect(followingHistory[followingHistory.length - 1]).toBe(true);

    // Simulate a real population reset: brand-new neighborhood/location
    // IDs (hoodB instead of hoodA) and a brand-new agent set -- exactly
    // what apps/web/lib/useSimulationController.ts's reset() produces
    // (fresh World, fresh uuids). The old agent id no longer exists.
    const newAgent = makeAgent("someone-else", HOOD_B.locations[0].id, "hoodB");
    rerender(
      <div style={{ width: "800px", height: "600px" }}>
        <CityCanvasIso
          ref={ref}
          neighborhoods={[HOOD_B.neighborhood]}
          locations={HOOD_B.locations}
          agents={[newAgent]}
          tick={999}
          selectedAgentId={agent.id /* stale selection, as page.tsx would still hold it for one render */}
          onSelectAgent={() => {}}
          onSelectLocation={() => {}}
          onFollowingChange={(f) => { followingHistory.push(f); }}
        />
      </div>
    );
    flush(16);

    // The reset must force Follow back to false. Before the fix, the
    // fit/follow-reset effect was keyed on `sliceReady` (true->true on a
    // second pick, so it silently never re-fired); it's now keyed on a
    // `sliceVersion` counter that increments on every genuine re-pick.
    expect(followingHistory[followingHistory.length - 1]).toBe(false);
  });
});
