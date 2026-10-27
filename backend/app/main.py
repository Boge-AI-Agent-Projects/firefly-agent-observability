"""
app/main.py
───────────
Firefly Backend — FastAPI application entry point.

Start locally:
    uvicorn app.main:app --reload --port 8000

Docs:
    http://localhost:8000/docs
    http://localhost:8000/redoc
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.api.otlp import otlp_router
from app.config import get_settings
from app.database import engine
from app.models import Base

settings = get_settings()

SQLITE_DEV_COLUMNS = {
    "traces": [
        ("user_id", "VARCHAR(256)"),
        ("timestamp_start", "DATETIME"),
        ("total_tokens", "INTEGER NOT NULL DEFAULT 0"),
        ("category", "VARCHAR(32) NOT NULL DEFAULT 'user_trace'"),
    ],
    "spans": [
        ("type", "VARCHAR(64) NOT NULL DEFAULT 'custom'"),
        ("input_tokens", "INTEGER NOT NULL DEFAULT 0"),
        ("latency_ms", "BIGINT"),
        ("category", "VARCHAR(32) NOT NULL DEFAULT 'user_trace'"),
        ("metadata", "JSON"),
    ],
    "projects": [
        ("organization_id", "CHAR(32)"),
    ],
}


def _ensure_sqlite_dev_schema(sync_conn) -> None:
    """Keep older local SQLite files usable after small model changes."""
    if sync_conn.dialect.name != "sqlite":
        return

    for table, columns in SQLITE_DEV_COLUMNS.items():
        existing = {
            row[1]
            for row in sync_conn.exec_driver_sql(f'PRAGMA table_info("{table}")')
        }
        if not existing:
            continue

        for column, ddl in columns:
            if column not in existing:
                sync_conn.exec_driver_sql(
                    f'ALTER TABLE "{table}" ADD COLUMN "{column}" {ddl}'
                )

    sync_conn.exec_driver_sql(
        "UPDATE traces SET timestamp_start = created_at WHERE timestamp_start IS NULL"
    )
    sync_conn.exec_driver_sql(
        "UPDATE traces SET total_tokens = 0 WHERE total_tokens IS NULL"
    )
    sync_conn.exec_driver_sql(
        "UPDATE traces SET category = 'user_trace' WHERE category IS NULL"
    )
    sync_conn.exec_driver_sql(
        "UPDATE spans SET type = 'custom' WHERE type IS NULL"
    )
    sync_conn.exec_driver_sql(
        "UPDATE spans SET input_tokens = 0 WHERE input_tokens IS NULL"
    )
    sync_conn.exec_driver_sql(
        "UPDATE spans SET category = 'user_trace' WHERE category IS NULL"
    )


def _ensure_postgres_runtime_schema(sync_conn) -> None:
    """Apply small additive schema upgrades for local dev/Postgres installs."""
    if sync_conn.dialect.name != "postgresql":
        return

    sync_conn.exec_driver_sql("ALTER TABLE projects ADD COLUMN IF NOT EXISTS organization_id UUID")
    sync_conn.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_projects_organization_id ON projects (organization_id)"
    )
    sync_conn.exec_driver_sql(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'projects_organization_id_fkey'
            ) THEN
                ALTER TABLE projects
                ADD CONSTRAINT projects_organization_id_fkey
                FOREIGN KEY (organization_id)
                REFERENCES organizations(id)
                ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle hooks."""
    # Auto-create tables for SQLite dev / first-run Postgres
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_ensure_sqlite_dev_schema)
        await conn.run_sync(_ensure_postgres_runtime_schema)
    yield
    await engine.dispose()


app = FastAPI(
    title="🔥 Firefly Observability API",
    description=(
        "Multi-agent observability platform — OTLP-compatible ingestion "
        "& query API for traces, spans, sessions, and prompt versions."
    ),
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── CORS ────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────────────────
app.include_router(api_router, prefix="/api/v1")
app.include_router(otlp_router)  # OTLP routes at /v1/traces and /api/v1/otlp/traces


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health", tags=["meta"])
async def health() -> JSONResponse:
    """Liveness probe."""
    return JSONResponse({"status": "ok", "service": settings.app_name})


@app.get("/", tags=["meta"], include_in_schema=False)
async def root() -> JSONResponse:
    return JSONResponse({"message": "Firefly backend is running. Visit /docs for API reference."})
