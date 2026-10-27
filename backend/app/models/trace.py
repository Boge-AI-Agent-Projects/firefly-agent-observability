"""
app/models/trace.py
────────────────────
Trace — the root unit of observation for one end-to-end agent run.
"""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Integer, String, JSON
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.span import Span
    from app.models.session import AgentSession


class Trace(UUIDMixin, TimestampMixin, Base):
    """One complete agent invocation / LLM request chain."""

    __tablename__ = "traces"

    project_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("agent_sessions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    user_id: Mapped[str | None] = mapped_column(
        String(256), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(
        String(256), nullable=False, index=True
    )

    input: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    output: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    timestamp_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    timestamp_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    latency_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    span_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="ok", index=True
    )
    category: Mapped[str] = mapped_column(
        String(32), nullable=False, default="user_trace", index=True
    )
    meta: Mapped[dict[str, Any] | None] = mapped_column(
        "metadata", JSON, nullable=True
    )
    tags: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    project: Mapped["Project"] = relationship("Project", back_populates="traces")
    session: Mapped["AgentSession | None"] = relationship("AgentSession", back_populates="traces")
    spans: Mapped[list["Span"]] = relationship(
        "Span", back_populates="trace", cascade="all, delete-orphan", lazy="noload"
    )
