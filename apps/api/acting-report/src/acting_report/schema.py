from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReportReq(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: UUID


class AnalysisNextTake(_StrictModel):
    direction: str
    tested: Literal[False]


class AnalysisReport(_StrictModel):
    report_type: Literal["analysis"]
    title: str
    actor_discovery: str
    line_meaning: str
    timing_reason: str
    target_effect: str
    next_take: AnalysisNextTake
    acting_caution: str
    evidence: list[str]
    uncertainties: list[str]
    source_handoff_id: str


class EffectiveExperiment(_StrictModel):
    instruction: str
    tested: Literal[True]


class ActorTraining(_StrictModel):
    title: str
    purpose: str
    duration_minutes: int | float
    steps: list[str]
    focus: str
    success_check: str
    tested: Literal[False]


class SourceHandoffIds(_StrictModel):
    analysis: str | None
    expression: str


class ExpressionReport(_StrictModel):
    report_type: Literal["expression"]
    title: str
    blocked_point: str
    expression_core: str
    line_meaning: str
    timing_reason: str
    playable_action: str
    effective_experiment: EffectiveExperiment
    observed_change: str
    next_take: str
    acting_trap: str
    actor_training: ActorTraining
    evidence: list[str]
    actor_words: list[str]
    uncertainties: list[str]
    source_handoff_ids: SourceHandoffIds


class BlockedReport(_StrictModel):
    report_type: Literal["blocked"]
    reason: Literal[
        "confirmed_analysis_handoff_required",
        "confirmed_expression_handoff_required",
    ]


PracticeReport = AnalysisReport | ExpressionReport | BlockedReport
