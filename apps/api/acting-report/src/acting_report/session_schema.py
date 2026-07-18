"""acting-agent의 세션 스키마 사본.

리포트는 코치 대화가 끝난 CoachSession을 입력으로 받는 소비자다.
wire 포맷이 바뀌면 이 파일도 함께 맞춘다 (원본: acting_agent/src/acting_agent/schema.py).
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field

from acting_report.summary_schema import SceneSummary, SubText


class CoachTurn(BaseModel):
    role: Literal["ai", "actor"]
    text: str


class CoachSession(BaseModel):
    session_id: str
    summary: SceneSummary
    subtext: Optional[SubText] = None
    turns: list[CoachTurn] = Field(default_factory=list)
    question_count: int = 0
    status: Literal["open", "closed"] = "open"
    close_reason: str = ""
