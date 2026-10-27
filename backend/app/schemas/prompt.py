"""
app/schemas/prompt.py
─────────────────────
Pydantic v2 schemas for Prompt CRUD endpoints.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


# ─── Sub-schemas ─────────────────────────────────────────────────────────────

class PromptVersion(BaseModel):
    """One version entry stored inside `Prompt.versions` JSONB array."""

    version: str = Field(..., description="Version tag, e.g. 'v1.2'")
    content: str = Field(..., description="Prompt template text.")
    variables: list[str] = Field(default_factory=list, description="Variable placeholders.")
    author: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    notes: str | None = None


# ─── Create / Update ─────────────────────────────────────────────────────────

class PromptCreate(BaseModel):
    """Payload for POST /api/v1/prompts."""

    model_config = ConfigDict(extra="ignore")

    project_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=256)
    description: str | None = Field(None, max_length=512)
    initial_version: PromptVersion | None = Field(
        default=None,
        description="Optional first version to seed on creation.",
    )
    metadata: dict[str, Any] | None = None


class PromptAddVersion(BaseModel):
    """Payload for POST /api/v1/prompts/{id}/versions — add a new version."""

    model_config = ConfigDict(extra="ignore")

    version: PromptVersion
    set_current: bool = Field(
        default=True,
        description="If true, promote this version to current_version.",
    )


class PromptUpdate(BaseModel):
    """Payload for PATCH /api/v1/prompts/{id}."""

    model_config = ConfigDict(extra="ignore")

    description: str | None = None
    current_version: str | None = None
    metadata: dict[str, Any] | None = None


# ─── Response ────────────────────────────────────────────────────────────────

class PromptResponse(BaseModel):
    """Full prompt representation."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    description: str | None
    current_version: str | None
    versions: list[dict[str, Any]]
    version_count: int
    metadata: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime


class PromptListResponse(BaseModel):
    """Paginated list of prompts."""

    items: list[PromptResponse]
    total: int
    page: int
    page_size: int
