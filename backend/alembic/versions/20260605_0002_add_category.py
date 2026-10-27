"""add_category_to_trace_and_span

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-05

Adds ``category`` column to ``traces`` and ``spans`` tables.
Values: user_trace (default) | system | tool | background
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    for table in ("traces", "spans"):
        op.add_column(
            table,
            sa.Column(
                "category",
                sa.String(32),
                nullable=False,
                server_default="user_trace",
            ),
        )
        op.create_index(
            f"ix_{table}_category",
            table,
            ["category"],
        )

    # Backfill existing system noise
    op.execute(
        "UPDATE traces SET category = 'system' "
        "WHERE (metadata->>'otel.trace_id') IS NOT NULL "
        "AND (metadata->>'service.name') IS NOT NULL "
        "AND name LIKE '%diagnostic%' OR name LIKE '%liveness%' OR name LIKE '%heartbeat%' "
        "OR name LIKE '%health%'"
    )


def downgrade() -> None:
    for table in ("traces", "spans"):
        op.drop_index(f"ix_{table}_category", table_name=table)
        op.drop_column(table, "category")
