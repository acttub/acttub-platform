from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from acting_report import engine
from acting_report.config import Settings
from acting_report.store import ReportStore


class ReportReq(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: UUID


def build_router(*, client, settings: Settings, store: ReportStore) -> APIRouter:
    router = APIRouter(tags=["report"])

    @router.post("/report")
    def create_report(req: ReportReq):
        session_id = str(req.session_id)
        context = store.get_report_context(session_id)
        if context is None:
            raise HTTPException(status_code=404, detail="session not found")
        user_id, session = context
        if session.status != "closed":
            raise HTTPException(status_code=409, detail="session is still open")
        if store.has_report(session_id):
            raise HTTPException(
                status_code=409, detail="report already exists for session"
            )
        previous = store.list_reports(user_id)
        try:
            report = engine.generate_report(
                session, previous, client=client, model=settings.model
            )
        except engine.ReportParseError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        if not store.add_report(session_id, report):
            raise HTTPException(
                status_code=409, detail="report already exists for session"
            )
        return {
            "user_id": user_id,
            "report": report.model_dump(),
            "report_count": store.count_reports(user_id),
        }

    @router.get("/report/history/{user_id}")
    def report_history(user_id: str):
        records = store.list_reports(user_id)
        return {
            "user_id": user_id,
            "count": len(records),
            "reports": [r.model_dump() for r in records],
        }

    return router
