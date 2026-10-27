"""
app/models/project.py
─────────────────────
Project — top-level tenant/namespace for traces and prompts.
Each Firefly installation may host multiple projects (e.g. one per Agent platform).
"""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.trace import Trace
    from app.models.prompt import Prompt
    from app.models.session import AgentSession
    from app.models.organization import Organization


class Project(UUIDMixin, TimestampMixin, Base):
    """
    Tenant / namespace for agent observability data.

    Columns
    -------
    id          UUID PK
    name        Human-readable project name, must be unique
    slug        URL-friendly identifier (e.g. "openclaw-prod")
    description Optional description
    """

    __tablename__ = "projects"

    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    slug: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # ── Relationships ────────────────────────────────────────────────────────
    organization: Mapped["Organization | None"] = relationship("Organization", back_populates="projects")
    traces: Mapped[list["Trace"]] = relationship("Trace", back_populates="project", lazy="noload")
    prompts: Mapped[list["Prompt"]] = relationship("Prompt", back_populates="project", lazy="noload")
    sessions: Mapped[list["AgentSession"]] = relationship(
        "AgentSession", back_populates="project", lazy="noload"
    )
