"""Firefly Hermes Adapter - Observability for Hermes Agent framework."""

from .adapter import HermesAdapter, create_adapter
from .types import FireflyConfig

__all__ = ["HermesAdapter", "create_adapter", "FireflyConfig"]
__version__ = "0.1.0"
