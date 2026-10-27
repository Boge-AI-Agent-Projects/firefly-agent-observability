"""
app/api/prompts.py
──────────────────
Prompt template CRUD endpoints.

POST   /api/v1/prompts               — create prompt
GET    /api/v1/prompts               — list prompts (by project)
GET    /api/v1/prompts/{id}          — get prompt
PATCH  /api/v1/prompts/{id}          — update description / current_version
POST   /api/v1/prompts/{id}/versions — add a new version
DELETE /api/v1/prompts/{id}          — delete prompt
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.prompt import Prompt
from app.schemas.prompt import (
    PromptAddVersion,
    PromptCreate,
    PromptListResponse,
    PromptResponse,
    PromptUpdate,
)

router = APIRouter(prefix="/prompts", tags=["prompts"])


# ─── Create ──────────────────────────────────────────────────────────────────

@router.post("", response_model=PromptResponse, status_code=status.HTTP_201_CREATED)
async def create_prompt(
    payload: PromptCreate,
    db: AsyncSession = Depends(get_db),
) -> PromptResponse:
    """Create a new prompt template, optionally seeding the first version."""
    versions: list[dict] = []
    current_version: str | None = None

    if payload.initial_version:
        versions = [payload.initial_version.model_dump(mode="json")]
        current_version = payload.initial_version.version

    prompt = Prompt(
        project_id=payload.project_id,
        name=payload.name,
        description=payload.description,
        current_version=current_version,
        versions=versions,
        version_count=len(versions),
        metadata=payload.metadata,
    )
    db.add(prompt)
    await db.flush()
    return PromptResponse.model_validate(prompt)


# ─── List ────────────────────────────────────────────────────────────────────

@router.get("", response_model=PromptListResponse)
async def list_prompts(
    project_id: uuid.UUID | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> PromptListResponse:
    """List prompt templates, optionally filtered by project."""
    stmt = select(Prompt)
    if project_id:
        stmt = stmt.where(Prompt.project_id == project_id)

    count = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        await db.execute(
            stmt.order_by(Prompt.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return PromptListResponse(
        items=[PromptResponse.model_validate(r) for r in rows],
        total=count,
        page=page,
        page_size=page_size,
    )


# ─── Get ─────────────────────────────────────────────────────────────────────

@router.get("/{prompt_id}", response_model=PromptResponse)
async def get_prompt(
    prompt_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> PromptResponse:
    prompt = await _get_or_404(db, prompt_id)
    return PromptResponse.model_validate(prompt)


# ─── Update ──────────────────────────────────────────────────────────────────

@router.patch("/{prompt_id}", response_model=PromptResponse)
async def update_prompt(
    prompt_id: uuid.UUID,
    payload: PromptUpdate,
    db: AsyncSession = Depends(get_db),
) -> PromptResponse:
    """Update description, active version, or metadata."""
    prompt = await _get_or_404(db, prompt_id)

    if payload.description is not None:
        prompt.description = payload.description
    if payload.current_version is not None:
        # Validate the version tag exists
        existing_tags = {v.get("version") for v in (prompt.versions or [])}
        if payload.current_version not in existing_tags:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Version '{payload.current_version}' not found in prompt versions.",
            )
        prompt.current_version = payload.current_version
    if payload.metadata is not None:
        prompt.metadata = payload.metadata

    await db.flush()
    return PromptResponse.model_validate(prompt)


# ─── Add Version ─────────────────────────────────────────────────────────────

@router.post("/{prompt_id}/versions", response_model=PromptResponse)
async def add_prompt_version(
    prompt_id: uuid.UUID,
    payload: PromptAddVersion,
    db: AsyncSession = Depends(get_db),
) -> PromptResponse:
    """Append a new version to an existing prompt and optionally promote it."""
    prompt = await _get_or_404(db, prompt_id)

    # Check for duplicate version tag
    existing_tags = {v.get("version") for v in (prompt.versions or [])}
    if payload.version.version in existing_tags:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Version '{payload.version.version}' already exists.",
        )

    new_versions = list(prompt.versions or [])
    new_versions.append(payload.version.model_dump(mode="json"))
    prompt.versions = new_versions
    prompt.version_count = len(new_versions)

    if payload.set_current:
        prompt.current_version = payload.version.version

    await db.flush()
    return PromptResponse.model_validate(prompt)


# ─── Delete ──────────────────────────────────────────────────────────────────

@router.delete("/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_prompt(
    prompt_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Hard-delete a prompt and all its versions."""
    prompt = await _get_or_404(db, prompt_id)
    await db.delete(prompt)


# ─── Internal helper ─────────────────────────────────────────────────────────

async def _get_or_404(db: AsyncSession, prompt_id: uuid.UUID) -> Prompt:
    result = await db.execute(select(Prompt).where(Prompt.id == prompt_id))
    prompt = result.scalar_one_or_none()
    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prompt {prompt_id} not found.",
        )
    return prompt
