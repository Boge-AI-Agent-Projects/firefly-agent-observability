"""
app/services/query.py
─────────────────────
Read-side query service: traces, sessions, stats.

All queries use SQLAlchemy 2.0 async style.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import Integer, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models.session import AgentSession
from app.models.span import Span
from app.models.trace import Trace
from app.services.correlation import Correlation, context_fingerprint, trace_correlation
from app.services.normalization import (
    AGENT_TRACE_NAMES,
    LLM_TRACE_NAMES,
    REQUEST_TRACE_NAMES,
    TOOL_TRACE_NAMES,
)

settings = get_settings()


@dataclass(frozen=True)
class TraceBundle:
    anchor: Trace
    traces: list[Trace]
    strategy: str
    confidence: str
    correlation: Correlation | None
    context: dict[str, str]
    window_before_ms: int
    window_after_ms: int


# ─── Traces ──────────────────────────────────────────────────────────────────

async def list_traces(
    db: AsyncSession,
    *,
    project_id: uuid.UUID | None = None,
    platform: str | None = None,        # filters on metadata->>'platform'
    status: str | None = None,
    user_id: str | None = None,
    category: str | None = None,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
    page: int = 1,
    page_size: int | None = None,
) -> tuple[list[Trace], int]:
    """
    Return a paginated list of traces + total count.

    Parameters
    ----------
    platform : optional filter on ``trace.metadata->>'platform'``
    category : filter by trace category. ``user_request`` also includes legacy
               ``user_trace`` rows. When omitted, system rows are excluded.
    from_dt / to_dt : filter on ``timestamp_start``
    page / page_size : 1-based pagination
    """
    ps = page_size or settings.page_size_default
    ps = min(ps, settings.page_size_max)
    offset = (page - 1) * ps

    stmt = select(Trace)

    if project_id:
        stmt = stmt.where(Trace.project_id == project_id)
    if platform:
        stmt = stmt.where(Trace.meta["platform"].as_string() == platform)
    if status:
        stmt = stmt.where(Trace.status == status)
    if user_id:
        stmt = stmt.where(Trace.user_id == user_id)
    if from_dt:
        stmt = stmt.where(Trace.timestamp_start >= from_dt)
    if to_dt:
        stmt = stmt.where(Trace.timestamp_start <= to_dt)

    # Category filter: old OpenClaw rows were stored as user_trace, so keep a
    # read-side compatibility map until those rows are backfilled.
    name_lower = func.lower(Trace.name)
    named_request = name_lower.in_(REQUEST_TRACE_NAMES)
    named_llm = name_lower.in_(LLM_TRACE_NAMES)
    named_tool = name_lower.in_(TOOL_TRACE_NAMES)
    named_agent = name_lower.in_(AGENT_TRACE_NAMES)

    if category == "user_request":
        stmt = stmt.where(or_(Trace.category == "user_request", named_request))
    elif category == "llm_generation":
        stmt = stmt.where(or_(Trace.category == "llm_generation", named_llm))
    elif category == "tool":
        stmt = stmt.where(or_(Trace.category.in_(("tool", "tool_call")), named_tool))
    elif category == "agent_step":
        stmt = stmt.where(or_(Trace.category == "agent_step", named_agent))
    elif category:
        stmt = stmt.where(Trace.category == category)
    else:
        stmt = stmt.where(Trace.category != "system")

    # Count total (before pagination)
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = (await db.execute(count_stmt)).scalar_one()

    # Paginate
    stmt = (
        stmt
        .options(selectinload(Trace.spans))
        .order_by(Trace.timestamp_start.desc())
        .offset(offset)
        .limit(ps)
    )
    rows = (await db.execute(stmt)).scalars().all()

    return list(rows), total


async def get_trace(
    db: AsyncSession,
    trace_id: uuid.UUID,
) -> Trace | None:
    """Fetch one Trace with all its Spans eagerly loaded."""
    result = await db.execute(
        select(Trace)
        .where(Trace.id == trace_id)
        .options(selectinload(Trace.spans))
    )
    return result.scalar_one_or_none()


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


async def get_trace_bundle(
    db: AsyncSession,
    trace_id: uuid.UUID,
    *,
    include_system: bool = False,
    window_before_ms: int = 30000,
    window_after_ms: int = 360000,
    limit: int = 120,
) -> TraceBundle | None:
    """
    Return one anchor trace plus nearby traces that likely belong to the same turn.

    OpenClaw's current OTLP stream can emit model, usage, message, tool, and
    harness events as separate trace IDs. Until ingestion gets a stable turn ID,
    the read side groups by project, platform, and a bounded time window.
    """
    anchor = await get_trace(db, trace_id)
    if not anchor:
        return None

    platform = (anchor.meta or {}).get("platform")
    anchor_correlation = trace_correlation(anchor)
    start = anchor.timestamp_start - timedelta(milliseconds=window_before_ms)
    end = _trace_window_end(anchor) + timedelta(milliseconds=window_after_ms)

    stmt = (
        select(Trace)
        .where(
            Trace.project_id == anchor.project_id,
            Trace.timestamp_start >= start,
            Trace.timestamp_start <= end,
        )
        .options(selectinload(Trace.spans))
        .order_by(Trace.timestamp_start.asc(), Trace.created_at.asc())
        .limit(limit)
    )
    if platform:
        stmt = stmt.where(Trace.meta["platform"].as_string() == str(platform))
    if not include_system:
        stmt = stmt.where(Trace.category != "system")

    rows = (await db.execute(stmt)).scalars().all()
    if anchor_correlation:
        traces = [
            trace
            for trace in rows
            if (candidate := trace_correlation(trace)) is not None
            and candidate.value == anchor_correlation.value
        ]
        strategy = "correlation_id"
        confidence = "strong"
    else:
        traces = list(rows)
        strategy = "project_platform_time_window"
        confidence = "fallback"

    if anchor.id not in {trace.id for trace in traces}:
        traces.append(anchor)
        traces.sort(key=lambda trace: (trace.timestamp_start, trace.created_at))

    context: dict[str, str] = {}
    for trace in traces:
        context.update({k: v for k, v in context_fingerprint(trace).items() if k not in context})

    return TraceBundle(
        anchor=anchor,
        traces=traces,
        strategy=strategy,
        confidence=confidence,
        correlation=anchor_correlation,
        context=context,
        window_before_ms=window_before_ms,
        window_after_ms=window_after_ms,
    )


# ─── Sessions ────────────────────────────────────────────────────────────────

async def get_session(
    db: AsyncSession,
    session_id: uuid.UUID,
    include_traces: bool = False,
) -> AgentSession | None:
    """Fetch one AgentSession, optionally with its traces."""
    stmt = select(AgentSession).where(AgentSession.id == session_id)
    if include_traces:
        stmt = stmt.options(selectinload(AgentSession.traces))
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


# ─── Stats ───────────────────────────────────────────────────────────────────

async def get_stats(
    db: AsyncSession,
    project_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """
    Compute basic aggregate statistics.

    Returns
    -------
    {
        total_traces, total_spans, error_traces,
        total_tokens, total_cost_usd,
        avg_latency_ms, p95_latency_ms
    }
    """
    trace_stmt = select(
        func.count(Trace.id).label("total_traces"),
        func.sum(func.cast(Trace.status == "error", Integer)).label("error_traces"),
        func.sum(Trace.total_tokens).label("total_tokens"),
        func.sum(Trace.total_cost).label("total_cost_usd"),
        func.avg(Trace.latency_ms).label("avg_latency_ms"),
    )
    if project_id:
        trace_stmt = trace_stmt.where(Trace.project_id == project_id)

    trace_row = (await db.execute(trace_stmt)).one()

    p95_latency_ms = 0.0
    latency_stmt = select(Trace.latency_ms).where(Trace.latency_ms.is_not(None))
    if project_id:
        latency_stmt = latency_stmt.where(Trace.project_id == project_id)
    latencies = (await db.execute(latency_stmt.order_by(Trace.latency_ms.asc()))).scalars().all()
    if latencies:
        p95_index = min(len(latencies) - 1, int((len(latencies) - 1) * 0.95))
        p95_latency_ms = float(latencies[p95_index] or 0.0)

    span_stmt = select(func.count(Span.id).label("total_spans"))
    if project_id:
        span_stmt = span_stmt.join(Trace, Span.trace_id == Trace.id).where(
            Trace.project_id == project_id
        )
    span_row = (await db.execute(span_stmt)).one()

    return {
        "total_traces": trace_row.total_traces or 0,
        "total_spans": span_row.total_spans or 0,
        "error_traces": int(trace_row.error_traces or 0),
        "total_tokens": int(trace_row.total_tokens or 0),
        "total_cost_usd": float(trace_row.total_cost_usd or 0.0),
        "avg_latency_ms": float(trace_row.avg_latency_ms or 0.0),
        "p95_latency_ms": p95_latency_ms,
    }
