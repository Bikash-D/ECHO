"""
Need enums for ECHO agents.
"""

from enum import Enum


class NeedType(str, Enum):
    """
    Core biological and psychological needs for MVP agents.

    Work is deliberately deferred to economic/goal systems.
    """

    HUNGER = "hunger"
    ENERGY = "energy"
    SOCIAL = "social"
