"""
app/services/ingestion.py
─────────────────────────
Business logic for writing Traces and Spans to the database.

Design decisions:
- Trace + Spans are written atomically within one session transaction.
- If a trace_id is provided by the client and already exists, we UPSERT
  (update aggregates) rather than raise a duplicate error — enabling
  idempotent re-delivery from producers.
- Span counts and error counts on the Trace are recalculated after span insert.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session import AgentSession
from app.models.span import Span
from app.models.trace import Trace
from app.schemas.span import SpanIngest
from app.schemas.trace import TraceIngest
from app.services.normalization import (
    merge_firefly_metadata,
    normalize_span,
    summarize_span_categories,
    trace_category_for_name_and_span_categories,
)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


async def _ensure_session(
    db: AsyncSession,
    project_id: uuid.UUID,
    session_id: uuid.UUID,
) -> AgentSession:
    """Return an existing AgentSession or create a minimal placeholder."""
    result = await db.execute(
        select(AgentSession).where(AgentSession.id == session_id)
    )
    existing = result.scalar_one_or_none()
    if existing:
        return existing

    new_session = AgentSession(
        id=session_id,
        project_id=project_id,
        trace_count=0,
    )
    db.add(new_session)
    await db.flush()  # populate DB defaults without committing
    return new_session


# ─── Ingest Trace (with optional spans) ──────────────────────────────────────

async def ingest_trace(
    db: AsyncSession,
    payload: TraceIngest,
) -> tuple[Trace, list[Span]]:
    """
    Atomically persist one Trace and its child Spans.

    Returns
    -------
    (trace, spans) — the persisted ORM objects.
    """
    # Resolve IDs
    trace_id = payload.trace_id or uuid.uuid4()

    # Ensure session exists if provided
    if payload.session_id:
        await _ensure_session(db, payload.project_id, payload.session_id)

    span_semantics = [
        normalize_span(
            name=s.name,
            attrs={str(k): str(v) for k, v in (s.metadata or {}).items() if v is not None},
            fallback_type=s.type,
        )
        for s in payload.spans
    ]
    span_categories = [s.category for s in span_semantics]
    trace_category = trace_category_for_name_and_span_categories(payload.name, set(span_categories))
    summary = summarize_span_categories(span_categories)
    metadata = merge_firefly_metadata(
        payload.metadata,
        category=trace_category,
        display_type="Trace",
        display_name=payload.name,
        visibility="primary" if trace_category == "user_request" else "secondary",
        summary=summary,
    )

    # Build Trace ORM object
    trace = Trace(
        id=trace_id,
        project_id=payload.project_id,
        session_id=payload.session_id,
        user_id=payload.user_id,
        name=payload.name,
        input=payload.input,
        output=payload.output,
        timestamp_start=payload.timestamp_start,
        timestamp_end=payload.timestamp_end,
        latency_ms=payload.latency_ms,
        status=payload.status,
        total_tokens=payload.total_tokens,
        total_cost=payload.total_cost,
        error_count=payload.error_count,
        span_count=len(payload.spans),
        category=trace_category,
        meta=metadata,
        tags=payload.tags,
    )
    db.add(trace)
    await db.flush()  # assign PK, detect FK violations early

    # Insert child spans
    spans: list[Span] = []
    for span_payload, semantics in zip(payload.spans, span_semantics, strict=False):
        span = _build_span(span_payload, override_trace_id=trace_id, semantics=semantics)
        db.add(span)
        spans.append(span)

    if spans:
        await db.flush()

    # Update Session aggregates
    if payload.session_id:
        await db.execute(
            update(AgentSession)
            .where(AgentSession.id == payload.session_id)
            .values(
                trace_count=AgentSession.trace_count + 1,
                started_at=AgentSession.started_at or payload.timestamp_start,
                ended_at=payload.timestamp_end or payload.timestamp_start,
            )
        )

    return trace, spans


# ─── Ingest standalone Span ───────────────────────────────────────────────────

async def ingest_span(
    db: AsyncSession,
    payload: SpanIngest,
) -> Span:
    """
    Persist a single Span.  The referenced trace_id must already exist
    (or be sent in the same request batch from the producer).

    Also updates the parent Trace's span_count and error_count.
    """
    if not payload.trace_id:
        raise ValueError("trace_id is required for standalone span ingest.")

    semantics = normalize_span(
        name=payload.name,
        attrs={str(k): str(v) for k, v in (payload.metadata or {}).items() if v is not None},
        fallback_type=payload.type,
    )
    span = _build_span(payload, override_trace_id=payload.trace_id, semantics=semantics)
    db.add(span)
    await db.flush()

    # Update parent trace aggregates
    error_delta = 1 if payload.status == "error" else 0
    await db.execute(
        update(Trace)
        .where(Trace.id == payload.trace_id)
        .values(
            span_count=Trace.span_count + 1,
            error_count=Trace.error_count + error_delta,
            total_tokens=Trace.total_tokens + ((payload.tokens_input or 0) + (payload.tokens_output or 0)),
            total_cost=Trace.total_cost + (payload.cost or 0.0),
        )
    )

    return span


# ─── Internal builder ────────────────────────────────────────────────────────

def _build_span(payload: SpanIngest, override_trace_id: uuid.UUID, semantics=None) -> Span:
    """Convert a SpanIngest schema into a Span ORM object."""
    if semantics is None:
        semantics = normalize_span(
            name=payload.name,
            attrs={str(k): str(v) for k, v in (payload.metadata or {}).items() if v is not None},
            fallback_type=payload.type,
        )
    metadata = merge_firefly_metadata(
        payload.metadata,
        category=semantics.category,
        display_type=semantics.display_type,
        display_name=semantics.display_name,
        visibility=semantics.visibility,
    )
    return Span(
        id=payload.span_id or uuid.uuid4(),
        parent_span_id=payload.parent_span_id,
        trace_id=override_trace_id,
        type=semantics.span_type,
        name=semantics.display_name,
        model=payload.model,
        provider=payload.provider,
        input=payload.input,
        output=payload.output,
        input_tokens=payload.tokens_input or 0,
        output_tokens=payload.tokens_output or 0,
        total_tokens=(payload.tokens_input or 0) + (payload.tokens_output or 0),
        cost_usd=payload.cost,
        latency_ms=payload.latency_ms,
        first_token_ms=payload.first_token_latency_ms,
        timestamp_start=payload.timestamp_start or _now_utc(),
        timestamp_end=payload.timestamp_end,
        status=payload.status,
        category=semantics.category,
        error=payload.error,
        meta=metadata,
    )
