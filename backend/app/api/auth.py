from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import bearer_scheme, get_current_user
from app.database import get_db
from app.models.user import AuthSession, User
from app.schemas.auth import AuthToken, LoginRequest, RegisterRequest, UserPublic
from app.services.security import create_access_token, hash_password, hash_token, normalize_email, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])
SESSION_TTL_DAYS = 30


async def _issue_token(db: AsyncSession, user: User) -> AuthToken:
    token = create_access_token()
    expires_at = datetime.now(UTC) + timedelta(days=SESSION_TTL_DAYS)
    db.add(AuthSession(user_id=user.id, token_hash=hash_token(token), expires_at=expires_at))
    await db.flush()
    return AuthToken(access_token=token, expires_at=expires_at, user=UserPublic.model_validate(user))


@router.post("/register", response_model=AuthToken, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)) -> AuthToken:
    email = normalize_email(payload.email)
    existing = await db.scalar(select(User).where(User.email == email))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already registered.")

    user = User(email=email, name=payload.name.strip(), password_hash=hash_password(payload.password))
    db.add(user)
    await db.flush()
    return await _issue_token(db, user)


@router.post("/login", response_model=AuthToken)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> AuthToken:
    email = normalize_email(payload.email)
    user = await db.scalar(select(User).where(User.email == email))
    if not user or not verify_password(payload.password, user.password_hash) or user.disabled:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")

    return await _issue_token(db, user)


@router.get("/me", response_model=UserPublic)
async def me(current_user: User = Depends(get_current_user)) -> UserPublic:
    return UserPublic.model_validate(current_user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Response:
    if not credentials:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    token_hash = hash_token(credentials.credentials)
    session = await db.scalar(
        select(AuthSession).where(AuthSession.token_hash == token_hash, AuthSession.revoked_at.is_(None))
    )
    if session:
        session.revoked_at = datetime.now(UTC)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
