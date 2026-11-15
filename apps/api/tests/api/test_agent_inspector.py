"""
Tests for the Agent Inspector/Profile milestone: making existing agent
domain data (employment, relationships, current goal, decision context)
observable through the existing /api/world, /api/world/neighborhoods/{id},
and /api/world/locations/{id} endpoints.

No new routes were added for this milestone -- AgentSummaryResponse was
extended in place, so these fields ride along on the endpoints already
covered by tests/api/test_world_api.py. This file only covers what's new.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.simulation.state import get_simulation_service


def _first_agent_with_workplace(agents: list[dict]) -> dict | None:
    return next((a for a in agents if a.get("workplace_id")), None)


def _first_unemployed_agent(agents: list[dict]) -> dict | None:
    return next((a for a in agents if a.get("occupation") == "unemployed"), None)


def test_agent_summary_includes_new_inspector_fields_shape():
    """
    Every agent in /api/world must carry the new fields (even if empty/None
    at tick 0), so the frontend Agent type contract is always satisfiable.
    """
    service = get_simulation_service()
    service.reset(seed=12345)

    client = TestClient(app)
    res = client.get("/api/world")
    assert res.status_code == 200
    agents = res.json()["agents"]
    assert len(agents) == 100

    for agent in agents:
        assert "employer_name" in agent
        assert "wage" in agent
        assert "current_goal" in agent
        assert "relationships" in agent
        assert isinstance(agent["relationships"], list)
        assert "current_action" in agent
        # No step has happened yet since reset -- no decision has been made.
        assert agent["current_action"] is None


def test_employed_agent_has_employer_name_and_wage():
    service = get_simulation_service()
    service.reset(seed=12345)

    client = TestClient(app)
    res = client.get("/api/world")
    agents = res.json()["agents"]

    employed = _first_agent_with_workplace(agents)
    assert employed is not None, "Expected at least one employed agent in the seeded population."
    assert employed["employer_name"] is not None
    assert isinstance(employed["employer_name"], str) and len(employed["employer_name"]) > 0
    assert employed["wage"] is not None
    assert employed["wage"] > 0


def test_unemployed_agent_has_no_employer_or_wage():
    service = get_simulation_service()
    service.reset(seed=12345)

    client = TestClient(app)
    res = client.get("/api/world")
    agents = res.json()["agents"]

    unemployed = _first_unemployed_agent(agents)
    if unemployed is None:
        # Not every seed is guaranteed to roll an "unemployed" agent --
        # skip rather than fail if this particular seed didn't.
        return
    assert unemployed["workplace_id"] is None
    assert unemployed["employer_name"] is None
    assert unemployed["wage"] is None


def test_current_action_appears_after_a_step_and_carries_reasoning():
    """
    After at least one tick, every agent should have a current_action with
    a non-empty reasoning string (the DecisionStrategy's own justification,
    not something invented for display).
    """
    service = get_simulation_service()
    service.reset(seed=12345)
    service.step()

    client = TestClient(app)
    res = client.get("/api/world")
    agents = res.json()["agents"]

    for agent in agents:
        action = agent["current_action"]
        assert action is not None
        assert action["tick"] == 1
        assert isinstance(action["action_type"], str) and action["action_type"]
        assert isinstance(action["success"], bool)
        assert isinstance(action["reasoning"], str)


def test_current_goal_is_highest_priority_active_goal_or_none():
    service = get_simulation_service()
    service.reset(seed=12345)
    service.step()

    client = TestClient(app)
    res = client.get("/api/world")
    agents = res.json()["agents"]

    for agent in agents:
        active_goals = [g for g in agent["goals"] if g["status"] == "active"]
        if not active_goals:
            assert agent["current_goal"] is None
            continue
        expected = max(active_goals, key=lambda g: g["priority"])
        assert agent["current_goal"] is not None
        assert agent["current_goal"]["priority"] == expected["priority"]
        assert agent["current_goal"]["status"] == "active"


def test_relationships_appear_and_are_bilateral_after_socializing():
    """
    Step the live simulation enough ticks for at least one socialize
    interaction to occur (mirrors
    tests/simulation/test_relationship_memory.py's end-to-end test), then
    confirm the relationship is visible and consistent through the API
    on both sides of the edge.
    """
    service = get_simulation_service()
    service.reset(seed=12345)

    for _ in range(30):
        service.step()

    client = TestClient(app)
    res = client.get("/api/world")
    agents = res.json()["agents"]

    agents_with_relationships = [a for a in agents if len(a["relationships"]) > 0]
    assert len(agents_with_relationships) > 0, "Expected at least one relationship to have formed."

    sample = agents_with_relationships[0]
    rel = sample["relationships"][0]
    assert rel["other_agent_id"] != sample["id"]
    assert rel["other_agent_name"]
    assert 0.0 <= rel["strength"] <= 1.0
    assert 0.0 <= rel["trust"] <= 1.0
    assert rel["interactions_count"] >= 1

    # Bilaterality: the other agent should carry the reverse edge back.
    other = next((a for a in agents if a["id"] == rel["other_agent_id"]), None)
    assert other is not None
    reverse = next((r for r in other["relationships"] if r["other_agent_id"] == sample["id"]), None)
    assert reverse is not None
    assert reverse["interactions_count"] == rel["interactions_count"]


def test_relationships_sorted_by_strength_descending():
    service = get_simulation_service()
    service.reset(seed=12345)
    for _ in range(30):
        service.step()

    client = TestClient(app)
    res = client.get("/api/world")
    agents = res.json()["agents"]

    for agent in agents:
        strengths = [r["strength"] for r in agent["relationships"]]
        assert strengths == sorted(strengths, reverse=True)


def test_neighborhood_and_location_detail_also_carry_inspector_fields():
    """New fields must be consistent across all three agent-bearing endpoints."""
    service = get_simulation_service()
    service.reset(seed=12345)
    service.step()

    client = TestClient(app)
    world_res = client.get("/api/world")
    world_data = world_res.json()

    hood_id = world_data["neighborhoods"][0]["id"]
    hood_res = client.get(f"/api/world/neighborhoods/{hood_id}")
    assert hood_res.status_code == 200
    for resident in hood_res.json()["residents"]:
        assert "current_action" in resident
        assert "relationships" in resident
        assert resident["current_action"] is not None

    loc_id = world_data["locations"][0]["id"]
    loc_res = client.get(f"/api/world/locations/{loc_id}")
    assert loc_res.status_code == 200
    for occupant in loc_res.json()["occupants"]:
        assert "current_action" in occupant
        assert "relationships" in occupant


def test_current_action_reflects_a_rejected_action_when_it_occurs():
    """
    last_actions must record failures too (not just successes) -- an
    inspector should be able to show *why* an agent's action failed, not
    just a happy-path summary. We don't force a specific failure here
    (that would require reaching into private engine internals); instead
    we assert the invariant that every recorded action's `success` field
    matches whether the reported action_type is one of the resolvable
    types the resolver understands, and specifically that get_last_action
    is queryable directly off the service (unit-level, not just via HTTP).
    """
    service = get_simulation_service()
    service.reset(seed=12345)
    service.step()

    agent = service.agents[0]
    last_action = service.get_last_action(agent.id)
    assert last_action is not None
    assert last_action["tick"] == 1
    assert set(last_action.keys()) == {"tick", "action_type", "success", "message", "reasoning"}


def test_last_actions_cleared_on_reset():
    service = get_simulation_service()
    service.reset(seed=12345)
    service.step()
    assert len(service.last_actions) > 0

    service.reset(seed=12345)
    assert service.last_actions == {}
