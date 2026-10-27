"""
app/api/router.py
─────────────────
Main API router — aggregates all sub-routers under /api/v1.
"""

from fastapi import APIRouter

from app.api import auth, ingestion, organizations, prompts, sessions, spans, stats, traces

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(organizations.router)
api_router.include_router(ingestion.router)
api_router.include_router(traces.router)
api_router.include_router(spans.router)
api_router.include_router(sessions.router)
api_router.include_router(stats.router)
api_router.include_router(prompts.router)
