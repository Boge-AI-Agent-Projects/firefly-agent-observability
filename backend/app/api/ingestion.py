"""
app/api/ingestion.py
────────────────────
OTLP-style ingest endpoints.

POST /api/v1/ingest/trace  — atomic trace + spans ingest
POST /api/v1/ingest/span   — single span ingest (streaming / late-arriving)

Auth: X-Firefly-Key header (shared secret from settings.ingest_api_key).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.ingest_auth import verify_ingest_key
from app.database import get_db
from app.schemas.span import SpanIngest, SpanIngestResponse
from app.schemas.trace import TraceIngest, TraceIngestResponse
from app.services import ingestion as svc

router = APIRouter(prefix="/ingest", tags=["ingestion"])


@router.post(
    "/trace",
    response_model=TraceIngestResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Ingest a Trace with all its Spans",
)
async def ingest_trace(
    payload: TraceIngest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_ingest_key),
) -> TraceIngestResponse:
    """
    Atomically write one Trace and its child Spans.

    - Idempotent: if `trace_id` is provided and already exists, the request is accepted.
    - `spans` array is optional; spans may also be sent individually via `/ingest/span`.
    """
    trace, spans = await svc.ingest_trace(db, payload)
    return TraceIngestResponse(
        trace_id=trace.id,
        span_count=len(spans),
    )


@router.post(
    "/span",
    response_model=SpanIngestResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Ingest a single Span (streaming scenario)",
)
async def ingest_span(
    payload: SpanIngest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_ingest_key),
) -> SpanIngestResponse:
    """
    Write one Span to an existing Trace.

    Use this endpoint when spans arrive incrementally (e.g. streaming LLM calls).
    `trace_id` is required in the request body.
    """
    if not payload.trace_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="trace_id is required for standalone span ingest.",
        )
    span = await svc.ingest_span(db, payload)
    return SpanIngestResponse(span_id=span.id, trace_id=span.trace_id)
