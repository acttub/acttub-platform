from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict
from starlette.concurrency import run_in_threadpool

from acting_api.db.store import LeaseOwnershipError
from acting_api.practice_sessions import PLAYBACK_URL_TTL_SEC
from acting_api.sync_operations import (
    begin_sync_operation,
    fail_sync_operation_async,
    generate_source_report,
    parse_request_id,
    success_response,
    sync_request_fingerprint,
)
from acting_report import engine as report_engine
from acting_report.schema import (
    AnalysisReport,
    BlockedReport,
    ExpressionReport,
    ReportReq,
)


class _StrictResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReportRecord(_StrictResponse):
    practice_session_id: UUID
    report_type: Literal["analysis", "expression"]
    title: str
    created_at: datetime


class ReportDetailResponse(_StrictResponse):
    practice_session_id: UUID
    created_at: datetime
    report: AnalysisReport | ExpressionReport
    playback_url: str


class ReportHistoryResponse(_StrictResponse):
    count: int
    reports: list[ReportRecord]


def build_router(
    *,
    store,
    storage,
    rate_limited_user,
    report_generate=None,
) -> APIRouter:
    router = APIRouter(prefix="/v2/reports", tags=["v2-reports"])

    @router.post(
        "",
        responses={
            200: {
                "model": AnalysisReport | ExpressionReport | BlockedReport
            }
        },
    )
    async def create_report(
        req: ReportReq,
        x_request_id: str | None = Header(default=None, alias="X-Request-Id"),
        user=Depends(rate_limited_user),
    ):
        source = await run_in_threadpool(
            store.get_owned_report_source,
            user_id=user.id,
            coach_session_id=req.session_id,
        )
        if source is None:
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
            practice_session_id=source.practice_session_id,
            request_id=request_id,
            kind="report",
            request_fingerprint=fingerprint,
        )
        if isinstance(begun, Response):
            return begun
        claim = begun
        try:
            existing = (
                await run_in_threadpool(
                    store.get_practice_report_for_handoff,
                    source.handoff_id,
                )
                if source.handoff_id is not None
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
            if report["report_type"] == "blocked" or existing is not None:
                await run_in_threadpool(
                    store.complete_sync_operation,
                    operation_id=claim.operation_id,
                    lease_token=claim.lease_token,
                    response_payload=report,
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
                    response_payload=report,
                )
                if not saved:
                    await fail_sync_operation_async(store, claim, "report_already_exists")
                    raise HTTPException(status_code=409, detail="report already exists")
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
            await fail_sync_operation_async(store, claim, "report_failed")
            raise
        return success_response(report, claim)

    @router.get(
        "",
        responses={200: {"model": ReportHistoryResponse}},
    )
    async def report_history(user=Depends(rate_limited_user)):
        records = await run_in_threadpool(store.list_report_summaries, user.id)
        return ReportHistoryResponse.model_validate(
            {
                "count": len(records),
                "reports": [
                    {
                        "practice_session_id": record.practice_session_id,
                        "report_type": record.report_type,
                        "title": record.title,
                        "created_at": record.created_at,
                    }
                    for record in records
                ],
            }
        )

    @router.get(
        "/{practice_session_id}",
        responses={200: {"model": ReportDetailResponse}},
    )
    async def report_detail(
        practice_session_id: UUID,
        user=Depends(rate_limited_user),
    ):
        detail = await run_in_threadpool(
            store.get_report_detail_for_practice_session,
            user_id=user.id,
            practice_session_id=practice_session_id,
        )
        if detail is None:
            raise HTTPException(status_code=404, detail="report_not_found")
        if storage is None:
            raise HTTPException(status_code=503, detail="storage_not_configured")
        playback_url = await run_in_threadpool(
            storage.presign_playback,
            object_key=detail.object_key,
            expires_in_sec=PLAYBACK_URL_TTL_SEC,
        )
        return ReportDetailResponse.model_validate(
            {
                "practice_session_id": detail.practice_session_id,
                "created_at": detail.created_at,
                "report": detail.report,
                "playback_url": playback_url,
            }
        )

    return router
