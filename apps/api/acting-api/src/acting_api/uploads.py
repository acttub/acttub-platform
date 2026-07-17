from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import PurePosixPath
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

MAX_UPLOAD_BYTES = 550 * 1024 * 1024
UPLOAD_INTENT_TTL = timedelta(minutes=30)


class UploadIntentRequest(BaseModel):
    mime_type: str
    size_bytes: int = Field(gt=0)
    duration_ms: int | None = Field(default=None, gt=0)


def _status_value(value) -> str:
    return getattr(value, "value", value)


def _object_suffix(mime_type: str) -> str:
    subtype = mime_type.split("/", 1)[1].split(";", 1)[0].lower()
    known = {"mp4": ".mp4", "quicktime": ".mov", "webm": ".webm"}
    if subtype in known:
        return known[subtype]
    safe = "".join(character for character in subtype if character.isalnum())[:12]
    return f".{safe}" if safe else ".video"


def _object_key(user_id: UUID, mime_type: str) -> str:
    filename = f"{uuid4().hex}{_object_suffix(mime_type)}"
    return str(PurePosixPath("users", str(user_id), "uploads", filename))


def build_router(
    *,
    store,
    storage,
    rate_limited_user,
    utcnow=lambda: datetime.now(timezone.utc),
) -> APIRouter:
    router = APIRouter(prefix="/v2/uploads", tags=["v2-uploads"])

    def require_storage():
        if storage is None:
            raise HTTPException(status_code=503, detail="storage_not_configured")
        return storage

    @router.post("/intents", status_code=status.HTTP_201_CREATED)
    async def create_intent(
        payload: UploadIntentRequest, user=Depends(rate_limited_user)
    ):
        mime_type = payload.mime_type.strip().lower()
        if not mime_type.startswith("video/"):
            raise HTTPException(status_code=415, detail="unsupported_media_type")
        if payload.size_bytes > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="upload_too_large")
        s3 = require_storage()
        now = utcnow()
        expires_at = now + UPLOAD_INTENT_TTL
        object_key = _object_key(user.id, mime_type)
        upload_url = await run_in_threadpool(
            s3.presign_upload,
            object_key=object_key,
            mime_type=mime_type,
            size_bytes=payload.size_bytes,
            expires_in_sec=int(UPLOAD_INTENT_TTL.total_seconds()),
        )
        intent = await run_in_threadpool(
            store.create_upload_intent,
            user_id=user.id,
            storage_provider="s3",
            object_key=object_key,
            mime_type=mime_type,
            size_bytes=payload.size_bytes,
            duration_ms=payload.duration_ms,
            expires_at=expires_at,
        )
        return {
            "intent_id": str(intent.id),
            "upload_url": upload_url,
            "expires_at": expires_at,
        }

    @router.post("/intents/{intent_id}/complete")
    async def complete_intent(intent_id: UUID, user=Depends(rate_limited_user)):
        s3 = require_storage()
        intent = await run_in_threadpool(
            store.get_upload_intent,
            user_id=user.id,
            upload_intent_id=intent_id,
        )
        if intent is None:
            raise HTTPException(status_code=404, detail="upload_intent_not_found")
        if _status_value(intent.status) == "finalized":
            return {"intent_id": str(intent.id), "status": "finalized"}
        now = utcnow()
        if _status_value(intent.status) != "pending" or intent.expires_at <= now:
            raise HTTPException(status_code=409, detail="upload_intent_expired")
        metadata = await run_in_threadpool(s3.head, object_key=intent.object_key)
        if metadata is None:
            raise HTTPException(status_code=409, detail="upload_not_found")
        if metadata.size_bytes != intent.size_bytes:
            raise HTTPException(status_code=409, detail="upload_size_mismatch")
        finalized = await run_in_threadpool(
            store.finalize_upload_intent,
            user_id=user.id,
            upload_intent_id=intent.id,
            etag=metadata.etag,
            now=now,
        )
        if finalized is None:
            latest = await run_in_threadpool(
                store.get_upload_intent,
                user_id=user.id,
                upload_intent_id=intent.id,
            )
            if latest is not None and _status_value(latest.status) == "finalized":
                return {"intent_id": str(latest.id), "status": "finalized"}
            raise HTTPException(status_code=409, detail="upload_intent_expired")
        return {"intent_id": str(finalized.id), "status": "finalized"}

    return router
