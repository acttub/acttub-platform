from __future__ import annotations

from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, model_validator
from starlette.concurrency import run_in_threadpool

from acting_agent import engine as coach_engine
from acting_agent.router import CoachReplyReq, CoachStartReq
from acting_agent.store import SessionWriteConflict
from acting_api.db.store import LeaseOwnershipError
from acting_api.sync_operations import (
    SyncOperationClaim,
    begin_sync_operation,
    fail_sync_operation,
    parse_request_id,
    success_response,
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


class CoachTurnResponse(_StrictResponse):
    session_id: UUID
    message: str
    status: Literal["continue", "complete"]
    handoff: PublicHandoff | None
    report: AnalysisReport | ExpressionReport | BlockedReport | None


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
    session_id: str,
    reply,
    handoff_id: UUID | None,
    branch: str,
    report: dict[str, Any] | None,
):
    return {
        "session_id": session_id,
        "message": reply.message,
        "status": reply.status,
        "handoff": _public_handoff(handoff_id, branch),
        "report": report,
    }


async def _fail(store, claim: SyncOperationClaim, error_code: str) -> None:
    await run_in_threadpool(
        fail_sync_operation,
        store=store,
        claim=claim,
        error_code=error_code,
    )


def _generate_report(source, *, generate=None):
    kwargs: dict[str, Any] = {}
    if generate is not None:
        kwargs["generate"] = generate
    return report_engine.generate_report(
        report_type=source.branch_kind,
        video_summary=source.video_summary,
        confirmed_handoff=source.handoff_json,
        confirmed=source.confirmed,
        coaching_handoff_id=str(source.handoff_id or ""),
        analysis_handoff=source.analysis_handoff_json,
        analysis_handoff_id=(
            str(source.analysis_handoff_id)
            if source.analysis_handoff_id is not None
            else None
        ),
        **kwargs,
    )


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
            await _fail(store, claim, "report_already_exists")
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
                session_id, reply, handoff_id, branch, report_json
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
            )
        except LeaseOwnershipError as exc:
            await _fail(store, claim, "lease_ownership_lost")
            raise HTTPException(
                status_code=409, detail="request is still processing"
            ) from exc
        except report_engine.ReportParseError as exc:
            await _fail(store, claim, "report_parse_error")
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except Exception:
            await _fail(store, claim, "coach_start_failed")
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
                    _generate_completed_turn_report,
                    owned.session,
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
                str(req.session_id), reply, handoff_id, branch, report_json
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
            await _fail(store, claim, "session_write_conflict")
            raise HTTPException(
                status_code=409, detail="session changed concurrently"
            ) from exc
        except LeaseOwnershipError as exc:
            await _fail(store, claim, "lease_ownership_lost")
            raise HTTPException(
                status_code=409, detail="request is still processing"
            ) from exc
        except report_engine.ReportParseError as exc:
            await _fail(store, claim, "report_parse_error")
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except Exception:
            await _fail(store, claim, "coach_reply_failed")
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
                await _fail(store, claim, "session_not_found")
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
                        _generate_report,
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
                    await _fail(store, claim, "report_already_exists")
                    raise HTTPException(status_code=409, detail="report already exists")
        except report_engine.ReportParseError as exc:
            await _fail(store, claim, "report_parse_error")
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except LeaseOwnershipError as exc:
            await _fail(store, claim, "lease_ownership_lost")
            raise HTTPException(
                status_code=409, detail="request is still processing"
            ) from exc
        except HTTPException:
            raise
        except Exception:
            await _fail(store, claim, "coach_confirm_failed")
            raise
        return success_response(payload, claim)

    return router
