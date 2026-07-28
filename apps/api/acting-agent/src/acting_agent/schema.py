from typing import Literal, Optional

from pydantic import BaseModel, Field

from acting_agent.summary_schema import SceneSummary, SubText


class CoachTurn(BaseModel):
    role: Literal["ai", "actor"]
    text: str
    action: Optional[Literal["probe_intent", "dig_cause", "deflect", "close"]] = None
    focus_timestamp: str = ""


class CoachReply(BaseModel):
    action: Literal["probe_intent", "dig_cause", "deflect", "close"]
    utterance: str
    focus_timestamp: str = ""
    done: bool = False
    # Gemini response_schema enum은 빈 문자열을 허용하지 않으므로 None을 기본값으로 쓴다
    reason: Optional[Literal["gap_stated", "exhausted", "limit", "user_ended"]] = None


class CoachSession(BaseModel):
    session_id: str
    summary_id: str
    summary: SceneSummary
    subtext: Optional[SubText] = None
    turns: list[CoachTurn] = Field(default_factory=list)
    question_count: int = 0
    status: Literal["open", "closed"] = "open"
    close_reason: str = ""
    # 관찰 상태(쓴 것·부정된 것)는 필드로 두지 않는다 — DB 복원 경로에 없어서 운영에서만
    # 초기화된다. turns 의 focus_timestamp 에서 targeting.derive_observation_state 로 되살린다.
