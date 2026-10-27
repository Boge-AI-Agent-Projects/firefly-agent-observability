"""Shared authentication dependency for all telemetry ingestion endpoints."""

from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, status

from app.config import get_settings

settings = get_settings()


def verify_ingest_key(
    x_firefly_key: str | None = Header(default=None, alias="X-Firefly-Key"),
) -> None:
    """Validate the shared ingest key without leaking comparison timing."""
    expected = settings.ingest_api_key
    if not x_firefly_key or not hmac.compare_digest(x_firefly_key, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Firefly-Key header.",
        )
