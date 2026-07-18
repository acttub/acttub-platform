from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from acting_api.sync_operations import parse_request_id, sync_request_fingerprint

PLAYBACK_URL_TTL_SEC = 15 * 60


class PracticeSessionRequest(BaseModel):
    upload_intent_id: UUID
    situation: str = Field(min_length=1)
    character_context: str = Field(min_length=1)
    subtext: str = Field(min_length=1)


def _value(value) -> str:
    return getattr(value, "value", value)


def _session_payload(session) -> dict:
    return {"session_id": str(session.id), "status": _value(session.status)}


def _idempotent_response(result, *, store, user_id: UUID, request_id: UUID):
    operation = result.operation
    operation_status = _value(operation.status)
    headers = {"X-Request-Id": str(request_id)}
    if operation_status == "succeeded":
        payload = operation.response_payload or _session_payload(result.session)
        return JSONResponse(status_code=200, content=payload, headers=headers)
    if operation_status in {"pending", "running"}:
        return JSONResponse(
            status_code=202,
            content={"session_id": str(operation.session_id), "status": "analyzing"},
            headers=headers,
        )
    if operation_status == "failed":
        resumed = store.resume_failed_analysis_operation(
            user_id=user_id,
            operation_id=operation.id,
            now=datetime.now(timezone.utc),
        )
        if not resumed:
            raise HTTPException(status_code=409, detail="analysis_retry_exhausted")
        return JSONResponse(
            status_code=202,
            content={"session_id": str(operation.session_id), "status": "analyzing"},
            headers=headers,
        )
    raise HTTPException(status_code=409, detail="invalid_operation_state")


def build_router(*, store, storage, rate_limited_user) -> APIRouter:
    router = APIRouter(prefix="/v2/practice-sessions", tags=["v2-practice"])

    @router.post("")
    async def create_session(
        payload: PracticeSessionRequest,
        x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
        user=Depends(rate_limited_user),
    ):
        request_id = parse_request_id(x_request_id)
        fingerprint = sync_request_fingerprint(
            "analyze", payload.model_dump(mode="json")
        )
        upload = await run_in_threadpool(
            store.get_upload_intent,
            user_id=user.id,
            upload_intent_id=payload.upload_intent_id,
        )
        if upload is None:
            raise HTTPException(status_code=404, detail="upload_intent_not_found")
        result = await run_in_threadpool(
            store.create_practice_session_with_analysis_operation,
            user_id=user.id,
            upload_intent_id=payload.upload_intent_id,
            situation=payload.situation,
            character_context=payload.character_context,
            subtext=payload.subtext,
            request_id=request_id,
            request_fingerprint=fingerprint,
        )
        if result is None:
            raise HTTPException(
                status_code=409,
                detail="upload_intent_not_finalized_or_already_used",
            )
        if result.fingerprint_mismatch:
            raise HTTPException(status_code=422, detail="request_fingerprint_mismatch")
        if result.created:
            return JSONResponse(
                status_code=202,
                content=_session_payload(result.session),
                headers={"X-Request-Id": str(request_id)},
            )
        return await run_in_threadpool(
            _idempotent_response,
            result,
            store=store,
            user_id=user.id,
            request_id=request_id,
        )

    @router.get("")
    async def list_sessions(user=Depends(rate_limited_user)):
        sessions = await run_in_threadpool(store.list_practice_sessions, user.id)
        return {
            "sessions": [
                {
                    "session_id": str(session.id),
                    "status": _value(session.status),
                    "situation": session.situation,
                    "character_context": session.character_context,
                    "subtext": session.subtext,
                    "created_at": session.created_at,
                    "updated_at": session.updated_at,
                }
                for session in sessions
            ]
        }

    @router.get("/{session_id}")
    async def get_session(session_id: UUID, user=Depends(rate_limited_user)):
        detail = await run_in_threadpool(
            store.get_practice_session_detail,
            user_id=user.id,
            session_id=session_id,
        )
        if detail is None:
            raise HTTPException(status_code=404, detail="practice_session_not_found")
        if storage is None:
            raise HTTPException(status_code=503, detail="storage_not_configured")
        playback_url = await run_in_threadpool(
            storage.presign_playback,
            object_key=detail.upload.object_key,
            expires_in_sec=PLAYBACK_URL_TTL_SEC,
        )
        session = detail.session
        payload = {
            "session_id": str(session.id),
            "status": _value(session.status),
            "situation": session.situation,
            "character_context": session.character_context,
            "subtext": session.subtext,
            "playback_url": playback_url,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
        }
        if _value(session.status) == "analyzed" and detail.summary is not None:
            payload["summary"] = {
                "summary_id": str(detail.summary.id),
                **detail.summary.raw,
            }
        if _value(session.status) == "failed":
            payload["error_code"] = (
                detail.operation.error_code if detail.operation is not None else None
            )
        return payload

    @router.post("/{session_id}/analyze")
    async def reanalyze_session(
        session_id: UUID,
        x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
        user=Depends(rate_limited_user),
    ):
        request_id = parse_request_id(x_request_id)
        fingerprint = sync_request_fingerprint(
            "analyze", {"session_id": str(session_id)}
        )
        result = await run_in_threadpool(
            store.create_analysis_retry_operation,
            user_id=user.id,
            session_id=session_id,
            request_id=request_id,
            request_fingerprint=fingerprint,
        )
        if result is None:
            session = await run_in_threadpool(
                store.get_practice_session,
                user_id=user.id,
                session_id=session_id,
            )
            if session is None:
                raise HTTPException(
                    status_code=404, detail="practice_session_not_found"
                )
            raise HTTPException(status_code=409, detail="session_is_not_failed")
        if result.fingerprint_mismatch:
            raise HTTPException(status_code=422, detail="request_fingerprint_mismatch")
        if result.created:
            return JSONResponse(
                status_code=202,
                content=_session_payload(result.session),
                headers={"X-Request-Id": str(request_id)},
            )
        return await run_in_threadpool(
            _idempotent_response,
            result,
            store=store,
            user_id=user.id,
            request_id=request_id,
        )

    @router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_session(session_id: UUID, user=Depends(rate_limited_user)):
        hidden = await run_in_threadpool(
            store.hide_practice_session,
            user_id=user.id,
            session_id=session_id,
        )
        if not hidden:
            raise HTTPException(status_code=404, detail="practice_session_not_found")
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
