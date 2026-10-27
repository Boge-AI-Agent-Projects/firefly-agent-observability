"""
app/api/otlp.py
───────────────
Native OTLP HTTP ingestion endpoint for Firefly.

Accepts OpenTelemetry protobuf traces at:
    POST /api/v1/otlp/traces   (Content-Type: application/x-protobuf)

Also serves as the standard OTLP endpoint for tools that expect:
    POST /v1/traces
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.ingest_auth import verify_ingest_key
from app.database import get_db
from app.services import otlp_ingestion

otlp_router = APIRouter(tags=["otlp"])


def _project_id_from_request(request: Request) -> uuid.UUID:
    raw_project_id = request.headers.get("x-firefly-project-id") or request.query_params.get("project_id")
    if not raw_project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project scope required. Send x-firefly-project-id or project_id.",
        )
    try:
        return uuid.UUID(raw_project_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Firefly project id.",
        ) from exc


async def _ingest(request: Request, db: AsyncSession) -> dict[str, int]:
    raw = await request.body()
    project_id = _project_id_from_request(request)
    try:
        return await otlp_ingestion.ingest_otlp_traces(db, raw, project_id=project_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@otlp_router.post("/api/v1/otlp/traces")
async def ingest_otlp_traces(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_ingest_key),
):
    """Accept OTLP protobuf traces (application/x-protobuf)."""
    result = await _ingest(request, db)
    return JSONResponse(
        content={"status": "ok", **result},
        status_code=202,
    )


@otlp_router.post("/v1/traces")
async def ingest_otlp_v1_traces(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_ingest_key),
):
    """Standard OTLP HTTP endpoint — compatible with OpenClaw diagnostics-otel."""
    await _ingest(request, db)
    return JSONResponse(
        content={"partialSuccess": {}},
        status_code=200,
    )
