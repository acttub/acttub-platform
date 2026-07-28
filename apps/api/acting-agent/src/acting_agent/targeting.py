"""타깃 선정 — 어떤 질문 원형을 쓸지 코드가 정한다.

모델에게 "알아서 골라라"를 맡기면 은행이 있으나 마나가 된다. 주입본 target_selection
규칙(스펙 §3)의 구현이고, 볼트 하네스 `tools/question-prompt-test/real-agent-stub.mjs`
에서 옮겨 왔다.
"""

import re
from dataclasses import dataclass, field
from typing import Any, Optional

from acting_agent.knowledge import bank_find
from acting_agent.summary_schema import SceneSummary, SubText

# ── 관찰 신호 ────────────────────────────────────────────────────
# 스펙 §5의 1층 집계 신호(피치·템포 변화량, 평탄도·급증, 침묵·정지 구간)는 아직 1층이
# 만들지 않는다. 그때까지는 anomalies 를 신호로 읽는다 — 하네스 contextFromFixture 와
# 같은 매핑이다. §5가 붙으면 이 어댑터만 걷어내면 된다.


@dataclass
class Signal:
    name: str
    evidence: str
    start: str = ""
    confidence: str = "high"

    def key(self) -> str:
        # 턴에 남는 건 focus_timestamp(=start) 뿐이라 그것으로 신호를 식별한다. 같은 시각에
        # 신호가 둘이면 한 덩어리로 묶이지만, 상태를 통째로 잃는 것보다 낫다.
        return self.start or self.name


@dataclass
class SceneInput:
    situation: str = ""
    character: str = ""
    goal: str = ""


@dataclass
class Context:
    input: SceneInput
    signals: list[Signal] = field(default_factory=list)


# 1층 anomaly 의 severity 를 신호 신뢰도로 읽는다. §5 신호가 붙기 전까지의 임시 대응이고,
# 이 매핑이 있어야 신뢰도 게이트(high만 타깃으로 승격)가 실제로 걸린다 — 전부 high로 두면
# 게이트가 없는 것과 같다.
_SEVERITY_TO_CONFIDENCE = {"high": "high", "mid": "medium", "low": "low"}


def signals_from_summary(summary: SceneSummary) -> list[Signal]:
    out: list[Signal] = []
    for a in summary.anomalies or []:
        out.append(
            Signal(
                name=a.dimension,
                evidence=f"{a.what} — {a.why_odd}",
                start=a.start,
                confidence=_SEVERITY_TO_CONFIDENCE.get(a.severity, "medium"),
            )
        )
    return out


def build_context(summary: SceneSummary, subtext: Optional[SubText]) -> Context:
    return Context(
        input=SceneInput(
            situation=getattr(subtext, "situation", "") or "",
            character=getattr(subtext, "character", "") or "",
            goal=getattr(subtext, "subtext", "") or "",
        ),
        signals=signals_from_summary(summary),
    )


# ── 입력 모호함 판정 ─────────────────────────────────────────────
# 'ㅎㅇ' 같은 값이 "채운 것"으로 통과하면 결손 분기를 통째로 건너뛴다. 판정은 좁게 —
# 멀쩡한 입력을 결손으로 오인하면 배우가 이미 적은 걸 되묻게 되고 그게 더 나쁘다.
_HANGUL_SYLLABLE = re.compile(r"[가-힣]")
_LATIN_OR_DIGIT = re.compile(r"[A-Za-z0-9]")


def is_vague(value: Optional[str]) -> bool:
    s = (value or "").strip()
    if not s:
        return True
    compact = re.sub(r"\s+", "", s)
    if len(compact) < 2:
        return True
    if len(set(compact)) == 1:
        return True
    if not _HANGUL_SYLLABLE.search(compact) and not _LATIN_OR_DIGIT.search(compact):
        return True
    return False


def usable(value: Optional[str]) -> str:
    """모호한 값은 프롬프트에 넘기지 않는다 — 넘기면 모델이 'ㅎㅇ'에서 뜻을 읽어내려 한다."""
    return "" if is_vague(value) else (value or "")


# ── 원형 매핑 ────────────────────────────────────────────────────
Q_PURPOSE = "이 장면에서 인물이 원하는 게 뭐예요?"
Q_SITUATION = "지금 여기는 어디인가요? 어떤 상황에 처해 있나요?"
Q_CHARACTER = "이 장면의 인물은 어떤 사람이에요?"
Q_STAKE = "원하는 걸 이루지 못하면 인물에게 무슨 일이 벌어질까요?"
Q_STIMULUS = "그 순간 인물에게 가장 크게 들어온 건 무엇이었을까요?"

_SIGNAL_ARCHETYPE: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"침묵|멈춘|멈춤|말이\s*끊|끊김"), "말을 멈춘 그 순간, 인물 안에서는 무슨 일이 지나가고 있었을까요?"),
    (re.compile(r"시선|눈빛|눈길|응시"), "그때 인물의 눈길이 간 곳에는 무엇이 있었을까요?"),
    (re.compile(r"정지|고정"), "멈춘 그 순간, 인물은 뭘 하고 있었을까요?"),
    (re.compile(r"움직임|제스처|자세|손|어깨|고개"), "그 순간 인물의 몸은 무엇을 하려던 중이었을까요?"),
    (re.compile(r"볼륨|피치|커진|커짐|높|강하|소리"), "그 말이 커진 순간, 인물은 상대에게서 뭘 얻고 싶었을까요?"),
]

# 전 구간 관찰 vs 순간 관찰. "직전 구간"·"이전 구간"이 "전 구간"에 걸려 순간 신호가
# 전 구간으로 오분류되던 것을 앞 글자로 막는다.
_WHOLE_SCOPE = re.compile(
    r"(?<![직이그])전\s*구간|전반에|전반적|내내|장면\s*전체|시종|처음부터\s*끝|처음과\s*끝"
    r"|변화\s*폭|변화량|평탄|일관|고르게|차이가\s*크지\s*않"
)

_WHOLE_ARCHETYPE: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"볼륨|소리|강도|세기"), "이 장면 내내 인물을 붙잡고 있는 건 하나였을까요?"),
    (re.compile(r"."), "처음과 끝에서 인물이 원하는 건 같은 걸까요, 달라졌을까요?"),
]


# "직전 구간"·"그 전 구간"·"바로 전 구간"은 순간 관찰이다. 앞 글자 하나만 막으면 띄어쓴
# 형태가 새어 전 구간으로 오분류된다 (Codex 교차검토 2026-07-28).
_PRIOR_SEGMENT = re.compile(r"(직전|이전|그|바로|앞)\s*구간|(직|이|그|바로)\s*전\s*구간")


def is_whole_scope(sig: Signal) -> bool:
    hay = f"{sig.name} {sig.evidence}"
    if _PRIOR_SEGMENT.search(hay):
        return False
    return bool(_WHOLE_SCOPE.search(hay))


def _whole_archetype_for(sig: Signal) -> Optional[str]:
    hay = f"{sig.name} {sig.evidence}"
    for pattern, question in _WHOLE_ARCHETYPE:
        if pattern.search(hay):
            return question
    return None


@dataclass
class Target:
    row: dict[str, Any]
    why: str
    use_observation: bool = False
    signal: Optional[Signal] = None


def high_signals(ctx: Context, exclude: Optional[set[str]] = None) -> list[Signal]:
    skip = exclude or set()
    return [s for s in ctx.signals if s.confidence == "high" and s.key() not in skip]


def pick_first_target(ctx: Context) -> Target:
    """장면 전체가 먼저고 순간은 나중이다 — 틀 없이 순간부터 물으면 '갑자기 이걸 왜?'가 된다."""
    inp = ctx.input

    # 1) 상황 결손만 관찰보다 앞선다 — 장면을 모르면 관찰을 해석할 수 없다.
    #    인물·목표 결손은 관찰 뒤로 간다 (스펙 §3 선정 규칙 1·4).
    #    ⚠️ 하네스 구현은 셋 다 관찰보다 앞세웠는데, 그 탓에 입력이 비면 질문이 계속
    #    입력 채우기로만 돌고 영상으로 내려가지 못했다 (2026-07-28 실사용).
    if is_vague(inp.situation):
        return Target(bank_find(Q_SITUATION), "입력 결손(상황)")

    high = high_signals(ctx)

    # 2) 전 구간 관찰 — 순간보다 앞이다
    for sig in high:
        if not is_whole_scope(sig):
            continue
        question = _whole_archetype_for(sig)
        if question:
            return Target(bank_find(question), f"전 구간 관찰({sig.name})", True, sig)

    # 3) 순간 관찰
    for sig in high:
        if is_whole_scope(sig):
            continue
        hay = f"{sig.name} {sig.evidence}"
        for pattern, question in _SIGNAL_ARCHETYPE:
            if pattern.search(hay):
                return Target(bank_find(question), f"순간 관찰({sig.name})", True, sig)

    # 4) 매핑에 안 걸리는 관찰도 버리지 않는다 — 자극 원형으로 받는다
    moment = [s for s in high if not is_whole_scope(s)]
    if moment:
        return Target(
            bank_find(Q_STIMULUS),
            f"순간 관찰({moment[0].name}) 매핑 없음 → 자극",
            True,
            moment[0],
        )

    # 5) 쓸 관찰이 없을 때에야 남은 입력 결손으로 간다 — 목표 > 인물 순
    if is_vague(inp.goal):
        return Target(bank_find(Q_PURPOSE), "쓸 관찰 없음 → 입력 결손(목표)")
    if is_vague(inp.character):
        return Target(bank_find(Q_CHARACTER), "쓸 관찰 없음 → 입력 결손(인물)")

    # 6) 입력도 완비고 쓸 관찰도 없으면 걸린 것으로 잇는다
    return Target(bank_find(Q_STAKE), "쓸 관찰 없음·입력 완비 → 걸린 것")


# ── 꼬리 질문 ────────────────────────────────────────────────────
# 배우가 관찰을 부정하면 그 관찰은 rejected — 다시 쓰지 않는다.
DENIAL = re.compile(
    r"안\s*(그랬|했|커졌|멈췄|봤)|그런\s*적\s*없|아니(에요|었어요|야|었)"
    r"|기억\s*안|그렇지\s*않|잘못\s*보(신|셨)"
)
# 배우가 스스로 막혔다고 말한 경우만 scaffold. 짧은 답은 scaffold 대상이 아니다.
STUCK = re.compile(r"모르겠|잘\s*모르|감정이\s*안|안\s*나와|막혔|어떻게\s*해야\s*할지|생각\s*안\s*나")


def denies_observation(answer: str) -> bool:
    return bool(DENIAL.search(answer or ""))


def is_stuck(answer: str) -> bool:
    return bool(STUCK.search(answer or ""))


def archetype_for_signal(sig: Signal) -> dict[str, Any]:
    """관찰 하나에 맞는 은행 원형을 고른다. 꼬리 질문도 원형을 코드가 정한다 —
    관찰만 넘기면 모델이 자유 생성해서 은행이 있으나 마나가 된다."""
    if is_whole_scope(sig):
        question = _whole_archetype_for(sig)
        if question:
            return bank_find(question)
    else:
        hay = f"{sig.name} {sig.evidence}"
        for pattern, question in _SIGNAL_ARCHETYPE:
            if pattern.search(hay):
                return bank_find(question)
    return bank_find(Q_STIMULUS)


def derive_observation_state(turns) -> tuple[set[str], set[str], str]:
    """관찰 상태(쓴 것·부정된 것·직전에 인용한 것)를 턴에서 되살린다.

    CoachSession 에 필드로 얹으면 DB 복원 경로(`_agent_coach_session`)에 없어서 운영에서는
    매 요청마다 초기화된다 (Codex 교차검토 2026-07-28). 턴은 이미 저장되므로 거기서
    결정적으로 계산한다 — 저장 스키마를 늘리지 않고도 상태가 유지된다.
    """
    used: set[str] = set()
    rejected: set[str] = set()
    cited = ""
    for index, turn in enumerate(turns):
        if turn.role != "ai":
            continue
        key = (turn.focus_timestamp or "").strip()
        if not key:
            cited = ""
            continue
        used.add(key)
        cited = key
        nxt = turns[index + 1] if index + 1 < len(turns) else None
        if nxt is not None and nxt.role == "actor" and denies_observation(nxt.text):
            # 배우가 부정한 관찰은 다시 꺼내지 않는다
            rejected.add(key)
            cited = ""
    return used, rejected, cited


def pick_followup_signal(
    ctx: Context, used_keys: set[str], rejected_keys: set[str]
) -> Optional[Signal]:
    """아직 안 쓴 confidence high 관찰을 다음 후보로 낸다 (스펙 §6).

    rejected 는 제외한다 — 목록에 남기면 모델이 다시 꺼낸다.
    """
    for sig in high_signals(ctx, exclude=used_keys | rejected_keys):
        return sig
    return None
