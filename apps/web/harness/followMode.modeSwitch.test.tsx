// Item 5 verification: "switching between 2D / Iso / 3D does not leave
// stale Follow state."
//
// HONESTY NOTE (see report): the actual fix lives inline in
// app/(dashboard)/city/page.tsx, which calls useSimulationController()
// and fetches live data on mount -- not practical to mount directly in
// this harness without a running backend. Rather than skip item 5, this
// test verbatim-copies the exact 3 reset effects added to page.tsx
// (the `renderMode !== "..."` guards) into a minimal stand-in component
// with the same state shape, and drives it with React's real scheduler.
// This proves the *logic* is correct under real React effect semantics;
// it does not prove page.tsx's wiring of that logic is byte-identical
// (a code review of the actual diff, included in the report, covers
// that). This is disclosed here and in the report as RENDER VERIFIED at
// the extracted-logic level, not full-page level.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import React, { useEffect, useState } from "react";

type RenderMode = "2d" | "3d" | "iso";

// Verbatim copy of the 3 effects added/fixed in page.tsx.
function ModeSwitchFollowState({
  renderMode,
  onSnapshot,
}: {
  renderMode: RenderMode;
  onSnapshot: (s: { followedAgentId: string | null; followingIn2D: boolean; followingInIso: boolean }) => void;
}) {
  const [followedAgentId, setFollowedAgentId] = useState<string | null>("some-agent-id");
  const [followingIn2D, setFollowingIn2D] = useState(false);
  const [followingInIso, setFollowingInIso] = useState(false);

  // Simulate the 3D view having been actively followed before switching
  // away, and each 2D/Iso view too, by seeding true on first mount only
  // (mirrors "the user was actively following when they clicked another
  // tab").
  useEffect(() => {
    setFollowedAgentId("some-agent-id");
    setFollowingIn2D(true);
    setFollowingInIso(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (renderMode !== "3d") setFollowedAgentId(null);
  }, [renderMode]);
  useEffect(() => {
    if (renderMode !== "2d") setFollowingIn2D(false);
  }, [renderMode]);
  useEffect(() => {
    if (renderMode !== "iso") setFollowingInIso(false);
  }, [renderMode]);

  useEffect(() => {
    onSnapshot({ followedAgentId, followingIn2D, followingInIso });
  });

  return null;
}

describe("Follow Mode -- mode-switch stale-state reset (page.tsx logic, verbatim-copied)", () => {
  afterEach(() => cleanup());

  it("switching Iso -> 2D clears followingInIso instead of leaving it stuck true", () => {
    let latest: any = null;
    const { rerender } = render(
      <ModeSwitchFollowState renderMode="iso" onSnapshot={(s) => (latest = s)} />
    );
    expect(latest.followingInIso).toBe(true); // was actively following in Iso

    act(() => {
      rerender(<ModeSwitchFollowState renderMode="2d" onSnapshot={(s) => (latest = s)} />);
    });
    // Before the fix, nothing reset followingInIso when leaving "iso" --
    // it would still read `true` here.
    expect(latest.followingInIso).toBe(false);
  });

  it("switching 2D -> 3D clears followingIn2D", () => {
    let latest: any = null;
    const { rerender } = render(
      <ModeSwitchFollowState renderMode="2d" onSnapshot={(s) => (latest = s)} />
    );
    expect(latest.followingIn2D).toBe(true);
    // Mounting directly in 2D mode also exercises the pre-existing 3D
    // reset pattern (`renderMode !== "3d"`), which fires immediately on
    // this same mount and nulls followedAgentId -- correct, since you
    // can't be "following in 3D" the instant you've loaded in 2D.
    expect(latest.followedAgentId).toBe(null);

    act(() => {
      rerender(<ModeSwitchFollowState renderMode="3d" onSnapshot={(s) => (latest = s)} />);
    });
    expect(latest.followingIn2D).toBe(false);
  });

  it("switching away from 3D clears followedAgentId (pre-existing pattern, still correct)", () => {
    let latest: any = null;
    const { rerender } = render(
      <ModeSwitchFollowState renderMode="3d" onSnapshot={(s) => (latest = s)} />
    );
    expect(latest.followedAgentId).toBe("some-agent-id"); // valid while actually in 3D

    act(() => {
      rerender(<ModeSwitchFollowState renderMode="2d" onSnapshot={(s) => (latest = s)} />);
    });
    expect(latest.followedAgentId).toBe(null);
  });

  it("round-trip Iso -> 2D -> Iso does not resurrect stale `true`", () => {
    let latest: any = null;
    const { rerender } = render(
      <ModeSwitchFollowState renderMode="iso" onSnapshot={(s) => (latest = s)} />
    );
    act(() => {
      rerender(<ModeSwitchFollowState renderMode="2d" onSnapshot={(s) => (latest = s)} />);
    });
    expect(latest.followingInIso).toBe(false);

    act(() => {
      rerender(<ModeSwitchFollowState renderMode="iso" onSnapshot={(s) => (latest = s)} />);
    });
    // Re-entering Iso should NOT come back as "already following" just
    // because it once was, before the previous unmount.
    expect(latest.followingInIso).toBe(false);
  });
});
