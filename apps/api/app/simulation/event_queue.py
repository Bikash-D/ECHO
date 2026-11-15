"""
EventQueue: holds scripted Events pending application to the world.

Phase 0: structure only. Actual event scheduling/resolution against
World state is implemented in Phase 8, per architecture.md.
"""

from __future__ import annotations

from typing import Any


class EventQueue:
    def __init__(self) -> None:
        self._pending: list[Any] = []

    def schedule(self, event: Any) -> None:
        """
        Queue an event for future application.

        Phase 0: stores the event with no validation or scheduling
        logic. Real implementation (start_tick/duration handling,
        ordering) lands in Phase 8.
        """
        self._pending.append(event)

    def pending_for_tick(self, tick: int) -> list[Any]:
        """
        Return events that should be applied at the given tick.

        Phase 0: always returns an empty list -- no scheduling logic
        exists yet. Signature is fixed now so SimulationEngine can be
        written against it without changing later.
        """
        return []

    def clear(self) -> None:
        self._pending = []
