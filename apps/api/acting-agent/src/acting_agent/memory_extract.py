"""연습 하나에서 배우 기억 4칸을 뽑아낸다.

배우가 연습을 마칠 때마다 대화·받아쓴 대사·연습 기록이 남는데, 그걸 다음
연습까지 가져가는 자리가 배우 기억이다. 여기서는 그 재료를 읽어 **달라진 칸만**
돌려준다.

두 가지를 지킨다.

**성별·나이는 쓰지 않는다.** 영상이나 말투에서 추론하는 순간 틀릴 수 있고,
틀린 채로 다음 연습의 전제가 된다. 배우가 직접 넣는 칸으로 남긴다.

**뽑아낸 값도 대화와 같은 검사를 통과해야 한다.** 기억은 다음 요청의 입력이라,
여기가 뚫리면 코치 대화에 걸어둔 검사가 통째로 우회된다. 통과 못 한 칸은 버리고
이전 값을 그대로 둔다 -- 빈 값으로 밀어내면 배우가 쓴 것까지 사라진다.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Callable

from acting_llm.forbidden import ACTOR_GOAL_ALLOWED
from acting_llm.validate import validate_turn

log = logging.getLogger(__name__)

# 에이전트가 손대는 칸. 성별(gender)·나이(age)는 배우 전용이라 여기 없다.
AGENT_WRITABLE_FIELDS = ("goal", "blockage", "speech_self", "speech_actual")

# 저장 계층(actor_memory_entries)의 길이 상한과 같은 값. 넘으면 저장이 거부되므로
# 여기서 미리 버린다 -- 길어질수록 다음 연습 프롬프트를 그만큼 먹기도 한다.
VALUE_MAX_LENGTH = 1000

_FENCED_JSON = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)

_FIELD_LABELS = {
    "goal": "목표",
    "blockage": "막히는 지점",
    "speech_self": "본인이 생각하는 화법",
    "speech_actual": "실제로 말하는 화법",
}

SYSTEM_PROMPT = """너는 배우의 연습 기록을 정리하는 사람이다.

방금 끝난 연습 하나를 읽고, 배우에 대해 **다음 연습까지 가져갈 만한 것**만 골라
적는다. 아래를 지킨다.

- **근거가 있는 칸만 적는다.** 이번 연습에서 새로 알게 된 것이 없는 칸은 아예 빼라.
  빈 문자열도 적지 마라. 칸을 빼는 것이 정상이다.
- **판정하지 말고 인용하라.** "말이 빠르다", "뻣뻣하다" 처럼 네가 내린 평가는 적지
  않는다. 배우가 한 말과 실제 대사를 그대로 옮겨 차이가 드러나게만 한다.
- **약점·개선점 같은 말을 쓰지 않는다.** 배우를 깎는 말, 마음 상태를 단정하는 말도
  쓰지 않는다.
- 각 칸은 200자를 넘기지 않는다.
- 성별과 나이는 **절대 적지 않는다.** 배우가 직접 입력하는 칸이다.

아래 JSON 만 출력한다. 적을 칸이 없으면 {} 를 출력한다.

{"goal": "...", "blockage": "...", "speech_self": "...", "speech_actual": "..."}
"""


@dataclass(frozen=True)
class MemoryMaterial:
    """기억을 갱신할 때 읽는 이번 연습의 재료."""

    goal: str
    blockage_kind: str
    sub_branch: str
    blockage_detail: str | None
    transcripts: tuple[str, ...]
    actor_messages: tuple[str, ...]
    existing: dict[str, str]


@dataclass(frozen=True)
class MemoryExtraction:
    """갱신할 칸과, 걸러낸 칸.

    `rejected` 는 무엇이 왜 안 들어갔는지 로그로 남기기 위한 것이다 -- 조용히
    사라지면 나중에 "왜 안 쌓이지" 를 추적할 방법이 없다.
    """

    updates: dict[str, str] = field(default_factory=dict)
    rejected: dict[str, str] = field(default_factory=dict)


GenerateText = Callable[[str, str], tuple[str, object]]


def build_extraction_prompt(material: MemoryMaterial) -> str:
    lines = ["[이번 연습]", f"- 배우가 적은 목표: {material.goal}"]
    branch = f"{material.blockage_kind} / {material.sub_branch}"
    lines.append(f"- 배우가 고른 막히는 지점: {branch}")
    if material.blockage_detail:
        lines.append(f"- 배우가 덧붙인 설명: {material.blockage_detail}")

    if material.transcripts:
        lines.append("")
        lines.append("[영상에서 받아쓴 실제 대사]")
        lines.extend(f"- {t}" for t in material.transcripts)

    if material.actor_messages:
        lines.append("")
        lines.append("[대화에서 배우가 한 말]")
        lines.extend(f"- {m}" for m in material.actor_messages)

    lines.append("")
    lines.append("[지금까지 쌓인 기억]")
    if material.existing:
        for name in AGENT_WRITABLE_FIELDS:
            value = material.existing.get(name)
            if value:
                lines.append(f"- {_FIELD_LABELS[name]}: {value}")
    else:
        lines.append("- (아직 없음)")

    lines.append("")
    lines.append("달라진 칸만 JSON 으로 출력하라.")
    return "\n".join(lines)


def _language_failures(name: str, text: str) -> list[str]:
    """대화와 같은 검사를 걸되, 목표 칸에서만 결과 어휘를 통과시킨다.

    "합격" 은 코치가 말하면 판정이지만 배우가 자기 목표로 말하면 그냥 그 배우의
    말이다. 그 밖의 실패(판정 어휘·타임코드 등)는 목표 칸에서도 그대로 막는다.
    """
    validation = validate_turn(text, enforce_sentence_limit=False)
    if not validation.failures:
        return []
    if name != "goal":
        return validation.failures

    remaining = [hit for hit in validation.forbidden_hits if hit not in ACTOR_GOAL_ALLOWED]
    if remaining:
        return validation.failures
    # 금지어 말고 다른 사유(타임코드 등)가 남았는지 본다.
    return [
        failure
        for failure, ok in validation.checks.items()
        if not ok and failure != "forbidden_language"
    ]


def _parse(raw_text: str) -> dict[str, object]:
    text = raw_text.strip()
    fenced = _FENCED_JSON.match(text)
    if fenced:
        text = fenced.group(1).strip()
    try:
        candidate = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return {}
    return candidate if isinstance(candidate, dict) else {}


def extract_memory_updates(
    material: MemoryMaterial,
    *,
    generate: GenerateText,
) -> MemoryExtraction:
    """이번 연습에서 달라진 기억 칸만 돌려준다.

    모델이 형식을 어기거나 아무것도 못 찾아도 예외를 내지 않는다 -- 기억 갱신이
    실패했다고 연습이 실패하면 안 된다.
    """
    raw_text, _ = generate(SYSTEM_PROMPT, build_extraction_prompt(material))
    candidate = _parse(raw_text)

    updates: dict[str, str] = {}
    rejected: dict[str, str] = {}

    for name, value in candidate.items():
        if name in ("gender", "age"):
            rejected[name] = "배우 전용 칸"
            continue
        if name not in AGENT_WRITABLE_FIELDS:
            continue
        if not isinstance(value, str):
            rejected[name] = "문자열이 아님"
            continue

        text = value.strip()
        if not text:
            rejected[name] = "빈 값"
            continue
        if len(text) > VALUE_MAX_LENGTH:
            rejected[name] = "길이 상한 초과"
            continue
        if text == material.existing.get(name):
            continue

        failures = _language_failures(name, text)
        if failures:
            rejected[name] = f"검사 실패: {', '.join(failures)}"
            continue

        updates[name] = text

    if rejected:
        log.info("기억 갱신에서 걸러낸 칸: %s", rejected)
    return MemoryExtraction(updates=updates, rejected=rejected)
