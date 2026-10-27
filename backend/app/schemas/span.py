"""
app/schemas/span.py
────────────────────
Pydantic v2 schemas for Span ingest and query endpoints.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class SpanIngest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    span_id: uuid.UUID | None = None
    parent_span_id: uuid.UUID | None = None
    trace_id: uuid.UUID | None = None
    type: str = Field(..., description="gen_ai.chat, gen_ai.tool, etc.")
    name: str
    model: str | None = None
    provider: str | None = None
    input: dict[str, Any] | None = None
    output: dict[str, Any] | None = None
    tokens_input: int | None = None
    tokens_output: int | None = None
    cost: float | None = None
    latency_ms: int | None = None
    first_token_latency_ms: int | None = None
    status: str = Field(default="ok", pattern="^(ok|error|running)$")
    status_message: str | None = None
    metadata: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    timestamp_start: datetime | None = None
    timestamp_end: datetime | None = None


class SpanResponse(BaseModel):
    """Full span in GET /api/v1/traces/{id}. Maps ORM columns to API names."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    parent_span_id: uuid.UUID | None = None
    trace_id: uuid.UUID
    type: str
    name: str
    model: str | None
    provider: str | None
    category: str = "user_trace"
    input: Any | None
    output: Any | None
    # ORM has input_tokens/output_tokens; API calls them tokens_input/tokens_output
    tokens_input: int = Field(0, validation_alias="input_tokens")
    tokens_output: int = Field(0, validation_alias="output_tokens")
    total_tokens: int = 0
    cost_usd: float | None = None
    latency_ms: int | None = None
    first_token_ms: int | None = Field(None, validation_alias="first_token_ms")
    timestamp_start: datetime
    timestamp_end: datetime | None = None
    status: str
    error: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = Field(None, validation_alias="meta")
    created_at: datetime
    updated_at: datetime


class SpanIngestResponse(BaseModel):
    span_id: uuid.UUID
    trace_id: uuid.UUID
    message: str = "Span ingested successfully."


class SpanListResponse(BaseModel):
    items: list[SpanResponse]
    total: int
    page: int
    page_size: int
    has_next: bool
