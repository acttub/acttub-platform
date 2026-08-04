"""코치 대화 엔진.

규칙은 system_instruction 으로, 장면·관찰·타깃 지시는 사용자 메시지로 나눠 보낸다.
모델이 금지 문형을 흘리면 한 번 재생성시키고, 그래도 걸리면 폴백 질문으로 바꾼다 —
가드가 경고에 그치면 배우에게 그대로 나간다.
"""

import logging
from typing import Optional

from google.genai import types
from pydantic import BaseModel

from acting_agent import prompt as prompt_mod
from acting_agent import targeting
from acting_agent.guard import (
    ECHO_LIMIT,
    echo_hits,
    lint_question,
    normalize_question,
    pick_fallback,
)
from acting_agent.schema import CoachReply, CoachSession, CoachTurn

log = logging.getLogger(__name__)

MAX_QUESTIONS = 10
END_TOKENS = ("그만", "종료", "끝")
# 상한 직전 몇 턴은 새 갈래를 열지 않고 배우 문장으로 수렴시킨다 (스펙 §6).
CONVERGE_MARGIN = 2
# 닫는 턴이 금지 문형에 걸렸을 때 쓰는 문장. 질문을 넣지 않는다.
SAFE_CLOSING = "오늘 대화 잘 이어와 주셨어요 — 스스로 짚으신 걸 한 줄로 남겨봐 주세요."


class CoachParseError(Exception):
    pass


class AgentOut(BaseModel):
    analysis: str
    question: str


class AgentOutWithClose(BaseModel):
    analysis: str
    question: str
    close: bool = False


def _call(client, model, system: str, user_msg: str, with_close: bool):
    schema = AgentOutWithClose if with_close else AgentOut
    config = types.GenerateContentConfig(
        system_instruction=system,
        response_mime_type="application/json",
        response_schema=schema,
    )
    response = client.models.generate_content(
        model=model, contents=[user_msg], config=config
    )
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, schema):
        return parsed
    # close 유무만 다른 형제 모델로 파싱돼 오는 경우가 있다 — 필드가 같으니 옮겨 담는다
    if isinstance(parsed, BaseModel):
        try:
            return schema.model_validate(parsed.model_dump())
        except Exception:  # noqa: BLE001 - 아래 text 경로로 내려간다
            pass
    text = getattr(response, "text", None)
    if text:
        try:
            return schema.model_validate_json(text)
        except Exception as exc:  # noqa: BLE001
            raise CoachParseError(str(exc)) from exc
    raise CoachParseError("no parseable reply in response")


def _call_retrying_parse(client, model, system, user_msg, with_close):
    """JSON이 깨져 오는 건 드물지만 한 번은 다시 시켜 본다 — 한 번에 502를 내지 않는다."""
    try:
        return _call(client, model, system, user_msg, with_close)
    except CoachParseError:
        return _call(client, model, system, user_msg, with_close)


def _generate_guarded(client, model, system, user_msg, with_close, ctx, asked=None):
    out = _call_retrying_parse(client, model, system, user_msg, with_close)

    # 종료 발화도 검사한다. 옛 구현은 close 를 통째로 건너뛰어서 판정·칭찬이 섞인 마무리가
    # 그대로 배우에게 나갔다 (Codex 교차검토 2026-07-28).
    hits = lint_question(out.question)
    if hits:
        log.info("금지 문형 감지(%s) → 재생성", ", ".join(hits))
        retry_msg = (
            f"{user_msg}\n\n[재생성] 직전 출력이 금지 문형({', '.join(hits)})에 걸렸다. "
            "규칙을 지켜 다시."
        )
        out = _call_retrying_parse(client, model, system, retry_msg, with_close)
        hits = lint_question(out.question)
        if hits:
            log.warning("재생성도 실패(%s) → 대체 문장", ", ".join(hits))
            if getattr(out, "close", False):
                # 닫는 턴이면 질문을 넣지 않는다 — 폴백 질문 + done=true 는 모순이다
                out = out.model_copy(update={"question": SAFE_CLOSING})
            else:
                # 이미 물어본 것을 빼고 고른다. 같은 문장을 다시 내보내면
                # 대화가 원점으로 돌아가고, 그게 가장 큰 이탈 신호였다.
                # 폴백까지 떨어지면 질문을 비운다 — 호출부가 종료로 바꾼다.
                out = out.model_copy(update={"question": pick_fallback(asked) or ""})

    closing = bool(getattr(out, "close", False))

    # 되읽기는 가드레일 위반이 아니라 품질 문제다 → 한 번 더 시켜보되, 재시도가 깨지면
    # 멀쩡한 첫 응답을 버리지 않는다 (그 경우 502가 났다).
    echo = echo_hits(out.question, ctx.input.situation, ctx.input.goal)
    if len(echo) >= ECHO_LIMIT and not closing:
        log.info("입력 되읽기 %d개(%s) → 재생성", len(echo), ", ".join(echo))
        retry_msg = (
            f"{user_msg}\n\n[재생성] 직전 출력이 입력에 적힌 표현({', '.join(echo)})을"
            " 그대로 옮겼다. 입력을 요약해 돌려주지 말고, 그 입력에서 읽어낸 것으로 다시"
            " 만들어라. 입력끼리 부딪히는 지점이 있으면 그것을 짚어라."
        )
        try:
            retry = _call(client, model, system, retry_msg, with_close)
        except CoachParseError:
            log.info("되읽기 재생성이 깨졌다 → 첫 응답을 그대로 쓴다")
            return out
        retry_echo = echo_hits(retry.question, ctx.input.situation, ctx.input.goal)
        if not lint_question(retry.question) and len(retry_echo) < len(echo):
            out = retry
    return out


def start(session_id, summary, subtext=None, *, summary_id, client, model):
    session = CoachSession(
        session_id=session_id,
        summary_id=summary_id,
        summary=summary,
        subtext=subtext,
    )
    ctx = targeting.build_context(summary, subtext)
    target = targeting.pick_first_target(ctx)
    log.info("코치 첫 타깃: %s — %s", target.row["category"], target.why)

    user_msg = prompt_mod.first_user_message(ctx, target)
    out = _generate_guarded(
        client, model, prompt_mod.system_prompt(False), user_msg, False, ctx
    )

    # focus_timestamp 는 "이 턴이 근거로 제시한 관찰"의 기록이다. 다음 턴이 이걸 읽어
    # 같은 관찰을 다시 꺼내지 않는다.
    focus = target.signal.start if target.signal else ""

    reply_obj = CoachReply(
        action="probe_intent", utterance=out.question, focus_timestamp=focus
    )
    session.turns.append(
        CoachTurn(
            role="ai", text=out.question, action="probe_intent", focus_timestamp=focus
        )
    )
    session.question_count += 1
    return session, reply_obj


def _close(session: CoachSession, reply: CoachReply) -> None:
    session.turns.append(
        CoachTurn(
            role="ai",
            text=reply.utterance,
            action=reply.action,
            focus_timestamp=reply.focus_timestamp,
        )
    )
    session.status = "closed"
    session.close_reason = reply.reason or ""


def reply(
    session: CoachSession,
    actor_text: str,
    *,
    client,
    model,
    max_questions: int = MAX_QUESTIONS,
) -> CoachReply:
    if session.status == "closed":
        return CoachReply(
            action="close",
            utterance="",
            done=True,
            reason=session.close_reason or "user_ended",  # type: ignore[arg-type]
        )

    session.turns.append(CoachTurn(role="actor", text=actor_text))

    if any(token in actor_text for token in END_TOKENS):
        r = CoachReply(
            action="close",
            utterance="여기까지 할게요. 오늘 대화 잘 이어와 주셨어요 — 스스로 짚으신 걸 기억해 주세요.",
            done=True,
            reason="user_ended",
        )
        _close(session, r)
        return r

    if session.question_count >= max_questions:
        r = CoachReply(
            action="close",
            utterance="질문은 여기까지예요. 오늘 대화 잘 이어와 주셨어요 — 짚으신 차이를 한 줄로 남겨봐 주세요.",
            done=True,
            reason="limit",
        )
        _close(session, r)
        return r

    # 관찰 상태는 턴에서 되살린다 — 방금 붙인 배우 답변이 부정이면 직전 관찰이 rejected 된다.
    used_keys, rejected_keys, _cited = targeting.derive_observation_state(session.turns)

    ctx = targeting.build_context(session.summary, session.subtext)
    candidate = targeting.pick_followup_signal(ctx, used_keys, rejected_keys)
    user_msg = prompt_mod.followup_user_message(
        ctx,
        [(t.role, t.text) for t in session.turns[:-1]],
        actor_text,
        candidate,
        targeting.archetype_for_signal(candidate) if candidate is not None else None,
        stuck=targeting.is_stuck(actor_text),
        converging=session.question_count >= max_questions - CONVERGE_MARGIN,
    )
    out = _generate_guarded(
        client,
        model,
        prompt_mod.system_prompt(True),
        user_msg,
        True,
        ctx,
        asked=[t.text for t in session.turns if t.role == "ai"],
    )

    # 같은 질문을 또 던지느니 끝낸다. 폴백이 떨어졌거나(question 빈 문자열),
    # 모델이 이미 물어본 것을 그대로 냈을 때 걸린다.
    asked_before = {
        normalize_question(t.text) for t in session.turns if t.role == "ai"
    }
    repeats = normalize_question(out.question) in asked_before
    if not out.question.strip() or repeats:
        log.info("되풀이 질문 감지 → 종료 (%s)", "폴백 소진" if not out.question.strip() else "중복")
        r = CoachReply(
            action="close",
            utterance=(
                "여기까지 할게요. 오늘 짚으신 것들이 이미 충분해요 — "
                "그중 하나만 다음 연습에 들고 가 주세요."
            ),
            done=True,
            reason="exhausted",
        )
        _close(session, r)
        return r

    closing = bool(getattr(out, "close", False))
    focus = candidate.start if candidate is not None else ""

    result = CoachReply(
        action="close" if closing else "dig_cause",
        utterance=out.question,
        focus_timestamp="" if closing else focus,
        done=closing,
        reason="gap_stated" if closing else None,
    )
    if closing:
        _close(session, result)
        return result

    session.turns.append(
        CoachTurn(
            role="ai", text=out.question, action="dig_cause", focus_timestamp=focus
        )
    )
    session.question_count += 1
    return result
