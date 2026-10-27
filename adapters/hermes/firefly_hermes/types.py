"""Firefly Hermes Adapter - Pydantic v2 type definitions."""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class SpanType(str, Enum):
    """Semantic span type aligned with gen_ai conventions."""

    chat = "gen_ai.chat"
    tool = "gen_ai.tool"
    retrieval = "gen_ai.retrieval"
    agent = "gen_ai.agent"
    chain = "gen_ai.chain"
    embedding = "gen_ai.embedding"


class SpanStatus(str, Enum):
    """Lifecycle / result status of a span or trace."""

    ok = "ok"
    error = "error"
    running = "running"


class FireflyConfig(BaseModel):
    """Connection configuration for the Firefly ingest API."""

    api_key: str = Field(..., description="Shared key sent in the X-Firefly-Key header.")
    base_url: str = Field(
        default="http://localhost:8000",
        description="Base URL of the Firefly backend (no trailing slash).",
    )
    project_id: str = Field(..., description="UUID of the target Firefly project.")


class FireflySpanIngest(BaseModel):
    """Payload for a single span sent to Firefly."""

    span_id: str = Field(..., description="Unique identifier for this span (UUID).")
    trace_id: str = Field(..., description="Parent trace identifier (UUID).")
    type: SpanType = Field(..., description="Semantic span type.")
    name: str = Field(..., description="Human-readable span name.")
    model: Optional[str] = Field(default=None, description="LLM model name, e.g. 'gpt-4o'.")
    provider: Optional[str] = Field(default=None, description="LLM provider, e.g. 'openai'.")
    input: Optional[Any] = Field(default=None, description="Span input payload (prompt, query, …).")
    output: Optional[Any] = Field(default=None, description="Span output payload (completion, result, …).")
    tokens_input: Optional[int] = Field(default=None, description="Number of input / prompt tokens consumed.")
    tokens_output: Optional[int] = Field(default=None, description="Number of output / completion tokens produced.")
    latency_ms: Optional[float] = Field(default=None, description="Wall-clock latency in milliseconds.")
    status: SpanStatus = Field(default=SpanStatus.ok, description="Span status.")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Arbitrary key-value metadata.")


class FireflyTraceIngest(BaseModel):
    """Payload for a complete trace sent to Firefly."""

    trace_id: str = Field(..., description="Unique identifier for this trace (UUID).")
    project_id: str = Field(..., description="UUID of the Firefly project this trace belongs to.")
    name: str = Field(..., description="Human-readable trace name (e.g. agent turn label).")
    input: Optional[Any] = Field(default=None, description="Trace-level input (user message, task description, …).")
    output: Optional[Any] = Field(default=None, description="Trace-level output (final agent response).")
    latency_ms: Optional[float] = Field(default=None, description="Total end-to-end latency in milliseconds.")
    total_tokens: Optional[int] = Field(default=None, description="Aggregate token count across all spans.")
    total_cost: Optional[float] = Field(default=None, description="Estimated USD cost for the trace.")
    status: SpanStatus = Field(default=SpanStatus.ok, description="Overall trace status.")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Arbitrary key-value metadata.")
    tags: list[str] = Field(default_factory=list, description="Free-form string tags for filtering.")
    spans: list[FireflySpanIngest] = Field(default_factory=list, description="Ordered list of child spans.")
