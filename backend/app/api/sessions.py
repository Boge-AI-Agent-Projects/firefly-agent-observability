"""
app/api/sessions.py
───────────────────
Agent session query endpoints.

GET /api/v1/sessions/{session_id}  — fetch session + its traces
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.session import AgentSession
from app.schemas.trace import TraceSummary
from app.services import query as svc

router = APIRouter(prefix="/sessions", tags=["sessions"])


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    user_id: str | None
    name: str | None
    trace_count: int
    started_at: datetime | None
    ended_at: datetime | None
    metadata: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime
    traces: list[TraceSummary] = []


@router.get(
    "/{session_id}",
    response_model=SessionResponse,
    summary="Get a session and its traces",
)
async def get_session(
    session_id: uuid.UUID,
    include_traces: bool = Query(True, description="Whether to include trace summaries."),
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    """
    Fetch one AgentSession by ID.

    Set `include_traces=false` for a lightweight response when you only need
    session metadata.
    """
    session = await svc.get_session(db, session_id, include_traces=include_traces)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found.",
        )

    resp = SessionResponse.model_validate(session)
    if include_traces and session.traces:
        resp.traces = [TraceSummary.model_validate(t) for t in session.traces]
    return resp
