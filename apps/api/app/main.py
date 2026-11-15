
"""
FastAPI entrypoint.

Deliberately thin: this module wires routes and middleware only. All
real logic lives in simulation/, agents/, economy/, etc. and must
remain importable/runnable without this module.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.simulation import router as simulation_router
from app.api.routes.world import router as world_router
from app.core.config import get_settings
from app.core.logging import configure_logging

configure_logging()
settings = get_settings()

app = FastAPI(title=settings.app_name)

# Allow the deployed Vercel frontend to communicate with this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://echo-fawn-mu.vercel.app",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/api", tags=["health"])
app.include_router(world_router, prefix="/api", tags=["world"])
app.include_router(simulation_router, prefix="/api", tags=["simulation"])
