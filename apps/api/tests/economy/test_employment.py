"""
Tests for the genuine employment milestone.

Prior behavior (regression target, not exercised by any of these tests):
- ANY agent standing at ANY workplace during the day could receive a
  "work" ActionIntent, regardless of whether it was employed there.
- ActionResolver paid a flat, hardcoded $15 wage with no relationship
  to the agent's occupation or employer.

This module asserts the replacement causal chain:
    occupation -> persistent workplace_id -> physical presence ->
    work action -> occupation-derived wage -> wealth mutation
"""

from __future__ import annotations

import uuid

from app.agents.agent import Agent
from app.agents.decision import RuleBasedDecisionStrategy
from app.agents.generator import generate_mvp_agents
from app.agents.personality import Personality
from app.core.rng import SimulationRNG
from app.economy.wages import OCCUPATION_WAGES, get_wage_for_occupation
from app.needs.system import NeedsSystem
from app.perception.system import PerceptionSystem
from app.schemas.action_intent import ActionIntent, DecisionMode
from app.simulation.action_resolver import ActionResolver
from app.simulation.state import SimulationService
from app.world.enums import LocationType
from app.world.generator import generate_mvp_world


def _agent(**overrides) -> Agent:
    defaults = dict(
        id=uuid.uuid4(),
        name="Test Agent",
        age=30,
        personality=Personality(
            openness=0.5, conscientiousness=0.9, extraversion=0.5,
            agreeableness=0.5, neuroticism=0.5,
        ),
        occupation="healer",
        wealth=100.0,
    )
    defaults.update(overrides)
    return Agent(**defaults)


# -- Wage lookup: deterministic, occupation-derived ---------------------


def test_wage_lookup_is_deterministic_and_occupation_specific():
    assert get_wage_for_occupation("healer") == OCCUPATION_WAGES["healer"]
    assert get_wage_for_occupation("laborer") == OCCUPATION_WAGES["laborer"]
    assert get_wage_for_occupation("healer") != get_wage_for_occupation("laborer")
    # Repeated calls are identical -- no hidden randomness.
    assert get_wage_for_occupation("trader") == get_wage_for_occupation("trader")


def test_unemployed_occupation_pays_zero():
    assert get_wage_for_occupation("unemployed") == 0.0


# -- ActionResolver: work requires a genuine employment relationship ----


def test_work_action_rejected_when_agent_has_no_employer():
    rng = SimulationRNG(seed=1)
    world = generate_mvp_world(rng=rng)
    workplace = world.locations_by_type(LocationType.WORKPLACE)[0]

    agent = _agent(occupation="unemployed", workplace_id=None, location_id=workplace.id)
    intent = ActionIntent(action_type="work", produced_by=DecisionMode.RULE_BASED)

    result = ActionResolver.resolve(agent, intent, world)

    assert result.success is False
    assert agent.wealth == 100.0


def test_work_action_rejected_when_agent_not_physically_at_own_workplace():
    rng = SimulationRNG(seed=1)
    world = generate_mvp_world(rng=rng)
    workplaces = world.locations_by_type(LocationType.WORKPLACE)
    own_workplace, elsewhere = workplaces[0], workplaces[1]

    agent = _agent(workplace_id=own_workplace.id, location_id=elsewhere.id)
    intent = ActionIntent(action_type="work", produced_by=DecisionMode.RULE_BASED)

    result = ActionResolver.resolve(agent, intent, world)

    assert result.success is False
    assert agent.wealth == 100.0


def test_work_action_succeeds_and_pays_exact_occupation_wage_when_present_at_own_workplace():
    rng = SimulationRNG(seed=1)
    world = generate_mvp_world(rng=rng)
    workplace = world.locations_by_type(LocationType.WORKPLACE)[0]

    agent = _agent(occupation="trader", workplace_id=workplace.id, location_id=workplace.id, wealth=200.0)
    intent = ActionIntent(action_type="work", produced_by=DecisionMode.RULE_BASED)

    result = ActionResolver.resolve(agent, intent, world)

    expected_wage = OCCUPATION_WAGES["trader"]
    assert result.success is True
    assert result.changes["wage"] == expected_wage
    assert agent.wealth == round(200.0 + expected_wage, 2)
    assert result.changes["workplace_id"] == str(workplace.id)


# -- Decision strategy: only ever routes to the agent's OWN workplace ---


def test_decision_strategy_never_produces_work_for_unemployed_agent_even_when_standing_at_a_workplace():
    rng = SimulationRNG(seed=7)
    world = generate_mvp_world(rng=rng)
    workplace = world.locations_by_type(LocationType.WORKPLACE)[0]

    agent = _agent(occupation="unemployed", workplace_id=None, location_id=workplace.id)
    NeedsSystem.initialize_needs(agent)  # fully satisfied needs -> no urgent goal

    context = PerceptionSystem.build_agent_context(agent, world, other_agents=[], tick=10)  # 10:00, daytime
    intent = RuleBasedDecisionStrategy().decide(context)

    assert intent.action_type != "work"


def test_decision_strategy_routes_employed_agent_to_own_workplace_not_a_different_one():
    rng = SimulationRNG(seed=7)
    world = generate_mvp_world(rng=rng)
    workplaces = world.locations_by_type(LocationType.WORKPLACE)
    own_workplace, other_workplace = workplaces[0], workplaces[1]
    # Both workplaces must be visible to the agent for this to be a fair test.
    assert own_workplace.neighborhood_id == other_workplace.neighborhood_id

    residential = world.locations_by_type(LocationType.RESIDENTIAL)[0]
    residential_in_hood = next(
        l for l in world.locations_in_neighborhood(own_workplace.neighborhood_id)
        if l.location_type == LocationType.RESIDENTIAL
    )

    agent = _agent(
        occupation="clerk",
        workplace_id=own_workplace.id,
        location_id=residential_in_hood.id,
        personality=Personality(
            openness=0.5, conscientiousness=0.9, extraversion=0.5,
            agreeableness=0.5, neuroticism=0.5,
        ),  # conscientious -> reliably commutes
    )
    NeedsSystem.initialize_needs(agent)

    context = PerceptionSystem.build_agent_context(agent, world, other_agents=[], tick=10)
    intent = RuleBasedDecisionStrategy().decide(context)

    assert intent.action_type == "move"
    assert intent.params["target_location_id"] == str(own_workplace.id)
    assert intent.params["target_location_id"] != str(other_workplace.id)


def test_decision_strategy_produces_work_when_employed_agent_is_at_own_workplace():
    rng = SimulationRNG(seed=7)
    world = generate_mvp_world(rng=rng)
    workplace = world.locations_by_type(LocationType.WORKPLACE)[0]

    agent = _agent(occupation="artisan", workplace_id=workplace.id, location_id=workplace.id)
    NeedsSystem.initialize_needs(agent)

    context = PerceptionSystem.build_agent_context(agent, world, other_agents=[], tick=10)
    intent = RuleBasedDecisionStrategy().decide(context)

    assert intent.action_type == "work"


# -- End-to-end: at least one real employment/work transition through --
# -- the full autonomous tick loop (perceive -> decide -> resolve)    --


def test_autonomous_simulation_produces_at_least_one_genuine_work_transition():
    service = SimulationService(seed=12345, population_size=100)

    employed_agents = {a.id: a for a in service.agents if a.workplace_id is not None}
    assert len(employed_agents) > 0, "Expected at least one agent to have a persistent employer."

    work_events = []
    for _ in range(48):  # 2 simulated days
        service.step()
        this_tick_work_events = [e for e in service.recent_events if e["action_type"] == "work" and e["tick"] == service.world.tick]
        # Verify causality at the moment it happened, not after later ticks
        # have moved the agent elsewhere: the acting agent has a persistent
        # workplace_id, was physically present there THIS tick, and was
        # paid exactly its own occupation's wage -- not a flat/fake one.
        for event in this_tick_work_events:
            agent = service.get_agent(uuid.UUID(event["agent_id"]))
            assert agent.workplace_id is not None
            assert agent.location_id == agent.workplace_id
            assert event["changes"]["wage"] == OCCUPATION_WAGES.get(agent.occupation)
        work_events.extend(this_tick_work_events)

    assert len(work_events) > 0, "Expected at least one agent to autonomously work a shift."
