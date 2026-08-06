from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import logging
from uuid import UUID, uuid4

from fastapi import HTTPException
from fastapi.responses import Response

from acting_api.db.store import LeaseOwnershipError

logger = logging.getLogger(__name__)

SYNC_OPERATION_LEASE = timedelta(minutes=15)


@dataclass(frozen=True)
class SyncOperationClaim:
    operation_id: UUID
    lease_token: UUID
    request_id: UUID

    @property
    def headers(self) -> dict[str, str]:
        return {"X-Request-Id": str(self.request_id)}


def parse_request_id(header: str | None) -> UUID:
    if header is None:
        return uuid4()
    try:
        return UUID(header)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="invalid X-Request-Id") from exc


def sync_request_fingerprint(kind: str, payload: dict) -> str:
    canonical = json.dumps(
        {"kind": kind, "payload": payload},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def begin_sync_operation(
    *,
    store,
    user_id: UUID,
    practice_session_id: UUID,
    request_id: UUID,
    kind: str,
    request_fingerprint: str,
    now: datetime | None = None,
) -> SyncOperationClaim | Response:
    now = now or datetime.now(timezone.utc)
    lookup = store.get_or_create_external_operation(
        user_id=user_id,
        session_id=practice_session_id,
        request_id=request_id,
        kind=kind,
        request_fingerprint=request_fingerprint,
    )
    if lookup.fingerprint_mismatch:
        raise HTTPException(status_code=422, detail="request_fingerprint_mismatch")
    operation = lookup.operation
    cached = _existing_operation_response(operation, request_id=request_id, now=now)
    if cached is not None:
        return cached

    lease_token = uuid4()
    claimed = store.claim_external_operation(
        operation_id=operation.id,
        lease_token=lease_token,
        lease_duration=SYNC_OPERATION_LEASE,
        now=now,
    )
    if claimed is None:
        latest = store.get_external_operation(
            user_id=user_id,
            request_id=request_id,
        )
        cached = _existing_operation_response(
            latest,
            request_id=request_id,
            now=now,
        )
        if cached is not None:
            return cached
        raise HTTPException(status_code=409, detail="request retry exhausted")
    return SyncOperationClaim(
        operation_id=claimed.id,
        lease_token=lease_token,
        request_id=request_id,
    )


def success_response(payload: dict, claim: SyncOperationClaim) -> Response:
    return _json_response(payload, headers=claim.headers)


def sync_response(payload: dict, *, request_id: UUID) -> Response:
    return _json_response(
        payload,
        headers={"X-Request-Id": str(request_id)},
    )


def fail_sync_operation(
    *,
    store,
    claim: SyncOperationClaim,
    error_code: str,
) -> None:
    try:
        store.fail_external_operation(
            operation_id=claim.operation_id,
            lease_token=claim.lease_token,
            error_code=error_code,
        )
    except LeaseOwnershipError:
        logger.warning("sync operation lease ownership was lost: %s", claim.operation_id)


def _existing_operation_response(
    operation,
    *,
    request_id: UUID,
    now: datetime,
) -> Response | None:
    if operation is None:
        return None
    status = getattr(operation.status, "value", operation.status)
    headers = {"X-Request-Id": str(request_id)}
    if status == "succeeded":
        return _json_response(operation.response_payload or {}, headers=headers)
    if status == "running" and (
        operation.lease_token is not None
        and operation.lease_expires_at is not None
        and operation.lease_expires_at >= now
    ):
        raise HTTPException(
            status_code=409,
            detail="request is still processing",
            headers=headers,
        )
    return None


def _json_response(payload: dict, *, headers: dict[str, str]) -> Response:
    # JSONB does not promise to preserve object key order. Canonical encoding makes
    # the first response and a later idempotent replay byte-for-byte identical.
    content = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return Response(
        status_code=200,
        content=content,
        media_type="application/json",
        headers=headers,
    )
