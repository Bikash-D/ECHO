"""
FastAPI entrypoint.

Deliberately thin: this module wires routes and middleware only. All
real logic lives in simulation/, agents/, economy/, etc. and must
remain importable/runnable without this module (see architecture.md
Section 4 -- headless experiments run the engine directly, not through
HTTP).
"""

from fastapi import FastAPI

from app.api.routes.health import router as health_router
from app.api.routes.simulation import router as simulation_router
from app.api.routes.world import router as world_router
from app.core.config import get_settings
from app.core.logging import configure_logging

configure_logging()
settings = get_settings()

app = FastAPI(title=settings.app_name)

app.include_router(health_router, prefix="/api", tags=["health"])
app.include_router(world_router, prefix="/api", tags=["world"])
app.include_router(simulation_router, prefix="/api", tags=["simulation"])

