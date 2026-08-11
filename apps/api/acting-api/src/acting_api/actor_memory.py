"""코치가 배우를 기억하는 6칸 — 조회·수정·삭제.

에이전트가 채우고 배우가 나중에 고친다. 그래서 이 화면이 이 기능의 안전판이다.
에이전트가 잘못 적은 것을 되돌릴 경로가 여기밖에 없으므로, 기억을 쌓기 시작하기
전에 열려 있어야 한다.

배우가 고친 칸은 에이전트가 다시 덮지 않는다. 그 판단은 저장 계층이 한다
(store.write_actor_memory_as_agent 가 건너뛰고 None 을 돌려준다).

성별·나이는 배우만 쓴다. 영상이나 목소리에서 추론하지 않는다 — 라우터에서
막고, DB 제약이 최종 방어선이다.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from acting_api.db.models import ActorMemoryField

# 저장 계층과 같은 값이어야 한다. DB 제약이 최종 방어선이지만, 여기서 먼저 막아야
# 배우가 긴 글을 쓰고 나서 500 을 보는 일이 없다.
VALUE_MAX_LENGTH = 1000

MemoryFieldName = Literal[
    "gender", "age", "goal", "blockage", "speech_self", "speech_actual"
]


class _StrictResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MemoryItem(_StrictResponse):
    field: MemoryFieldName
    value: str
    # True 면 배우가 직접 쓰거나 고친 칸이다. 화면에서 "내가 고친 항목" 을
    # 구분해 보여줄 수 있어야, 배우가 무엇이 자동으로 적힌 것인지 안다.
    edited_by_me: bool
    # 에이전트가 적은 칸이 어느 연습에서 나왔는지. 근거를 못 보면 고칠지
    # 판단이 안 선다.
    source_practice_session_id: UUID | None


class MemoryResponse(_StrictResponse):
    items: list[MemoryItem]


class UpdateMemoryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: str = Field(min_length=1, max_length=VALUE_MAX_LENGTH)

    @field_validator("value")
    @classmethod
    def _normalize(cls, value: str) -> str:
        collapsed = " ".join(value.split())
        if not collapsed:
            raise ValueError("value must not be blank")
        return collapsed


def _item(entry) -> MemoryItem:
    return MemoryItem(
        field=entry.field,
        value=entry.value,
        edited_by_me=entry.written_by_actor,
        source_practice_session_id=entry.source_practice_session_id,
    )


def build_router(*, store, rate_limited_user) -> APIRouter:
    router = APIRouter(prefix="/v2/me/memory", tags=["v2-me"])

    @router.get("", responses={status.HTTP_200_OK: {"model": MemoryResponse}})
    async def get_memory(user=Depends(rate_limited_user)) -> MemoryResponse:
        """기억을 전부 읽는다. 아직 채워지지 않은 칸은 빠진 채로 온다."""
        entries = await run_in_threadpool(store.list_actor_memory, user.id)
        return MemoryResponse(items=[_item(entry) for entry in entries])

    @router.put(
        "/{field}", responses={status.HTTP_200_OK: {"model": MemoryItem}}
    )
    async def update_memory(
        field: MemoryFieldName,
        request: UpdateMemoryRequest,
        user=Depends(rate_limited_user),
    ) -> MemoryItem:
        """배우가 한 칸을 쓰거나 고친다.

        여기서 쓴 칸은 이후 에이전트가 덮지 않는다. 되돌리려면 지우면 되고,
        지우면 다음 연습부터 에이전트가 다시 채운다.
        """
        entry = await run_in_threadpool(
            store.write_actor_memory_as_actor,
            user_id=user.id,
            field=ActorMemoryField(field),
            value=request.value,
        )
        return _item(entry)

    @router.delete("/{field}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_memory_field(
        field: MemoryFieldName, user=Depends(rate_limited_user)
    ) -> Response:
        """한 칸을 지운다. 이미 없으면 404 대신 204 — 지우려는 결과는 같다."""
        await run_in_threadpool(
            store.delete_actor_memory,
            user_id=user.id,
            field=ActorMemoryField(field),
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.delete("", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_memory(user=Depends(rate_limited_user)) -> Response:
        """기억을 통째로 지운다. 다음 연습부터 다시 쌓인다."""
        await run_in_threadpool(store.delete_actor_memory, user_id=user.id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
