"""
Phase 1 Step 4 tests: Goal domain model and GoalsSystem.
"""

import uuid

from app.agents.agent import Agent
from app.agents.personality import Personality
from app.core.rng import SimulationRNG
from app.goals.enums import GoalStatus, GoalType
from app.goals.models import Goal
from app.goals.system import GoalsSystem
from app.needs.enums import NeedType
from app.needs.models import Need
from app.schemas.agent_context import GoalSnapshot


def _valid_personality() -> Personality:
    return Personality(
        openness=0.5,
        conscientiousness=0.5,
        extraversion=0.5,
        agreeableness=0.5,
        neuroticism=0.5,
    )


def _make_agent() -> Agent:
    return Agent(
        id=uuid.uuid4(),
        name="Test Agent",
        age=30,
        personality=_valid_personality(),
        occupation="artisan",
        wealth=500.0,
    )


# -- Goal Model Tests --------------------------------------------------------


def test_goal_constructs_with_defaults():
    gid = uuid.uuid4()
    goal = Goal(
        id=gid,
        goal_type=GoalType.SATISFY_HUNGER,
        description="Eat food",
        priority=80,
    )
    assert goal.id == gid
    assert goal.goal_type == GoalType.SATISFY_HUNGER
    assert goal.description == "Eat food"
    assert goal.priority == 80
    assert goal.status == GoalStatus.ACTIVE
    assert goal.progress == 0.0
    assert goal.type_str == "satisfy_hunger"
    assert goal.status_str == "active"


def test_goal_to_snapshot():
    gid = uuid.uuid4()
    goal = Goal(
        id=gid,
        goal_type=GoalType.RESTORE_ENERGY,
        description="Sleep",
        priority=90,
        status=GoalStatus.ACTIVE,
        progress=0.25,
    )
    snapshot = goal.to_snapshot()
    assert isinstance(snapshot, GoalSnapshot)
    assert snapshot.id == gid
    assert snapshot.description == "Sleep"
    assert snapshot.priority == 90
    assert snapshot.status == "active"
    assert snapshot.progress == 0.25


def test_goal_rejects_invalid_progress():
    gid = uuid.uuid4()
    try:
        Goal(id=gid, goal_type=GoalType.SATISFY_HUNGER, description="X", priority=50, progress=1.5)
        assert False, "Should raise ValueError"
    except ValueError:
        pass

    try:
        Goal(id=gid, goal_type=GoalType.SATISFY_HUNGER, description="X", priority=50, progress=-0.1)
        assert False, "Should raise ValueError"
    except ValueError:
        pass


# -- GoalsSystem Generation Tests -------------------------------------------


def test_no_goals_generated_when_needs_are_satisfied():
    agent = _make_agent()
    agent.needs = {
        NeedType.HUNGER: Need(need_type=NeedType.HUNGER, value=0.9, decay_rate=0.02),
        NeedType.ENERGY: Need(need_type=NeedType.ENERGY, value=0.8, decay_rate=0.01),
        NeedType.SOCIAL: Need(need_type=NeedType.SOCIAL, value=0.7, decay_rate=0.015),
    }

    new_goals = GoalsSystem.generate_goals(agent)
    assert len(new_goals) == 0
    assert len(agent.goals) == 0


def test_goals_generated_when_needs_depleted():
    agent = _make_agent()
    agent.needs = {
        NeedType.HUNGER: Need(need_type=NeedType.HUNGER, value=0.2, decay_rate=0.02),
        NeedType.ENERGY: Need(need_type=NeedType.ENERGY, value=0.9, decay_rate=0.01),
        NeedType.SOCIAL: Need(need_type=NeedType.SOCIAL, value=0.1, decay_rate=0.015),
    }

    new_goals = GoalsSystem.generate_goals(agent)
    assert len(new_goals) == 2
    assert len(agent.goals) == 2

    goal_types = {g.goal_type for g in new_goals}
    assert GoalType.SATISFY_HUNGER in goal_types
    assert GoalType.SEEK_SOCIAL_CONTACT in goal_types


def test_goal_priority_proportional_to_need_deficit():
    agent = _make_agent()
    agent.needs = {
        NeedType.HUNGER: Need(need_type=NeedType.HUNGER, value=0.1, decay_rate=0.02),  # 90 deficit
        NeedType.ENERGY: Need(need_type=NeedType.ENERGY, value=0.25, decay_rate=0.01),  # 75 deficit
    }

    GoalsSystem.generate_goals(agent)

    hunger_goal = next(g for g in agent.goals if g.goal_type == GoalType.SATISFY_HUNGER)
    energy_goal = next(g for g in agent.goals if g.goal_type == GoalType.RESTORE_ENERGY)

    assert hunger_goal.priority > energy_goal.priority
    assert hunger_goal.priority == 90
    assert energy_goal.priority == 75


def test_no_duplicate_active_goals_for_same_need():
    agent = _make_agent()
    agent.needs = {
        NeedType.HUNGER: Need(need_type=NeedType.HUNGER, value=0.15, decay_rate=0.02),
    }

    first_gen = GoalsSystem.generate_goals(agent)
    assert len(first_gen) == 1
    assert len(agent.goals) == 1

    # Second call should not duplicate the active goal
    second_gen = GoalsSystem.generate_goals(agent)
    assert len(second_gen) == 0
    assert len(agent.goals) == 1


def test_goals_generation_deterministic_with_rng():
    rng_a = SimulationRNG(seed=77)
    rng_b = SimulationRNG(seed=77)

    agent_a = _make_agent()
    agent_b = _make_agent()
    agent_b.id = agent_a.id

    agent_a.needs = {NeedType.HUNGER: Need(NeedType.HUNGER, 0.1, 0.02)}
    agent_b.needs = {NeedType.HUNGER: Need(NeedType.HUNGER, 0.1, 0.02)}

    goals_a = GoalsSystem.generate_goals(agent_a, rng_a)
    goals_b = GoalsSystem.generate_goals(agent_b, rng_b)

    assert goals_a[0].id == goals_b[0].id
    assert goals_a[0].priority == goals_b[0].priority


# -- GoalsSystem Update & Lifecycle Tests ------------------------------------


def test_goal_completes_when_need_satisfied():
    agent = _make_agent()
    agent.needs = {
        NeedType.HUNGER: Need(need_type=NeedType.HUNGER, value=0.15, decay_rate=0.02),
    }
    GoalsSystem.generate_goals(agent)
    goal = agent.goals[0]
    assert goal.status == GoalStatus.ACTIVE

    # Not satisfied yet
    agent.needs[NeedType.HUNGER].value = 0.5
    GoalsSystem.update_goals(agent)
    assert goal.status == GoalStatus.ACTIVE
    assert goal.progress == 0.0

    # Satisfied above threshold (>= 0.8)
    agent.needs[NeedType.HUNGER].value = 0.85
    GoalsSystem.update_goals(agent)
    assert goal.status == GoalStatus.COMPLETED
    assert goal.progress == 1.0


def test_abandon_goal():
    gid = uuid.uuid4()
    goal = Goal(id=gid, goal_type=GoalType.SATISFY_HUNGER, description="X", priority=50)
    assert goal.status == GoalStatus.ACTIVE

    GoalsSystem.abandon(goal)
    assert goal.status == GoalStatus.ABANDONED


def test_update_goals_does_not_affect_abandoned_or_completed_goals():
    agent = _make_agent()
    goal_abandoned = Goal(
        id=uuid.uuid4(),
        goal_type=GoalType.SATISFY_HUNGER,
        description="Eat",
        priority=50,
        status=GoalStatus.ABANDONED,
    )
    goal_completed = Goal(
        id=uuid.uuid4(),
        goal_type=GoalType.RESTORE_ENERGY,
        description="Sleep",
        priority=50,
        status=GoalStatus.COMPLETED,
        progress=1.0,
    )
    agent.goals = [goal_abandoned, goal_completed]
    agent.needs = {
        NeedType.HUNGER: Need(NeedType.HUNGER, 0.9, 0.02),
        NeedType.ENERGY: Need(NeedType.ENERGY, 0.9, 0.01),
    }

    GoalsSystem.update_goals(agent)

    assert agent.goals[0].status == GoalStatus.ABANDONED
    assert agent.goals[1].status == GoalStatus.COMPLETED


def test_incremental_goal_generation_when_new_need_depletes():
    agent = _make_agent()
    agent.needs = {
        NeedType.HUNGER: Need(NeedType.HUNGER, 0.2, 0.02),
        NeedType.ENERGY: Need(NeedType.ENERGY, 0.8, 0.01),
    }

    first_batch = GoalsSystem.generate_goals(agent)
    assert len(first_batch) == 1
    assert first_batch[0].goal_type == GoalType.SATISFY_HUNGER

    # Later, energy also depletes
    agent.needs[NeedType.ENERGY].value = 0.15
    second_batch = GoalsSystem.generate_goals(agent)
    assert len(second_batch) == 1
    assert second_batch[0].goal_type == GoalType.RESTORE_ENERGY
    assert len(agent.goals) == 2
