"""
Tests for the relationship-memory milestone: wiring the existing
"socialize" ActionIntent to the existing Relationship.interact() method
(app/society/relationships.py), which previously existed but was never
called from anywhere in the tick loop.
"""

from __future__ import annotations

import uuid

from app.agents.generator import generate_mvp_agents
from app.core.rng import SimulationRNG
from app.schemas.action_intent import ActionIntent, DecisionMode
from app.simulation.action_resolver import ActionResolver
from app.simulation.state import SimulationService
from app.society.relationships import RelationshipType
from app.world.generator import generate_mvp_world


def _make_two_agents(seed: int = 7):
    rng = SimulationRNG(seed=seed)
    world = generate_mvp_world(rng=rng)
    agents = generate_mvp_agents(world, rng, population_size=5)
    return world, agents


def test_socialize_creates_and_deepens_relationship_between_two_agents():
    world, agents = _make_two_agents()
    a, b = agents[0], agents[1]
    a.relationships.pop(b.id, None)
    b.relationships.pop(a.id, None)

    intent = ActionIntent(
        action_type="socialize",
        params={"target_agent_id": str(b.id)},
        produced_by=DecisionMode.RULE_BASED,
    )

    result = ActionResolver.resolve(agent=a, intent=intent, world=world, other_agents=agents)

    assert result.success is True
    assert b.id in a.relationships
    assert a.id in b.relationships

    forward = a.relationships[b.id]
    backward = b.relationships[a.id]

    assert forward.interactions_count == 1
    assert backward.interactions_count == 1
    assert forward.strength > 0.10
    assert backward.trust > 0.10
    assert result.changes["relationship_target_id"] == str(b.id)


def test_repeated_socializing_evolves_relationship_type_toward_friendship():
    world, agents = _make_two_agents()
    a, b = agents[0], agents[1]
    a.relationships.pop(b.id, None)
    b.relationships.pop(a.id, None)

    intent = ActionIntent(
        action_type="socialize",
        params={"target_agent_id": str(b.id)},
        produced_by=DecisionMode.RULE_BASED,
    )

    for _ in range(12):
        ActionResolver.resolve(agent=a, intent=intent, world=world, other_agents=agents)

    forward = a.relationships[b.id]
    # 12 interactions * 0.05 strength / 0.03 trust from a 0.10 base comfortably
    # clears the FRIEND thresholds (strength >= 0.50, trust >= 0.45) in
    # Relationship.interact()'s own evolution rule.
    assert forward.interactions_count == 12
    assert forward.relationship_type in (RelationshipType.FRIEND, RelationshipType.CLOSE_FRIEND)


def test_socialize_with_no_specific_target_does_not_fabricate_a_relationship():
    world, agents = _make_two_agents()
    a = agents[0]
    before = dict(a.relationships)

    intent = ActionIntent(
        action_type="socialize",
        params={"target_agent_id": None},
        produced_by=DecisionMode.RULE_BASED,
    )
    result = ActionResolver.resolve(agent=a, intent=intent, world=world, other_agents=agents)

    assert result.success is True
    assert "relationship_target_id" not in result.changes
    assert a.relationships == before


def test_socialize_without_other_agents_list_is_backward_compatible():
    """Existing single-agent callers that don't pass other_agents must not break."""
    world, agents = _make_two_agents()
    a, b = agents[0], agents[1]

    intent = ActionIntent(
        action_type="socialize",
        params={"target_agent_id": str(b.id)},
        produced_by=DecisionMode.RULE_BASED,
    )
    result = ActionResolver.resolve(agent=a, intent=intent, world=world)

    assert result.success is True
    assert "relationship_target_id" not in result.changes


def test_end_to_end_step_produces_real_relationship_interactions():
    """
    Full pipeline: stepping the live SimulationService (not calling the
    resolver directly) should, over enough ticks, cause at least one real
    bilateral relationship interaction between two co-located agents.
    """
    service = SimulationService(seed=12345, population_size=100)

    for _ in range(30):
        service.step()

    total_interactions = sum(
        rel.interactions_count
        for agent in service.agents
        for rel in agent.relationships.values()
    )
    assert total_interactions > 0, "Expected at least one socialize interaction to have occurred."
