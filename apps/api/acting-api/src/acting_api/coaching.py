from __future__ import annotations

import logging
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, model_validator
from starlette.concurrency import run_in_threadpool

from acting_agent import engine as coach_engine
from acting_agent.schema import CoachReplyReq, CoachStartReq
from acting_agent.store import SessionWriteConflict
from acting_api.db.store import LeaseOwnershipError
from acting_api.memory_worker import should_update_memory
from acting_api.sync_operations import (
    begin_sync_operation,
    fail_sync_operation_async,
    generate_source_report,
    parse_request_id,
    success_response,
    sync_response,
    sync_request_fingerprint,
)
from acting_report import engine as report_engine
from acting_report.schema import (
    AnalysisReport,
    BlockedReport,
    ExpressionReport,
    PracticeReport,
)


class _StrictResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PublicHandoff(_StrictResponse):
    id: UUID
    branch_kind: Literal["analysis", "expression"]


class PublicCoachTurn(_StrictResponse):
    role: Literal["actor", "ai"]
    text: str


class CoachTurnResponse(_StrictResponse):
    session_id: UUID
    message: str
    status: Literal["continue", "complete"]
    handoff: PublicHandoff | None
    report: AnalysisReport | ExpressionReport | BlockedReport | None
    turns: list[PublicCoachTurn]


class CoachConfirmReq(BaseModel):
    model_config = ConfigDict(extra="forbid")

    coach_session_id: UUID
    confirmed: bool
    rebuttal_text: str | None = None

    @model_validator(mode="after")
    def validate_rebuttal(self):
        if not self.confirmed and not (self.rebuttal_text or "").strip():
            raise ValueError("rebuttal_text is required when confirmed is false")
        return self


class CoachConfirmResponse(_StrictResponse):
    session_id: UUID
    confirmed: bool
    handoff: PublicHandoff | None
    report: AnalysisReport | ExpressionReport | BlockedReport


def _branch_kind(blockage_kind: str) -> Literal["analysis", "expression"]:
    return "expression" if blockage_kind == "표현" else "analysis"


def _public_handoff(
    handoff_id: UUID | None, branch_kind: str
) -> dict[str, str] | None:
    if handoff_id is None:
        return None
    return {"id": str(handoff_id), "branch_kind": branch_kind}


def _coach_payload(
    session,
    reply,
    handoff_id: UUID | None,
    branch: str,
    report: dict[str, Any] | None,
):
    return {
        "session_id": session.session_id,
        "message": reply.message,
        "status": reply.status,
        "handoff": _public_handoff(handoff_id, branch),
        "report": report,
        "turns": [turn.model_dump(mode="json") for turn in session.turns],
    }


def _resumed_coach_payload(session):
    message = next(
        (turn.text for turn in reversed(session.turns) if turn.role == "ai"),
        "",
    )
    return {
        "session_id": session.session_id,
        "message": message,
        "status": "continue",
        "handoff": None,
        "report": None,
        "turns": [turn.model_dump(mode="json") for turn in session.turns],
    }


log = logging.getLogger(__name__)


async def _schedule_memory_update(
    store,
    *,
    user_id: UUID,
    practice_session_id: UUID,
    confirmed: bool,
) -> None:
    """연습을 마쳤으면 기억 갱신을 뒤에서 돌도록 큐에 넣는다.

    여기서 직접 갱신하지 않는 이유는 속도다 -- 이 응답은 이미 성적표를 만드느라
    느린데 모델 호출을 하나 더 얹으면 배우가 그만큼 더 기다린다.

    큐에 넣다 실패해도 삼킨다. 기억은 있으면 좋은 것이지, 없다고 방금 끝낸
    연습을 실패로 돌려줄 일은 아니다.
    """
    if not confirmed:
        return
    try:
        count = await run_in_threadpool(store.count_confirmed_practices, user_id)
        if not should_update_memory(count):
            return
        await run_in_threadpool(
            store.enqueue_memory_update,
            user_id=user_id,
            practice_session_id=practice_session_id,
        )
    except Exception:
        log.warning("기억 갱신 예약에 실패했다: %s", practice_session_id, exc_info=True)


def _generate_completed_turn_report(
    session,
    *,
    branch: Literal["analysis", "expression"],
    handoff_id: UUID,
    handoff: dict[str, Any],
    generate=None,
) -> PracticeReport:
    kwargs: dict[str, Any] = {}
    if generate is not None:
        kwargs["generate"] = generate
    video_summary = (
        session.observation_pack.model_dump(mode="json")
        if session.observation_pack is not None
        else {"observations": [], "uncertainties": []}
    )
    return report_engine.generate_report(
        report_type=branch,
        video_summary=video_summary,
        confirmed_handoff=handoff,
        confirmed=True,
        coaching_handoff_id=str(handoff_id),
        analysis_handoff=session.analysis_handoff,
        **kwargs,
    )


_MIN_ANSWERS_FOR_REPORT = 2


def _report_for_completed_turn(
    session,
    *,
    branch: Literal["analysis", "expression"],
    handoff_id: UUID,
    handoff: dict[str, Any] | None,
    generate=None,
) -> PracticeReport:
    """배우가 실제로 답한 게 거의 없으면 노트를 만들지 않는다.

    첫 actor 턴은 대화가 아니라 폼에 적은 목표·막힌 지점이므로(engine.start) 빼고 센다.

    coach_start 에는 걸지 않는다. 거기에 걸면 리포트 생성이 한 번도 돌지 않아
    coach_start 의 502(리포트 파싱 실패) 경로가 도달 불가가 되고, 그 502로 retry
    소진을 확인하는 계약 하네스 시나리오까지 죽는다. 첫 턴에 바로 complete 되는
    경우는 따로 다룬다.
    """
    answers = [t for t in session.turns if t.role == "actor"][1:]
    answered = sum(1 for t in answers if not coach_engine.is_closing(t.text))
    if handoff is None or answered < _MIN_ANSWERS_FOR_REPORT:
        return (
            report_engine.BLOCKED_ANALYSIS_REPORT
            if branch == "analysis"
            else report_engine.BLOCKED_EXPRESSION_REPORT
        )
    return _generate_completed_turn_report(
        session,
        branch=branch,
        handoff_id=handoff_id,
        handoff=handoff,
        generate=generate,
    )


def build_router(
    *,
    store,
    rate_limited_user,
    coach_generate=None,
    report_generate=None,
) -> APIRouter:
    router = APIRouter(prefix="/v2/coach", tags=["v2-coach"])

    @router.post(
        "/start",
        responses={200: {"model": CoachTurnResponse}},
    )
    async def coach_start(
        req: CoachStartReq,
        x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
        user=Depends(rate_limited_user),
    ):
        practice_status = await run_in_threadpool(
            store.get_practice_session_status,
            user_id=user.id,
            session_id=req.practice_session_id,
        )
        if practice_status is None:
            raise HTTPException(status_code=404, detail="practice session not found")
        if practice_status.status not in {"analyzed", "failed"}:
            raise HTTPException(
                status_code=409,
                detail="practice session analysis is not settled",
            )
        owned = await run_in_threadpool(
            store.get_owned_practice_session_context,
            user_id=user.id,
            practice_session_id=req.practice_session_id,
        )
        if owned is None:
            raise HTTPException(status_code=404, detail="practice session not found")
        request_id = parse_request_id(x_request_id)
        if not req.restart:
            resumed = await run_in_threadpool(
                store.get_oldest_open_coach_session,
                user_id=user.id,
                practice_session_id=owned.practice_session_id,
            )
            if resumed is not None:
                if await run_in_threadpool(
                    store.has_report_for_practice_session,
                    owned.practice_session_id,
                ):
                    raise HTTPException(
                        status_code=409,
                        detail="report already exists for practice session",
                    )
                return sync_response(
                    _resumed_coach_payload(resumed.session),
                    request_id=request_id,
                )
        fingerprint = sync_request_fingerprint(
            "coach_start",
            req.model_dump(mode="json"),
        )
        begun = await run_in_threadpool(
            begin_sync_operation,
            store=store,
            user_id=user.id,
            practice_session_id=owned.practice_session_id,
            request_id=request_id,
            kind="coach_start",
            request_fingerprint=fingerprint,
        )
        if isinstance(begun, Response):
            return begun
        claim = begun
        if await run_in_threadpool(
            store.has_report_for_practice_session,
            owned.practice_session_id,
        ):
            await fail_sync_operation_async(store, claim, "report_already_exists")
            raise HTTPException(
                status_code=409,
                detail="report already exists for practice session",
            )
        session_id = str(uuid4())
        try:
            generation_kwargs = (
                {"generate": coach_generate} if coach_generate is not None else {}
            )
            session, reply = await run_in_threadpool(
                coach_engine.start,
                session_id,
                owned.observation_pack,
                owned.actor,
                practice_session_id=str(owned.practice_session_id),
                summary_id=(
                    str(owned.summary_id) if owned.summary_id is not None else None
                ),
                sub_branch=owned.sub_branch,
                transcripts=owned.transcripts,
                analysis_handoff=owned.analysis_handoff,
                **generation_kwargs,
            )
            branch = _branch_kind(owned.actor.blockage_kind)
            handoff_id = uuid4() if reply.status == "complete" else None
            report = (
                await run_in_threadpool(
                    _generate_completed_turn_report,
                    session,
                    branch=branch,
                    handoff_id=handoff_id,
                    handoff=reply.handoff,
                    generate=report_generate,
                )
                if handoff_id is not None and reply.handoff is not None
                else None
            )
            report_json = (
                report.model_dump(mode="json") if report is not None else None
            )
            payload = _coach_payload(
                session, reply, handoff_id, branch, report_json
            )
            await run_in_threadpool(
                store.complete_coach_start_operation,
                operation_id=claim.operation_id,
                lease_token=claim.lease_token,
                coach_session=session,
                response_payload=payload,
                handoff_id=handoff_id,
                branch_kind=branch if handoff_id else None,
                handoff_json=reply.handoff,
                confirmed=report is not None,
                report_json=report_json,
                restart=req.restart,
            )
        except LeaseOwnershipError as exc:
            await fail_sync_operation_async(store, claim, "lease_ownership_lost")
            raise HTTPException(
                status_code=409, detail="request is still processing"
            ) from exc
        except report_engine.ReportParseError as exc:
            await fail_sync_operation_async(store, claim, "report_parse_error")
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except Exception:
            await fail_sync_operation_async(store, claim, "coach_start_failed")
            raise
        return success_response(payload, claim)

    @router.post(
        "/reply",
        responses={200: {"model": CoachTurnResponse}},
    )
    async def coach_reply(
        req: CoachReplyReq,
        x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
        user=Depends(rate_limited_user),
    ):
        owned = await run_in_threadpool(
            store.get_owned_coach_session,
            user_id=user.id,
            coach_session_id=req.session_id,
        )
        if owned is None:
            raise HTTPException(status_code=404, detail="session not found")
        if owned.session.status == "closed":
            raise HTTPException(status_code=409, detail="session is closed")
        request_id = parse_request_id(x_request_id)
        fingerprint = sync_request_fingerprint(
            "coach_reply",
            req.model_dump(mode="json"),
        )
        begun = await run_in_threadpool(
            begin_sync_operation,
            store=store,
            user_id=user.id,
            practice_session_id=owned.practice_session_id,
            request_id=request_id,
            kind="coach_reply",
            request_fingerprint=fingerprint,
        )
        if isinstance(begun, Response):
            return begun
        claim = begun
        branch = _branch_kind(owned.session.blockage_kind)
        try:
            generation_kwargs = (
                {"generate": coach_generate} if coach_generate is not None else {}
            )
            reply = await run_in_threadpool(
                coach_engine.reply,
                owned.session,
                req.text,
                **generation_kwargs,
            )
            handoff_id = uuid4() if reply.status == "complete" else None
            report = (
                await run_in_threadpool(
                    _report_for_completed_turn,
                    owned.session,
                    branch=branch,
                    handoff_id=handoff_id,
                    handoff=reply.handoff,
                    generate=report_generate,
                )
                if handoff_id is not None
                else None
            )
            report_json = (
                report.model_dump(mode="json") if report is not None else None
            )
            payload = _coach_payload(
                owned.session, reply, handoff_id, branch, report_json
            )
            await run_in_threadpool(
                store.complete_coach_reply_operation,
                operation_id=claim.operation_id,
                lease_token=claim.lease_token,
                coach_session=owned.session,
                response_payload=payload,
                handoff_id=handoff_id,
                branch_kind=branch if handoff_id else None,
                handoff_json=reply.handoff,
                confirmed=report is not None,
                report_json=report_json,
            )
        except SessionWriteConflict as exc:
            await fail_sync_operation_async(store, claim, "session_write_conflict")
            raise HTTPException(
                status_code=409, detail="session changed concurrently"
            ) from exc
        except LeaseOwnershipError as exc:
            await fail_sync_operation_async(store, claim, "lease_ownership_lost")
            raise HTTPException(
                status_code=409, detail="request is still processing"
            ) from exc
        except report_engine.ReportParseError as exc:
            await fail_sync_operation_async(store, claim, "report_parse_error")
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except Exception:
            await fail_sync_operation_async(store, claim, "coach_reply_failed")
            raise
        return success_response(payload, claim)

    @router.post(
        "/confirm",
        responses={200: {"model": CoachConfirmResponse}},
    )
    async def coach_confirm(
        req: CoachConfirmReq,
        x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
        user=Depends(rate_limited_user),
    ):
        owned = await run_in_threadpool(
            store.get_owned_coach_session,
            user_id=user.id,
            coach_session_id=req.coach_session_id,
        )
        if owned is None:
            raise HTTPException(status_code=404, detail="session not found")
        request_id = parse_request_id(x_request_id)
        fingerprint = sync_request_fingerprint(
            "coach_confirm", req.model_dump(mode="json")
        )
        begun = await run_in_threadpool(
            begin_sync_operation,
            store=store,
            user_id=user.id,
            practice_session_id=owned.practice_session_id,
            request_id=request_id,
            kind="report",
            request_fingerprint=fingerprint,
        )
        if isinstance(begun, Response):
            return begun
        claim = begun
        try:
            source = await run_in_threadpool(
                store.confirm_latest_handoff,
                user_id=user.id,
                coach_session_id=req.coach_session_id,
                confirmed=req.confirmed,
                rebuttal_text=req.rebuttal_text,
            )
            if source is None:
                await fail_sync_operation_async(store, claim, "session_not_found")
                raise HTTPException(status_code=404, detail="session not found")
            public_handoff = _public_handoff(
                source.handoff_id, source.branch_kind
            )
            existing = (
                await run_in_threadpool(
                    store.get_practice_report_for_handoff,
                    source.handoff_id,
                )
                if req.confirmed and source.handoff_id is not None
                else None
            )
            report = (
                existing
                if existing is not None
                else (
                    await run_in_threadpool(
                        generate_source_report,
                        source,
                        generate=report_generate,
                    )
                ).model_dump(mode="json")
            )
            payload = {
                "session_id": str(req.coach_session_id),
                "confirmed": req.confirmed,
                "handoff": public_handoff,
                "report": report,
            }
            if report["report_type"] == "blocked" or existing is not None:
                await run_in_threadpool(
                    store.complete_sync_operation,
                    operation_id=claim.operation_id,
                    lease_token=claim.lease_token,
                    response_payload=payload,
                )
            else:
                saved = await run_in_threadpool(
                    store.complete_practice_report_operation,
                    operation_id=claim.operation_id,
                    lease_token=claim.lease_token,
                    practice_session_id=source.practice_session_id,
                    report_type=report["report_type"],
                    report_json=report,
                    source_handoff_id=source.handoff_id,
                    response_payload=payload,
                )
                if not saved:
                    await fail_sync_operation_async(store, claim, "report_already_exists")
                    raise HTTPException(status_code=409, detail="report already exists")
            await _schedule_memory_update(
                store,
                user_id=user.id,
                practice_session_id=source.practice_session_id,
                confirmed=req.confirmed,
            )
        except report_engine.ReportParseError as exc:
            await fail_sync_operation_async(store, claim, "report_parse_error")
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except LeaseOwnershipError as exc:
            await fail_sync_operation_async(store, claim, "lease_ownership_lost")
            raise HTTPException(
                status_code=409, detail="request is still processing"
            ) from exc
        except HTTPException:
            raise
        except Exception:
            await fail_sync_operation_async(store, claim, "coach_confirm_failed")
            raise
        return success_response(payload, claim)

    return router
