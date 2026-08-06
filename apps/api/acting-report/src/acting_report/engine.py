from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any, Literal

from pydantic import ValidationError

from acting_llm.openai_client import TokenUsage, generate_text
from acting_report.prompt import REPORT_ANALYSIS_PROMPT, REPORT_EXPRESSION_PROMPT
from acting_report.schema import (
    AnalysisReport,
    BlockedReport,
    ExpressionReport,
    PracticeReport,
)
from acting_report.summary_schema import ObservationPack

GenerateText = Callable[[str, str], tuple[str, TokenUsage]]
ReportType = Literal["analysis", "expression"]
_FENCED_JSON = re.compile(r"^```(?:json)?\s*([\s\S]*?)\s*```$", re.IGNORECASE)

BLOCKED_ANALYSIS_REPORT = BlockedReport(
    report_type="blocked",
    reason="confirmed_analysis_handoff_required",
)
BLOCKED_EXPRESSION_REPORT = BlockedReport(
    report_type="blocked",
    reason="confirmed_expression_handoff_required",
)


class ReportParseError(Exception):
    pass


def _record(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _expression_ready(handoff: dict[str, Any] | None) -> bool:
    if handoff is None:
        return False
    experiment = _record(handoff.get("experiment"))
    observed_change = handoff.get("observed_change")
    return bool(
        experiment
        and experiment.get("tested") is True
        and isinstance(experiment.get("instruction"), str)
        and experiment["instruction"].strip()
        and isinstance(observed_change, str)
        and observed_change.strip()
    )


def build_report_input(
    *,
    report_type: ReportType,
    video_summary: dict[str, Any],
    confirmed_handoff: dict[str, Any] | None,
    confirmed: bool,
    coaching_handoff_id: str,
    analysis_handoff: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if not confirmed or confirmed_handoff is None:
        return None
    observation_pack = ObservationPack.model_validate(video_summary).model_dump(
        mode="json"
    )
    confirmation = {
        "confirmed": True,
        "coaching_handoff_id": coaching_handoff_id,
    }
    if report_type == "analysis":
        return {
            "video_summary": observation_pack,
            "confirmed_handoff": confirmed_handoff,
            "confirmation": confirmation,
        }
    if not _expression_ready(confirmed_handoff):
        return None
    return {
        "video_summary": observation_pack,
        "confirmed_handoff": confirmed_handoff,
        "analysis_handoff": analysis_handoff,
        "expression_handoff": confirmed_handoff,
        "confirmation": confirmation,
    }


def _parse_json(raw_text: str) -> dict[str, Any]:
    original = raw_text.strip()
    fenced = _FENCED_JSON.match(original)
    json_text = fenced.group(1).strip() if fenced else original
    try:
        value = json.loads(json_text)
    except json.JSONDecodeError as exc:
        raise ReportParseError(str(exc)) from exc
    if not isinstance(value, dict):
        raise ReportParseError("report response is not an object")
    return value


def _parse_report(
    raw_text: str,
    *,
    report_type: ReportType,
    source_handoff_id: str,
    analysis_handoff_id: str | None,
) -> PracticeReport:
    candidate = _parse_json(raw_text)
    try:
        if candidate.get("report_type") == "blocked":
            return BlockedReport.model_validate(candidate)
        if report_type == "analysis":
            candidate["source_handoff_id"] = source_handoff_id
            return AnalysisReport.model_validate(candidate)
        candidate["source_handoff_ids"] = {
            "analysis": analysis_handoff_id,
            "expression": source_handoff_id,
        }
        return ExpressionReport.model_validate(candidate)
    except ValidationError as exc:
        raise ReportParseError(str(exc)) from exc


def generate_report(
    *,
    report_type: ReportType,
    video_summary: dict[str, Any],
    confirmed_handoff: dict[str, Any] | None,
    confirmed: bool,
    coaching_handoff_id: str,
    analysis_handoff: dict[str, Any] | None = None,
    analysis_handoff_id: str | None = None,
    generate: GenerateText = generate_text,
) -> PracticeReport:
    model_input = build_report_input(
        report_type=report_type,
        video_summary=video_summary,
        confirmed_handoff=confirmed_handoff,
        confirmed=confirmed,
        coaching_handoff_id=coaching_handoff_id,
        analysis_handoff=analysis_handoff,
    )
    if model_input is None:
        return (
            BLOCKED_EXPRESSION_REPORT
            if report_type == "expression"
            else BLOCKED_ANALYSIS_REPORT
        )
    system_prompt = (
        REPORT_EXPRESSION_PROMPT
        if report_type == "expression"
        else REPORT_ANALYSIS_PROMPT
    )
    raw_text, _ = generate(
        system_prompt,
        json.dumps(model_input, ensure_ascii=False, indent=2),
    )
    return _parse_report(
        raw_text,
        report_type=report_type,
        source_handoff_id=coaching_handoff_id,
        analysis_handoff_id=analysis_handoff_id,
    )
