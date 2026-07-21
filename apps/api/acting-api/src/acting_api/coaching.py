from __future__ import annotations

from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict
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

CoachAction = Literal["probe_intent", "dig_cause", "deflect", "close"]
CoachReason = Literal["gap_stated", "exhausted", "limit", "user_ended"] | None


class CoachTurnResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: UUID
    action: CoachAction
    utterance: str
    focus_timestamp: str
    done: bool
    reason: CoachReason


def _payload(session_id: str, reply) -> dict:
    return {
        "session_id": session_id,
        "action": reply.action,
        "utterance": reply.utterance,
        "focus_timestamp": reply.focus_timestamp,
        "done": reply.done,
        "reason": reply.reason,
    }


async def _fail(store, claim: SyncOperationClaim, error_code: str) -> None:
    await run_in_threadpool(
        fail_sync_operation,
        store=store,
        claim=claim,
        error_code=error_code,
    )


def build_router(*, client, settings, store, rate_limited_user) -> APIRouter:
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
        owned = await run_in_threadpool(
            store.get_owned_summary,
            user_id=user.id,
            summary_id=req.summary_id,
        )
        if owned is None:
            raise HTTPException(status_code=404, detail="summary not found")
        if await run_in_threadpool(
            store.has_report_for_practice_session,
            owned.practice_session_id,
        ):
            raise HTTPException(
                status_code=409,
                detail="report already exists for practice session",
            )
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
        session_id = str(uuid4())
        try:
            session, reply = await run_in_threadpool(
                coach_engine.start,
                session_id,
                owned.summary,
                owned.subtext,
                summary_id=str(req.summary_id),
                client=client,
                model=settings.model,
            )
            payload = _payload(session_id, reply)
            await run_in_threadpool(
                store.complete_coach_start_operation,
                operation_id=claim.operation_id,
                lease_token=claim.lease_token,
                coach_session=session,
                response_payload=payload,
            )
        except coach_engine.CoachParseError as exc:
            await _fail(store, claim, "coach_parse_error")
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except LeaseOwnershipError as exc:
            await _fail(store, claim, "lease_ownership_lost")
            raise HTTPException(
                status_code=409, detail="request is still processing"
            ) from exc
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
        try:
            reply = await run_in_threadpool(
                coach_engine.reply,
                owned.session,
                req.text,
                client=client,
                model=settings.model,
                max_questions=settings.max_questions,
            )
            payload = _payload(str(req.session_id), reply)
            await run_in_threadpool(
                store.complete_coach_reply_operation,
                operation_id=claim.operation_id,
                lease_token=claim.lease_token,
                coach_session=owned.session,
                response_payload=payload,
            )
        except coach_engine.CoachParseError as exc:
            await _fail(store, claim, "coach_parse_error")
            raise HTTPException(status_code=502, detail=str(exc)) from exc
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
        except Exception:
            await _fail(store, claim, "coach_reply_failed")
            raise
        return success_response(payload, claim)

    return router
