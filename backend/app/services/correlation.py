"""Correlation helpers for grouping split telemetry into one user turn."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from app.models.trace import Trace


STRONG_CORRELATION_KEYS = (
    "firefly.bundle_id",
    "firefly.trace_bundle_id",
    "firefly.turn_id",
    "firefly.correlation_id",
    "langfuse.trace.id",
    "openclaw.turn.id",
    "openclaw.turn_id",
    "openclaw.request.id",
    "openclaw.request_id",
    "openclaw.message.id",
    "openclaw.message_id",
    "openclaw.run.id",
    "openclaw.run_id",
    "openclaw.trace.id",
    "openclaw.trace_id",
    "openclaw.traceId",
    "gen_ai.operation.id",
    "gen_ai.request.id",
)

WEAK_CONTEXT_KEYS = (
    "session.id",
    "session_id",
    "openclaw.session.id",
    "openclaw.session_id",
    "openclaw.sessionKey",
    "openclaw.session_key",
    "openclaw.channel",
    "openclaw.agent",
)


@dataclass(frozen=True)
class Correlation:
    key: str
    value: str
    confidence: str = "strong"


def _string_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (str, int, float)):
        text = str(value).strip()
        return text or None
    return None


def _iter_nested_dicts(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for nested in value.values():
            yield from _iter_nested_dicts(nested)
    elif isinstance(value, list):
        for item in value:
            yield from _iter_nested_dicts(item)


def extract_correlation(*sources: Any) -> Correlation | None:
    """Find the strongest explicit turn/request correlation ID in JSON-ish data."""
    for source in sources:
        for record in _iter_nested_dicts(source):
            for key in STRONG_CORRELATION_KEYS:
                value = _string_value(record.get(key))
                if value:
                    return Correlation(key=key, value=value)
    return None


def trace_correlation(trace: Trace) -> Correlation | None:
    """Extract an explicit correlation ID from a trace and its loaded spans."""
    sources: list[Any] = [trace.meta, trace.input, trace.output]
    for span in trace.spans:
        sources.extend([span.meta, span.input, span.output])
    return extract_correlation(*sources)


def context_fingerprint(trace: Trace) -> dict[str, str]:
    """Return weak context fields useful for diagnostics, not exact grouping."""
    result: dict[str, str] = {}
    sources: list[Any] = [trace.meta, trace.input, trace.output]
    for span in trace.spans:
        sources.extend([span.meta, span.input, span.output])
    for source in sources:
        for record in _iter_nested_dicts(source):
            for key in WEAK_CONTEXT_KEYS:
                value = _string_value(record.get(key))
                if value and key not in result:
                    result[key] = value
    return result
