"""
DecisionStrategy: the interface that RuleBasedStrategy, UtilityStrategy,
and LLMStrategy must all implement identically.

This lives in `schemas/` rather than `agents/` deliberately -- it's a
contract, not an implementation, and other modules (experiments/,
analytics/) need to reference the interface without importing concrete
strategy implementations.

Phase 0 defines the abstract contract only. Concrete strategies are
implemented in Phase 4 (rule/utility) and Phase 9 (LLM).
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.schemas.action_intent import ActionIntent
from app.schemas.agent_context import AgentContext


class DecisionStrategy(ABC):
    """
    Every concrete strategy takes an AgentContext and returns exactly
    one ActionIntent. No strategy may:
      - mutate the AgentContext it receives
      - access anything outside the AgentContext (no direct DB/world
        queries -- if a strategy needs more context, the context
        schema itself must grow, so all strategies see the same shape)
      - raise on "I don't know what to do" -- it must return some
        ActionIntent (e.g. a no-op/idle action), so the DecisionRouter's
        fallback logic (Section 6, decision pipeline) has a uniform
        failure mode to handle.
    """

    mode: str  # set by subclasses to a DecisionMode value

    @abstractmethod
    def decide(self, context: AgentContext) -> ActionIntent:
        """Produce one ActionIntent for the given agent context."""
        raise NotImplementedError
