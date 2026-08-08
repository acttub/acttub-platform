"""운영 대시보드용 조회 엔드포인트.

기획(최우영)이 지표와 세션을 확인하는 화면이 이 API 를 부른다.

⚠️ 이 모듈은 **배우 영상과 발화**를 다룬다. 그래서 두 가지를 지킨다.
   1. `ADMIN_OPS_TOKEN` 이 설정되지 않으면 라우터가 아예 뜨지 않는다 —
      기본값이 '열림'이 되지 않게 한다.
   2. 이메일·user_id 를 내보내지 않는다. 누구인지 몰라도 무엇이 오갔는지는 볼 수 있고,
      토큰이 새더라도 사용자 명단이 되지는 않는다.

영상은 파일을 넘기지 않고 **1시간짜리 서명 URL** 만 준다.
"""

from __future__ import annotations

from datetime import datetime
import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from starlette.concurrency import run_in_threadpool

PLAYBACK_TTL_SEC = 3600
MAX_SESSIONS = 50


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AdminFunnelStep(_Strict):
    step: str
    users: int
    users_real: int


class AdminCloseReasonCount(_Strict):
    reason: str
    count: int
    count_real: int


class AdminStats(_Strict):
    users_total: int
    users_total_real: int
    users_last_7d: int
    users_last_7d_real: int
    users_last_24h: int
    users_last_24h_real: int
    practice_sessions_total: int
    practice_sessions_total_real: int
    practice_sessions_last_7d: int
    practice_sessions_last_7d_real: int
    practice_sessions_last_24h: int
    practice_sessions_last_24h_real: int
    uploads_finalized_total: int
    uploads_finalized_total_real: int
    analyses_completed_total: int
    analyses_completed_total_real: int
    coach_sessions_total: int
    coach_sessions_total_real: int
    coach_sessions_last_7d: int
    coach_sessions_last_7d_real: int
    coach_sessions_last_24h: int
    coach_sessions_last_24h_real: int
    coach_turns_total: int
    coach_turns_total_real: int
    coach_turns_last_7d: int
    coach_turns_last_7d_real: int
    coach_turns_last_24h: int
    coach_turns_last_24h_real: int
    reports_total: int
    reports_total_real: int
    active_users_last_7d: int
    active_users_last_7d_real: int
    users_with_session: int
    users_with_session_real: int
    returning_2x: int
    returning_2x_real: int
    returning_3x: int
    returning_3x_real: int
    users_yesterday: int
    users_yesterday_real: int
    active_users_yesterday: int
    active_users_yesterday_real: int
    funnel_steps: list[AdminFunnelStep]
    close_reasons: list[AdminCloseReasonCount]
    gap_stated_24h: int
    gap_stated_24h_real: int
    gap_stated_7d: int
    gap_stated_7d_real: int
    gap_stated_all: int
    gap_stated_all_real: int
    db_size: str | None
    observations_total: int
    observations_per_summary: float
    last_signup_at: datetime | None
    last_session_at: datetime | None


class AdminTurn(_Strict):
    turn_index: int
    role: str
    text: str


class AdminSession(_Strict):
    coach_session_id: str
    created_at: datetime
    status: str | None
    close_reason: str | None
    situation: str | None
    character_context: str | None
    goal: str | None
    turns: list[AdminTurn]
    video_url: str | None


class AdminSessions(_Strict):
    sessions: list[AdminSession]
    playback_expires_in_sec: int


def build_router(
    *, store, storage, admin_token: str | None, exclude_emails: tuple[str, ...] = ()
) -> APIRouter | None:
    """토큰이 없으면 None 을 돌려준다 — 호출부가 아예 라우터를 달지 않는다."""
    if not admin_token:
        return None

    router = APIRouter(prefix="/v2/admin", tags=["admin"])

    def require_token(authorization: str = Header(default="")) -> None:
        # 길이·내용이 달라도 걸리는 시간이 같게 비교한다.
        if not hmac.compare_digest(authorization, f"Bearer {admin_token}"):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED)

    @router.get("/stats", response_model=AdminStats, dependencies=[Depends(require_token)])
    async def stats() -> AdminStats:
        return AdminStats(
            **await run_in_threadpool(store.admin_stats, exclude_emails)
        )

    @router.get(
        "/sessions",
        response_model=AdminSessions,
        dependencies=[Depends(require_token)],
    )
    async def sessions(
        limit: int = Query(default=20, ge=1, le=MAX_SESSIONS)
    ) -> AdminSessions:
        rows = await run_in_threadpool(store.admin_sessions, limit, exclude_emails)
        out: list[AdminSession] = []
        for row in rows:
            object_key = row.pop("object_key", None)
            video_url = None
            if object_key:
                try:
                    video_url = await run_in_threadpool(
                        lambda: storage.presign_playback(
                            object_key=object_key, expires_in_sec=PLAYBACK_TTL_SEC
                        )
                    )
                except Exception:
                    # 영상 하나를 못 서명해도 대화는 보여준다.
                    video_url = None
            out.append(AdminSession(**row, video_url=video_url))
        return AdminSessions(sessions=out, playback_expires_in_sec=PLAYBACK_TTL_SEC)

    return router
