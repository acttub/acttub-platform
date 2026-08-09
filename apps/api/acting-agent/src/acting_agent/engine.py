"""OpenAI 기반 갈래 코칭 엔진."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable

from acting_llm.openai_client import TokenUsage, generate_text
from acting_llm.validate import validate_turn

from acting_agent import prompt as prompt_mod
from acting_agent.schema import CoachReply, CoachSession, CoachTurn

log = logging.getLogger(__name__)

GenerateText = Callable[[str, str], tuple[str, TokenUsage]]
_FENCED_JSON = re.compile(r"^```(?:json)?\s*([\s\S]*?)\s*```$", re.IGNORECASE)
_CLOSING_STRIP = re.compile(r"""[\s.,!?~…·'"]+""")
# 이 넷은 발화 전체가 그 말일 때만 종료로 본다. "끝"은 한 글자라
# "끝까지", "끝나고" 같은 정상 답변에 항상 걸린다.
_CLOSING_EXACT = frozenset({"그만", "종료", "끝", "여기까지"})
# 짧은 발화 안에서만 부분 일치를 허용한다 ("여기서 그만할게").
_CLOSING_LOOSE = ("그만", "종료")
_CLOSING_LOOSE_MAX_LEN = 10
# "그만큼"은 종료와 무관하게 흔히 쓰인다.
_CLOSING_FALSE_FRIENDS = ("그만큼",)
_CLOSING_TURN_INSTRUCTION = """

## 배우의 마무리 요청
배우가 지금 대화를 마치겠다고 했다.
더 질문하지 말고 지금까지 모인 내용만으로 초안을 마무리한다.
아직 확인하지 못한 내용은 uncertainties에 남긴다.
실험 전이라도 현재까지의 handoff를 작성해 status를 complete로 출력한다.
""".rstrip()


def is_closing(text: str) -> bool:
    """배우가 대화를 끝내겠다고 한 말인지 판정한다.

    오탐이 미탐보다 훨씬 비싸다. 오탐이면 답변 도중에 세션이 끊기고, 미탐이면
    배우가 '그만'을 한 번 더 치면 된다. 그래서 길게 설명하는 문장은 종료로 보지 않는다.
    """
    stripped = _CLOSING_STRIP.sub("", text)
    if stripped in _CLOSING_EXACT:
        return True
    if len(stripped) > _CLOSING_LOOSE_MAX_LEN:
        return False
    if any(word in stripped for word in _CLOSING_FALSE_FRIENDS):
        return False
    return any(word in stripped for word in _CLOSING_LOOSE)


def parse_coaching_response(raw_text: str) -> CoachReply:
    original = raw_text.strip()
    fenced = _FENCED_JSON.match(original)
    json_text = fenced.group(1).strip() if fenced else original
    try:
        candidate = json.loads(json_text)
        if not isinstance(candidate, dict) or not isinstance(
            candidate.get("message"), str
        ):
            raise ValueError("message 없음")
    except (json.JSONDecodeError, ValueError, TypeError):
        return CoachReply(message=original, status="continue", handoff=None)

    handoff = candidate.get("handoff")
    requested_complete = candidate.get("status") == "complete"
    if requested_complete and isinstance(handoff, dict):
        return CoachReply(
            message=candidate["message"].strip(),
            status="complete",
            handoff=handoff,
        )
    return CoachReply(
        message=candidate["message"].strip(),
        status="continue",
        handoff=None,
    )


def _generate_validated(
    session: CoachSession,
    user_message: str,
    *,
    generate: GenerateText,
) -> CoachReply:
    system_prompt = prompt_mod.select_prompt(session.blockage_kind)
    raw_text, _ = generate(
        system_prompt,
        prompt_mod.build_chat_prompt(session, user_message),
    )
    reply = parse_coaching_response(raw_text)
    validation = validate_turn(reply.message, enforce_sentence_limit=False)
    if validation.failures:
        log.info("코칭 응답 검증 실패 → 한 번 재생성: %s", validation.failures)
        raw_text, _ = generate(
            system_prompt,
            prompt_mod.build_regeneration_prompt(
                session,
                user_message,
                raw_text,
                validation.failures,
            ),
        )
        reply = parse_coaching_response(raw_text)
        validation = validate_turn(reply.message, enforce_sentence_limit=False)
    if validation.failures:
        log.warning("코칭 응답 재생성도 검증 실패 → 안전 문장 사용")
        return CoachReply(
            message=prompt_mod.safe_template(),
            status="continue",
            handoff=None,
        )
    return _sanitize_actor_words(reply)


def _sanitize_actor_words(reply: CoachReply) -> CoachReply:
    """handoff 에서 종료어를 걷어낸다.

    handoff 가 만들어지는 유일한 자리라 여기서 걸러야 새는 곳이 없다. 노트를 만드는
    경로가 둘(완료 턴, /v2/reports 가 저장된 handoff 로 다시 만드는 경우)이라
    소비하는 쪽에서 거르면 한쪽이 반드시 빠진다.

    모델이 actor_words 를 리스트가 아닌 값으로 줄 수 있다. parse_coaching_response
    는 handoff 가 dict 인지만 본다 -- 문자열이 오면 글자 단위로 쪼개지고 숫자가 오면
    터진다. 문자열 원소만 남긴다.
    """
    if not isinstance(reply.handoff, dict):
        return reply
    words = reply.handoff.get("actor_words")
    if not isinstance(words, list):
        return reply
    kept = [w for w in words if isinstance(w, str) and not is_closing(w)]
    if kept == words:
        return reply
    return reply.model_copy(
        update={"handoff": {**reply.handoff, "actor_words": kept}}
    )


def start(
    session_id: str,
    observation_pack,
    actor,
    *,
    practice_session_id: str,
    summary_id: str | None,
    sub_branch: str,
    transcripts: list[str] | tuple[str, ...] = (),
    analysis_handoff: dict | None = None,
    generate: GenerateText = generate_text,
) -> tuple[CoachSession, CoachReply]:
    session = CoachSession(
        session_id=session_id,
        practice_session_id=practice_session_id,
        summary_id=summary_id,
        observation_pack=observation_pack,
        actor=actor,
        blockage_kind=actor.blockage_kind,
        sub_branch=sub_branch,
        blockage_detail=actor.blockage_detail or None,
        transcripts=list(transcripts),
        analysis_handoff=analysis_handoff,
    )
    latest = actor.blockage_detail or actor.goal
    response = _generate_validated(session, latest, generate=generate)
    session.turns.append(CoachTurn(role="actor", text=latest))
    session.turns.append(CoachTurn(role="ai", text=response.message))
    return session, response


def reply(
    session: CoachSession,
    actor_text: str,
    *,
    generate: GenerateText = generate_text,
) -> CoachReply:
    user_message = actor_text
    if is_closing(actor_text):
        user_message += _CLOSING_TURN_INSTRUCTION
    response = _generate_validated(session, user_message, generate=generate)
    session.turns.append(CoachTurn(role="actor", text=actor_text))
    session.turns.append(CoachTurn(role="ai", text=response.message))
    return response
