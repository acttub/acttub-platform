import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from acting_agent import engine as coach_engine
from acting_agent.config import Settings
from acting_agent.store import InMemorySessionStore
from acting_agent.summary_schema import SceneSummary, SubText


class CoachStartReq(BaseModel):
    summary: SceneSummary
    subtext: SubText | None = None


class CoachReplyReq(BaseModel):
    session_id: str
    text: str


def build_router(*, client, settings: Settings, store=None) -> APIRouter:
    store = store or InMemorySessionStore()
    router = APIRouter(tags=["coach"])

    def _payload(session_id, reply):
        return {
            "session_id": session_id,
            "action": reply.action,
            "utterance": reply.utterance,
            "focus_timestamp": reply.focus_timestamp,
            "done": reply.done,
            "reason": reply.reason,
        }

    @router.post("/coach/start")
    def coach_start(req: CoachStartReq):
        sid = uuid.uuid4().hex
        try:
            _, reply = coach_engine.start(
                sid,
                req.summary,
                req.subtext,
                client=client,
                model=settings.model,
                store=store,
            )
        except coach_engine.CoachParseError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        return _payload(sid, reply)

    @router.post("/coach/reply")
    def coach_reply(req: CoachReplyReq):
        session = store.get(req.session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="session not found")
        try:
            reply = coach_engine.reply(
                session,
                req.text,
                client=client,
                model=settings.model,
                max_questions=settings.max_questions,
            )
        except coach_engine.CoachParseError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        store.save(session)
        return _payload(req.session_id, reply)

    return router
