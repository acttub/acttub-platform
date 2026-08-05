import re
from dataclasses import dataclass

from acting_llm.forbidden import scan_generated_strings

_VALIDATION_KEYS = ("sentence_limit", "forbidden_language", "timecode")

_TIMECODE_PATTERNS = [
    re.compile(r"[0-9]{1,2}\s*:\s*[0-9]{2}"),
    re.compile(r"[0-9]+\s*초\s*(?:에서|부터|~|-|–)\s*[0-9]+\s*초"),
    re.compile(r"[0-9]+\s*[~\-–]\s*[0-9]+\s*초"),
    re.compile(r"[0-9]+\s*초\s*(?:에|에선|에서|쯤|즈음|구간|사이|부분|지점|무렵)"),
    re.compile(r"[0-9]+\s*분\s*[0-9]+\s*초"),
]


@dataclass(frozen=True)
class ValidationResult:
    checks: dict[str, bool]
    failures: list[str]
    forbidden_hits: list[str]


def visible_length(text: str) -> int:
    return len(re.sub(r"\s+", " ", text).strip())


def has_timecode(text: str) -> bool:
    return any(pattern.search(text) is not None for pattern in _TIMECODE_PATTERNS)


def validate_turn(
    visible_message: str, enforce_sentence_limit: bool = True
) -> ValidationResult:
    forbidden_hits = scan_generated_strings([visible_message])
    length = visible_length(visible_message)
    checks = {
        "sentence_limit": not enforce_sentence_limit or length <= 170,
        "forbidden_language": len(forbidden_hits) == 0,
        "timecode": not has_timecode(visible_message),
    }
    labels = {
        "sentence_limit": f"응답이 {length}자입니다. 170자 이내여야 합니다.",
        "forbidden_language": f"금지어가 노출됐습니다: {', '.join(forbidden_hits)}",
        "timecode": "응답에 시각이 들어 있습니다. 숫자를 빼고 대사나 동작으로 그 순간을 가리킵니다.",
    }
    failures = [labels[key] for key in _VALIDATION_KEYS if not checks[key]]
    return ValidationResult(
        checks=checks, failures=failures, forbidden_hits=forbidden_hits
    )
