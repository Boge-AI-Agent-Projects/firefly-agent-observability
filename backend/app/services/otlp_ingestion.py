"""
app/services/otlp_ingestion.py
───────────────────────────────
Translate OpenTelemetry OTLP protobuf data into Firefly Trace + Span models.

OpenClaw diagnostics-otel sends ExportTraceServiceRequest protobuf to
POST /v1/traces. This module decodes those protobuf messages, groups spans
by trace_id, classifies them, filters out system noise, and maps them onto
Firefly's internal ORM model hierarchy.

Classification rules (open-source friendly, not platform-specific):
  - system   — diagnostic / liveness / heartbeat / health spans (hidden by default)
  - user_trace — LLM chat / agent / chain spans (user-visible)
  - tool     — function/tool call spans
  - background — cron / scheduled / worker spans
"""

from __future__ import annotations

import json
import uuid


# ─── Encoding repair ──────────────────────────────────────────────────────────

def _repair_encoding(text: str) -> str:
    """
    Repair UTF-8 text that was double-encoded through Latin-1 / CP1252.

    This handles a known encoding bug in some OTel exporter content capture
    paths where multi-byte UTF-8 characters are misinterpreted as single-byte
    Latin-1, turning e.g. 中文 into garbled mojibake.

    Returns the repaired string, or the original if repair was not possible.
    """
    try:
        repaired = text.encode("latin-1").decode("utf-8")
        # If repair increased the CJK character ratio, keep it
        orig_cjk = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
        fixed_cjk = sum(1 for c in repaired if "\u4e00" <= c <= "\u9fff")
        if fixed_cjk > orig_cjk:
            return repaired
        # Also check if repair fixed visibly broken patterns
        if "???" in text or "??" in text:
            return repaired
        return text
    except (UnicodeError, ValueError):
        return text


def _repair_json(data):
    """Recursively repair encoding in parsed JSON structures."""
    if isinstance(data, str):
        return _repair_encoding(data)
    if isinstance(data, dict):
        return {k: _repair_json(v) for k, v in data.items()}
    if isinstance(data, list):
        return [_repair_json(v) for v in data]
    return data
from datetime import datetime, timezone

from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)
from opentelemetry.proto.trace.v1.trace_pb2 import Span as OtelSpan
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.trace import Trace
from app.models.span import Span
from app.models.project import Project
from app.models.session import AgentSession
from app.services.normalization import (
    merge_firefly_metadata,
    normalize_span,
    summarize_span_categories,
    trace_category_for_name_and_span_categories,
)


def _classify_span(span: OtelSpan, attrs: dict[str, str]) -> str:
    """
    Categorize an OTel span.

    Returns one of: ``user_trace`` | ``system`` | ``tool`` | ``background``
    """
    semantics = normalize_span(
        name=span.name or "",
        attrs=attrs,
        otel_kind=span.kind,
    )
    return semantics.category


# ─── Attribute helpers ────────────────────────────────────────────────────────

def _attrs(otel_span: OtelSpan) -> dict[str, str]:
    """Extract a flat str→str dict from OTel span attributes."""
    result: dict[str, str] = {}
    for a in otel_span.attributes:
        v = a.value
        if v.HasField("string_value"):
            result[a.key] = v.string_value
        elif v.HasField("int_value"):
            result[a.key] = str(v.int_value)
        elif v.HasField("double_value"):
            result[a.key] = str(v.double_value)
        elif v.HasField("bool_value"):
            result[a.key] = str(v.bool_value)
    return result


def _res_attrs(rs) -> dict[str, str]:
    """Extract resource-level attributes (service.name, etc.)."""
    result: dict[str, str] = {}
    for a in rs.resource.attributes:
        v = a.value
        if v.HasField("string_value"):
            result[a.key] = v.string_value
    return result


def _parse_content(raw: str | None, wrapper_key: str) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        parsed = _repair_json(json.loads(raw))
    except (json.JSONDecodeError, TypeError):
        return {"raw": raw}
    if isinstance(parsed, dict):
        return parsed
    if isinstance(parsed, list):
        return {wrapper_key: parsed}
    return {"value": parsed}


# ─── Duration ─────────────────────────────────────────────────────────────────

def _dur_ms(span: OtelSpan) -> int:
    """Nano → milliseconds."""
    return (span.end_time_unix_nano - span.start_time_unix_nano) // 1_000_000


def _nano_to_dt(ns: int) -> datetime:
    """Unix nano → timezone-aware datetime."""
    return datetime.fromtimestamp(ns / 1_000_000_000, tz=timezone.utc)


# ─── Resource → Project ───────────────────────────────────────────────────────

async def _resolve_project(db: AsyncSession, res_attrs: dict[str, str], project_id: uuid.UUID) -> uuid.UUID:
    """
    Resolve the managed Firefly project supplied by the OTLP request.
    """
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project or project.organization_id is None:
        service_name = res_attrs.get("service.name", "unknown-service")
        raise ValueError(f"Managed Firefly project required for OTLP ingest ({service_name}).")
    return project.id


# ─── Resource → Session ───────────────────────────────────────────────────────

async def _resolve_session(
    db: AsyncSession,
    project_id: uuid.UUID,
    attrs: dict[str, str],
) -> uuid.UUID:
    """Find or create an AgentSession from OTel session.id attribute."""
    raw_sid = attrs.get("session.id")
    try:
        sid = uuid.UUID(raw_sid) if raw_sid else uuid.uuid4()
    except (ValueError, AttributeError):
        sid = uuid.uuid4()

    result = await db.execute(
        select(AgentSession).where(AgentSession.id == sid)
    )
    s = result.scalar_one_or_none()
    if s:
        return s.id

    s = AgentSession(
        id=sid,
        project_id=project_id,
        user_id=attrs.get("user.id"),
        name=attrs.get("session.name") or raw_sid or "unknown-session",
    )
    db.add(s)
    await db.flush()
    return s.id


# ─── OTel Span → Firefly Span ─────────────────────────────────────────────────

def _build_span(
    otel_span: OtelSpan,
    trace_id: uuid.UUID,
    category: str,
) -> Span:
    """Convert a single OTel span into a Firefly Span ORM object."""
    attrs = _attrs(otel_span)
    name = otel_span.name or "unnamed-span"
    name_lower = name.lower()

    parent_id = None
    if otel_span.parent_span_id:
        parent_id = uuid.UUID(int=int.from_bytes(otel_span.parent_span_id, "big"))

    semantics = normalize_span(
        name=name,
        attrs=attrs,
        otel_kind=otel_span.kind,
    )

    model = attrs.get("gen_ai.request.model") or attrs.get("openclaw.model") or attrs.get("gen_ai.response.model")

    # Token extraction: try standard OTel keys, then OpenClaw-specific keys
    input_tokens = int(attrs.get("gen_ai.usage.input_tokens", 0) or attrs.get("openclaw.usage.input_tokens", 0))
    output_tokens = int(attrs.get("gen_ai.usage.output_tokens", 0) or attrs.get("openclaw.usage.output_tokens", 0))

    # Build structured input/output from actual content attributes (not just metadata)
    span_input = None
    span_output = None

    # 1) Try OpenClaw content capture (rich: full messages JSON)
    if semantics.category == "tool_call":
        raw_input = (
            attrs.get("openclaw.content.tool_inputs")
            or attrs.get("openclaw.content.tool_input")
            or attrs.get("openclaw.content.tool.arguments")
        )
        raw_output = (
            attrs.get("openclaw.content.tool_outputs")
            or attrs.get("openclaw.content.tool_output")
            or attrs.get("openclaw.content.tool.result")
        )
    else:
        raw_input = attrs.get("openclaw.content.input_messages")
        raw_output = attrs.get("openclaw.content.output_messages")

    # 2) Fallback: standard GenAI semantic convention keys
    if not raw_input:
        raw_input = attrs.get("gen_ai.input.messages") or attrs.get("gen_ai.prompt")
    if not raw_output:
        raw_output = attrs.get("gen_ai.output.messages") or attrs.get("gen_ai.completion")

    # 3) Parse JSON strings into structured dicts (with encoding repair)
    span_input = _parse_content(raw_input, "messages")
    span_output = _parse_content(raw_output, "messages")

    # 4) Fallback: if no structured content, store attributes as-is
    if span_input is None:
        if semantics.category in {"llm_generation", "tool_call", "retrieval", "context_assembly"}:
            span_input = {"attributes": attrs}

    return Span(
        id=uuid.UUID(int=int.from_bytes(otel_span.span_id, "big")),
        parent_span_id=parent_id,
        trace_id=trace_id,
        type=semantics.span_type,
        name=semantics.display_name,
        model=model,
        provider=attrs.get("gen_ai.system") or attrs.get("openclaw.provider"),
        input=span_input,
        output=span_output,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        latency_ms=_dur_ms(otel_span) or None,
        timestamp_start=_nano_to_dt(otel_span.start_time_unix_nano),
        timestamp_end=_nano_to_dt(otel_span.end_time_unix_nano) if otel_span.end_time_unix_nano else None,
        status="error" if otel_span.status.code == 2 else "ok",
        category=semantics.category,
        meta=merge_firefly_metadata(
            {
            "otel.trace_id": otel_span.trace_id.hex(),
            "otel.span_id": otel_span.span_id.hex(),
            "otel.kind": otel_span.kind,
            "otel.name": name,
            "gen_ai.system": attrs.get("gen_ai.system"),
            "gen_ai.request.model": attrs.get("gen_ai.request.model"),
            "gen_ai.operation.name": attrs.get("gen_ai.operation.name"),
            "attributes": attrs,
            },
            category=semantics.category,
            display_type=semantics.display_type,
            display_name=semantics.display_name,
            visibility=semantics.visibility,
        ),
    )


# ─── Main ingestion entry-point ───────────────────────────────────────────────

async def ingest_otlp_traces(db: AsyncSession, raw: bytes, *, project_id: uuid.UUID) -> dict[str, int]:
    """
    Decode OTLP binary protobuf and persist as Firefly Traces + Spans.

    Key behaviour for open-source quality:
    - Spans are **grouped by trace_id** (one OTel trace → one Firefly Trace).
    - System-noise spans (diagnostic, liveness, heartbeat) get category="system"
      and are **stored but hidden by default** from the user-facing trace list.
    - A Trace inherits its ``category`` from the best non-system span it contains;
      if all spans are system, the trace is ``system``.

    Returns a summary dict.
    """
    req = ExportTraceServiceRequest()
    req.ParseFromString(raw)

    traces_created = 0
    spans_created = 0
    system_spans_filtered = 0

    for resource_span in req.resource_spans:
        res_attrs = _res_attrs(resource_span)
        project_id = await _resolve_project(db, res_attrs, project_id)

        # ── Step 1: collect ALL spans and classify + group by trace_id ──────
        # Key: trace_id_hex → list of (otel_span, category)
        trace_groups: dict[str, list[tuple[OtelSpan, str]]] = {}

        for scope_span in resource_span.scope_spans:
            for otel_span in scope_span.spans:
                attrs = _attrs(otel_span)
                cat = _classify_span(otel_span, attrs)
                trace_hex = otel_span.trace_id.hex()

                if trace_hex not in trace_groups:
                    trace_groups[trace_hex] = []
                trace_groups[trace_hex].append((otel_span, cat))

        # ── Step 2: for each trace_id group, decide trace category ─────────
        for trace_hex, group in trace_groups.items():
            trace_id_bytes = bytes.fromhex(trace_hex)
            trace_uuid = uuid.UUID(int=int.from_bytes(trace_id_bytes, "big"))

            # Determine trace-level category: one real agent run becomes a
            # user_request even if it contains many child observation types.
            categories = {cat for _, cat in group}
            display_spans = [
                (s, c) for s, c in group if c != "system"
            ] or group

            best_span, _best_cat = display_spans[0]
            best_attrs = _attrs(best_span)
            trace_category = trace_category_for_name_and_span_categories(
                best_span.name or "",
                categories,
            )
            summary = summarize_span_categories([cat for _, cat in group])

            # Check for existing trace
            result = await db.execute(
                select(Trace).where(Trace.id == trace_uuid)
            )
            existing_trace = result.scalar_one_or_none()

            if existing_trace:
                # Append new spans to existing trace
                for otel_span, cat in group:
                    span = _build_span(otel_span, trace_uuid, cat)
                    db.add(span)
                    existing_trace.span_count = Trace.span_count + 1
                    existing_trace.total_tokens = (
                        Trace.total_tokens + span.total_tokens
                    )
                    if span.status == "error":
                        existing_trace.error_count = Trace.error_count + 1
                    existing_trace.category = trace_category
                    existing_trace.meta = merge_firefly_metadata(
                        existing_trace.meta,
                        category=trace_category,
                        display_type="Trace",
                        display_name=existing_trace.name,
                        visibility="primary" if trace_category == "user_request" else "secondary",
                        summary=summary,
                    )
                    spans_created += 1
            else:
                # Create new trace
                session_id = await _resolve_session(db, project_id, best_attrs)

                trace = Trace(
                    id=trace_uuid,
                    project_id=project_id,
                    session_id=session_id,
                    name=best_span.name or "otel-trace",
                    timestamp_start=_nano_to_dt(best_span.start_time_unix_nano),
                    status="error" if best_span.status.code == 2 else "ok",
                    span_count=len(group),
                    category=trace_category,
                    meta=merge_firefly_metadata(
                        {
                        "otel.trace_id": trace_hex,
                        "service.name": res_attrs.get("service.name"),
                        "telemetry.sdk.name": res_attrs.get("telemetry.sdk.name"),
                        "platform": res_attrs.get("service.name", ""),
                        },
                        category=trace_category,
                        display_type="Trace",
                        display_name=best_span.name or "otel-trace",
                        visibility="primary" if trace_category == "user_request" else "secondary",
                        summary=summary,
                    ),
                )

                total_tokens = 0
                error_count = 0
                for otel_span, cat in group:
                    span = _build_span(otel_span, trace_uuid, cat)
                    total_tokens += span.total_tokens
                    if span.status == "error":
                        error_count += 1
                    db.add(span)
                    spans_created += 1

                trace.total_tokens = total_tokens
                trace.error_count = error_count
                trace.latency_ms = (
                    _dur_ms(best_span) if len(group) == 1 else None
                )

                db.add(trace)
                traces_created += 1

    await db.flush()
    return {
        "traces": traces_created,
        "spans": spans_created,
        "system_filtered": system_spans_filtered,
    }
