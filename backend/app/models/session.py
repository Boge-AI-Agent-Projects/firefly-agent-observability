"""
app/models/session.py
─────────────────────
AgentSession — logical grouping of multiple traces from one conversation.
"""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, JSON
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.trace import Trace


class AgentSession(UUIDMixin, TimestampMixin, Base):
    """
    Logical session grouping multiple traces.

    Columns
    -------
    id              UUID PK
    project_id      FK -> projects.id
    user_id         End-user identifier
    name            Human-readable session label
    trace_count     Denormalized count of traces in this session
    started_at      Earliest trace start
    ended_at        Latest trace end
    metadata        Arbitrary JSON (platform, agent_id, context, etc.)
    """

    __tablename__ = "agent_sessions"

    project_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    user_id: Mapped[str | None] = mapped_column(String(256), nullable=True, index=True)
    name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    trace_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    meta: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSON, nullable=True)

    project: Mapped["Project"] = relationship("Project", back_populates="sessions")
    traces: Mapped[list["Trace"]] = relationship("Trace", back_populates="session", lazy="noload")
