"""
Phase 0 smoke test.

Purpose: prove the test pipeline itself works, and that SimulationEngine
boots and its lifecycle methods run without throwing on the empty
Phase 0 skeleton. This test intentionally does NOT assert anything
about simulation behavior (there isn't any yet) -- that begins in
Phase 2+.
"""

from app.core.config import SimulationProfile
from app.simulation.engine import SimulationEngine


def test_engine_boots_with_default_seed():
    engine = SimulationEngine()
    assert engine.status == "initialized"
    assert engine.seed is not None


def test_engine_lifecycle_does_not_throw():
    engine = SimulationEngine(seed=42, profile=SimulationProfile.DEV)

    engine.start()
    assert engine.status == "running"

    tick = engine.step()
    assert tick == 1

    tick = engine.step()
    assert tick == 2

    engine.pause()
    assert engine.status == "paused"

    engine.resume()
    assert engine.status == "running"

    engine.stop()
    assert engine.status == "stopped"

    engine.reset()
    assert engine.status == "initialized"
    assert engine.clock.current_tick == 0


def test_dev_profile_uses_small_population():
    engine = SimulationEngine(profile=SimulationProfile.DEV)
    assert 10 <= engine.population_size <= 20


def test_mvp_profile_targets_100_agents():
    engine = SimulationEngine(profile=SimulationProfile.MVP)
    assert engine.population_size == 100


def test_rng_is_deterministic_for_same_seed():
    from app.core.rng import SimulationRNG

    rng_a = SimulationRNG(seed=7)
    rng_b = SimulationRNG(seed=7)

    sequence_a = [rng_a.random() for _ in range(5)]
    sequence_b = [rng_b.random() for _ in range(5)]

    assert sequence_a == sequence_b
