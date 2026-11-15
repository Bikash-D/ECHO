"""
Tests for the consumption causality milestone.

Prior behavior (regression target, not exercised by any of these tests):
- ActionResolver's "consume_food" branch satisfied hunger and deducted a
  flat $5 from ANY agent regardless of location -- an agent standing at
  home, at work, or anywhere else could "buy food" with no market
  involved, and the $5 it spent went nowhere: no Business ever received
  it. This was the same anti-pattern the employment milestone fixed for
  "work" (see tests/economy/test_employment.py's module docstring),
  just on the spending side of the economy instead of the earning side.

This module asserts the replacement causal chain:
    agent hungry -> travels to a MARKET (already existed, see
    agents/decision.py) -> consume_food requires physical presence at
    that MARKET -> payment (if affordable) is recorded as revenue on
    the market's Business -> agent wealth decreases -> hunger satisfied

And the negative case: an agent attempting to eat away from any market
must be rejected, and must not move any Business's cash.
"""

from __future__ import annotations

import uuid

from app.agents.agent import Agent
from app.agents.personality import Personality
from app.core.rng import SimulationRNG
from app.needs.enums import NeedType
from app.needs.system import NeedsSystem
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
    agent = Agent(**defaults)
    NeedsSystem.initialize_needs(agent)
    agent.needs[NeedType.HUNGER].value = 0.20
    return agent


# -- World generation: every market has exactly one Business -------------


def test_every_market_location_has_a_registered_business():
    rng = SimulationRNG(seed=5)
    world = generate_mvp_world(rng=rng)
    markets = world.locations_by_type(LocationType.MARKET)

    assert len(markets) > 0
    for market in markets:
        business = world.get_business(market.id)
        assert business is not None
        assert business.location_id == market.id
        assert business.cash == 0.0  # fresh world, no purchases yet


# -- ActionResolver: consume_food requires physical presence at MARKET --


def test_consume_food_rejected_when_agent_not_at_a_market():
    rng = SimulationRNG(seed=1)
    world = generate_mvp_world(rng=rng)
    residence = world.locations_by_type(LocationType.RESIDENTIAL)[0]

    agent = _agent(location_id=residence.id, wealth=100.0)
    intent = ActionIntent(action_type="consume_food", produced_by=DecisionMode.RULE_BASED)

    result = ActionResolver.resolve(agent, intent, world)

    assert result.success is False
    assert agent.wealth == 100.0
    assert agent.needs[NeedType.HUNGER].value == 0.20  # untouched


def test_consume_food_rejected_at_a_workplace_too():
    """Presence at *some* economic location isn't enough -- must be a MARKET specifically."""
    rng = SimulationRNG(seed=1)
    world = generate_mvp_world(rng=rng)
    workplace = world.locations_by_type(LocationType.WORKPLACE)[0]

    agent = _agent(location_id=workplace.id, wealth=100.0)
    intent = ActionIntent(action_type="consume_food", produced_by=DecisionMode.RULE_BASED)

    result = ActionResolver.resolve(agent, intent, world)

    assert result.success is False
    assert agent.wealth == 100.0


def test_consume_food_succeeds_and_pays_the_market_when_present():
    rng = SimulationRNG(seed=1)
    world = generate_mvp_world(rng=rng)
    market = world.locations_by_type(LocationType.MARKET)[0]
    business = world.get_business(market.id)
    assert business is not None
    assert business.cash == 0.0

    agent = _agent(location_id=market.id, wealth=100.0)
    intent = ActionIntent(action_type="consume_food", produced_by=DecisionMode.RULE_BASED)

    result = ActionResolver.resolve(agent, intent, world)

    assert result.success is True
    assert agent.wealth == 95.0
    assert agent.needs[NeedType.HUNGER].value > 0.20
    assert business.cash == 5.0
    assert result.changes["business_id"] == str(business.id)
    assert result.changes["business_cash"] == 5.0
    assert result.changes["paid"] is True


def test_repeated_purchases_accumulate_market_cash():
    rng = SimulationRNG(seed=1)
    world = generate_mvp_world(rng=rng)
    market = world.locations_by_type(LocationType.MARKET)[0]
    business = world.get_business(market.id)

    agent = _agent(location_id=market.id, wealth=100.0)
    intent = ActionIntent(action_type="consume_food", produced_by=DecisionMode.RULE_BASED)

    ActionResolver.resolve(agent, intent, world)
    ActionResolver.resolve(agent, intent, world)

    assert business.cash == 10.0
    assert agent.wealth == 90.0


def test_agent_who_cannot_afford_food_still_eats_but_market_earns_nothing():
    rng = SimulationRNG(seed=1)
    world = generate_mvp_world(rng=rng)
    market = world.locations_by_type(LocationType.MARKET)[0]
    business = world.get_business(market.id)

    agent = _agent(location_id=market.id, wealth=2.0)  # can't afford the $5 cost
    intent = ActionIntent(action_type="consume_food", produced_by=DecisionMode.RULE_BASED)

    result = ActionResolver.resolve(agent, intent, world)

    assert result.success is True
    assert agent.wealth == 2.0  # unchanged -- no fabricated payment
    assert agent.needs[NeedType.HUNGER].value > 0.20  # still eats (MVP simplification)
    assert business.cash == 0.0  # market records no revenue for a payment that didn't happen
    assert result.changes["paid"] is False


# -- End-to-end: autonomous tick loop produces real market revenue -------


def test_autonomous_simulation_produces_genuine_market_revenue():
    service = SimulationService(seed=12345, population_size=100)

    consume_events: list[dict] = []
    for _ in range(48):  # 2 simulated days
        service.step()
        this_tick_events = [
            e for e in service.recent_events
            if e["action_type"] == "consume_food" and e["tick"] == service.world.tick
        ]
        consume_events.extend(this_tick_events)

    assert len(consume_events) > 0, "Expected at least one agent to autonomously buy food."

    markets = service.world.locations_by_type(LocationType.MARKET)
    markets_with_revenue = [
        m for m in markets if service.world.get_business(m.id) is not None
        and service.world.get_business(m.id).cash > 0.0
    ]
    assert len(markets_with_revenue) > 0, (
        "Expected at least one market to have accumulated cash from real food purchases."
    )

    # Every successful purchase event must have occurred at an actual
    # MARKET Business, captured at the moment it happened (not the
    # agent's possibly-since-moved-on current location).
    market_business_ids = {
        service.world.get_business(m.id).id for m in markets if service.world.get_business(m.id)
    }
    for event in consume_events:
        assert event["changes"]["paid"] in (True, False)
        if event["changes"]["paid"]:
            assert uuid.UUID(event["changes"]["business_id"]) in market_business_ids
