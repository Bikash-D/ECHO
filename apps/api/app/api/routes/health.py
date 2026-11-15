"""
Health check endpoint. Used to verify the API process boots and to
manually verify DB/Redis connectivity during Phase 0 setup -- not part
of the simulation domain.
"""

from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter()


@router.get("/health")
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "app": settings.app_name,
        "environment": settings.environment,
        "simulation_profile": settings.simulation_profile,
        "population_size": settings.population_size,
    }
