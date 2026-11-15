"""
FastAPI routes for Simulation lifecycle control (start, pause, step, reset).
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.schemas.world_api import SimulationLifecycleResponse
from app.simulation.state import get_simulation_service

router = APIRouter()


class ResetRequest(BaseModel):
    seed: int | None = None


@router.get("/simulation/state", response_model=SimulationLifecycleResponse)
def get_simulation_state() -> SimulationLifecycleResponse:
    service = get_simulation_service()
    return SimulationLifecycleResponse(
        status=service.status,
        tick=service.world.tick,
        population_size=len(service.agents),
    )


@router.post("/simulation/start", response_model=SimulationLifecycleResponse)
def start_simulation() -> SimulationLifecycleResponse:
    service = get_simulation_service()
    status = service.start()
    return SimulationLifecycleResponse(
        status=status,
        tick=service.world.tick,
        population_size=len(service.agents),
    )


@router.post("/simulation/pause", response_model=SimulationLifecycleResponse)
def pause_simulation() -> SimulationLifecycleResponse:
    service = get_simulation_service()
    status = service.pause()
    return SimulationLifecycleResponse(
        status=status,
        tick=service.world.tick,
        population_size=len(service.agents),
    )


@router.post("/simulation/step", response_model=SimulationLifecycleResponse)
def step_simulation() -> SimulationLifecycleResponse:
    service = get_simulation_service()
    new_tick = service.step()
    return SimulationLifecycleResponse(
        status=service.status,
        tick=new_tick,
        population_size=len(service.agents),
    )


@router.post("/simulation/reset", response_model=SimulationLifecycleResponse)
def reset_simulation(request: ResetRequest | None = None) -> SimulationLifecycleResponse:
    service = get_simulation_service()
    seed = request.seed if request else None
    service.reset(seed=seed)
    return SimulationLifecycleResponse(
        status=service.status,
        tick=service.world.tick,
        population_size=len(service.agents),
    )
