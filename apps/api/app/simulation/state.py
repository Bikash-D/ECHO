"""
Singleton simulation state service for the API server.

Maintains the live SimulationEngine, World, Agent population, Decision Pipeline,
and Action Resolution in memory for development and visualization sessions.
"""

from __future__ import annotations

import threading
from typing import Any
import uuid

from app.agents.agent import Agent
from app.agents.decision import RuleBasedDecisionStrategy
from app.agents.generator import generate_mvp_agents
from app.core.config import get_settings
from app.core.rng import SimulationRNG
from app.goals.system import GoalsSystem
from app.needs.system import NeedsSystem
from app.perception.system import PerceptionSystem
from app.schemas.action_intent import ActionIntent
from app.simulation.action_resolver import ActionResolver, ActionResult
from app.simulation.clock import Clock
from app.simulation.event_queue import EventQueue
from app.world.generator import generate_mvp_world
from app.world.models import World


class SimulationService:
    """
    Manages the active simulation instance and executes the full autonomous
    simulation tick loop:
    Need State -> Perception -> Goal Generation -> Decision (ActionIntent) -> Action Resolution -> World State Mutation.
    """

    def __init__(self, seed: int = 12345, population_size: int = 100) -> None:
        self.seed = seed
        self.population_size = population_size
        self.rng = SimulationRNG(seed=self.seed)
        self.world: World = generate_mvp_world(city_name="Echo City", rng=self.rng)
        self.agents: list[Agent] = generate_mvp_agents(
            world=self.world,
            rng=self.rng,
            population_size=self.population_size,
        )
        self.clock = Clock()
        self.event_queue = EventQueue()
        self.decision_strategy = RuleBasedDecisionStrategy()
        self.status = "paused"
        self.recent_events: list[dict[str, Any]] = []

        # Per-agent snapshot of the most recent Decision + Action
        # Resolution outcome, keyed by agent id. This is the smallest
        # addition needed for an Agent Inspector to show "what is this
        # agent doing right now, and why": intent.reasoning and
        # result.message/success/action_type were already computed every
        # tick inside step() below, but previously only survived (for a
        # subset of action types) inside the global, unkeyed
        # `recent_events` ring buffer -- there was no way to look up "the
        # current action" for one specific agent. This dict is overwritten
        # every tick for every agent (not just the ones matching
        # recent_events' filter), so it always reflects the latest
        # decision, including rejected/failed ones -- an inspector should
        # be able to see *why* an agent's move failed, not just successes.
        self.last_actions: dict[uuid.UUID, dict[str, Any]] = {}

        # SimulationService is a shared, mutable, process-wide singleton
        # (see get_simulation_service() below) that is reached from FastAPI
        # request handlers. Those handlers are defined as plain `def`, so
        # FastAPI/Starlette runs each call in a worker thread from its
        # threadpool -- meaning two HTTP requests (e.g. a browser's
        # autoplay STEP loop racing a RESET click, or React StrictMode's
        # deliberate double-invocation of effects in dev) can genuinely
        # execute concurrently. Without serialization, a reset() that
        # reassigns self.world/self.agents mid-step() can hand an in-flight
        # step() a stale agent whose location_id was generated against the
        # *previous* World (Location ids are uuid4-random, not
        # seed-derived -- see agents/generator.py's documented
        # KNOWN LIMITATION), which PerceptionSystem.perceive() then rejects
        # with an uncaught ValueError -> bare framework 500. This lock
        # makes start/pause/step/reset mutually exclusive so that never
        # happens, without introducing a second engine or duplicate state.
        self._lock = threading.RLock()

    def reset(self, seed: int | None = None) -> None:
        """Reset the simulation world and agents deterministically."""
        with self._lock:
            if seed is not None:
                self.seed = seed
            self.rng = SimulationRNG(seed=self.seed)
            self.world = generate_mvp_world(city_name="Echo City", rng=self.rng)
            self.agents = generate_mvp_agents(
                world=self.world,
                rng=self.rng,
                population_size=self.population_size,
            )
            self.clock.reset()
            self.world.tick = 0
            self.event_queue.clear()
            self.recent_events = []
            self.last_actions = {}
            self.status = "paused"

    def start(self) -> str:
        with self._lock:
            self.status = "running"
            return self.status

    def pause(self) -> str:
        with self._lock:
            self.status = "paused"
            return self.status

    def step(self) -> int:
        """
        Advance the simulation by exactly one tick through the full autonomous loop:
        1. Clock Advance
        2. Needs Decay
        3. Goal Generation & Prioritization
        4. Perception (AgentContext Construction)
        5. Decision (ActionIntent generation via DecisionStrategy)
        6. Action Resolution (precondition validation & deterministic state mutation)
        """
        with self._lock:
            new_tick = self.clock.advance()
            self.world.tick = new_tick

            step_events: list[dict[str, Any]] = []

            # 1. Decay needs and generate goals for all agents
            for agent in self.agents:
                NeedsSystem.decay(agent.needs)
                GoalsSystem.generate_goals(agent, self.rng)

            # 2. Perceive, Decide, and Resolve for every agent
            for agent in self.agents:
                # A. Perception: Build transient context scoped to agent's senses
                context = PerceptionSystem.build_agent_context(
                    agent=agent,
                    world=self.world,
                    other_agents=self.agents,
                    tick=new_tick,
                )

                # B. Decision: Produce actionable intent from context
                intent: ActionIntent = self.decision_strategy.decide(context)

                # C. Action Resolution: Apply state mutations (movement, consumption, rest, work)
                result: ActionResult = ActionResolver.resolve(
                    agent=agent,
                    intent=intent,
                    world=self.world,
                    other_agents=self.agents,
                )

                # Record this agent's current action outcome regardless of
                # action type or success -- see `self.last_actions`
                # docstring in __init__ for why this is unfiltered, unlike
                # step_events below (which stays scoped to the notable
                # event-feed subset it already covered).
                self.last_actions[agent.id] = {
                    "tick": new_tick,
                    "action_type": result.action_type,
                    "success": result.success,
                    "message": result.message,
                    "reasoning": intent.reasoning,
                }

                if result.success and result.action_type in ("move", "consume_food", "rest", "work", "socialize"):
                    step_events.append({
                        "tick": new_tick,
                        "agent_id": str(agent.id),
                        "agent_name": agent.name,
                        "action_type": result.action_type,
                        "message": result.message,
                        "reasoning": intent.reasoning,
                        "changes": result.changes,
                    })

            # Keep recent event history bounded
            self.recent_events = (step_events + self.recent_events)[:100]

            return new_tick

    def get_last_action(self, agent_id: uuid.UUID) -> dict[str, Any] | None:
        """Most recent Decision + Action Resolution outcome for one agent, if any."""
        return self.last_actions.get(agent_id)

    def get_agent(self, agent_id: uuid.UUID) -> Agent | None:
        for a in self.agents:
            if a.id == agent_id:
                return a
        return None

    def get_agents_at_location(self, location_id: uuid.UUID) -> list[Agent]:
        return [a for a in self.agents if a.location_id == location_id]

    def get_agents_in_neighborhood(self, neighborhood_id: uuid.UUID) -> list[Agent]:
        neighborhood = self.world.get_neighborhood(neighborhood_id)
        location_ids = set(neighborhood.location_ids)
        return [a for a in self.agents if a.location_id in location_ids]


# Global singleton instance
_instance: SimulationService | None = None


def get_simulation_service() -> SimulationService:
    global _instance
    if _instance is None:
        settings = get_settings()
        # BUGFIX: this previously hardcoded population_size=100, ignoring
        # `settings.population_size` (which is derived from
        # SIMULATION_PROFILE). That meant /api/health reported whatever
        # profile/population the environment was configured with (e.g.
        # "dev"/15 from a .env copied from .env.example) while every other
        # endpoint -- backed by this singleton -- silently ran 100 agents
        # regardless. There must be exactly one source of truth for
        # population/profile; settings.population_size is it.
        _instance = SimulationService(
            seed=settings.default_seed,
            population_size=settings.population_size,
        )
    return _instance
