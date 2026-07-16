from google.genai import types

from acting_agent import prompt as prompt_mod
from acting_agent.guard import has_forbidden
from acting_agent.schema import CoachReply, CoachSession, CoachTurn

MAX_QUESTIONS = 10
END_TOKENS = ("그만", "종료", "끝")


class CoachParseError(Exception):
    pass


def _parse(response) -> CoachReply:
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, CoachReply):
        return parsed
    text = getattr(response, "text", None)
    if text:
        try:
            return CoachReply.model_validate_json(text)
        except Exception as exc:  # noqa: BLE001
            raise CoachParseError(str(exc)) from exc
    raise CoachParseError("no parseable reply in response")


def _generate(session, actor_text, *, client, model) -> CoachReply:
    text_prompt = prompt_mod.build_prompt(session, actor_text)
    config = types.GenerateContentConfig(
        response_mime_type="application/json", response_schema=CoachReply
    )
    last_reply = None
    last_err = None
    for _ in range(2):
        response = client.models.generate_content(
            model=model, contents=[text_prompt], config=config
        )
        try:
            reply = _parse(response)
        except CoachParseError as exc:
            last_err = exc
            continue
        if not has_forbidden(reply.utterance):
            return reply
        last_reply = reply  # 금지어 → 재시도
    if last_reply is not None:
        return last_reply
    raise CoachParseError(f"failed to parse after retry: {last_err}")


def start(session_id, summary, subtext=None, *, summary_id, client, model):
    session = CoachSession(
        session_id=session_id,
        summary_id=summary_id,
        summary=summary,
        subtext=subtext,
    )
    reply = _generate(session, None, client=client, model=model)
    session.turns.append(
        CoachTurn(
            role="ai",
            text=reply.utterance,
            action=reply.action,
            focus_timestamp=reply.focus_timestamp,
        )
    )
    if reply.action != "close":
        session.question_count += 1
    if reply.done:
        session.status = "closed"
        session.close_reason = reply.reason or ""
    return session, reply


def _close(session, reply):
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
    session, actor_text, *, client, model, max_questions: int = MAX_QUESTIONS
) -> CoachReply:
    if session.status == "closed":
        return CoachReply(
            action="close",
            utterance="",
            done=True,
            reason=session.close_reason or "user_ended",
        )

    session.turns.append(CoachTurn(role="actor", text=actor_text))

    if any(tok in actor_text for tok in END_TOKENS):
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

    out = _generate(session, actor_text, client=client, model=model)
    session.turns.append(
        CoachTurn(
            role="ai",
            text=out.utterance,
            action=out.action,
            focus_timestamp=out.focus_timestamp,
        )
    )
    if out.action != "close":
        session.question_count += 1
    if out.done:
        session.status = "closed"
        session.close_reason = out.reason or ""
    return out
