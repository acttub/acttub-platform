from typing import Any, Literal

from pydantic import BaseModel, Field

from acting_agent.summary_schema import ActorMaterial, ObservationPack

BlockageKind = Literal["분석", "표현", "그 외"]
CoachingStatus = Literal["continue", "complete"]


class CoachTurn(BaseModel):
    role: Literal["ai", "actor"]
    text: str


class CoachReply(BaseModel):
    message: str
    status: CoachingStatus = "continue"
    handoff: dict[str, Any] | None = None


class CoachSession(BaseModel):
    session_id: str
    practice_session_id: str
    summary_id: str | None = None
    observation_pack: ObservationPack | None = None
    actor: ActorMaterial
    blockage_kind: BlockageKind
    sub_branch: str
    blockage_detail: str | None = None
    transcripts: list[str] = Field(default_factory=list)
    conversation_summary: str = ""
    analysis_handoff: dict[str, Any] | None = None
    turns: list[CoachTurn] = Field(default_factory=list)
    status: Literal["open", "closed"] = "open"
