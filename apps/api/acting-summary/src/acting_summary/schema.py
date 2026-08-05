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
