"""
Tests for the economic causality milestone.

Prior behavior (regression target, not exercised by any of these tests):
- ActionResolver's "work" branch paid an agent an occupation wage with
  no corresponding economic event anywhere else -- the wage appeared
  from nowhere, and a workplace Location had no economic state at all.

This module asserts the replacement causal chain:
    workplace -> Business (created at world generation)
    -> work shift -> deterministic output_value produced
    -> Business.cash increases by output_value, decreases by wage
    -> agent is paid wage -> agent wealth increases

And the negative case: an agent who cannot legally work (no employer,
not physically present) must not move any Business's cash either --
mirroring test_employment.py's existing wage-side assertions.
"""

from __future__ import annotations

import uuid

from app.agents.agent import Agent
from app.agents.personality import Personality
from app.economy.business import Business
from app.economy.production import OUTPUT_MULTIPLIER, get_output_value_for_occupation
from app.economy.wages import OCCUPATION_WAGES, get_wage_for_occupation
from app.schemas.action_intent import ActionIntent, DecisionMode
from app.simulation.action_resolver import ActionResolver
from app.simulation.state import SimulationService
from app.world.enums import LocationType
from app.world.generator import generate_mvp_world
from app.core.rng import SimulationRNG


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


# -- Production: deterministic, occupation-derived, > wage ---------------


def test_output_value_is_deterministic_and_exceeds_wage():
    for occupation, wage in OCCUPATION_WAGES.items():
        if occupation == "unemployed":
            continue
        output = get_output_value_for_occupation(occupation)
        assert output == round(wage * OUTPUT_MULTIPLIER, 2)
        assert output > wage  # work must be a genuine value-creating act
        # Repeated calls are identical -- no hidden randomness.
        assert output == get_output_value_for_occupation(occupation)


# -- World generation: every workplace has exactly one Business ----------


def test_every_workplace_location_has_a_registered_business():
    rng = SimulationRNG(seed=3)
    world = generate_mvp_world(rng=rng)
    workplaces = world.locations_by_type(LocationType.WORKPLACE)

    assert len(workplaces) > 0
    for workplace in workplaces:
        business = world.get_business(workplace.id)
        assert business is not None
        assert business.location_id == workplace.id
        assert business.cash == 0.0  # fresh world, no shifts worked yet


def test_business_cannot_be_registered_at_a_non_workplace_location():
    rng = SimulationRNG(seed=3)
    world = generate_mvp_world(rng=rng)
    residence = world.locations_by_type(LocationType.RESIDENTIAL)[0]

    bogus_business = Business(id=uuid.uuid4(), location_id=residence.id, name="Bogus Co.")
    try:
        world.add_business(bogus_business)
        assert False, "Expected ValueError for non-workplace business registration"
    except ValueError:
        pass


# -- ActionResolver: work shift mutates the employer's Business, not ----
# -- just the agent's wealth --------------------------------------------


def test_work_action_increases_business_cash_by_net_of_output_and_wage():
    rng = SimulationRNG(seed=1)
    world = generate_mvp_world(rng=rng)
    workplace = world.locations_by_type(LocationType.WORKPLACE)[0]
    business = world.get_business(workplace.id)
    assert business is not None
    assert business.cash == 0.0

    agent = _agent(occupation="trader", workplace_id=workplace.id, location_id=workplace.id, wealth=200.0)
    intent = ActionIntent(action_type="work", produced_by=DecisionMode.RULE_BASED)

    result = ActionResolver.resolve(agent, intent, world)

    expected_wage = OCCUPATION_WAGES["trader"]
    expected_output = get_output_value_for_occupation("trader")
    expected_net = round(expected_output - expected_wage, 2)

    assert result.success is True
    assert result.changes["output_value"] == expected_output
    assert result.changes["business_id"] == str(business.id)
    assert business.cash == expected_net
    assert result.changes["business_cash"] == expected_net
    # Retained profit is strictly positive since OUTPUT_MULTIPLIER > 1.
    assert business.cash > 0.0


def test_repeated_shifts_accumulate_business_cash():
    rng = SimulationRNG(seed=1)
    world = generate_mvp_world(rng=rng)
    workplace = world.locations_by_type(LocationType.WORKPLACE)[0]
    business = world.get_business(workplace.id)

    agent = _agent(occupation="artisan", workplace_id=workplace.id, location_id=workplace.id)
    intent = ActionIntent(action_type="work", produced_by=DecisionMode.RULE_BASED)

    ActionResolver.resolve(agent, intent, world)
    cash_after_one = business.cash
    ActionResolver.resolve(agent, intent, world)
    cash_after_two = business.cash

    per_shift_net = round(
        get_output_value_for_occupation("artisan") - get_wage_for_occupation("artisan"), 2
    )
    assert cash_after_one == per_shift_net
    assert cash_after_two == round(per_shift_net * 2, 2)


def test_rejected_work_action_does_not_touch_business_cash():
    rng = SimulationRNG(seed=1)
    world = generate_mvp_world(rng=rng)
    workplace = world.locations_by_type(LocationType.WORKPLACE)[0]
    business = world.get_business(workplace.id)

    # Unemployed agent standing at a workplace that isn't theirs (they
    # have none) -- must be rejected, and must not create economic
    # activity out of a rejected action.
    agent = _agent(occupation="unemployed", workplace_id=None, location_id=workplace.id)
    intent = ActionIntent(action_type="work", produced_by=DecisionMode.RULE_BASED)

    result = ActionResolver.resolve(agent, intent, world)

    assert result.success is False
    assert business.cash == 0.0


# -- End-to-end: autonomous tick loop produces real business revenue ----


def test_autonomous_simulation_produces_genuine_business_revenue():
    service = SimulationService(seed=12345, population_size=100)

    # recent_events is bounded (see SimulationService.step's docstring),
    # so collect work events as we go rather than only inspecting the
    # tail after many ticks -- same pattern as
    # test_employment.py::test_autonomous_simulation_produces_at_least_one_genuine_work_transition.
    work_events: list[dict] = []
    for _ in range(48):  # 2 simulated days
        service.step()
        this_tick_work_events = [
            e for e in service.recent_events
            if e["action_type"] == "work" and e["tick"] == service.world.tick
        ]
        work_events.extend(this_tick_work_events)

    assert len(work_events) > 0, "Expected at least one agent to autonomously work a shift."

    businesses_with_activity = [b for b in service.world.businesses.values() if b.cash != 0.0]
    assert len(businesses_with_activity) > 0, (
        "Expected at least one business to have accumulated cash from real work shifts."
    )

    # Cross-check against the emitted work events: every work event's
    # output_value must be consistent with that agent's occupation-derived
    # per-shift economics (not a flat/fake number), and must exceed the
    # wage paid out -- the whole point of the economic causality milestone.
    for event in work_events:
        agent = service.get_agent(uuid.UUID(event["agent_id"]))
        expected_output = get_output_value_for_occupation(agent.occupation)
        assert event["changes"]["output_value"] == expected_output
        assert event["changes"]["output_value"] > event["changes"]["wage"]
