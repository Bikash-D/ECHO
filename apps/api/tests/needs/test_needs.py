"""
Phase 1 Step 3 tests: Needs domain model and NeedsSystem.
"""

import uuid

from app.agents.agent import Agent
from app.agents.personality import Personality
from app.core.rng import SimulationRNG
from app.needs.enums import NeedType
from app.needs.models import Need
from app.needs.system import NeedsSystem
from app.schemas.agent_context import NeedSnapshot


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
        occupation="trader",
        wealth=1000.0,
    )


# -- Need Model Tests --------------------------------------------------------


def test_need_constructs_with_valid_values():
    need = Need(need_type=NeedType.HUNGER, value=0.8, decay_rate=0.02)
    assert need.need_type == NeedType.HUNGER
    assert need.value == 0.8
    assert need.decay_rate == 0.02
    assert need.type_str == "hunger"


def test_need_accepts_string_type():
    need = Need(need_type="energy", value=0.5, decay_rate=0.01)
    assert need.need_type == NeedType.ENERGY
    assert need.type_str == "energy"


def test_need_rejects_negative_value():
    try:
        Need(need_type=NeedType.HUNGER, value=-0.1, decay_rate=0.02)
        assert False, "Should have raised ValueError"
    except ValueError:
        pass


def test_need_rejects_value_greater_than_one():
    try:
        Need(need_type=NeedType.HUNGER, value=1.1, decay_rate=0.02)
        assert False, "Should have raised ValueError"
    except ValueError:
        pass


def test_need_rejects_negative_decay_rate():
    try:
        Need(need_type=NeedType.HUNGER, value=0.5, decay_rate=-0.01)
        assert False, "Should have raised ValueError"
    except ValueError:
        pass


def test_need_to_snapshot_returns_valid_schema():
    need = Need(need_type=NeedType.SOCIAL, value=0.75, decay_rate=0.015)
    snapshot = need.to_snapshot()
    assert isinstance(snapshot, NeedSnapshot)
    assert snapshot.need_type == "social"
    assert snapshot.value == 0.75


# -- NeedsSystem Initialization Tests ---------------------------------------


def test_initialize_needs_without_rng_gives_default_full_needs():
    agent = _make_agent()
    needs = NeedsSystem.initialize_needs(agent)

    assert NeedType.HUNGER in needs
    assert NeedType.ENERGY in needs
    assert NeedType.SOCIAL in needs

    assert needs[NeedType.HUNGER].value == 1.0
    assert needs[NeedType.ENERGY].value == 1.0
    assert needs[NeedType.SOCIAL].value == 1.0

    assert agent.needs == needs


def test_initialize_needs_with_rng_is_deterministic():
    rng_a = SimulationRNG(seed=42)
    rng_b = SimulationRNG(seed=42)

    needs_a = NeedsSystem.initialize_needs(rng=rng_a)
    needs_b = NeedsSystem.initialize_needs(rng=rng_b)

    for k in NeedType:
        assert needs_a[k].value == needs_b[k].value
        assert needs_a[k].decay_rate == needs_b[k].decay_rate
        assert 0.7 <= needs_a[k].value <= 1.0


# -- NeedsSystem Decay Tests ------------------------------------------------


def test_decay_reduces_need_values_deterministically():
    needs = {
        NeedType.HUNGER: Need(need_type=NeedType.HUNGER, value=1.0, decay_rate=0.02),
        NeedType.ENERGY: Need(need_type=NeedType.ENERGY, value=0.5, decay_rate=0.01),
        NeedType.SOCIAL: Need(need_type=NeedType.SOCIAL, value=0.8, decay_rate=0.015),
    }

    NeedsSystem.decay(needs)

    assert needs[NeedType.HUNGER].value == 0.98
    assert needs[NeedType.ENERGY].value == 0.49
    assert needs[NeedType.SOCIAL].value == 0.785


def test_decay_clamps_at_zero():
    need = Need(need_type=NeedType.HUNGER, value=0.01, decay_rate=0.05)
    NeedsSystem.decay([need])
    assert need.value == 0.0

    # Decaying further stays at 0.0
    NeedsSystem.decay([need])
    assert need.value == 0.0


# -- NeedsSystem Satisfaction Tests -----------------------------------------


def test_satisfy_increases_need_value():
    need = Need(need_type=NeedType.HUNGER, value=0.4, decay_rate=0.02)
    NeedsSystem.satisfy(need, 0.3)
    assert need.value == 0.7


def test_satisfy_clamps_at_one():
    need = Need(need_type=NeedType.HUNGER, value=0.9, decay_rate=0.02)
    NeedsSystem.satisfy(need, 0.5)
    assert need.value == 1.0


def test_satisfy_rejects_negative_amount():
    need = Need(need_type=NeedType.HUNGER, value=0.5, decay_rate=0.02)
    try:
        NeedsSystem.satisfy(need, -0.1)
        assert False, "Should have raised ValueError"
    except ValueError:
        pass


def test_is_depleted_checks_threshold():
    need_full = Need(need_type=NeedType.HUNGER, value=0.8, decay_rate=0.02)
    need_depleted = Need(need_type=NeedType.HUNGER, value=0.25, decay_rate=0.02)
    need_boundary = Need(need_type=NeedType.HUNGER, value=0.3, decay_rate=0.02)

    assert not NeedsSystem.is_depleted(need_full, threshold=0.3)
    assert NeedsSystem.is_depleted(need_depleted, threshold=0.3)
    assert NeedsSystem.is_depleted(need_boundary, threshold=0.3)


def test_needs_initialization_differs_across_seeds():
    rng_a = SimulationRNG(seed=10)
    rng_b = SimulationRNG(seed=20)

    needs_a = NeedsSystem.initialize_needs(rng=rng_a)
    needs_b = NeedsSystem.initialize_needs(rng=rng_b)

    values_a = [n.value for n in needs_a.values()]
    values_b = [n.value for n in needs_b.values()]
    assert values_a != values_b


def test_multi_step_decay_and_satisfaction_cycle():
    need = Need(need_type=NeedType.ENERGY, value=1.0, decay_rate=0.05)
    for _ in range(10):
        NeedsSystem.decay([need])
    assert abs(need.value - 0.5) < 1e-5

    NeedsSystem.satisfy(need, 0.3)
    assert abs(need.value - 0.8) < 1e-5

    NeedsSystem.satisfy(need, 0.5)
    assert need.value == 1.0
