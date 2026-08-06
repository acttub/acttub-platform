"""acting-summary 관찰 팩 wire 스키마 사본.

코치는 acting-summary가 만든 JSON을 입력으로 받는 소비자다.
wire 포맷이 바뀌면 이 파일도 함께 맞춘다 (원본: acting-summary/src/acting_summary/schema.py).
"""

from typing import Literal

from pydantic import BaseModel, Field


class ObservationItem(BaseModel):
    start_ms: int
    end_ms: int
    label: str
    confidence: float


class ObservationPack(BaseModel):
    observations: list[ObservationItem] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)


class ActorMaterial(BaseModel):
    situation: str
    character: str
    goal: str
    blockage_kind: Literal["분석", "표현", "그 외"]
    blockage_detail: str
    duration_ms: int = Field(ge=0)
