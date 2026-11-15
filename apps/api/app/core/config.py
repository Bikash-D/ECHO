"""
Central configuration for ECHO.

All environment-driven settings live here. Nothing else in the codebase
should read `os.environ` directly — go through `get_settings()` instead,
so behavior stays testable and overridable in one place.
"""

from enum import Enum
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class SimulationProfile(str, Enum):
    """
    Controls population scale and other scale-dependent defaults.

    DEV: fast iteration while building/debugging (10-20 agents).
    MVP: the target scale for the final MVP demonstration (100 agents).

    This exists so the architecture supports 100 agents from day one,
    while day-to-day development doesn't pay the cost of simulating
    a full population on every debug run. No simulation logic reads
    these yet in Phase 0 -- this is configuration surface only.
    """

    DEV = "dev"
    MVP = "mvp"


# Population size per profile. DEV defaults to 15 (within the requested
# 10-20 range). MVP is locked at 100 per the finalized architecture.
PROFILE_POPULATION_SIZES: dict[SimulationProfile, int] = {
    SimulationProfile.DEV: 15,
    SimulationProfile.MVP: 100,
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- App ---
    app_name: str = "ECHO"
    environment: str = "local"
    log_level: str = "INFO"

    # --- Simulation scale ---
    simulation_profile: SimulationProfile = SimulationProfile.MVP

    # --- Reproducibility ---
    default_seed: int = 12345

    # --- Database ---
    database_url: str = "postgresql+psycopg2://echo:echo@localhost:5432/echo"

    # --- Redis ---
    redis_url: str = "redis://localhost:6379/0"

    # --- LLM provider (values only; no provider call logic in Phase 0) ---
    llm_provider: str = "anthropic"
    llm_api_key: str | None = None
    llm_model: str = "not-configured"
    llm_max_calls_per_tick: int = 5

    @property
    def population_size(self) -> int:
        """Agent count implied by the active simulation profile."""
        return PROFILE_POPULATION_SIZES[self.simulation_profile]


@lru_cache
def get_settings() -> Settings:
    """
    Cached settings accessor. Use this everywhere instead of
    instantiating Settings() directly, so the whole process shares
    one config snapshot.
    """
    return Settings()
