"""
Minimal wage model.

Deliberately NOT a market/labor-supply system: no per-tick randomness,
no negotiation, no inflation, no per-business economics. This is the
smallest genuine link between an agent's `occupation` attribute (which
existed as a purely descriptive tag -- see agents/generator.py's
OCCUPATIONS docstring) and the economic consequence of the "work"
action: which occupation actually pays what.

Every value is a fixed constant, deterministic given `occupation`, and
looked up the same way every tick -- so this stays reproducible under
the same SimulationRNG seed rule as everything else, without needing
to consume the RNG at all (the wage doesn't vary; only whether an
agent is present at their workplace to earn it does).

Extending this into a real economy (supply/demand pricing, employer
budgets, promotions, taxation) is explicitly out of scope for this
milestone -- flagged here, not silently expanded.
"""

from __future__ import annotations

# Keyed on the exact OCCUPATIONS pool in agents/generator.py. "unemployed"
# maps to 0.0 for lookup completeness/safety, but is unreachable in
# practice: an agent with occupation="unemployed" is never assigned a
# workplace_id (see agents/generator.py::_assign_workplaces), and the
# work action requires a genuine employment relationship (see
# simulation/action_resolver.py), so an unemployed agent can never
# reach this lookup with a valid work action.
OCCUPATION_WAGES: dict[str, float] = {
    "unemployed": 0.0,
    "laborer": 10.0,
    "farmer": 12.0,
    "clerk": 14.0,
    "artisan": 16.0,
    "trader": 18.0,
    "healer": 20.0,
}

# Defensive fallback only -- every value in agents/generator.py's
# OCCUPATIONS pool is covered above. Not expected to be exercised by
# any currently-generated agent.
DEFAULT_WAGE = 12.0


def get_wage_for_occupation(occupation: str) -> float:
    """Deterministic wage for one work shift, given an agent's occupation."""
    return OCCUPATION_WAGES.get(occupation, DEFAULT_WAGE)
