"use client";

/**
 * Self-contained simulation polling/control hook for the City page.
 *
 * Deliberately NOT shared with apps/web/app/(dashboard)/world/page.tsx --
 * that page already has this exact load/auto-play logic working and
 * tested by hand; refactoring it to share a hook would touch a page this
 * milestone was told not to break, for no functional benefit. A few dozen
 * duplicated lines here is a smaller, safer footprint than a shared
 * abstraction that risks the existing dashboard.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchWorld,
  pauseSimulation,
  resetSimulation,
  startSimulation,
  stepSimulation,
} from "./api";
import { AgentDelta, CityActivityEvent, WorldResponse } from "./types";
import { diffWorldSnapshots } from "./activityFeed";

// How many activity feed rows to keep around (Step 6 asks for "perhaps
// the latest 10-20").
const MAX_ACTIVITY_EVENTS = 20;

export function useSimulationController() {
  const [world, setWorld] = useState<WorldResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Previous real snapshot, kept purely to diff against the next one --
  // see lib/activityFeed.ts. Not exposed; only its diff output is.
  const prevWorldRef = useRef<WorldResponse | null>(null);
  const [activityEvents, setActivityEvents] = useState<CityActivityEvent[]>([]);
  // Latest real per-agent delta, keyed by agent id, cleared once the tick
  // that produced it has passed (so the canvas only ever shows a
  // currently-true causality annotation, not a stale one).
  const [latestDeltas, setLatestDeltas] = useState<Map<string, AgentDelta>>(new Map());

  const loadWorld = useCallback(async () => {
    const { data, error: err } = await fetchWorld();
    if (data) {
      const { events, deltas } = diffWorldSnapshots(prevWorldRef.current, data);
      if (events.length > 0) {
        setActivityEvents((prevEvents) => [...events, ...prevEvents].slice(0, MAX_ACTIVITY_EVENTS));
      }
      if (deltas.length > 0) {
        setLatestDeltas(new Map(deltas.map((d) => [d.agentId, d])));
      } else {
        setLatestDeltas(new Map());
      }
      prevWorldRef.current = data;
      setWorld(data);
      setError(null);
    } else {
      setError(err);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadWorld();
  }, [loadWorld]);

  useEffect(() => {
    if (isPlaying) {
      // Floor was 100ms, letting the 10x speed option poll the backend 10
      // times/second. CityCanvas's walk animation (see WALK_SPEED) can't
      // visually resolve a tick that fast for cross-district trips, so at
      // high speeds agents' targets kept getting reassigned mid-walk faster
      // than the animation could show any single trip completing -- this
      // read as "moving extremely fast" and unreadable, not as a faster
      // simulation. 250ms keeps every available speed multiplier inside a
      // rate the walk animation can actually keep up with.
      const interval = Math.max(250, 1000 / speed);
      playIntervalRef.current = setInterval(async () => {
        await stepSimulation();
        await loadWorld();
      }, interval);
    } else if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [isPlaying, speed, loadWorld]);

  const step = async () => {
    await stepSimulation();
    await loadWorld();
  };

  const start = async () => {
    await startSimulation();
    setIsPlaying(true);
    await loadWorld();
  };

  const pause = async () => {
    setIsPlaying(false);
    await pauseSimulation();
    await loadWorld();
  };

  const reset = async () => {
    setIsPlaying(false);
    await resetSimulation();
    // A reset starts a fresh world -- the old snapshot is no longer a
    // valid "before" state to diff against (would otherwise report every
    // agent's spawn position as a fabricated "move").
    prevWorldRef.current = null;
    setActivityEvents([]);
    setLatestDeltas(new Map());
    await loadWorld();
  };

  return {
    world,
    error,
    isLoading,
    isPlaying,
    speed,
    setSpeed,
    loadWorld,
    step,
    start,
    pause,
    reset,
    activityEvents,
    latestDeltas,
  };
}
