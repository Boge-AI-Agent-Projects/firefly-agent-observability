"""
Normalize raw platform telemetry into Firefly display semantics.

The database still stores the original names and attributes, but the UI should
not have to understand every OpenClaw/Hermes event shape. These helpers produce
stable categories and metadata used by the trace viewer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


SPAN_CATEGORIES = {
    "llm_generation",
    "tool_call",
    "retrieval",
    "context_assembly",
    "agent_step",
    "chain_step",
    "embedding",
    "system",
    "background",
    "custom",
}

SYSTEM_PATTERNS = (
    "diagnostic",
    "liveness",
    "heartbeat",
    "health_check",
    "healthcheck",
    "openclaw.diagnostic",
    "openclaw.liveness",
    "openclaw.heartbeat",
)

REQUEST_TRACE_NAMES = (
    "openclaw.model.call",
    "openclaw.message.processed",
)

LLM_TRACE_NAMES = (
    "openclaw.model.call",
    "openclaw.model.usage",
)

TOOL_TRACE_NAMES = (
    "openclaw.tool.execution",
    "openclaw.exec",
)

AGENT_TRACE_NAMES = (
    "openclaw.harness.run",
    "openclaw.tool.loop",
)


@dataclass(frozen=True)
class SpanSemantics:
    span_type: str
    category: str
    display_type: str
    display_name: str
    visibility: str


def first_attr(attrs: dict[str, str], *keys: str) -> str | None:
    for key in keys:
        value = attrs.get(key)
        if value:
            return value
    return None


def normalize_span(
    *,
    name: str,
    attrs: dict[str, str] | None = None,
    otel_kind: int | None = None,
    fallback_type: str | None = None,
) -> SpanSemantics:
    attrs = attrs or {}
    name_lower = (name or "").lower()
    fallback_lower = (fallback_type or "").lower()

    if any(pattern in name_lower for pattern in SYSTEM_PATTERNS):
        return SpanSemantics(
            span_type="custom",
            category="system",
            display_type="System",
            display_name=clean_display_name(name, attrs),
            visibility="hidden",
        )

    if "context.assembled" in name_lower or "prompt.assembled" in name_lower:
        return SpanSemantics(
            span_type="gen_ai.retrieval",
            category="context_assembly",
            display_type="Context",
            display_name="Context assembly",
            visibility="secondary",
        )

    if "retrieval" in name_lower or "retriever" in name_lower or "vector" in name_lower:
        return SpanSemantics(
            span_type="gen_ai.retrieval",
            category="retrieval",
            display_type="Retrieval",
            display_name=clean_display_name(name, attrs),
            visibility="primary",
        )

    tool_name = first_attr(
        attrs,
        "gen_ai.tool.name",
        "openclaw.toolName",
        "openclaw.tool.name",
        "tool.name",
        "tool_name",
    )
    if (
        "tool.execution" in name_lower
        or "tool.call" in name_lower
        or fallback_lower in {"gen_ai.tool", "tool"}
        or tool_name
    ):
        return SpanSemantics(
            span_type="gen_ai.tool",
            category="tool_call",
            display_type="Tool",
            display_name=tool_name or clean_display_name(name, attrs),
            visibility="primary",
        )

    if name_lower.startswith("openclaw.exec") or ".exec" in name_lower:
        return SpanSemantics(
            span_type="gen_ai.tool",
            category="tool_call",
            display_type="Exec",
            display_name=clean_display_name(name, attrs),
            visibility="primary",
        )

    if "tool.loop" in name_lower:
        tool_name = first_attr(attrs, "openclaw.toolName", "gen_ai.tool.name")
        return SpanSemantics(
            span_type="gen_ai.chain",
            category="chain_step",
            display_type="Tool loop",
            display_name=tool_name or "Tool loop",
            visibility="secondary",
        )

    if "model.usage" in name_lower:
        return SpanSemantics(
            span_type="gen_ai.chat",
            category="llm_generation",
            display_type="Usage",
            display_name=clean_display_name(name, attrs),
            visibility="secondary",
        )

    if (
        "model.call" in name_lower
        or fallback_lower in {"gen_ai.chat", "gen_ai.generation", "gen_ai.completion"}
        or attrs.get("gen_ai.request.model")
        or attrs.get("gen_ai.system")
    ):
        model = first_attr(attrs, "gen_ai.request.model", "openclaw.model", "gen_ai.response.model")
        return SpanSemantics(
            span_type="gen_ai.chat",
            category="llm_generation",
            display_type="Generation",
            display_name=model or clean_display_name(name, attrs),
            visibility="primary",
        )

    if "message.processed" in name_lower or "harness.run" in name_lower:
        return SpanSemantics(
            span_type="agent",
            category="agent_step",
            display_type="Agent",
            display_name=clean_display_name(name, attrs),
            visibility="primary",
        )

    if "embedding" in name_lower or "embed" in name_lower:
        return SpanSemantics(
            span_type="gen_ai.embedding",
            category="embedding",
            display_type="Embedding",
            display_name=clean_display_name(name, attrs),
            visibility="secondary",
        )

    if "cron" in name_lower or "scheduled" in name_lower or "worker" in name_lower:
        return SpanSemantics(
            span_type=fallback_type or "custom",
            category="background",
            display_type="Background",
            display_name=clean_display_name(name, attrs),
            visibility="secondary",
        )

    if otel_kind is not None:
        return SpanSemantics(
            span_type=fallback_type or "gen_ai.agent",
            category="agent_step",
            display_type="Agent",
            display_name=clean_display_name(name, attrs),
            visibility="primary",
        )

    return SpanSemantics(
        span_type=fallback_type or "custom",
        category="custom",
        display_type="Span",
        display_name=clean_display_name(name, attrs),
        visibility="secondary",
    )


def trace_category_for_span_categories(categories: set[str]) -> str:
    if not categories:
        return "user_request"
    if categories <= {"system"}:
        return "system"
    if categories <= {"background", "system"}:
        return "background"
    primary = categories - {"system", "background"}
    if primary <= {"llm_generation"}:
        return "llm_generation"
    if primary <= {"tool_call"}:
        return "tool"
    if primary <= {"retrieval", "context_assembly"}:
        return "retrieval"
    if primary <= {"agent_step", "chain_step"}:
        return "agent_step"
    return "user_request"


def trace_category_for_name_and_span_categories(name: str, categories: set[str]) -> str:
    name_lower = (name or "").lower()
    if any(pattern in name_lower for pattern in SYSTEM_PATTERNS):
        return "system"
    if name_lower in LLM_TRACE_NAMES:
        return "llm_generation"
    if name_lower in REQUEST_TRACE_NAMES:
        return "user_request"
    if name_lower in TOOL_TRACE_NAMES:
        return "tool"
    if name_lower in AGENT_TRACE_NAMES:
        return "agent_step"
    return trace_category_for_span_categories(categories)


def summarize_span_categories(categories: list[str]) -> dict[str, int]:
    summary = {
        "generations": 0,
        "tools": 0,
        "retrievals": 0,
        "context": 0,
        "systems": 0,
        "background": 0,
    }
    for category in categories:
        if category == "llm_generation":
            summary["generations"] += 1
        elif category == "tool_call":
            summary["tools"] += 1
        elif category == "retrieval":
            summary["retrievals"] += 1
        elif category == "context_assembly":
            summary["context"] += 1
        elif category == "system":
            summary["systems"] += 1
        elif category == "background":
            summary["background"] += 1
    return summary


def clean_display_name(name: str, attrs: dict[str, str] | None = None) -> str:
    attrs = attrs or {}
    explicit = first_attr(
        attrs,
        "langfuse.observation.name",
        "gen_ai.tool.name",
        "openclaw.toolName",
        "gen_ai.request.model",
        "openclaw.model",
    )
    if explicit:
        return explicit
    if not name:
        return "unnamed"
    return name.replace("openclaw.", "").replace("_", " ").strip() or name


def merge_firefly_metadata(
    metadata: dict[str, Any] | None,
    *,
    category: str,
    display_type: str,
    display_name: str,
    visibility: str,
    summary: dict[str, int] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = dict(metadata or {})
    firefly = dict(result.get("firefly") or {})
    firefly.update(
        {
            "category": category,
            "display_type": display_type,
            "display_name": display_name,
            "visibility": visibility,
        }
    )
    if summary is not None:
        firefly["summary"] = summary
    result["firefly"] = firefly
    return result
