"""
Span query endpoints.

GET /api/v1/spans returns paginated observations for the Tracing workspace.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ensure_project_access, get_current_user
from app.database import get_db
from app.models.span import Span
from app.models.trace import Trace
from app.models.user import User
from app.schemas.span import SpanListResponse, SpanResponse

router = APIRouter(prefix="/spans", tags=["spans"])


@router.get("", response_model=SpanListResponse, summary="List spans")
async def list_spans(
    project_id: uuid.UUID = Query(..., description="Project scope is required."),
    span_type: str | None = Query(None, alias="type", description="Filter by span type."),
    status_filter: str | None = Query(None, alias="status", description="ok | error | running"),
    category: str | None = Query(None, description="Filter by normalized category."),
    from_dt: datetime | None = Query(None, alias="from", description="Start of time range (ISO-8601)."),
    to_dt: datetime | None = Query(None, alias="to", description="End of time range (ISO-8601)."),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SpanListResponse:
    await ensure_project_access(db, project_id, current_user.id)

    stmt = select(Span)

    stmt = stmt.join(Trace, Span.trace_id == Trace.id).where(Trace.project_id == project_id)
    if span_type:
        stmt = stmt.where(Span.type == span_type)
    if status_filter:
        stmt = stmt.where(Span.status == status_filter)
    if from_dt:
        stmt = stmt.where(Span.timestamp_start >= from_dt)
    if to_dt:
        stmt = stmt.where(Span.timestamp_start <= to_dt)
    if category == "llm_generation":
        stmt = stmt.where(or_(
            Span.category == "llm_generation",
            Span.type.in_(("gen_ai.chat", "generation")),
        ))
    elif category == "tool":
        stmt = stmt.where(or_(
            Span.category.in_(("tool", "tool_call")),
            Span.type.in_(("tool", "gen_ai.tool")),
        ))
    elif category:
        stmt = stmt.where(Span.category == category)
    else:
        stmt = stmt.where(Span.category != "system")

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        await db.execute(
            stmt
            .order_by(Span.timestamp_start.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return SpanListResponse(
        items=[SpanResponse.model_validate(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
        has_next=(page * page_size) < total,
    )
