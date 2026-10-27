"""
app/api/traces.py
─────────────────
Trace query endpoints.

GET /api/v1/traces                — paginated list with filters
GET /api/v1/traces/{trace_id}    — single trace with spans
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ensure_project_access, get_current_user
from app.database import get_db
from app.models.span import Span
from app.models.trace import Trace
from app.models.user import User
from app.schemas.span import SpanResponse
from app.schemas.trace import TraceListResponse, TraceResponse, TraceSummary
from app.services import query as svc
from app.services.normalization import normalize_span, trace_category_for_name_and_span_categories

router = APIRouter(prefix="/traces", tags=["traces"])


def _has_preview_value(value: object) -> bool:
    return value not in (None, "", [], {})


def _sorted_spans(trace: Trace) -> list[Span]:
    return sorted(trace.spans, key=lambda item: item.timestamp_start)


def _span_is_generation(span: Span | SpanResponse) -> bool:
    name = (span.name or "").lower()
    span_type = (span.type or "").lower()
    category = (span.category or "").lower()
    return (
        span_type in {"gen_ai.chat", "gen_ai.generation", "gen_ai.completion"}
        or category == "llm_generation"
        or "model.call" in name
        or "model.usage" in name
    )


def _summary_is_generation(summary: TraceSummary) -> bool:
    name = (summary.name or "").lower()
    category = (summary.category or "").lower()
    return category == "llm_generation" or "model.call" in name or "model.usage" in name


def _is_attribute_only(value: object) -> bool:
    if not isinstance(value, dict) or not value:
        return False
    meaningful_keys = [key for key, item in value.items() if _has_preview_value(item)]
    return meaningful_keys == ["attributes"]


def _is_tool_call_only(value: object) -> bool:
    if not isinstance(value, dict) or not value:
        return False
    keys = {str(key) for key in value.keys()}
    tool_keys = {"tool_calls", "toolCalls", "tool_call", "toolCall"}
    return bool(keys) and keys <= tool_keys


def _clean_prompt(text: str) -> str:
    cleaned = re.sub(
        r"<recalled-memories>.*?</recalled-memories>\s*",
        "",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    ).strip()
    cleaned = re.sub(r"^\[[^\]]+\]\s*", "", cleaned).strip()
    return cleaned or text.strip()


def _content_text(value: object, *, include_tool_calls: bool = False) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        parts = [
            text
            for item in value
            if (text := _content_text(item, include_tool_calls=include_tool_calls))
        ]
        return "\n".join(parts) if parts else None
    if not isinstance(value, dict):
        return str(value)

    if _is_attribute_only(value) or _is_tool_call_only(value):
        return None

    item_type = str(value.get("type") or "").lower()
    if item_type == "thinking":
        return None
    if item_type == "toolcall":
        if not include_tool_calls:
            return None
        name = value.get("name") or value.get("toolName") or "tool"
        args = value.get("arguments") or value.get("input") or value.get("partialArgs")
        return f"{name}: {args}" if _has_preview_value(args) else str(name)

    prompt = value.get("prompt")
    if isinstance(prompt, str) and _has_preview_value(prompt):
        return _clean_prompt(prompt)

    for key in ("text", "content", "message", "response", "result", "output", "error"):
        item = value.get(key)
        if _has_preview_value(item):
            text = _content_text(item, include_tool_calls=include_tool_calls)
            if text:
                return text

    return None


def _messages_from_value(value: object) -> list[dict[str, object]]:
    if not _has_preview_value(value) or _is_attribute_only(value):
        return []

    if isinstance(value, list):
        messages: list[dict[str, object]] = []
        for item in value:
            messages.extend(_messages_from_value(item))
        return messages

    if not isinstance(value, dict):
        return []

    for key in ("messages", "input_messages", "output_messages", "inputMessages", "outputMessages"):
        nested = value.get(key)
        if _has_preview_value(nested):
            messages = _messages_from_value(nested)
            if messages:
                return messages

    for key in ("input", "output", "request", "response"):
        nested = value.get(key)
        if isinstance(nested, dict) and _has_preview_value(nested.get("messages")):
            messages = _messages_from_value(nested.get("messages"))
            if messages:
                return messages

    role = value.get("role")
    if role:
        content = value.get("content")
        if content is None:
            content = value
        text = _content_text(content, include_tool_calls=True)
        if text:
            return [
                {
                    "role": str(role),
                    "content": text,
                    "timestamp": value.get("timestamp"),
                }
            ]

    prompt = value.get("prompt")
    if isinstance(prompt, str) and _has_preview_value(prompt):
        return [{"role": "user", "content": _clean_prompt(prompt), "timestamp": value.get("timestamp")}]

    return []


def _latest_user_input(values: list[object]) -> object | None:
    latest: object | None = None
    fallback: object | None = None

    for value in values:
        for message in _messages_from_value(value):
            role = str(message.get("role") or "").lower()
            content = message.get("content")
            if role in {"user", "human"} and _has_preview_value(content):
                latest = content

        if fallback is None and _has_preview_value(value) and not _is_attribute_only(value):
            text = _content_text(value)
            if text:
                fallback = text

    return latest if latest is not None else fallback


def _latest_model_output(values: list[object]) -> object | None:
    latest: object | None = None

    for value in values:
        if not _has_preview_value(value) or _is_attribute_only(value) or _is_tool_call_only(value):
            continue

        messages = _messages_from_value(value)
        if messages:
            for message in messages:
                role = str(message.get("role") or "").lower()
                content = message.get("content")
                if role in {"assistant", "ai", "model"} and _has_preview_value(content):
                    latest = content
            continue

        text = _content_text(value)
        if text:
            latest = text

    return latest


def _trace_summary(trace: Trace) -> TraceSummary:
    item = TraceSummary.model_validate(trace)
    item.category = trace_category_for_name_and_span_categories(
        trace.name,
        {span.category for span in trace.spans},
    )
    spans = _sorted_spans(trace)
    input_value = _latest_user_input([trace.input, *[span.input for span in spans]])
    output_value = _latest_model_output(
        [trace.output, *[span.output for span in spans if _span_is_generation(span)]]
    )

    if input_value is not None:
        item.input = input_value
    elif item.input is None or _is_attribute_only(item.input):
        item.input = next(
            (
                span.input
                for span in spans
                if _has_preview_value(span.input) and not _is_attribute_only(span.input)
            ),
            None,
        )
    if output_value is not None:
        item.output = output_value
    elif item.output is None or _is_attribute_only(item.output) or _is_tool_call_only(item.output):
        item.output = None
    return item


def _trace_window_end(trace: Trace) -> datetime:
    candidates = [trace.timestamp_end]
    if trace.latency_ms is not None:
        candidates.append(trace.timestamp_start + timedelta(milliseconds=trace.latency_ms))
    for span in trace.spans:
        candidates.append(span.timestamp_end)
        if span.latency_ms is not None:
            candidates.append(span.timestamp_start + timedelta(milliseconds=span.latency_ms))
        else:
            candidates.append(span.timestamp_start)
    return max(candidate for candidate in candidates if candidate is not None)


def _metadata_with_firefly(metadata: dict[str, Any] | None, updates: dict[str, Any]) -> dict[str, Any]:
    result = dict(metadata or {})
    firefly = dict(result.get("firefly") or {})
    firefly.update(updates)
    result["firefly"] = firefly
    return result


def _span_response(span: Span, *, parent_span_id: uuid.UUID | None = None) -> SpanResponse:
    item = SpanResponse.model_validate(span)
    if parent_span_id and item.parent_span_id is None:
        item.parent_span_id = parent_span_id
    metadata = dict(item.metadata or {})
    attrs_raw = metadata.get("attributes")
    attrs = {
        str(key): str(value)
        for key, value in (attrs_raw.items() if isinstance(attrs_raw, dict) else [])
        if value is not None
    }
    source_name = str(metadata.get("otel.name") or span.name)
    semantics = normalize_span(name=source_name, attrs=attrs, fallback_type=span.type)
    item.type = semantics.span_type
    item.category = semantics.category
    item.metadata = _metadata_with_firefly(
        item.metadata,
        {
            "category": semantics.category,
            "display_type": semantics.display_type,
            "display_name": semantics.display_name,
            "visibility": semantics.visibility,
        },
    )
    return item


def _trace_event_span(trace: Trace, summary: TraceSummary, bundle_trace_id: uuid.UUID) -> SpanResponse:
    return SpanResponse(
        id=trace.id,
        parent_span_id=None,
        trace_id=bundle_trace_id,
        type="trace.event",
        name=trace.name,
        model=None,
        provider=None,
        category=summary.category,
        input=summary.input,
        output=summary.output,
        tokens_input=0,
        tokens_output=0,
        total_tokens=trace.total_tokens,
        cost_usd=trace.total_cost,
        latency_ms=trace.latency_ms,
        first_token_ms=None,
        timestamp_start=trace.timestamp_start,
        timestamp_end=trace.timestamp_end,
        status=trace.status,
        error=None,
        metadata=_metadata_with_firefly(
            trace.meta,
            {
                "display_type": "Trace event",
                "display_name": trace.name,
                "source_trace_id": str(trace.id),
                "synthetic": True,
            },
        ),
        created_at=trace.created_at,
        updated_at=trace.updated_at,
    )


def _bundle_response(bundle: svc.TraceBundle) -> TraceResponse:
    anchor = bundle.anchor
    traces = bundle.traces
    summaries = [_trace_summary(trace) for trace in traces]
    start = min(trace.timestamp_start for trace in traces)
    end = max(_trace_window_end(trace) for trace in traces)
    status_value = "error" if any(trace.status == "error" or trace.error_count for trace in traces) else "ok"
    span_rows: list[SpanResponse] = []

    for trace, summary in zip(traces, summaries, strict=False):
        span_rows.append(_trace_event_span(trace, summary, anchor.id))
        for span in _sorted_spans(trace):
            span_rows.append(_span_response(span, parent_span_id=trace.id))

    input_value = _latest_user_input(
        [
            *[summary.input for summary in summaries],
            *[span.input for span in sorted(span_rows, key=lambda item: item.timestamp_start)],
        ]
    )
    output_value = _latest_model_output(
        [
            *[summary.output for summary in summaries if _summary_is_generation(summary)],
            *[
                span.output
                for span in sorted(span_rows, key=lambda item: item.timestamp_start)
                if _span_is_generation(span)
            ],
        ]
    )

    metadata = _metadata_with_firefly(
        anchor.meta,
        {
            "category": "user_request",
            "display_type": "Trace bundle",
            "display_name": anchor.name,
            "visibility": "primary",
            "bundle": {
                "anchor_trace_id": str(anchor.id),
                "trace_count": len(traces),
                "observation_count": len(span_rows),
                "strategy": bundle.strategy,
                "confidence": bundle.confidence,
                "correlation_key": bundle.correlation.key if bundle.correlation else None,
                "correlation_id": bundle.correlation.value if bundle.correlation else None,
                "context": bundle.context,
                "window_before_ms": bundle.window_before_ms,
                "window_after_ms": bundle.window_after_ms,
            },
        },
    )

    return TraceResponse(
        id=anchor.id,
        project_id=anchor.project_id,
        session_id=anchor.session_id,
        user_id=anchor.user_id,
        name=anchor.name,
        input=input_value,
        output=output_value,
        timestamp_start=start,
        timestamp_end=end,
        latency_ms=max(0, int((end - start).total_seconds() * 1000)),
        total_tokens=sum(trace.total_tokens for trace in traces),
        total_cost=sum(trace.total_cost for trace in traces),
        span_count=len(span_rows),
        error_count=sum(trace.error_count for trace in traces),
        status=status_value,
        category="user_request",
        metadata=metadata,
        tags=anchor.tags,
        created_at=anchor.created_at,
        updated_at=anchor.updated_at,
        spans=span_rows,
    )


@router.get("", response_model=TraceListResponse, summary="List traces")
async def list_traces(
    project_id: uuid.UUID = Query(..., description="Project scope is required."),
    platform: str | None = Query(None, description="Filter by metadata.platform value."),
    status_filter: str | None = Query(None, alias="status", description="ok | error | running"),
    category: str | None = Query(None, description="user_trace | system | tool | background. Default: exclude system."),
    user_id: str | None = Query(None),
    from_dt: datetime | None = Query(None, alias="from", description="Start of time range (ISO-8601)."),
    to_dt: datetime | None = Query(None, alias="to", description="End of time range (ISO-8601)."),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TraceListResponse:
    """
    Paginated trace list.

    Supports filtering by project, platform, status, category, user, and time range.
    When ``category`` is omitted, ``system`` traces are excluded from results.
    Pass ``category=system`` to see them.
    """
    await ensure_project_access(db, project_id, current_user.id)
    traces, total = await svc.list_traces(
        db,
        project_id=project_id,
        platform=platform,
        status=status_filter,
        category=category,
        user_id=user_id,
        from_dt=from_dt,
        to_dt=to_dt,
        page=page,
        page_size=page_size,
    )
    items = [_trace_summary(t) for t in traces]
    return TraceListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=(page * page_size) < total,
    )


@router.get(
    "/{trace_id}/bundle",
    response_model=TraceResponse,
    summary="Get an aggregated trace bundle",
)
async def get_trace_bundle(
    trace_id: uuid.UUID,
    include_system: bool = Query(False, description="Include system diagnostic traces in the bundle."),
    window_before_ms: int = Query(30000, ge=0, le=300000),
    window_after_ms: int = Query(360000, ge=0, le=1800000),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TraceResponse:
    """
    Fetch a Langfuse-like aggregate around one trace.

    This is read-only compatibility for OpenClaw OTLP streams where one user
    turn currently arrives as multiple trace IDs.
    """
    bundle = await svc.get_trace_bundle(
        db,
        trace_id,
        include_system=include_system,
        window_before_ms=window_before_ms,
        window_after_ms=window_after_ms,
    )
    if not bundle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Trace {trace_id} not found.",
        )
    await ensure_project_access(db, bundle.anchor.project_id, current_user.id)
    return _bundle_response(bundle)


@router.get(
    "/{trace_id}",
    response_model=TraceResponse,
    summary="Get a single trace with its spans",
)
async def get_trace(
    trace_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TraceResponse:
    """Fetch one Trace by ID, with all child Spans eagerly loaded."""
    trace = await svc.get_trace(db, trace_id)
    if not trace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Trace {trace_id} not found.",
        )
    await ensure_project_access(db, trace.project_id, current_user.id)
    item = TraceResponse.model_validate(trace)
    item.category = trace_category_for_name_and_span_categories(
        trace.name,
        {span.category for span in trace.spans},
    )
    return item
