"""Firefly Hermes Adapter - Top-level HermesAdapter and factory function."""

from __future__ import annotations

import logging
import os
from typing import Any

from .client import FireflyClient
from .tracer import TraceBuilder
from .types import FireflyConfig

log = logging.getLogger(__name__)


class HermesAdapter:
    """High-level adapter that wires together :class:`TraceBuilder` and
    :class:`FireflyClient` for use in Hermes agent pipelines.

    Typical usage::

        adapter = create_adapter()

        # At the end of every agent turn:
        ok = await adapter.on_turn_end(turn_data)

    *turn_data* is the plain ``dict`` produced by Hermes for each round-trip.
    See :class:`~firefly_hermes.tracer.TraceBuilder` for supported keys.
    """

    def __init__(self, config: FireflyConfig) -> None:
        self._config = config
        self._client = FireflyClient(config)
        self._builder = TraceBuilder(project_id=config.project_id)

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def on_turn_end(self, turn_data: dict[str, Any]) -> bool:
        """Process a completed Hermes turn and ship observability data to Firefly.

        The method is intentionally resilient: any error at the build or
        ingest stage is caught and logged rather than propagated, so that
        observability failures never interrupt the calling agent pipeline.

        Args:
            turn_data: Raw turn dictionary from the Hermes runtime.

        Returns:
            ``True`` if the trace was successfully delivered to Firefly,
            ``False`` on any build or network error.
        """
        # --- Layer 1: Build trace model -----------------------------------
        try:
            trace = self._builder.build_trace(turn_data)
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "HermesAdapter.on_turn_end: failed to build trace | error=%r turn_keys=%s",
                exc,
                list(turn_data.keys()),
            )
            return False

        # --- Layer 2: Ingest trace ----------------------------------------
        try:
            ok = await self._client.ingest_trace(trace)
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "HermesAdapter.on_turn_end: unexpected error during ingest | trace_id=%s error=%r",
                trace.trace_id,
                exc,
            )
            return False

        if not ok:
            log.warning(
                "HermesAdapter.on_turn_end: ingest returned False | trace_id=%s",
                trace.trace_id,
            )

        return ok

    # ------------------------------------------------------------------
    # Convenience properties
    # ------------------------------------------------------------------

    @property
    def config(self) -> FireflyConfig:
        """Return the adapter configuration (read-only)."""
        return self._config


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def create_adapter() -> HermesAdapter:
    """Create a :class:`HermesAdapter` from environment variables.

    Required environment variables::

        FIREFLY_API_KEY    – Bearer token for Firefly API authentication.
        FIREFLY_PROJECT_ID – UUID of the target Firefly project.

    Optional environment variables::

        FIREFLY_BASE_URL   – Firefly backend URL (default: http://localhost:8000).

    Raises:
        ValueError: If a required environment variable is missing or empty.
    """
    api_key = os.environ.get("FIREFLY_API_KEY", "").strip()
    if not api_key:
        raise ValueError(
            "FIREFLY_API_KEY environment variable is required but not set. "
            "Copy .env.example to .env and fill in the correct value."
        )

    project_id = os.environ.get("FIREFLY_PROJECT_ID", "").strip()
    if not project_id:
        raise ValueError(
            "FIREFLY_PROJECT_ID environment variable is required but not set. "
            "Copy .env.example to .env and fill in the correct value."
        )

    base_url = os.environ.get("FIREFLY_BASE_URL", "http://localhost:8000").rstrip("/")

    config = FireflyConfig(
        api_key=api_key,
        base_url=base_url,
        project_id=project_id,
    )

    log.debug(
        "create_adapter: Firefly adapter configured | base_url=%s project_id=%s",
        base_url,
        project_id,
    )

    return HermesAdapter(config)
