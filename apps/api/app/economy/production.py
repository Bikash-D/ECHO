"""
Minimal production model: the economic value one work shift generates.

This is the missing link the economy milestone adds. Before this module,
a completed "work" action paid an agent a wage with no corresponding
economic event on the employer's side -- the wage came from nowhere and
went nowhere but the agent's wallet. That is exactly the anti-pattern
flagged in the project brief ("agents should not simply receive money
because the simulation says work happened").

Deliberately NOT a market/production system: no supply/demand, no
per-business variation, no randomness. Output value is a fixed,
deterministic multiple of the occupation's wage (see economy/wages.py),
so it needs no SimulationRNG draw and stays reproducible under the same
seed rule as everything else. The multiplier being >1.0 is what makes the
work action a genuine value-creating act instead of a wash: the business
receives more than it pays out, so its cash actually grows from
production, matching the causal chain in the brief:

    work -> occupation/workplace productive activity -> output/value
         -> business revenue -> wage -> agent wealth

Extending this into a real production system (variable productivity,
diminishing returns, capital/equipment, per-business goods) is out of
scope for this milestone -- flagged here, not silently expanded.
"""

from __future__ import annotations

from app.economy.wages import get_wage_for_occupation

# Fixed, deterministic markup between what a shift costs the business
# (the wage) and what it produces (output_value). Arbitrary but
# documented MVP simplification -- not a claim about real productivity
# economics. Applies uniformly across occupations; occupation-specific
# productivity variation is future scope, not needed for this milestone.
OUTPUT_MULTIPLIER = 1.5


def get_output_value_for_occupation(occupation: str) -> float:
    """Deterministic economic output for one work shift, given occupation."""
    return round(get_wage_for_occupation(occupation) * OUTPUT_MULTIPLIER, 2)
