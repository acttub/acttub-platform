from google.genai import types

from acting_report import prompt as prompt_mod
from acting_report.schema import ActingReport, ReportRecord
from acting_report.session_schema import CoachSession


class ReportParseError(Exception):
    pass


def _parse(response) -> ActingReport:
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, ActingReport):
        return parsed
    text = getattr(response, "text", None)
    if text:
        try:
            return ActingReport.model_validate_json(text)
        except Exception as exc:  # noqa: BLE001
            raise ReportParseError(str(exc)) from exc
    raise ReportParseError("no parseable report in response")


def generate_report(
    session: CoachSession,
    previous: list[ReportRecord],
    *,
    client,
    model,
) -> ActingReport:
    text_prompt = prompt_mod.build_prompt(session, previous)
    config = types.GenerateContentConfig(
        response_mime_type="application/json", response_schema=ActingReport
    )
    last_err = None
    for _ in range(2):
        response = client.models.generate_content(
            model=model, contents=[text_prompt], config=config
        )
        try:
            return _parse(response)
        except ReportParseError as exc:
            last_err = exc
    raise ReportParseError(f"failed to parse after retry: {last_err}")
