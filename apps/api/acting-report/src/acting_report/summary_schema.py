"""3층 리포트가 받는 1층 관찰 팩 wire 스키마."""

from pydantic import BaseModel, Field


class ObservationItem(BaseModel):
    start_ms: int
    end_ms: int
    label: str
    confidence: float


class ObservationPack(BaseModel):
    observations: list[ObservationItem] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
