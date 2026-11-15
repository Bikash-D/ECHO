"""
FastAPI routes for ECHO World topology, locations, neighborhoods, and society telemetry.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException

from app.agents.agent import Agent
from app.economy.wages import get_wage_for_occupation
from app.schemas.world_api import (
    AgentActionResponse,
    AgentSummaryResponse,
    BusinessResponse,
    CityResponse,
    GoalResponse,
    LocationDetailResponse,
    LocationResponse,
    NeedResponse,
    NeighborhoodDetailResponse,
    NeighborhoodResponse,
    PersonalityResponse,
    RelationshipResponse,
    SocietyStatisticsResponse,
    WorldResponse,
)
from app.simulation.state import get_simulation_service
from app.world.enums import interior_archetype_for
from app.world.models import Location, World

router = APIRouter()


def _location_type_str(loc: Location) -> str:
    return loc.location_type.value if hasattr(loc.location_type, "value") else str(loc.location_type)


def _venue_kind_str(loc: Location) -> str:
    return loc.venue_kind.value if hasattr(loc.venue_kind, "value") else str(loc.venue_kind)


def _architectural_style_str(loc: Location) -> str:
    return loc.architectural_style.value if hasattr(loc.architectural_style, "value") else str(loc.architectural_style)


def _location_ontology_fields(loc: Location) -> dict[str, Any]:
    """
    The venue_kind/architectural_style/floor_count/is_public/
    interior_archetype fields every LocationResponse and
    LocationDetailResponse now carries (Living City milestone Phase A).
    Centralized here so the three call sites below that build those
    responses can't drift out of sync with each other on what this
    metadata actually is.
    """
    return {
        "venue_kind": _venue_kind_str(loc),
        "architectural_style": _architectural_style_str(loc),
        "floor_count": loc.floor_count,
        "is_public": bool(loc.is_public),
        "interior_archetype": interior_archetype_for(loc.venue_kind),
    }


def _format_business(business: Any | None) -> BusinessResponse | None:
    if business is None:
        return None
    return BusinessResponse(
        id=business.id,
        location_id=business.location_id,
        name=business.name,
        cash=round(business.cash, 2),
    )


def _format_agent(
    agent: Agent,
    location_to_neighborhood: dict[uuid.UUID, uuid.UUID],
    world: World,
    agents_by_id: dict[uuid.UUID, Agent],
    last_actions: dict[uuid.UUID, dict[str, Any]],
) -> AgentSummaryResponse:
    hood_id = location_to_neighborhood.get(agent.location_id, uuid.UUID(int=0))

    needs_list: list[NeedResponse] = []
    if isinstance(agent.needs, dict):
        for n in agent.needs.values():
            needs_list.append(NeedResponse(need_type=str(n.need_type.value if hasattr(n.need_type, 'value') else n.need_type), value=round(float(n.value), 2)))
    elif isinstance(agent.needs, list):
        for n in agent.needs:
            needs_list.append(NeedResponse(need_type=str(n.need_type.value if hasattr(n.need_type, 'value') else n.need_type), value=round(float(n.value), 2)))

    goals_list: list[GoalResponse] = []
    current_goal: GoalResponse | None = None
    for g in agent.goals:
        status_str = str(g.status.value if hasattr(g.status, 'value') else g.status)
        goal_resp = GoalResponse(
            id=g.id,
            description=g.description,
            priority=g.priority,
            status=status_str,
            progress=round(float(g.progress), 2),
        )
        goals_list.append(goal_resp)
        # The goal an agent is actually pursuing right now: the
        # highest-priority ACTIVE goal. GoalsSystem (app/goals/system.py)
        # doesn't itself track a single "current" goal, but priority +
        # status already fully determine it, so this is read-only
        # derivation, not new domain state.
        if status_str == "active" and (current_goal is None or g.priority > current_goal.priority):
            current_goal = goal_resp

    # Employment detail: derived from the existing workplace_id/occupation
    # fields plus the deterministic wage table (economy/wages.py) already
    # used by the "work" action -- not new domain state.
    employer_name: str | None = None
    wage: float | None = None
    if agent.workplace_id is not None:
        workplace = world.locations.get(agent.workplace_id)
        employer_name = workplace.name if workplace else None
        wage = get_wage_for_occupation(agent.occupation)

    # Relationships: app/society/relationships.py's Relationship dataclass
    # already tracks all of this per bilateral edge -- just reading it out
    # for the inspector, sorted so the strongest connections surface first.
    relationships_list: list[RelationshipResponse] = []
    for other_id, rel in agent.relationships.items():
        other_agent = agents_by_id.get(other_id)
        relationships_list.append(
            RelationshipResponse(
                other_agent_id=other_id,
                other_agent_name=other_agent.name if other_agent else "Unknown",
                relationship_type=rel.type_str,
                strength=round(rel.strength, 3),
                trust=round(rel.trust, 3),
                interactions_count=rel.interactions_count,
                last_interaction_tick=rel.last_interaction_tick,
            )
        )
    relationships_list.sort(key=lambda r: r.strength, reverse=True)

    # Current action / decision context: the most recent tick's Decision
    # + Action Resolution outcome for this specific agent (see
    # SimulationService.last_actions). None if the agent hasn't been
    # through a step yet since the last reset.
    last_action = last_actions.get(agent.id)
    current_action = AgentActionResponse(**last_action) if last_action else None

    return AgentSummaryResponse(
        id=agent.id,
        name=agent.name,
        age=agent.age,
        occupation=agent.occupation,
        wealth=round(agent.wealth, 2),
        social_status=round(agent.social_status, 3),
        location_id=agent.location_id if agent.location_id else uuid.UUID(int=0),
        neighborhood_id=hood_id,
        household_id=agent.household_id,
        workplace_id=agent.workplace_id,
        employer_name=employer_name,
        wage=wage,
        personality=PersonalityResponse(
            openness=agent.personality.openness,
            conscientiousness=agent.personality.conscientiousness,
            extraversion=agent.personality.extraversion,
            agreeableness=agent.personality.agreeableness,
            neuroticism=agent.personality.neuroticism,
        ),
        needs=needs_list,
        goals=goals_list,
        current_goal=current_goal,
        relationships=relationships_list,
        current_action=current_action,
    )


@router.get("/world", response_model=WorldResponse)
def get_world() -> WorldResponse:
    """Return the complete current World topology, locations, agents, and statistics."""
    service = get_simulation_service()
    world = service.world
    agents = service.agents
    agents_by_id: dict[uuid.UUID, Agent] = {a.id: a for a in agents}

    # Map location_id -> neighborhood_id and location_id -> occupant list
    location_to_hood: dict[uuid.UUID, uuid.UUID] = {
        loc.id: loc.neighborhood_id for loc in world.locations.values()
    }
    occupants_by_location: dict[uuid.UUID, list[uuid.UUID]] = {
        loc_id: [] for loc_id in world.locations
    }
    for a in agents:
        if a.location_id in occupants_by_location:
            occupants_by_location[a.location_id].append(a.id)

    # Calculate neighborhood population
    hood_population: dict[uuid.UUID, int] = {hood_id: 0 for hood_id in world.neighborhoods}
    for loc_id, occupant_ids in occupants_by_location.items():
        hood_id = location_to_hood.get(loc_id)
        if hood_id and hood_id in hood_population:
            hood_population[hood_id] += len(occupant_ids)

    # Build Neighborhoods list
    neighborhoods_resp = [
        NeighborhoodResponse(
            id=hood.id,
            name=hood.name,
            city_id=hood.city_id,
            number_of_locations=len(hood.location_ids),
            population=hood_population.get(hood.id, 0),
            location_ids=hood.location_ids,
        )
        for hood in world.neighborhoods.values()
    ]

    # Build Locations list
    locations_resp = [
        LocationResponse(
            id=loc.id,
            name=loc.name,
            type=_location_type_str(loc),
            neighborhood_id=loc.neighborhood_id,
            capacity=loc.capacity,
            occupancy=len(occupants_by_location.get(loc.id, [])),
            occupant_ids=occupants_by_location.get(loc.id, []),
            business=_format_business(world.businesses.get(loc.id)),
            **_location_ontology_fields(loc),
        )
        for loc in world.locations.values()
    ]

    # Format Agents list
    agents_resp = [
        _format_agent(a, location_to_hood, world, agents_by_id, service.last_actions) for a in agents
    ]

    # Compute Society Statistics
    total_pop = len(agents)
    avg_wealth = sum(a.wealth for a in agents) / total_pop if total_pop > 0 else 0.0
    avg_status = sum(a.social_status for a in agents) / total_pop if total_pop > 0 else 0.0

    # Needs averages
    need_sums: dict[str, float] = {}
    need_counts: dict[str, int] = {}
    for a in agents:
        if isinstance(a.needs, dict):
            for n in a.needs.values():
                k = str(n.need_type.value if hasattr(n.need_type, "value") else n.need_type)
                need_sums[k] = need_sums.get(k, 0.0) + float(n.value)
                need_counts[k] = need_counts.get(k, 0) + 1
    avg_needs = {k: round(need_sums[k] / need_counts[k], 2) for k in need_sums if need_counts[k] > 0}

    # Occupations distribution
    occ_dist: dict[str, int] = {}
    for a in agents:
        occ_dist[a.occupation] = occ_dist.get(a.occupation, 0) + 1

    total_business_cash = round(sum(b.cash for b in world.businesses.values()), 2)

    stats = SocietyStatisticsResponse(
        total_population=total_pop,
        average_wealth=round(avg_wealth, 2),
        average_social_status=round(avg_status, 3),
        average_needs=avg_needs,
        occupation_distribution=occ_dist,
        total_business_cash=total_business_cash,
    )

    return WorldResponse(
        city=CityResponse(
            id=world.city.id,
            name=world.city.name,
            neighborhood_count=len(world.neighborhoods),
        ),
        tick=world.tick,
        status=service.status,
        neighborhoods=neighborhoods_resp,
        locations=locations_resp,
        agents=agents_resp,
        statistics=stats,
    )


@router.get("/world/neighborhoods/{neighborhood_id}", response_model=NeighborhoodDetailResponse)
def get_neighborhood_detail(neighborhood_id: uuid.UUID) -> NeighborhoodDetailResponse:
    """Return detailed neighborhood data with locations, breakdown, and resident agents."""
    service = get_simulation_service()
    world = service.world

    if neighborhood_id not in world.neighborhoods:
        raise HTTPException(status_code=404, detail="Neighborhood not found")

    hood = world.get_neighborhood(neighborhood_id)
    location_to_hood = {loc.id: loc.neighborhood_id for loc in world.locations.values()}
    agents_by_id: dict[uuid.UUID, Agent] = {a.id: a for a in service.agents}

    # Locations in this neighborhood
    locs = [world.get_location(loc_id) for loc_id in hood.location_ids]
    residents = service.get_agents_in_neighborhood(neighborhood_id)

    # Locations with occupancy
    locations_resp: list[LocationResponse] = []
    breakdown: dict[str, int] = {}
    for loc in locs:
        occupants = [a.id for a in residents if a.location_id == loc.id]
        loc_type = _location_type_str(loc)
        breakdown[loc_type] = breakdown.get(loc_type, 0) + 1
        locations_resp.append(
            LocationResponse(
                id=loc.id,
                name=loc.name,
                type=loc_type,
                neighborhood_id=loc.neighborhood_id,
                capacity=loc.capacity,
                occupancy=len(occupants),
                occupant_ids=occupants,
                business=_format_business(world.businesses.get(loc.id)),
                **_location_ontology_fields(loc),
            )
        )

    residents_resp = [
        _format_agent(a, location_to_hood, world, agents_by_id, service.last_actions) for a in residents
    ]

    return NeighborhoodDetailResponse(
        id=hood.id,
        name=hood.name,
        city_id=hood.city_id,
        population=len(residents),
        locations=locations_resp,
        breakdown=breakdown,
        residents=residents_resp,
    )


@router.get("/world/locations/{location_id}", response_model=LocationDetailResponse)
def get_location_detail(location_id: uuid.UUID) -> LocationDetailResponse:
    """Return specific location details and the real agents currently present."""
    service = get_simulation_service()
    world = service.world

    if location_id not in world.locations:
        raise HTTPException(status_code=404, detail="Location not found")

    loc = world.get_location(location_id)
    hood = world.get_neighborhood(loc.neighborhood_id)
    location_to_hood = {l.id: l.neighborhood_id for l in world.locations.values()}
    agents_by_id: dict[uuid.UUID, Agent] = {a.id: a for a in service.agents}

    occupants = service.get_agents_at_location(location_id)
    occupants_resp = [
        _format_agent(a, location_to_hood, world, agents_by_id, service.last_actions) for a in occupants
    ]

    return LocationDetailResponse(
        id=loc.id,
        name=loc.name,
        type=_location_type_str(loc),
        neighborhood_id=loc.neighborhood_id,
        neighborhood_name=hood.name,
        capacity=loc.capacity,
        occupancy=len(occupants),
        occupants=occupants_resp,
        business=_format_business(world.businesses.get(loc.id)),
        **_location_ontology_fields(loc),
    )
