import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from acting_agent.summary_schema import ActorMaterial, ObservationPack

BlockageKind = Literal["분석", "표현", "그 외"]
CoachingStatus = Literal["continue", "complete"]


class CoachStartReq(BaseModel):
    model_config = ConfigDict(extra="forbid")

    practice_session_id: uuid.UUID
    restart: bool = False


class CoachReplyReq(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: uuid.UUID
    text: str


class CoachTurn(BaseModel):
    role: Literal["ai", "actor"]
    text: str


class CoachReply(BaseModel):
    message: str
    status: CoachingStatus = "continue"
    handoff: dict[str, Any] | None = None


class PriorContext(BaseModel):
    """이번 대화 전에 이미 있던 것들.

    셋 다 없을 수 있다 -- 첫 연습이 그렇다. 그때는 프롬프트에 칸을 아예 만들지
    않는다. 빈 제목만 있으면 모델이 그 자리를 지어내 채운다.
    """

    # 배우에 대해 쌓인 기억(유저.md). 칸 이름 -> 값.
    memory: dict[str, str] = Field(default_factory=dict)
    # 같은 연습을 다시 열었을 때, 지난 대화에서 정리된 것.
    earlier_conversation: str | None = None
    # 지난 연습에서 해보기로 했지만 아직 안 해본 것.
    pending_takes: tuple[str, ...] = ()

    def is_empty(self) -> bool:
        return not (self.memory or self.earlier_conversation or self.pending_takes)


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
    prior: PriorContext = Field(default_factory=PriorContext)
    status: Literal["open", "closed"] = "open"
