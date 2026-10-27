"""
app/models/prompt.py
────────────────────
Prompt — versioned prompt template registry.
"""

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, Integer, String, JSON
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.project import Project


class Prompt(UUIDMixin, TimestampMixin, Base):
    """Versioned prompt template."""

    __tablename__ = "prompts"

    project_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)
    current_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    versions: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, nullable=False, default=list
    )
    version_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    meta: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSON, nullable=True)

    project: Mapped["Project"] = relationship("Project", back_populates="prompts")
