# coach 대화형 에이전트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** acting-summary 요약 JSON을 받아 가장 큰 문제를 관찰+의도로 묻고 "왜 그랬어?"로 캐물어 배우가 차이를 스스로 말하게 하는 코칭 에이전트를 `acting_summary.coach` 서브패키지로 구현.

**Architecture:** 주입식 Gemini client 패턴(기존 summarizer와 동일)으로 LLM을 mock 가능하게. 에이전트 결정은 `CoachReply(action/utterance/done/reason)` 구조화 출력에 노출. 세션은 인메모리 dict. FastAPI 라우트 2개 + Gradio 챗 UI.

**Tech Stack:** Python(uv), Pydantic v2, google-genai(`from google.genai import types`), FastAPI, Gradio, pytest.

## Global Constraints

- 패키지 매니저: `py -m uv run ...` (예: `py -m uv run pytest -q`).
- 실제 Gemini 호출은 **사용자 승인 후에만**. 모든 유닛테스트는 주입식 client mock, 실제 API 0건.
- 모델 기본 `gemini-2.5-flash`, `Settings.model`/env `GEMINI_MODEL`로 override. client는 `create_app`/함수 인자로 주입.
- 입력 요약은 기존 `acting_summary.schema.SceneSummary` 재사용(observation/summary/intent_alignment/anomalies). 새 요약 스키마 만들지 말 것.
- 질문 상한 `MAX_QUESTIONS = 10`. 종료 토큰 `("그만", "종료", "끝")`.
- 발화 금지어(lexical): 점수·등급·진정성·몰입도·감정 전달력·연기력·좋다·나쁘다·합격·불합격.
- 커밋 자주. 커밋 메시지 한국어 OK. 파일 삭제/이름변경 금지.

---

### Task 1: coach 서브패키지 스키마

**Files:**
- Create: `src/acting_summary/coach/__init__.py`
- Create: `src/acting_summary/coach/schema.py`
- Create: `tests/coach/support.py` (공용 테스트 헬퍼 — 이후 모든 coach 테스트가 bare import)
- Test: `tests/coach/test_coach_schema.py`

**Interfaces:**
- Consumes: `acting_summary.schema.SceneSummary`, `SubText`.
- Produces: `CoachTurn`, `CoachReply(action, utterance, focus_timestamp, done, reason)`, `CoachSession(session_id, summary, subtext, turns, question_count, status, close_reason)`.
- Test support (`tests/coach/support.py`): `SUMMARY`(SceneSummary 샘플), `FakeClient(responses)`, `_Resp(parsed=,text=)`, `RaisingClient`(호출 시 AssertionError). pytest 기본 prepend 모드에서 `tests/coach/`가 sys.path에 올라가므로 형제 테스트들이 `from support import ...`로 쓴다.

- [ ] **Step 1: Write the support module + failing test**

`tests/coach/support.py`:
```python
from acting_summary.schema import SceneSummary, Observation, Anomaly

OBS = Observation(timeline="t", dialogue="d", tempo="te", pitch="p",
                  movement="m", expression="e", emotion="em")
SUMMARY = SceneSummary(observation=OBS, summary="s", intent_alignment="i",
                       anomalies=[Anomaly(timestamp="00:12", dimension="템포",
                                          what="1.2초 멈춤", why_odd="o",
                                          likely_cause="c", impact_on_intent="ii")])


class _Resp:
    def __init__(self, parsed=None, text=None):
        self.parsed, self.text = parsed, text


class _Models:
    def __init__(self, responses):
        self._responses, self.calls = list(responses), []

    def generate_content(self, model, contents, config):
        self.calls.append((model, contents, config))
        return self._responses.pop(0)


class FakeClient:
    def __init__(self, responses):
        self.models = _Models(responses)


class RaisingClient:
    class _M:
        def generate_content(self, *a, **k):
            raise AssertionError("LLM은 호출되면 안 됨")

    def __init__(self):
        self.models = self._M()
```

`tests/coach/test_coach_schema.py`:
```python
from acting_summary.coach.schema import CoachTurn, CoachReply, CoachSession
from support import SUMMARY


def test_coach_reply_defaults():
    r = CoachReply(action="probe_intent", utterance="q")
    assert r.done is False and r.reason == "" and r.focus_timestamp == ""


def test_coach_session_defaults_and_roundtrip():
    s = CoachSession(session_id="abc", summary=SUMMARY)
    assert s.turns == [] and s.question_count == 0 and s.status == "open"
    s.turns.append(CoachTurn(role="ai", text="hi"))
    assert CoachSession.model_validate(s.model_dump()).turns[0].role == "ai"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `py -m uv run pytest tests/coach/test_coach_schema.py -v`
Expected: FAIL (ModuleNotFoundError: acting_summary.coach)

- [ ] **Step 3: Write minimal implementation**

`src/acting_summary/coach/__init__.py`: (빈 파일)

`src/acting_summary/coach/schema.py`:
```python
from typing import Literal, Optional

from pydantic import BaseModel, Field

from acting_summary.schema import SceneSummary, SubText


class CoachTurn(BaseModel):
    role: Literal["ai", "actor"]
    text: str


class CoachReply(BaseModel):
    action: Literal["probe_intent", "dig_cause", "deflect", "next_problem", "close"]
    utterance: str
    focus_timestamp: str = ""
    done: bool = False
    reason: Literal["", "gap_stated", "limit", "user_ended"] = ""


class CoachSession(BaseModel):
    session_id: str
    summary: SceneSummary
    subtext: Optional[SubText] = None
    turns: list[CoachTurn] = Field(default_factory=list)
    question_count: int = 0
    status: Literal["open", "closed"] = "open"
    close_reason: str = ""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `py -m uv run pytest tests/coach/test_coach_schema.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/acting_summary/coach/__init__.py src/acting_summary/coach/schema.py tests/coach/support.py tests/coach/test_coach_schema.py
git commit -m "feat(coach): 세션·리플라이 스키마 + 테스트 support"
```

---

### Task 2: 인메모리 세션 저장소

**Files:**
- Create: `src/acting_summary/coach/store.py`
- Test: `tests/coach/test_store.py`

**Interfaces:**
- Consumes: `CoachSession`.
- Produces: `InMemorySessionStore` with `create(session)`, `get(session_id) -> CoachSession | None`, `save(session)`.

- [ ] **Step 1: Write the failing test**

`tests/coach/test_store.py`:
```python
from acting_summary.coach.store import InMemorySessionStore
from acting_summary.coach.schema import CoachSession
from support import SUMMARY


def test_create_get_save_roundtrip():
    store = InMemorySessionStore()
    s = CoachSession(session_id="x", summary=SUMMARY)
    store.create(s)
    assert store.get("x") is s
    s.question_count = 3
    store.save(s)
    assert store.get("x").question_count == 3


def test_get_missing_returns_none():
    assert InMemorySessionStore().get("nope") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `py -m uv run pytest tests/coach/test_store.py -v`
Expected: FAIL (ModuleNotFoundError: store)

- [ ] **Step 3: Write minimal implementation**

`src/acting_summary/coach/store.py`:
```python
from acting_summary.coach.schema import CoachSession


class InMemorySessionStore:
    def __init__(self):
        self._sessions: dict[str, CoachSession] = {}

    def create(self, session: CoachSession) -> CoachSession:
        self._sessions[session.session_id] = session
        return session

    def get(self, session_id: str) -> CoachSession | None:
        return self._sessions.get(session_id)

    def save(self, session: CoachSession) -> CoachSession:
        self._sessions[session.session_id] = session
        return session
```

- [ ] **Step 4: Run test to verify it passes**

Run: `py -m uv run pytest tests/coach/test_store.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/acting_summary/coach/store.py tests/coach/test_store.py
git commit -m "feat(coach): 인메모리 세션 저장소"
```

---

### Task 3: 금지어 lexical 가드

**Files:**
- Create: `src/acting_summary/coach/guard.py`
- Test: `tests/coach/test_guard.py`

**Interfaces:**
- Produces: `FORBIDDEN_WORDS: list[str]`, `has_forbidden(text: str) -> bool`.

- [ ] **Step 1: Write the failing test**

`tests/coach/test_guard.py`:
```python
from acting_summary.coach.guard import has_forbidden


def test_flags_forbidden_words():
    assert has_forbidden("연기력이 부족해 보여") is True
    assert has_forbidden("점수는 80점") is True


def test_allows_observation_question():
    assert has_forbidden("[00:12] 그 대사 뒤 1.2초 멈춤 — 왜 이렇게 나왔어?") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `py -m uv run pytest tests/coach/test_guard.py -v`
Expected: FAIL (ModuleNotFoundError: guard)

- [ ] **Step 3: Write minimal implementation**

`src/acting_summary/coach/guard.py`:
```python
FORBIDDEN_WORDS = [
    "점수", "등급", "진정성", "몰입도", "감정 전달력",
    "연기력", "좋다", "나쁘다", "합격", "불합격",
]


def has_forbidden(text: str) -> bool:
    return any(word in text for word in FORBIDDEN_WORDS)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `py -m uv run pytest tests/coach/test_guard.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/acting_summary/coach/guard.py tests/coach/test_guard.py
git commit -m "feat(coach): 금지어 lexical 가드"
```

---

### Task 4: 코칭 프롬프트 빌더

**Files:**
- Create: `src/acting_summary/coach/prompt.py`
- Test: `tests/coach/test_coach_prompt.py`

**Interfaces:**
- Consumes: `CoachSession`, `SceneSummary`, `Anomaly`.
- Produces: `build_prompt(session: CoachSession, actor_text: str | None) -> str`.

- [ ] **Step 1: Write the failing test**

`tests/coach/test_coach_prompt.py`:
```python
from acting_summary.coach.prompt import build_prompt
from acting_summary.coach.schema import CoachSession, CoachTurn
from support import SUMMARY


def test_prompt_includes_anomaly_and_rules():
    s = CoachSession(session_id="x", summary=SUMMARY)
    p = build_prompt(s, None)
    assert "00:12" in p and "1.2초 멈춤" in p      # anomaly material 실림
    assert "왜" in p                                # 캐묻기 지시
    assert "점수" in p                              # 금지 규칙 명시


def test_prompt_includes_history_and_actor_text():
    s = CoachSession(session_id="x", summary=SUMMARY,
                     turns=[CoachTurn(role="ai", text="첫 질문")])
    p = build_prompt(s, "긴장해서 그랬어요")
    assert "첫 질문" in p and "긴장해서 그랬어요" in p
```

- [ ] **Step 2: Run test to verify it fails**

Run: `py -m uv run pytest tests/coach/test_coach_prompt.py -v`
Expected: FAIL (ModuleNotFoundError: prompt)

- [ ] **Step 3: Write minimal implementation**

`src/acting_summary/coach/prompt.py`:
```python
from acting_summary.coach.schema import CoachSession

RULES = """너는 연기 코칭 에이전트다. 목표: 배우가 '의도한 것'과 '실제 화면에 보인 것'의
차이를 스스로 한 줄로 말하게 만드는 것. 아래 관찰 요약을 근거로 대화한다.

행동(action) 하나를 골라 JSON으로만 답한다:
- probe_intent: 가장 큰 문제(impact_on_intent가 큰 anomaly) 하나를 골라 '[시간] 관찰사실 —
  이거 의도한 거야, 아니면 왜 이렇게 나왔어?'로 관찰과 의도를 함께 묻는다. (대화 시작 시)
- dig_cause: 배우 답에 정답을 주지 말고 '그럼 왜 그랬어?/그 직전엔 무슨 생각이었어?'로 한 단계 더 캐묻는다.
- deflect: '제 감정 진짜 같았어요?'처럼 화면으로 잴 수 없는 질문에는 답하지 않고 되돌린다
  ('그건 화면에 어떻게 보이길 원했어?').
- next_problem: 지금 문제에서 더 나올 게 없으면 다음으로 큰 anomaly로 넘어간다.
- close: 배우가 의도와 실제의 차이를 스스로 한 줄로 말했으면 done=true, reason="gap_stated"로 닫는다.

철칙:
- 모든 발화 = '시간 표시 + 관찰한 사실(수치) → 질문 1개'. 그 외 군더더기 없음.
- 금지: 점수·등급·'진정성'/'몰입도'/'연기력' 표현, 동작 지시, '좋다/나쁘다', 정답·처방, 힌트.
- likely_cause는 참고만 하고 배우에게 정답으로 알려주지 않는다.
- utterance는 한국어 반말 한두 문장.
"""


def _anomalies_block(session: CoachSession) -> str:
    lines = []
    for a in session.summary.anomalies:
        lines.append(
            f"- [{a.timestamp}] ({a.dimension}) {a.what} / 왜 이상한지: {a.why_odd}"
            f" / 추정원인: {a.likely_cause} / 의도상 문제: {a.impact_on_intent}"
        )
    return "\n".join(lines) if lines else "(anomaly 없음 — summary/intent_alignment로 가장 두드러진 지점을 골라라)"


def _history_block(session: CoachSession) -> str:
    if not session.turns:
        return "(아직 대화 없음 — 첫 발화를 만들어라)"
    return "\n".join(f"{t.role}: {t.text}" for t in session.turns)


def build_prompt(session: CoachSession, actor_text: str | None) -> str:
    s = session.summary
    latest = f"\n[방금 배우 답변]\n{actor_text}" if actor_text else ""
    return f"""{RULES}

[요약]
{s.summary}

[의도 대비 실제]
{s.intent_alignment}

[이상징후(가장 큰 문제 후보)]
{_anomalies_block(session)}

[지금까지 대화]
{_history_block(session)}{latest}

위 맥락으로 다음 CoachReply(action, utterance, focus_timestamp, done, reason)를 JSON으로만 출력한다."""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `py -m uv run pytest tests/coach/test_coach_prompt.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/acting_summary/coach/prompt.py tests/coach/test_coach_prompt.py
git commit -m "feat(coach): 코칭 프롬프트 빌더"
```

---

### Task 5: 에이전트 코어 — start()

**Files:**
- Create: `src/acting_summary/coach/engine.py`
- Test: `tests/coach/test_engine_start.py`

**Interfaces:**
- Consumes: `CoachSession`, `CoachReply`, `CoachTurn`, `prompt.build_prompt`, `guard.has_forbidden`, `google.genai.types`.
- Produces: `MAX_QUESTIONS`, `END_TOKENS`, `CoachParseError`, `start(session_id, summary, subtext=None, *, client, model, store=None) -> tuple[CoachSession, CoachReply]`. `_generate`/`_parse` internal.

- [ ] **Step 1: Write the failing test**

`tests/coach/test_engine_start.py` (mock client는 `support.py`의 `FakeClient` 사용 — summarizer 테스트와 동일 스타일):
```python
from acting_summary.coach import engine
from acting_summary.coach.schema import CoachReply
from support import SUMMARY, FakeClient, _Resp


def test_start_creates_session_and_first_probe():
    reply = CoachReply(action="probe_intent", utterance="[00:12] 1.2초 멈춤 — 의도한 거야?",
                       focus_timestamp="00:12")
    client = FakeClient([_Resp(parsed=reply)])
    session, out = engine.start("sid", SUMMARY, client=client, model="m")
    assert out.action == "probe_intent"
    assert session.question_count == 1
    assert session.turns[-1].role == "ai" and session.turns[-1].text == out.utterance
    # 프롬프트에 anomaly material이 실려 나갔는지
    sent_prompt = client.models.calls[0][1][0]
    assert "1.2초 멈춤" in sent_prompt
```

- [ ] **Step 2: Run test to verify it fails**

Run: `py -m uv run pytest tests/coach/test_engine_start.py -v`
Expected: FAIL (ModuleNotFoundError: engine)

- [ ] **Step 3: Write minimal implementation**

`src/acting_summary/coach/engine.py`:
```python
from google.genai import types

from acting_summary.coach import prompt as prompt_mod
from acting_summary.coach.guard import has_forbidden
from acting_summary.coach.schema import CoachReply, CoachSession, CoachTurn

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


def start(session_id, summary, subtext=None, *, client, model, store=None):
    session = CoachSession(session_id=session_id, summary=summary, subtext=subtext)
    reply = _generate(session, None, client=client, model=model)
    session.turns.append(CoachTurn(role="ai", text=reply.utterance))
    session.question_count += 1
    if reply.done:
        session.status = "closed"
        session.close_reason = reply.reason
    if store is not None:
        store.create(session)
    return session, reply
```

- [ ] **Step 4: Run test to verify it passes**

Run: `py -m uv run pytest tests/coach/test_engine_start.py -v`
Expected: PASS (1 passed)

- [ ] **Step 5: Commit**

```bash
git add src/acting_summary/coach/engine.py tests/coach/test_engine_start.py
git commit -m "feat(coach): 에이전트 start() — 첫 관찰+의도 질문"
```

---

### Task 6: 에이전트 코어 — reply() (코드 가드 + LLM 경로)

**Files:**
- Modify: `src/acting_summary/coach/engine.py`
- Test: `tests/coach/test_engine_reply.py`

**Interfaces:**
- Consumes: Task 5의 `_generate`, `MAX_QUESTIONS`, `END_TOKENS`.
- Produces: `reply(session: CoachSession, actor_text: str, *, client, model) -> CoachReply`.

- [ ] **Step 1: Write the failing test**

`tests/coach/test_engine_reply.py`:
```python
from acting_summary.coach import engine
from acting_summary.coach.schema import CoachReply, CoachSession, CoachTurn
from support import SUMMARY, FakeClient, RaisingClient, _Resp


def _open_session():
    return CoachSession(session_id="x", summary=SUMMARY, question_count=1,
                        turns=[CoachTurn(role="ai", text="첫 질문")])


def test_reply_digs_cause():
    reply = CoachReply(action="dig_cause", utterance="그럼 그 직전엔 무슨 생각이었어?")
    out = engine.reply(_open_session(), "긴장했어요", client=FakeClient([_Resp(parsed=reply)]), model="m")
    assert out.action == "dig_cause" and out.done is False


def test_reply_gap_stated_closes():
    reply = CoachReply(action="close", utterance="차이를 잘 짚었어.", done=True, reason="gap_stated")
    s = _open_session()
    out = engine.reply(s, "긴장이 목소리를 작게 만든 것 같아요", client=FakeClient([_Resp(parsed=reply)]), model="m")
    assert out.reason == "gap_stated" and s.status == "closed"


def test_reply_limit_guard_no_llm_call():
    s = _open_session(); s.question_count = engine.MAX_QUESTIONS
    out = engine.reply(s, "음...", client=RaisingClient(), model="m")
    assert out.action == "close" and out.reason == "limit" and s.status == "closed"


def test_reply_user_ended_guard_no_llm_call():
    out = engine.reply(_open_session(), "그만할래", client=RaisingClient(), model="m")
    assert out.action == "close" and out.reason == "user_ended"


def test_reply_on_closed_session_returns_closed():
    s = _open_session(); s.status = "closed"; s.close_reason = "gap_stated"
    out = engine.reply(s, "더 얘기", client=RaisingClient(), model="m")
    assert out.done is True and out.reason == "gap_stated"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `py -m uv run pytest tests/coach/test_engine_reply.py -v`
Expected: FAIL (AttributeError: module has no attribute 'reply')

- [ ] **Step 3: Write minimal implementation** — `engine.py` 끝에 추가:
```python
def _close(session, reply):
    session.turns.append(CoachTurn(role="ai", text=reply.utterance))
    session.status = "closed"
    session.close_reason = reply.reason


def reply(session, actor_text, *, client, model) -> CoachReply:
    if session.status == "closed":
        return CoachReply(action="close", utterance="", done=True,
                          reason=session.close_reason or "user_ended")

    session.turns.append(CoachTurn(role="actor", text=actor_text))

    if any(tok in actor_text for tok in END_TOKENS):
        r = CoachReply(action="close", utterance="여기까지 하자. 오늘 스스로 짚은 걸 기억해.",
                       done=True, reason="user_ended")
        _close(session, r)
        return r

    if session.question_count >= MAX_QUESTIONS:
        r = CoachReply(action="close",
                       utterance="질문은 여기까지야. 오늘 짚은 차이를 한 줄로 남겨봐.",
                       done=True, reason="limit")
        _close(session, r)
        return r

    out = _generate(session, actor_text, client=client, model=model)
    session.turns.append(CoachTurn(role="ai", text=out.utterance))
    if out.action != "close":
        session.question_count += 1
    if out.done:
        session.status = "closed"
        session.close_reason = out.reason
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `py -m uv run pytest tests/coach/test_engine_reply.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add src/acting_summary/coach/engine.py tests/coach/test_engine_reply.py
git commit -m "feat(coach): 에이전트 reply() — 캐묻기/종료 가드"
```

---

### Task 7: FastAPI 라우트 /coach/start, /coach/reply

**Files:**
- Modify: `src/acting_summary/app.py`
- Test: `tests/coach/test_coach_app.py`

**Interfaces:**
- Consumes: `engine.start`, `engine.reply`, `InMemorySessionStore`, `SceneSummary`, `SubText`.
- Produces: `POST /coach/start` (body `{summary, subtext?}` → `{session_id, action, utterance, focus_timestamp, done, reason}`), `POST /coach/reply` (body `{session_id, text}` → 같은 필드). 없는 세션 → 404.

- [ ] **Step 1: Write the failing test**

`tests/coach/test_coach_app.py`:
```python
from fastapi.testclient import TestClient

from acting_summary.app import create_app
from acting_summary.config import Settings
from acting_summary.coach.schema import CoachReply
from support import SUMMARY, FakeClient, _Resp


def _client(replies):
    responses = [_Resp(parsed=r) for r in replies]
    app = create_app(client=FakeClient(responses), settings=Settings(api_key="k", model="m"))
    return TestClient(app)


def test_start_then_reply_flow():
    c = _client([
        CoachReply(action="probe_intent", utterance="[00:12] 1.2초 멈춤 — 의도한 거야?", focus_timestamp="00:12"),
        CoachReply(action="dig_cause", utterance="왜 그랬어?"),
    ])
    r1 = c.post("/coach/start", json={"summary": SUMMARY.model_dump()})
    assert r1.status_code == 200
    sid = r1.json()["session_id"]
    assert r1.json()["action"] == "probe_intent"
    r2 = c.post("/coach/reply", json={"session_id": sid, "text": "긴장했어요"})
    assert r2.status_code == 200 and r2.json()["action"] == "dig_cause"


def test_reply_unknown_session_404():
    c = _client([])
    r = c.post("/coach/reply", json={"session_id": "nope", "text": "hi"})
    assert r.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `py -m uv run pytest tests/coach/test_coach_app.py -v`
Expected: FAIL (404 on /coach/start → route 없음)

- [ ] **Step 3: Write minimal implementation** — `app.py` 상단 import에 추가:
```python
import uuid

from pydantic import BaseModel

from acting_summary.coach import engine as coach_engine
from acting_summary.coach.schema import CoachSession
from acting_summary.coach.store import InMemorySessionStore
from acting_summary.schema import SceneSummary
```
`create_app` 안, `app = FastAPI(...)` 다음에 store와 요청모델·라우트 추가:
```python
    store = InMemorySessionStore()

    class CoachStartReq(BaseModel):
        summary: SceneSummary
        subtext: SubText | None = None

    class CoachReplyReq(BaseModel):
        session_id: str
        text: str

    def _payload(session_id, reply):
        return {"session_id": session_id, "action": reply.action,
                "utterance": reply.utterance, "focus_timestamp": reply.focus_timestamp,
                "done": reply.done, "reason": reply.reason}

    @app.post("/coach/start")
    def coach_start(req: CoachStartReq):
        sid = uuid.uuid4().hex
        session, reply = coach_engine.start(
            sid, req.summary, req.subtext, client=client, model=settings.model, store=store
        )
        return _payload(sid, reply)

    @app.post("/coach/reply")
    def coach_reply(req: CoachReplyReq):
        session = store.get(req.session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="session not found")
        reply = coach_engine.reply(session, req.text, client=client, model=settings.model)
        store.save(session)
        return _payload(req.session_id, reply)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `py -m uv run pytest tests/coach/test_coach_app.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Full suite + Commit**

```bash
py -m uv run pytest -q
git add src/acting_summary/app.py tests/coach/test_coach_app.py
git commit -m "feat(coach): FastAPI /coach/start·/coach/reply"
```
Expected: 전체 통과(기존 + coach). 실제 Gemini 통합테스트는 `-m gemini` opt-in이라 기본 미실행.

---

### Task 8: Gradio 코치 챗 UI (수동 확인)

**Files:**
- Create: `coach_app.py` (프로젝트 루트, 기존 `gradio_app.py`와 동급)

**Interfaces:**
- Consumes: `create_app`? 아니오 — 엔진을 직접 쓴다: `engine.start`, `engine.reply`, `InMemorySessionStore`, `SceneSummary.model_validate_json`, `load_settings`, `genai.Client`.
- Produces: 요약 JSON 파일 업로드 → 대화 시작 → 챗 입력. (유닛테스트 없음, 수동 스모크. Gradio UI는 기존 관례대로 수동 확인.)

- [ ] **Step 1: Implement** `coach_app.py`:
```python
import gradio as gr
from google import genai

from acting_summary.config import load_settings
from acting_summary.coach import engine
from acting_summary.coach.store import InMemorySessionStore
from acting_summary.schema import SceneSummary

settings = load_settings()
client = genai.Client(api_key=settings.api_key)
store = InMemorySessionStore()


def start_chat(summary_file):
    summary = SceneSummary.model_validate_json(open(summary_file, encoding="utf-8").read())
    sid = "ui"
    _, reply = engine.start(sid, summary, client=client, model=settings.model, store=store)
    return sid, [(None, reply.utterance)]


def respond(sid, history, message):
    reply = engine.reply(store.get(sid), message, client=client, model=settings.model)
    store.save(store.get(sid))
    history = history + [(message, reply.utterance)]
    return history, ""


with gr.Blocks() as demo:
    sid = gr.State("")
    file = gr.File(label="요약 JSON", file_types=[".json"])
    chat = gr.Chatbot()
    msg = gr.Textbox(label="답변 (타이핑)")
    file.upload(start_chat, file, [sid, chat])
    msg.submit(respond, [sid, chat, msg], [chat, msg])

if __name__ == "__main__":
    demo.launch()
```

- [ ] **Step 2: Manual smoke (사용자 승인 시 실제 Gemini 호출)**

먼저 요약 JSON 하나 준비(기존 `/summarize` 결과 또는 손으로 만든 `SceneSummary` JSON).
Run: `py -m uv run python coach_app.py` → 브라우저에서 JSON 업로드 → 첫 질문 확인 → 타이핑 답변 몇 번.
Expected: 발화가 `[시간] 관찰 → 질문` 형태, 점수·처방 없음, "왜 그랬어?"로 캐묻고, 차이 한 줄 말하면 종료.
**주의**: 이 단계는 실제 Gemini를 호출하므로 사용자 승인 후에만 실행.

- [ ] **Step 3: Commit**

```bash
git add coach_app.py
git commit -m "feat(coach): Gradio 코치 챗 UI (수동 확인용)"
```

---

## 완료 후

- `PROGRESS.md`에 coach 섹션 추가(무엇을·다음 켰을 때 실행법·gotcha).
- 실제 Gemini 대화 검증은 사용자 승인 후 Task 8 스모크로.
