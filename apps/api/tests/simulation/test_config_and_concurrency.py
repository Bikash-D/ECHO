"""
Regression tests for two bugs found during the "Cannot Reach Echo City"
investigation:

1. Config drift: get_simulation_service() used to hardcode
   population_size=100, ignoring settings.simulation_profile /
   settings.population_size entirely. That let /api/health report a
   different profile/population than the live SimulationService backing
   /api/world and /api/simulation/*.

2. Thread-safety: SimulationService is a process-wide singleton mutated
   by plain `def` FastAPI routes, which Starlette runs concurrently in a
   threadpool. Without locking, a reset() racing an in-flight step() could
   hand PerceptionSystem.perceive() an agent whose location_id belongs to
   the *previous* World (Location ids are uuid4-random per world/agents
   generator, not seed-derived), which raises an uncaught ValueError ->
   bare HTTP 500.
"""

from __future__ import annotations

import threading

from app.core.config import Settings, SimulationProfile
from app.simulation.state import SimulationService


def test_simulation_service_population_matches_settings_population_size():
    """
    SimulationService must never hardcode a population size independent
    of Settings.population_size -- that duplication is exactly what
    caused the MVP/100 vs DEV/15 split reported in the field.
    """
    settings = Settings(simulation_profile=SimulationProfile.MVP)
    service = SimulationService(seed=settings.default_seed, population_size=settings.population_size)
    assert len(service.agents) == settings.population_size == 100

    dev_settings = Settings(simulation_profile=SimulationProfile.DEV)
    dev_service = SimulationService(seed=dev_settings.default_seed, population_size=dev_settings.population_size)
    assert len(dev_service.agents) == dev_settings.population_size == 15


def test_default_settings_are_mvp_profile_with_100_agents():
    """
    Out of the box (no .env / no overrides), ECHO must boot into the
    authoritative MVP/100 configuration everywhere.
    """
    settings = Settings()
    assert settings.simulation_profile == SimulationProfile.MVP
    assert settings.population_size == 100


def test_concurrent_reset_and_step_do_not_corrupt_state():
    """
    Hammers step()/reset()/world reads concurrently from multiple threads
    (mirroring FastAPI's threadpool executing sync routes concurrently,
    e.g. browser autoplay racing a RESET click). Every agent's
    location_id must remain valid against the *current* world after the
    dust settles, and no exception should propagate.
    """
    service = SimulationService(seed=999, population_size=20)
    errors: list[Exception] = []

    def hammer_step() -> None:
        for _ in range(30):
            try:
                service.step()
            except Exception as exc:  # noqa: BLE001 - intentionally broad for the test
                errors.append(exc)

    def hammer_reset() -> None:
        for _ in range(10):
            try:
                service.reset(seed=1234)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

    threads = [threading.Thread(target=hammer_step) for _ in range(4)]
    threads += [threading.Thread(target=hammer_reset) for _ in range(2)]

    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []

    # Final state must be internally consistent: every agent's location_id
    # must exist in the world that's currently live on the service.
    for agent in service.agents:
        assert agent.location_id in service.world.locations
