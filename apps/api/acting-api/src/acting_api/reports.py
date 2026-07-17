from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from starlette.concurrency import run_in_threadpool

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
from acting_report.router import ReportReq


async def _fail(store, claim: SyncOperationClaim, error_code: str) -> None:
    await run_in_threadpool(
        fail_sync_operation,
        store=store,
        claim=claim,
        error_code=error_code,
    )


def build_router(*, client, settings, store, rate_limited_user) -> APIRouter:
    router = APIRouter(prefix="/v2/reports", tags=["v2-reports"])

    @router.post("")
    async def create_report(
        req: ReportReq,
        x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
        user=Depends(rate_limited_user),
    ):
        owned = await run_in_threadpool(
            store.get_owned_report_context,
            user_id=user.id,
            coach_session_id=req.session_id,
        )
        if owned is None:
            raise HTTPException(status_code=404, detail="session not found")
        request_id = parse_request_id(x_request_id)
        fingerprint = sync_request_fingerprint(
            "report",
            req.model_dump(mode="json"),
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
            if owned.session.status != "closed":
                await _fail(store, claim, "session_is_still_open")
                raise HTTPException(status_code=409, detail="session is still open")
            if await run_in_threadpool(store.has_report, req.session_id):
                await _fail(store, claim, "report_already_exists")
                raise HTTPException(
                    status_code=409,
                    detail="report already exists for session",
                )
            previous = await run_in_threadpool(store.list_reports, user.id)
            report = await run_in_threadpool(
                report_engine.generate_report,
                owned.session,
                previous,
                client=client,
                model=settings.model,
            )
            payload = await run_in_threadpool(
                store.complete_report_operation,
                operation_id=claim.operation_id,
                lease_token=claim.lease_token,
                coach_session_id=req.session_id,
                report=report,
            )
            if payload is None:
                await _fail(store, claim, "report_already_exists")
                raise HTTPException(
                    status_code=409,
                    detail="report already exists for session",
                )
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
            await _fail(store, claim, "report_failed")
            raise
        return success_response(payload, claim)

    @router.get("")
    async def report_history(user=Depends(rate_limited_user)):
        records = await run_in_threadpool(store.list_reports, user.id)
        return {
            "count": len(records),
            "reports": [record.model_dump(mode="json") for record in records],
        }

    return router
