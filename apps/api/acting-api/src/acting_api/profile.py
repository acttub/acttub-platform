"""내 프로필 조회·수정.

닉네임은 그동안 웹 localStorage 와 앱 AsyncStorage 에만 있었다. 커뮤니티에서 남에게
보이는 이름이 되는 순간 기기 안에만 두면 안 된다 — 여기로 옮긴다.

중복은 허용한다. 가입 첫 화면에서 "이미 쓰는 이름" 을 만나면 그만두는 사람이 생기고,
동일인 판별은 어차피 user_id 로 한다. 사칭은 신고로 처리한다.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from acting_api.auth.dependencies import user_status_value

NICKNAME_MAX_LENGTH = 20


class _StrictResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MeResponse(_StrictResponse):
    id: UUID
    email: str | None
    nickname: str | None
    status: Literal["active", "suspended"]


class UpdateMeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nickname: str = Field(min_length=1, max_length=NICKNAME_MAX_LENGTH)

    @field_validator("nickname")
    @classmethod
    def _normalize(cls, value: str) -> str:
        # 공백만 넣어 빈 이름을 만드는 걸 막고, 가운데 연속 공백은 하나로 접는다.
        collapsed = " ".join(value.split())
        if not collapsed:
            raise ValueError("nickname must not be blank")
        return collapsed[:NICKNAME_MAX_LENGTH]


def _payload(user) -> MeResponse:
    return MeResponse(
        id=user.id,
        email=user.email,
        nickname=user.nickname,
        status=user_status_value(user),
    )


def build_router(*, store, rate_limited_user) -> APIRouter:
    router = APIRouter(prefix="/v2/me", tags=["v2-me"])

    @router.get("", responses={status.HTTP_200_OK: {"model": MeResponse}})
    async def get_me(user=Depends(rate_limited_user)) -> MeResponse:
        return _payload(user)

    @router.patch("", responses={status.HTTP_200_OK: {"model": MeResponse}})
    async def update_me(
        request: UpdateMeRequest, user=Depends(rate_limited_user)
    ) -> MeResponse:
        updated = await run_in_threadpool(
            store.update_user_nickname, user.id, request.nickname
        )
        if updated is None:
            raise HTTPException(status_code=404, detail="user_not_found")
        return _payload(updated)

    return router
