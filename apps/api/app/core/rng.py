"""
The single source of randomness for ECHO.

ARCHITECTURAL RULE (see docs/architecture.md, Section 9):
No code in `simulation/`, `agents/`, `economy/`, `society/`, or anywhere
else in this codebase may call `random.random()`, `random.choice()`,
NumPy's global RNG, or any other unseeded randomness source directly.

Every random decision -- agent iteration order, utility-model tie
breaking, stochastic event outcomes, etc. -- must go through a
`SimulationRNG` instance that was constructed from the simulation's
seed. This is what makes reproducibility (Section 31 of the original
spec) actually enforceable rather than aspirational.

Phase 0 defines the contract only. No simulation code calls this yet.
"""

from __future__ import annotations

import random


class SimulationRNG:
    """
    Thin wrapper around `random.Random` scoped to a single simulation run.

    One instance is created per `Simulation` (from its seed) and threaded
    through the engine to anything that needs randomness. Never
    instantiate this with no seed in simulation code -- an explicit
    seed is required so every call site is auditable.
    """

    def __init__(self, seed: int) -> None:
        self.seed = seed
        self._rng = random.Random(seed)

    def random(self) -> float:
        """Uniform float in [0, 1)."""
        return self._rng.random()

    def randint(self, a: int, b: int) -> int:
        """Random integer N such that a <= N <= b."""
        return self._rng.randint(a, b)

    def choice(self, seq):
        """Choose a single element from a non-empty sequence."""
        return self._rng.choice(seq)

    def shuffle(self, seq: list) -> None:
        """In-place shuffle, used for seeded agent iteration order per tick."""
        self._rng.shuffle(seq)

    def sample(self, population, k: int) -> list:
        """K unique elements chosen from population, without replacement."""
        return self._rng.sample(population, k)

    def uuid(self) -> uuid.UUID:
        """Generate a deterministic UUID derived from this RNG stream."""
        import uuid
        return uuid.UUID(int=self._rng.getrandbits(128), version=4)

    def spawn_child(self, label: str) -> "SimulationRNG":
        """
        Derive a new, deterministic-but-independent RNG stream for a
        sub-system (e.g. 'economy', 'memory-retrieval') so different
        subsystems don't consume from the same stream and accidentally
        become order-dependent on each other's call counts.

        Deterministic given (seed, label): same inputs always produce
        the same child seed.
        """
        derived_seed = hash((self.seed, label)) & 0xFFFFFFFF
        return SimulationRNG(derived_seed)
