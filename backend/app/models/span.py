"""
app/models/span.py
──────────────────
Span — one atomic unit of work within a Trace.
"""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Integer, String, JSON
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.trace import Trace


SPAN_TYPES = frozenset({
    "gen_ai.chat", "gen_ai.embed", "tool", "retrieval",
    "agent", "chain", "custom",
})


class Span(UUIDMixin, TimestampMixin, Base):
    """One atomic observability unit within a Trace."""

    __tablename__ = "spans"

    parent_span_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=True,
        index=True,
    )
    trace_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("traces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    provider: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    input: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    output: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)

    latency_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    first_token_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    timestamp_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    timestamp_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ok", index=True)
    category: Mapped[str] = mapped_column(
        String(32), nullable=False, default="user_trace", index=True
    )
    error: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    meta: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSON, nullable=True)

    trace: Mapped["Trace"] = relationship("Trace", back_populates="spans")
    # Self-referential link: parent_span_id has no FK for OTEL / ClickHouse compat.
    children: Mapped[list["Span"]] = relationship(
        "Span",
        primaryjoin="remote(Span.parent_span_id) == foreign(Span.id)",
        lazy="noload",
    )
