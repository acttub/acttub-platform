from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from acting_report import engine
from acting_report.config import Settings
from acting_report.schema import ReportRecord
from acting_report.session_schema import CoachSession
from acting_report.store import FileReportStore


class ReportReq(BaseModel):
    user_id: str
    session: CoachSession


def build_router(*, client, settings: Settings, store=None) -> APIRouter:
    store = store or FileReportStore(settings.store_path)
    router = APIRouter(tags=["report"])

    @router.post("/report")
    def create_report(req: ReportReq):
        previous = store.list(req.user_id)
        try:
            report = engine.generate_report(
                req.session, previous, client=client, model=settings.model
            )
        except engine.ReportParseError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        record = ReportRecord(
            created_at=datetime.now(timezone.utc).isoformat(),
            session_id=req.session.session_id,
            report=report,
            turns=req.session.turns,
        )
        store.add(req.user_id, record)
        return {
            "user_id": req.user_id,
            "report": report.model_dump(),
            "report_count": len(previous) + 1,
        }

    @router.get("/report/history/{user_id}")
    def report_history(user_id: str):
        records = store.list(user_id)
        return {
            "user_id": user_id,
            "count": len(records),
            "reports": [r.model_dump() for r in records],
        }

    return router
