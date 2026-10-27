"""Firefly Hermes Adapter - Async HTTP client for the Firefly ingest API."""

from __future__ import annotations

import logging

import httpx

from .types import FireflyConfig, FireflySpanIngest, FireflyTraceIngest

log = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 10.0  # seconds


class FireflyClient:
    """Lightweight async client that ships trace/span payloads to Firefly.

    Usage::

        async with FireflyClient(config) as client:
            ok = await client.ingest_trace(trace)
    """

    def __init__(self, config: FireflyConfig) -> None:
        self._config = config
        self._http: httpx.AsyncClient | None = None

    # ------------------------------------------------------------------
    # Context-manager helpers (optional — callers may also use directly)
    # ------------------------------------------------------------------

    async def __aenter__(self) -> "FireflyClient":
        self._http = httpx.AsyncClient(
            base_url=self._config.base_url,
            headers=self._auth_headers(),
            timeout=_DEFAULT_TIMEOUT,
        )
        return self

    async def __aexit__(self, *_: object) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _auth_headers(self) -> dict[str, str]:
        return {
            "X-Firefly-Key": self._config.api_key,
            "Content-Type": "application/json",
        }

    def _client(self) -> httpx.AsyncClient:
        """Return a live client, creating an ephemeral one when not used as context manager."""
        if self._http is not None:
            return self._http
        # Callers that don't use async-with get a freshly created client;
        # they are responsible for calling aclose() or using an outer context.
        return httpx.AsyncClient(
            base_url=self._config.base_url,
            headers=self._auth_headers(),
            timeout=_DEFAULT_TIMEOUT,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def ingest_trace(self, trace: FireflyTraceIngest) -> bool:
        """POST a complete trace payload to Firefly.

        Returns:
            True on HTTP 2xx; False on any error (network or server-side).
        """
        client = self._client()
        owned = self._http is None  # True when we created the client internally
        try:
            response = await client.post(
                "/api/v1/ingest/trace",
                content=trace.model_dump_json(),
            )
            response.raise_for_status()
            log.debug("ingest_trace ok | trace_id=%s status=%s", trace.trace_id, response.status_code)
            return True
        except httpx.HTTPStatusError as exc:
            log.warning(
                "ingest_trace HTTP error | trace_id=%s status=%s body=%s",
                trace.trace_id,
                exc.response.status_code,
                exc.response.text[:200],
            )
            return False
        except httpx.RequestError as exc:
            log.warning("ingest_trace request error | trace_id=%s error=%r", trace.trace_id, exc)
            return False
        finally:
            if owned:
                await client.aclose()

    async def ingest_span(self, span: FireflySpanIngest) -> bool:
        """POST a single span payload to Firefly.

        Returns:
            True on HTTP 2xx; False on any error (network or server-side).
        """
        client = self._client()
        owned = self._http is None
        try:
            response = await client.post(
                "/api/v1/ingest/span",
                content=span.model_dump_json(),
            )
            response.raise_for_status()
            log.debug("ingest_span ok | span_id=%s status=%s", span.span_id, response.status_code)
            return True
        except httpx.HTTPStatusError as exc:
            log.warning(
                "ingest_span HTTP error | span_id=%s status=%s body=%s",
                span.span_id,
                exc.response.status_code,
                exc.response.text[:200],
            )
            return False
        except httpx.RequestError as exc:
            log.warning("ingest_span request error | span_id=%s error=%r", span.span_id, exc)
            return False
        finally:
            if owned:
                await client.aclose()
