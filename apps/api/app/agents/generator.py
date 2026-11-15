"""
Deterministic MVP agent generator.

Generates the initial agent population and wires each agent into the World
produced by app/world/generator.py: assigns agents to newly-created
Households (which did not exist yet after Step 1 -- see world/models.py's
Household docstring), and sets each agent's starting location_id to their
household's location.

REPRODUCIBILITY: every random decision here (names, ages, personality
traits, wealth, occupation, household grouping/placement) goes through a
SimulationRNG instance, never Python's global `random`, per core/rng.py's
rule. This module uses `rng.spawn_child("agent_generation")` to draw from
an independent stream, so agent generation consuming N random calls does
not shift whatever the caller's own rng stream would otherwise produce
next -- consistent with core/rng.py's stated purpose for spawn_child().

KNOWN LIMITATION -- flagged, not silently decided (see Step 2 report):
`Agent.id`, `Household.id` (and World/Location ids from Step 1) are
generated with `uuid.uuid4()`, which is NOT derived from SimulationRNG
(Python's uuid4 reads from `os.urandom`, entirely independent of the
`random` module/seed). This means: the same seed reproduces the same
sequence of ages/wealth/personalities/household groupings/occupations,
but NOT the same literal UUID values across two runs. Whether that
matters depends on what "reproducible" needs to mean for this project
(behavioral/statistical reproducibility vs. byte-identical records) --
see the Step 2 report for the two remediation options.
"""

from __future__ import annotations

import uuid

from app.agents.agent import Agent
from app.agents.personality import Personality
from app.core.rng import SimulationRNG
from app.needs.system import NeedsSystem
from app.world.enums import LocationType
from app.world.models import Household, World

FIRST_NAMES: list[str] = [
    "Amara", "Bilal", "Chloe", "Diego", "Elena", "Farid", "Grace", "Hiro",
    "Ines", "Jonas", "Kavya", "Leo", "Mira", "Noah", "Olga", "Priya",
    "Quinn", "Rosa", "Sami", "Tara",
]
LAST_NAMES: list[str] = [
    "Ahmadi", "Baker", "Costa", "Dubois", "Eriksson", "Fischer", "Garcia",
    "Haddad", "Ito", "Jansen", "Kowalski", "Lindgren", "Mensah", "Nowak",
    "Okafor", "Petrov", "Quintero", "Reyes", "Silva", "Tanaka",
]

# Occupation is a plain descriptive string tag for MVP -- NOT linked to any
# real Job/Business entity (the JOBS/BUSINESSES tables and the actual jobs
# system are economy/ scope, not part of this step). "unemployed" is
# included in the pool deliberately so unemployment can exist from tick
# zero without a jobs system having to produce it.
OCCUPATIONS: list[str] = [
    "unemployed", "farmer", "trader", "artisan", "laborer", "clerk", "healer",
]

MIN_AGE = 18
MAX_AGE = 75

MIN_STARTING_WEALTH = 100.0
MAX_STARTING_WEALTH = 5000.0

# Household size distribution, expressed as a weighted pool for
# rng.choice() (SimulationRNG has no weighted-choice primitive, so bias is
# expressed by repeating values). Biases toward 2-person households while
# still allowing 1 and 3. Arbitrary but documented MVP simplification --
# no household-formation model is being claimed here.
HOUSEHOLD_SIZE_POOL: list[int] = [1, 2, 2, 3]


from app.society.relationships import Relationship, RelationshipType


def generate_mvp_agents(world: World, rng: SimulationRNG, population_size: int) -> list[Agent]:
    """
    Generate `population_size` agents, group them into newly-created
    Households, place each household at a random existing residential
    Location in `world`, assign workplaces, initialize needs and social relationships,
    and register the households on `world`.

    `world` is mutated in place (households added). Returns the list of
    generated agents; each agent's household_id/location_id/workplace_id are already
    set and consistent with the households registered on `world`.
    """
    agent_rng = rng.spawn_child("agent_generation")

    residential_locations = world.locations_by_type(LocationType.RESIDENTIAL)
    if not residential_locations:
        raise ValueError(
            "Cannot generate agents: World has no RESIDENTIAL locations. "
            "Build the world with app.world.generator.generate_mvp_world() first."
        )

    agents = [_generate_one_agent(agent_rng) for _ in range(population_size)]
    _assign_households(world, agents, residential_locations, agent_rng)
    _assign_workplaces(world, agents, agent_rng)
    _initialize_social_bonds(world, agents)

    for agent in agents:
        NeedsSystem.initialize_needs(agent, agent_rng)

    return agents



def _generate_one_agent(agent_rng: SimulationRNG) -> Agent:
    return Agent(
        id=agent_rng.uuid(),
        name=_generate_name(agent_rng),
        age=agent_rng.randint(MIN_AGE, MAX_AGE),
        personality=_generate_personality(agent_rng),
        occupation=agent_rng.choice(OCCUPATIONS),
        wealth=round(
            MIN_STARTING_WEALTH
            + agent_rng.random() * (MAX_STARTING_WEALTH - MIN_STARTING_WEALTH),
            2,
        ),
        social_status=round(agent_rng.random(), 3),
    )


def _generate_name(agent_rng: SimulationRNG) -> str:
    return f"{agent_rng.choice(FIRST_NAMES)} {agent_rng.choice(LAST_NAMES)}"


def _generate_personality(agent_rng: SimulationRNG) -> Personality:
    return Personality(
        openness=round(agent_rng.random(), 3),
        conscientiousness=round(agent_rng.random(), 3),
        extraversion=round(agent_rng.random(), 3),
        agreeableness=round(agent_rng.random(), 3),
        neuroticism=round(agent_rng.random(), 3),
    )


def _assign_households(
    world: World,
    agents: list[Agent],
    residential_locations: list,
    agent_rng: SimulationRNG,
) -> None:
    """
    Partition `agents` into households of size drawn from
    HOUSEHOLD_SIZE_POOL, each placed at a randomly chosen residential
    location, and register every household on `world`.

    Iteration order over agents is the order they were generated in
    (already deterministic given agent_rng's seed) -- not reshuffled here,
    since generation order is already an RNG-derived sequence and
    reshuffling it would just be consuming more RNG calls for no
    additional value at this step.
    """
    remaining = list(agents)
    while remaining:
        size = min(agent_rng.choice(HOUSEHOLD_SIZE_POOL), len(remaining))
        members, remaining = remaining[:size], remaining[size:]

        residence = agent_rng.choice(residential_locations)
        household = Household(id=agent_rng.uuid(), location_id=residence.id)

        for member in members:
            member.household_id = household.id
            member.location_id = residence.id
            household.member_agent_ids.append(member.id)

        world.add_household(household)


def _assign_workplaces(world: World, agents: list[Agent], agent_rng: SimulationRNG) -> None:
    """Assign employed agents to a specific workplace in their neighborhood."""
    workplaces_by_hood: dict[uuid.UUID, list] = {}
    for hood_id in world.neighborhoods:
        workplaces_by_hood[hood_id] = [
            loc for loc in world.locations_in_neighborhood(hood_id)
            if loc.location_type == LocationType.WORKPLACE
        ]

    for agent in agents:
        if agent.occupation != "unemployed" and agent.location_id:
            residence = world.get_location(agent.location_id)
            hood_workplaces = workplaces_by_hood.get(residence.neighborhood_id, [])
            if hood_workplaces:
                chosen_wp = agent_rng.choice(hood_workplaces)
                agent.workplace_id = chosen_wp.id


def _initialize_social_bonds(world: World, agents: list[Agent]) -> None:
    """Initialize initial family (housemate) and coworker social bonds."""
    agents_by_id = {a.id: a for a in agents}

    # 1. Housemate / Family bonds
    for household in world.households.values():
        member_ids = household.member_agent_ids
        for id_a in member_ids:
            for id_b in member_ids:
                if id_a != id_b and id_a in agents_by_id and id_b in agents_by_id:
                    agents_by_id[id_a].relationships[id_b] = Relationship(
                        agent_id=id_a,
                        other_agent_id=id_b,
                        relationship_type=RelationshipType.HOUSEMATE,
                        strength=0.75,
                        trust=0.80,
                    )

    # 2. Workplace colleague bonds
    workplace_groups: dict[uuid.UUID, list[Agent]] = {}
    for agent in agents:
        if agent.workplace_id:
            workplace_groups.setdefault(agent.workplace_id, []).append(agent)

    for colleagues in workplace_groups.values():
        for col_a in colleagues:
            for col_b in colleagues:
                if col_a.id != col_b.id and col_b.id not in col_a.relationships:
                    col_a.relationships[col_b.id] = Relationship(
                        agent_id=col_a.id,
                        other_agent_id=col_b.id,
                        relationship_type=RelationshipType.COLLEAGUE,
                        strength=0.35,
                        trust=0.45,
                    )

