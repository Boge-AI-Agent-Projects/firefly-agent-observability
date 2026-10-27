"""
app/api/stats.py
────────────────
Aggregate statistics endpoint.

GET /api/v1/stats  — returns platform-wide or per-project stats
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ensure_project_access, get_current_user
from app.database import get_db
from app.models.user import User
from app.services import query as svc

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("", summary="Platform / project aggregate stats")
async def get_stats(
    project_id: uuid.UUID = Query(..., description="Project scope is required."),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Returns aggregate metrics:

    - `total_traces` — total number of traces ingested
    - `total_spans` — total number of spans
    - `error_traces` — traces with status=error
    - `total_tokens` — sum of all tokens across all traces
    - `total_cost_usd` — sum of all costs
    - `avg_latency_ms` — mean trace latency
    - `p95_latency_ms` — 95th percentile trace latency
    """
    await ensure_project_access(db, project_id, current_user.id)
    return await svc.get_stats(db, project_id=project_id)
