import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from acting_agent import engine as coach_engine
from acting_agent.config import Settings
from acting_agent.store import (
    InMemorySessionStore,
    SessionStore,
    SessionWriteConflict,
)


class CoachStartReq(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary_id: uuid.UUID


class CoachReplyReq(BaseModel):
    session_id: uuid.UUID
    text: str


def build_router(
    *, client, settings: Settings, store: SessionStore | None = None
) -> APIRouter:
    if store is None:
        store = InMemorySessionStore()
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
        summary_id = str(req.summary_id)
        context = store.get_summary(summary_id)
        if context is None:
            raise HTTPException(status_code=404, detail="summary not found")
        summary, subtext = context
        sid = str(uuid.uuid4())
        try:
            session, reply = coach_engine.start(
                sid,
                summary,
                subtext,
                summary_id=summary_id,
                client=client,
                model=settings.model,
            )
        except coach_engine.CoachParseError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        store.create(session)
        return _payload(sid, reply)

    @router.post("/coach/reply")
    def coach_reply(req: CoachReplyReq):
        session_id = str(req.session_id)
        session = store.get(session_id)
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
        try:
            store.save(session)
        except SessionWriteConflict as exc:
            raise HTTPException(
                status_code=409, detail="session changed concurrently"
            ) from exc
        return _payload(session_id, reply)

    return router
