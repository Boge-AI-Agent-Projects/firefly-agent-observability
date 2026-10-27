"""
app/config.py
─────────────
Application settings loaded from environment / .env file.
All settings are validated by Pydantic v2 at startup.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ──────────────────────────────────────────────────────────
    app_name: str = "firefly-backend"
    app_env: Literal["development", "staging", "production"] = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    debug: bool = False
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    # ── Database ─────────────────────────────────────────────────────────────
    database_url: str = Field(
        default="sqlite+aiosqlite:///./firefly.db",
        description="SQLAlchemy database URL. Use asyncpg for Postgres, aiosqlite for SQLite dev.",
    )

    # ── OTLP ─────────────────────────────────────────────────────────────────
    otlp_endpoint: str = "http://localhost:4318"
    otlp_headers: str = ""  # comma-separated key=value pairs

    # ── Security ─────────────────────────────────────────────────────────────
    ingest_api_key: str = "dev-only-change-me"

    # ── Pagination ───────────────────────────────────────────────────────────
    page_size_default: int = 20
    page_size_max: int = 200

    @field_validator("database_url")
    @classmethod
    def normalize_driver(cls, v: str) -> str:
        if "postgresql" in v and "asyncpg" not in v:
            v = v.replace("postgresql://", "postgresql+asyncpg://")
        return v

    @model_validator(mode="after")
    def reject_insecure_production_key(self) -> "Settings":
        insecure_keys = {"", "dev-only-change-me", "changeme-secret-key"}
        if self.app_env in {"staging", "production"} and self.ingest_api_key in insecure_keys:
            raise ValueError("INGEST_API_KEY must be set to a non-default value outside development.")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings singleton (re-reads .env only once)."""
    return Settings()
