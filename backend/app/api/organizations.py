from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.organization import Organization, OrganizationMembership
from app.models.project import Project
from app.models.user import User
from app.schemas.organization import (
    OrganizationCreate,
    OrganizationResponse,
    ProjectCreate,
    ProjectResponse,
)
from app.services.security import slugify

router = APIRouter(tags=["workspace"])


async def _unique_slug(db: AsyncSession, model, base: str) -> str:
    root = slugify(base)
    candidate = root
    suffix = 2
    while await db.scalar(select(exists().where(model.slug == candidate))):
        candidate = f"{root}-{suffix}"
        suffix += 1
    return candidate


async def _membership(db: AsyncSession, organization_id: uuid.UUID, user_id: uuid.UUID) -> OrganizationMembership | None:
    return await db.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.user_id == user_id,
        )
    )


def _org_response(org: Organization, role: str | None = None) -> OrganizationResponse:
    item = OrganizationResponse.model_validate(org)
    item.role = role
    return item


@router.get("/organizations", response_model=list[OrganizationResponse])
async def list_organizations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[OrganizationResponse]:
    stmt = (
        select(Organization, OrganizationMembership.role)
        .join(OrganizationMembership, OrganizationMembership.organization_id == Organization.id)
        .where(OrganizationMembership.user_id == current_user.id)
        .order_by(Organization.created_at)
    )
    rows = await db.execute(stmt)
    return [_org_response(org, role) for org, role in rows.all()]


@router.post("/organizations", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
async def create_organization(
    payload: OrganizationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrganizationResponse:
    slug = await _unique_slug(db, Organization, payload.slug or payload.name)
    org = Organization(
        name=payload.name.strip(),
        slug=slug,
        description=payload.description,
        created_by_id=current_user.id,
    )
    db.add(org)
    await db.flush()
    db.add(OrganizationMembership(organization_id=org.id, user_id=current_user.id, role="owner"))
    await db.flush()
    return _org_response(org, "owner")


@router.get("/projects", response_model=list[ProjectResponse])
async def list_projects(
    organization_id: uuid.UUID | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ProjectResponse]:
    stmt = select(Project).order_by(Project.created_at)
    if organization_id:
        if not await _membership(db, organization_id, current_user.id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this organization.")
        stmt = stmt.where(Project.organization_id == organization_id)
    else:
        stmt = (
            stmt.join(OrganizationMembership, OrganizationMembership.organization_id == Project.organization_id)
            .where(OrganizationMembership.user_id == current_user.id)
        )
    projects = (await db.execute(stmt)).scalars().all()
    return [ProjectResponse.model_validate(project) for project in projects]


@router.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectResponse:
    membership = await _membership(db, payload.organization_id, current_user.id)
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this organization.")
    if membership.role not in {"owner", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owners or admins can create projects.")

    org = await db.scalar(select(Organization).where(Organization.id == payload.organization_id))
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found.")

    slug = await _unique_slug(db, Project, payload.slug or payload.name)
    project = Project(
        organization_id=payload.organization_id,
        name=payload.name.strip(),
        slug=slug,
        description=payload.description,
    )
    db.add(project)
    await db.flush()
    return ProjectResponse.model_validate(project)
