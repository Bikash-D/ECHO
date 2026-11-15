"""
Structured logging setup for ECHO.

Phase 0 provides configuration only: a single call that configures
Python's stdlib logging with a consistent format. Simulation-specific
structured fields (tick, simulation_id, agent_id) will be added as
adapters/filters once the simulation engine actually emits them.
"""

import logging
import sys

from app.core.config import get_settings

_CONFIGURED = False


def configure_logging() -> None:
    """
    Idempotent logging configuration. Safe to call multiple times
    (e.g. once from the API entrypoint, once from a test harness or
    a headless experiment script) without duplicating handlers.
    """
    global _CONFIGURED
    if _CONFIGURED:
        return

    settings = get_settings()

    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )

    root = logging.getLogger()
    root.setLevel(settings.log_level.upper())
    root.handlers = [handler]

    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    """Standard accessor so every module logs under a consistent namespace."""
    configure_logging()
    return logging.getLogger(name)
