"""
SimulationEngine: the core orchestrator.

Owns Clock, EventQueue, InterventionController, and (in later phases)
the World and AgentRegistry. Must be usable as a plain Python object
from a headless script -- apps/api/app/api/routes/ is a thin consumer
of this class, never the reverse (see architecture.md Section 4,
module dependency rule).

Phase 0: class shape and lifecycle method signatures only, per the
Phase 0 definition of done. No tick logic (perception / decision /
action resolution) is implemented yet -- that begins in Phase 2.
"""

from __future__ import annotations

from app.core.config import SimulationProfile, get_settings
from app.core.rng import SimulationRNG
from app.simulation.clock import Clock
from app.simulation.event_queue import EventQueue
from app.simulation.intervention_controller import InterventionController


class SimulationEngine:
    def __init__(
        self,
        seed: int | None = None,
        profile: SimulationProfile | None = None,
    ) -> None:
        settings = get_settings()
        self.seed = seed if seed is not None else settings.default_seed
        self.profile = profile if profile is not None else settings.simulation_profile

        self.rng = SimulationRNG(self.seed)
        self.clock = Clock()
        self.event_queue = EventQueue()
        self.intervention_controller = InterventionController()

        self._status = "initialized"

        # World / AgentRegistry are introduced in Phase 1 (DB models)
        # and Phase 2 (engine wiring) respectively. Deliberately absent
        # in Phase 0.

    @property
    def status(self) -> str:
        return self._status

    def start(self) -> None:
        """
        Transition the simulation to running.

        Phase 0: status transition only. No agent population is
        generated and no ticks are processed -- that begins once
        Phase 1 (models) and Phase 3 (agents) exist.
        """
        self._status = "running"

    def pause(self) -> None:
        self._status = "paused"

    def resume(self) -> None:
        if self._status != "paused":
            raise RuntimeError(
                f"Cannot resume from status '{self._status}'; must be 'paused'."
            )
        self._status = "running"

    def step(self) -> int:
        """
        Advance the simulation by exactly one tick and return the new
        tick number.

        Phase 0: advances the Clock only. The full tick lifecycle
        (world mutation application, per-agent perceive/decide/act,
        batch effect resolution, persistence) described in
        docs/architecture.md Section 5 is NOT implemented yet -- it is
        built incrementally across Phases 2-8.
        """
        return self.clock.advance()

    def stop(self) -> None:
        self._status = "stopped"

    def reset(self) -> None:
        """
        Return the engine to its initial state for the same seed/profile.

        Phase 0: resets Clock, EventQueue, and RNG only. Once World and
        AgentRegistry exist (Phase 1+), reset() must also regenerate
        or reload the initial population deterministically from the
        same seed -- that behavior is added alongside those phases,
        not here.
        """
        self.clock.reset()
        self.event_queue.clear()
        self.rng = SimulationRNG(self.seed)
        self._status = "initialized"

    @property
    def population_size(self) -> int:
        """
        Agent count implied by the active profile (10-20 for DEV,
        100 for MVP). Not yet connected to any actual agent generation
        -- that lands in Phase 3.
        """
        from app.core.config import PROFILE_POPULATION_SIZES

        return PROFILE_POPULATION_SIZES[self.profile]
