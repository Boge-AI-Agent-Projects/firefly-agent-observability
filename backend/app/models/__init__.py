# Import all models so Alembic `autogenerate` can detect them.
from app.models.base import Base  # noqa: F401
from app.models.user import AuthSession, User  # noqa: F401
from app.models.organization import Organization, OrganizationMembership  # noqa: F401
from app.models.project import Project  # noqa: F401
from app.models.session import AgentSession  # noqa: F401
from app.models.trace import Trace  # noqa: F401
from app.models.span import Span  # noqa: F401
from app.models.prompt import Prompt  # noqa: F401

__all__ = [
    "Base",
    "User",
    "AuthSession",
    "Organization",
    "OrganizationMembership",
    "Project",
    "AgentSession",
    "Trace",
    "Span",
    "Prompt",
]
