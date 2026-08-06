import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from acting_agent import engine as coach_engine
from acting_agent.store import (
    InMemorySessionStore,
    SessionStore,
    SessionWriteConflict,
)


class CoachStartReq(BaseModel):
    model_config = ConfigDict(extra="forbid")

    practice_session_id: uuid.UUID


class CoachReplyReq(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: uuid.UUID
    text: str


def build_router(*, store: SessionStore | None = None, generate=None) -> APIRouter:
    if store is None:
        store = InMemorySessionStore()
    router = APIRouter(tags=["coach"])

    def payload(session_id, reply, blockage_kind):
        branch = "expression" if blockage_kind == "표현" else "analysis"
        return {
            "session_id": session_id,
            "message": reply.message,
            "status": reply.status,
            "handoff": (
                {"id": str(uuid.uuid4()), "branch_kind": branch}
                if reply.status == "complete"
                else None
            ),
        }

    @router.post("/coach/start")
    def coach_start(req: CoachStartReq):
        practice_session_id = str(req.practice_session_id)
        context = store.get_practice_context(practice_session_id)
        if context is None:
            raise HTTPException(status_code=404, detail="practice session not found")
        observation_pack, actor, sub_branch, transcripts = context
        sid = str(uuid.uuid4())
        kwargs = {"generate": generate} if generate is not None else {}
        session, reply = coach_engine.start(
            sid,
            observation_pack,
            actor,
            practice_session_id=practice_session_id,
            summary_id=None,
            sub_branch=sub_branch,
            transcripts=transcripts,
            **kwargs,
        )
        store.create(session)
        return payload(sid, reply, actor.blockage_kind)

    @router.post("/coach/reply")
    def coach_reply(req: CoachReplyReq):
        session_id = str(req.session_id)
        session = store.get(session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="session not found")
        kwargs = {"generate": generate} if generate is not None else {}
        reply = coach_engine.reply(session, req.text, **kwargs)
        try:
            store.save(session)
        except SessionWriteConflict as exc:
            raise HTTPException(
                status_code=409, detail="session changed concurrently"
            ) from exc
        return payload(session_id, reply, session.blockage_kind)

    return router
