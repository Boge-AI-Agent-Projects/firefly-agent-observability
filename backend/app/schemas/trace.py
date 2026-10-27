"""
app/schemas/trace.py
────────────────────
Pydantic v2 schemas for Trace ingest and query endpoints.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.span import SpanIngest, SpanResponse


class TraceIngest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    trace_id: uuid.UUID | None = None
    project_id: uuid.UUID
    session_id: uuid.UUID | None = None
    user_id: str | None = Field(None, max_length=256)
    name: str = Field(..., min_length=1, max_length=256)

    input: dict[str, Any] | None = None
    output: dict[str, Any] | None = None

    timestamp_start: datetime
    timestamp_end: datetime | None = None
    latency_ms: int | None = Field(None, ge=0)

    status: str = Field(default="ok", pattern="^(ok|error|running)$")
    total_tokens: int = Field(default=0, ge=0)
    total_cost: float = Field(default=0.0, ge=0.0)
    error_count: int = Field(default=0, ge=0)

    metadata: dict[str, Any] | None = None
    tags: list[str] | None = None
    spans: list[SpanIngest] = Field(default_factory=list)

    @field_validator("timestamp_end", mode="after")
    @classmethod
    def check_end_after_start(cls, v, info):
        if v is None:
            return v
        start = info.data.get("timestamp_start")
        if start and v < start:
            raise ValueError("timestamp_end must be >= timestamp_start")
        return v


class TraceResponse(BaseModel):
    """Full trace returned by GET /api/v1/traces/{id}. Maps ORM meta->metadata."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    project_id: uuid.UUID
    session_id: uuid.UUID | None
    user_id: str | None
    name: str
    input: Any | None
    output: Any | None
    timestamp_start: datetime
    timestamp_end: datetime | None
    latency_ms: int | None
    total_tokens: int
    total_cost: float
    span_count: int
    error_count: int
    status: str
    category: str = "user_trace"
    metadata: dict[str, Any] | None = Field(None, validation_alias="meta")
    tags: list[str] | None
    created_at: datetime
    updated_at: datetime
    spans: list[SpanResponse] = []


class TraceSummary(BaseModel):
    """Lightweight trace row for list endpoints."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    project_id: uuid.UUID
    session_id: uuid.UUID | None
    user_id: str | None
    name: str
    input: Any | None
    output: Any | None
    status: str
    category: str = "user_trace"
    latency_ms: int | None
    total_tokens: int
    total_cost: float
    span_count: int
    error_count: int
    timestamp_start: datetime
    metadata: dict[str, Any] | None = Field(None, validation_alias="meta")
    tags: list[str] | None
    created_at: datetime


class TraceListResponse(BaseModel):
    items: list[TraceSummary]
    total: int
    page: int
    page_size: int
    has_next: bool


class TraceIngestResponse(BaseModel):
    trace_id: uuid.UUID
    span_count: int
    message: str = "Trace ingested successfully."
