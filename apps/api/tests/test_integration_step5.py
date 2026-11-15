"""
Integration tests for Steps 1 through 5:
World, Agents, Needs, Goals, Perception, and Deterministic AgentContext assembly.
"""

from app.agents.generator import generate_mvp_agents
from app.core.rng import SimulationRNG
from app.goals.enums import GoalStatus, GoalType
from app.goals.system import GoalsSystem
from app.needs.enums import NeedType
from app.needs.system import NeedsSystem
from app.perception.system import PerceptionSystem
from app.schemas.agent_context import AgentContext
from app.world.generator import generate_mvp_world


def test_end_to_end_simulation_tick_perception_flow():
    # 1. Generate World
    rng = SimulationRNG(seed=101)
    world = generate_mvp_world(rng=rng)
    assert len(world.neighborhoods) == 5
    assert len(world.locations) == 40

    # 2. Generate 100 Agents with deterministic needs
    agents = generate_mvp_agents(world, rng, population_size=100)
    assert len(agents) == 100
    for agent in agents:
        assert len(agent.needs) == 3
        assert agent.location_id is not None
        assert agent.household_id is not None

    # 3. Simulate multiple ticks of needs decay
    for tick in range(1, 45):
        world.tick = tick
        for agent in agents:
            NeedsSystem.decay(agent.needs)
            GoalsSystem.generate_goals(agent, rng)

    # Some agents should now have active goals due to need decay
    agents_with_goals = [a for a in agents if len(a.goals) > 0]
    assert len(agents_with_goals) > 0

    # 4. Perceive world state for all agents at current tick
    contexts: list[AgentContext] = []
    for agent in agents:
        context = PerceptionSystem.build_agent_context(
            agent=agent,
            world=world,
            other_agents=agents,
            tick=world.tick,
        )
        assert isinstance(context, AgentContext)
        assert context.tick == 44
        assert context.agent_id == agent.id
        assert len(context.needs) == 3
        contexts.append(context)

    assert len(contexts) == 100


def test_full_stack_determinism_across_identical_seeds():
    # Run A
    rng_a = SimulationRNG(seed=2026)
    world_a = generate_mvp_world(rng=rng_a)
    agents_a = generate_mvp_agents(world_a, rng_a, population_size=30)
    for _ in range(5):
        world_a.tick += 1
        for a in agents_a:
            NeedsSystem.decay(a.needs)
            GoalsSystem.generate_goals(a, rng_a)

    contexts_a = [
        PerceptionSystem.build_agent_context(a, world_a, agents_a, tick=world_a.tick).model_dump()
        for a in agents_a
    ]

    # Run B
    rng_b = SimulationRNG(seed=2026)
    world_b = generate_mvp_world(rng=rng_b)
    agents_b = generate_mvp_agents(world_b, rng_b, population_size=30)
    for _ in range(5):
        world_b.tick += 1
        for a in agents_b:
            NeedsSystem.decay(a.needs)
            GoalsSystem.generate_goals(a, rng_b)

    contexts_b = [
        PerceptionSystem.build_agent_context(a, world_b, agents_b, tick=world_b.tick).model_dump()
        for a in agents_b
    ]

    assert contexts_a == contexts_b
