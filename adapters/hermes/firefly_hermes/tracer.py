"""Firefly Hermes Adapter - TraceBuilder converts raw turn data into Firefly payloads."""

from __future__ import annotations

import logging
import time
from typing import Any
from uuid import uuid4

from .types import (
    FireflySpanIngest,
    FireflyTraceIngest,
    SpanStatus,
    SpanType,
)

log = logging.getLogger(__name__)

_PLATFORM = "hermes"


class TraceBuilder:
    """Converts Hermes turn dictionaries into Firefly ingest models.

    A *turn* is the unit of work Hermes produces for each agent round-trip.
    It is a plain ``dict`` whose keys are described in the Firefly
    ``Langfuse-OpenClaw-Python-Trace-Context-映射规范`` specification.

    Minimum expected keys (all optional — missing keys are silently skipped)::

        {
          "trace_id":   str | None,   # propagated from upstream, else generated
          "session_id": str | None,
          "user_id":    str | None,
          "agent_id":   str | None,
          "turn_id":    str | None,
          "channel":    str | None,
          "name":       str | None,   # trace / turn label
          "input":      Any,
          "output":     Any,
          "start_ts":   float | None, # epoch seconds — used to compute latency
          "end_ts":     float | None,
          "status":     "ok" | "error" | "running" | None,
          "tags":       list[str] | None,
          "spans":      list[dict] | None,  # raw span dicts (see build_span)
          "metadata":   dict | None,
        }
    """

    def __init__(self, project_id: str) -> None:
        self._project_id = project_id

    # ------------------------------------------------------------------
    # Public builders
    # ------------------------------------------------------------------

    def build_trace(self, turn_data: dict[str, Any]) -> FireflyTraceIngest:
        """Convert a Hermes turn dict into a :class:`FireflyTraceIngest`.

        Unknown / extra keys in *turn_data* are folded into ``metadata``.
        """
        trace_id = turn_data.get("trace_id") or str(uuid4())

        # Compute latency when both timestamps are present.
        latency_ms = self._latency(turn_data.get("start_ts"), turn_data.get("end_ts"))

        # Aggregate token counts from child spans when the trace itself
        # does not carry a total_tokens value.
        total_tokens: int | None = turn_data.get("total_tokens")

        raw_spans: list[dict[str, Any]] = turn_data.get("spans") or []
        built_spans: list[FireflySpanIngest] = []
        for raw in raw_spans:
            try:
                span = self.build_span(trace_id=trace_id, span_type=raw.get("type", SpanType.agent), **raw)
                built_spans.append(span)
                if total_tokens is None:
                    in_tok = span.tokens_input or 0
                    out_tok = span.tokens_output or 0
                    total_tokens = (total_tokens or 0) + in_tok + out_tok
            except Exception as exc:  # noqa: BLE001
                log.warning("build_trace: skipping malformed span | error=%r span=%r", exc, raw)

        status = self._coerce_status(turn_data.get("status"))

        # Build the base metadata dict, then merge in platform tag + extras.
        metadata = self._base_metadata(turn_data)
        user_meta: dict[str, Any] = turn_data.get("metadata") or {}
        metadata.update(user_meta)
        metadata["platform"] = _PLATFORM

        return FireflyTraceIngest(
            trace_id=trace_id,
            project_id=self._project_id,
            name=turn_data.get("name") or f"hermes-turn-{trace_id[:8]}",
            input=turn_data.get("input"),
            output=turn_data.get("output"),
            latency_ms=latency_ms,
            total_tokens=total_tokens,
            total_cost=turn_data.get("total_cost"),
            status=status,
            metadata=metadata,
            tags=list(turn_data.get("tags") or []),
            spans=built_spans,
        )

    def build_span(
        self,
        trace_id: str,
        span_type: str | SpanType = SpanType.chat,
        **kwargs: Any,
    ) -> FireflySpanIngest:
        """Build a :class:`FireflySpanIngest` from keyword arguments.

        *kwargs* may contain any field of ``FireflySpanIngest`` plus the
        standard turn-level keys (``start_ts``, ``end_ts``, ``metadata``, …).
        Unknown keys are merged into ``metadata``.
        """
        span_id = kwargs.pop("span_id", None) or str(uuid4())
        name = kwargs.pop("name", None) or f"span-{span_id[:8]}"

        if isinstance(span_type, str):
            try:
                span_type = SpanType(span_type)
            except ValueError:
                log.warning("build_span: unknown span_type=%r, defaulting to gen_ai.agent", span_type)
                span_type = SpanType.agent

        latency_ms = self._latency(kwargs.pop("start_ts", None), kwargs.pop("end_ts", None))

        status = self._coerce_status(kwargs.pop("status", None))

        # Known FireflySpanIngest fields we explicitly handle.
        _known = {
            "model", "provider", "input", "output",
            "tokens_input", "tokens_output", "metadata",
        }

        model = kwargs.pop("model", None)
        provider = kwargs.pop("provider", None)
        input_ = kwargs.pop("input", None)
        output = kwargs.pop("output", None)
        tokens_input = kwargs.pop("tokens_input", None)
        tokens_output = kwargs.pop("tokens_output", None)

        # Fold remaining kwargs into metadata.
        span_meta: dict[str, Any] = kwargs.pop("metadata", {}) or {}
        for key, val in kwargs.items():
            if key not in _known:
                span_meta[key] = val
        span_meta["platform"] = _PLATFORM

        return FireflySpanIngest(
            span_id=span_id,
            trace_id=trace_id,
            type=span_type,
            name=name,
            model=model,
            provider=provider,
            input=input_,
            output=output,
            tokens_input=tokens_input,
            tokens_output=tokens_output,
            latency_ms=latency_ms,
            status=status,
            metadata=span_meta,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _latency(start_ts: float | None, end_ts: float | None) -> float | None:
        """Return wall-clock latency in milliseconds, or None if timestamps are absent."""
        if start_ts is not None and end_ts is not None:
            return round((end_ts - start_ts) * 1000, 2)
        return None

    @staticmethod
    def _coerce_status(raw: str | None) -> SpanStatus:
        """Map raw status string to :class:`SpanStatus`, defaulting to ``ok``."""
        if raw is None:
            return SpanStatus.ok
        try:
            return SpanStatus(raw)
        except ValueError:
            log.warning("_coerce_status: unknown status=%r, defaulting to ok", raw)
            return SpanStatus.ok

    @staticmethod
    def _base_metadata(turn_data: dict[str, Any]) -> dict[str, Any]:
        """Extract standard Hermes/OpenClaw tracing fields into metadata."""
        _meta_keys = (
            "session_id",
            "user_id",
            "agent_id",
            "turn_id",
            "channel",
            "trigger",
            "source",
            "run_mode",
        )
        return {k: turn_data[k] for k in _meta_keys if k in turn_data and turn_data[k] is not None}
