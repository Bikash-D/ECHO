"""
Clock: owns the current tick counter for a simulation run.

Phase 0: structure only. Tick-advance side effects (triggering the
agent loop, event resolution, etc.) are wired in Phase 2.
"""

from __future__ import annotations


class Clock:
    def __init__(self, start_tick: int = 0) -> None:
        self.current_tick = start_tick

    def advance(self) -> int:
        """
        Advance to the next tick and return the new tick number.

        Phase 0: increments only. No hooks into the engine's tick
        lifecycle (perception, decision, action resolution) yet --
        those are wired in Phase 2 per the tick lifecycle diagram in
        docs/architecture.md.
        """
        self.current_tick += 1
        return self.current_tick

    def reset(self, start_tick: int = 0) -> None:
        self.current_tick = start_tick
