"""
Tests for World and Simulation API endpoints.
"""

from fastapi.testclient import TestClient
from app.main import app
from app.simulation.state import get_simulation_service


def test_get_world_structure_and_population():
    # Reset state to ensure clean test
    service = get_simulation_service()
    service.reset(seed=12345)

    client = TestClient(app)
    response = client.get("/api/world")
    assert response.status_code == 200
    data = response.json()

    # Verify City
    assert data["city"]["name"] == "Echo City"
    assert data["city"]["neighborhood_count"] == 5

    # Verify Neighborhoods (exactly 5)
    neighborhoods = data["neighborhoods"]
    assert len(neighborhoods) == 5
    hood_names = {n["name"] for n in neighborhoods}
    assert hood_names == {"Riverside", "Downtown", "Hillcrest", "Eastgate", "Millbrook"}

    # Verify Locations (exactly 40, 8 per neighborhood)
    locations = data["locations"]
    assert len(locations) == 40
    valid_location_ids = {l["id"] for l in locations}

    # Verify Agents (exactly 100)
    agents = data["agents"]
    assert len(agents) == 100

    # Verify every agent has a valid location
    total_occupancy = 0
    for agent in agents:
        assert agent["location_id"] in valid_location_ids
        assert len(agent["needs"]) == 3
        assert agent["personality"]["openness"] >= 0.0

    # Verify location occupancy counts
    for loc in locations:
        total_occupancy += loc["occupancy"]
        assert len(loc["occupant_ids"]) == loc["occupancy"]

    assert total_occupancy == 100

    # Verify statistics
    stats = data["statistics"]
    assert stats["total_population"] == 100
    assert stats["average_wealth"] > 0
    assert "energy" in [k.lower() for k in stats["average_needs"].keys()]


def test_get_neighborhood_detail():
    service = get_simulation_service()
    service.reset(seed=12345)

    client = TestClient(app)
    world_res = client.get("/api/world")
    first_hood_id = world_res.json()["neighborhoods"][0]["id"]

    res = client.get(f"/api/world/neighborhoods/{first_hood_id}")
    assert res.status_code == 200
    hood_data = res.json()
    assert hood_data["id"] == first_hood_id
    assert len(hood_data["locations"]) == 8
    assert sum(hood_data["breakdown"].values()) == 8
    assert hood_data["population"] == len(hood_data["residents"])


def test_get_location_detail():
    service = get_simulation_service()
    service.reset(seed=12345)

    client = TestClient(app)
    world_res = client.get("/api/world")
    first_loc_id = world_res.json()["locations"][0]["id"]

    res = client.get(f"/api/world/locations/{first_loc_id}")
    assert res.status_code == 200
    loc_data = res.json()
    assert loc_data["id"] == first_loc_id
    assert loc_data["occupancy"] == len(loc_data["occupants"])


# -- Living City milestone Phase A: location semantic ontology exposed via API --

_VALID_VENUE_KINDS_BY_TYPE = {
    "residential": {"detached_house", "townhouse", "small_apartment", "family_house"},
    "workplace": {"office", "clinic", "workshop", "service_office"},
    "market": {"grocery", "cafe", "general_store"},
    "leisure": {"park", "community_center", "small_plaza"},
}


def test_world_locations_expose_venue_kind_metadata():
    service = get_simulation_service()
    service.reset(seed=12345)

    client = TestClient(app)
    res = client.get("/api/world")
    assert res.status_code == 200
    locations = res.json()["locations"]
    assert len(locations) == 40

    for loc in locations:
        loc_type = loc["type"]
        assert loc_type in _VALID_VENUE_KINDS_BY_TYPE
        assert loc["venue_kind"] in _VALID_VENUE_KINDS_BY_TYPE[loc_type], (
            f"{loc['name']} ({loc_type}) has venue_kind {loc['venue_kind']!r}, "
            f"not a valid kind for that type"
        )
        assert isinstance(loc["architectural_style"], str) and loc["architectural_style"]
        assert isinstance(loc["floor_count"], int) and loc["floor_count"] >= 1
        assert isinstance(loc["is_public"], bool)
        assert isinstance(loc["interior_archetype"], str) and loc["interior_archetype"]

        expected_public = loc_type in ("market", "leisure")
        assert loc["is_public"] == expected_public


def test_world_venue_kind_assignment_is_reproducible_for_same_seed():
    service = get_simulation_service()
    client = TestClient(app)

    service.reset(seed=777)
    first = client.get("/api/world").json()["locations"]

    service.reset(seed=777)
    second = client.get("/api/world").json()["locations"]

    first_by_name = {loc["name"]: loc["venue_kind"] for loc in first}
    second_by_name = {loc["name"]: loc["venue_kind"] for loc in second}
    assert first_by_name == second_by_name


def test_neighborhood_detail_locations_also_expose_venue_kind():
    service = get_simulation_service()
    service.reset(seed=12345)

    client = TestClient(app)
    first_hood_id = client.get("/api/world").json()["neighborhoods"][0]["id"]
    hood_data = client.get(f"/api/world/neighborhoods/{first_hood_id}").json()

    for loc in hood_data["locations"]:
        assert "venue_kind" in loc
        assert loc["venue_kind"] in _VALID_VENUE_KINDS_BY_TYPE[loc["type"]]


def test_location_detail_exposes_venue_kind():
    service = get_simulation_service()
    service.reset(seed=12345)

    client = TestClient(app)
    first_loc_id = client.get("/api/world").json()["locations"][0]["id"]
    loc_data = client.get(f"/api/world/locations/{first_loc_id}").json()

    assert loc_data["venue_kind"] in _VALID_VENUE_KINDS_BY_TYPE[loc_data["type"]]
    assert loc_data["interior_archetype"]


def test_simulation_lifecycle_controls():
    service = get_simulation_service()
    service.reset(seed=12345)

    client = TestClient(app)

    # State check
    res = client.get("/api/simulation/state")
    assert res.status_code == 200
    assert res.json()["tick"] == 0

    # Step tick
    step_res = client.post("/api/simulation/step")
    assert step_res.status_code == 200
    assert step_res.json()["tick"] == 1

    # Start and Pause
    start_res = client.post("/api/simulation/start")
    assert start_res.json()["status"] == "running"

    pause_res = client.post("/api/simulation/pause")
    assert pause_res.json()["status"] == "paused"

    # Reset
    reset_res = client.post("/api/simulation/reset")
    assert reset_res.json()["tick"] == 0
