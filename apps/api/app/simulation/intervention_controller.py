"""
InterventionController: the Researcher/God Mode entry point.

This is the ONLY component permitted to accept intervention requests
from outside the simulation (API layer) and translate them into
WorldMutations. See architecture.md Section 7 for the full rationale.

Phase 0: structure only, matching the five intervention types defined
in app/schemas/intervention.py. No application to World state yet --
that's Phase 8, sequenced deliberately after Events so the same
WorldMutation application path is reused rather than duplicated.

No UI/endpoint wiring in Phase 0 (per architecture.md Section 8, MVP
scope: "God Mode backend, no UI").
"""

from __future__ import annotations

from typing import Any

from app.schemas.intervention import InterventionBase
from app.schemas.world_mutation import WorldMutation


class InterventionController:
    def __init__(self) -> None:
        self._log: list[InterventionBase] = []

    def submit(self, intervention: InterventionBase) -> WorldMutation:
        """
        Accept a researcher-issued intervention and translate it into
        a WorldMutation for the engine to apply.

        Phase 0: records the intervention and returns a structurally
        valid but inert WorldMutation. Real per-type translation
        logic (price shock -> price WorldMutation, etc.) is
        implemented in Phase 8.
        """
        self._log.append(intervention)
        return WorldMutation(
            target=self._target_for(intervention),
            scope="not_yet_implemented",
            params={},
            start_tick=intervention.start_tick,
            duration=intervention.duration,
            source="intervention",
            source_id=str(id(intervention)),
        )

    def history(self) -> list[InterventionBase]:
        """Full audit trail of interventions submitted this run."""
        return list(self._log)

    @staticmethod
    def _target_for(intervention: InterventionBase) -> Any:
        """
        Phase 0 placeholder mapping. Real mapping from each
        InterventionType to a MutationTarget is implemented in Phase 8
        alongside the application logic itself.
        """
        from app.schemas.world_mutation import MutationTarget

        return MutationTarget.PRICE
