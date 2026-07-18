# coach 대화형 챗봇 — 설계 (spec)

작성일 2026-07-03 · 상태: 승인됨(구현 대기)

## 한 줄 요약

acting-summary가 만든 요약 JSON(`SceneSummary`)을 입력으로 받아, **가장 큰 문제 하나**를
관찰 사실 + 의도로 물어보고 "왜 그랬어?"로 캐물어 배우가 스스로 의도와 실제의 차이를
한 줄로 말하게 하는 **코칭 에이전트**. acting-summary 패키지에 `coach` 서브모듈로 확장.

## 에이전트로서의 성격

단순 요청/응답 챗봇이 아니라 **목표를 가진 에이전트**다.
- **목표**: 배우가 의도 vs 실제의 차이를 스스로 한 줄로 말하게 한다.
- **상태**: 어떤 문제(anomaly)를 쫓는 중인지(focus), 다룬 문제, 질문 수, 종료 여부.
- **매 턴 행동 결정**: 관찰+의도 던지기 / 원인 캐묻기 / 잴 수 없는 질문 되돌리기 /
  현재 문제 소진 시 다음 큰 문제로 이동 / 종료. 이 결정을 구조화 출력에 노출해 관찰·테스트한다.
- **가장 큰 문제 선택**: `anomalies`를 `impact_on_intent` 기준으로 에이전트가 정렬·선택.

근거 Confluence: [coach 시스템 구조 설계](https://hiws99.atlassian.net/wiki/spaces/TSSNN/pages/26116098) ·
[질문형 기능명세 v0.3](https://hiws99.atlassian.net/wiki/spaces/TSSNN/pages/27557889) ·
[유저 시나리오](https://hiws99.atlassian.net/wiki/spaces/TSSNN/pages/27590657)

## 확정된 결정

1. **충실도**: Confluence Q4 핵심 플로우 기반. 단 **힌트 없음**. 별도 관찰확인(맞아/아냐) 단계
   없이 첫 발화에서 **관찰 사실 + 의도 질문을 결합**한다.
2. **위치/저장**: acting-summary 패키지 확장. 세션은 **인메모리**(dict).
3. **엔진**: Gemini(`gemini-2.5-flash`). 질문 생성은 LLM. **실제 호출은 사용자 승인 후에만**,
   빌드·테스트는 전부 주입식 client mock.
4. **질문 상한**: 10턴.
5. **입력**: 이미 만들어진 요약 **JSON 파일**을 받아 시작(영상→요약은 기존 흐름 그대로).

## 대화 규칙 (가드레일 — 프롬프트에 내장)

- 모든 AI 발화 = `시간 표시 + 관찰한 사실(수치) → 질문 1개`. 그 외 없음.
- **금지**: 점수·등급·"진정성"/"몰입도"/"연기력" 표현, 동작 지시("입꼬리 빼라"), "좋다/나쁘다",
  정답·처방, 근거 없는 질문, **힌트**.
- 잴 수 없는 질문("제 감정 진짜 같았어요?")엔 답하지 않고 되돌린다("그건 화면에 어떻게 보이길 원했어?").
- 배우 답변에 대해 정답을 주지 않고 **"왜 그랬어?" 한 단계 더 캐묻는다**. 이때 배우의 **의도**를 함께 묻는다.
- 종료 전까지 배우가 의도와 실제의 차이를 한 줄로 말하도록 이끈다.

## 종료 조건 (3가지 중 하나)

1. 배우가 의도 vs 실제의 차이를 한 줄로 스스로 말함 → LLM이 `done=true, reason="gap_stated"`.
2. 질문 상한 10턴 도달 → `done=true, reason="limit"`.
3. 배우가 종료 버튼(또는 종료 입력) → `done=true, reason="user_ended"`.

## 모듈 구조

기존 `acting_summary` 패키지에 `coach/` 서브패키지 추가. 기존 `config`(Gemini client/model) 재사용.

```
src/acting_summary/coach/
  __init__.py
  schema.py     # CoachTurn, CoachSession, CoachReply
  prompt.py     # build_system(summary, subtext?) + 대화 이력 → 프롬프트
  engine.py     # start(summary) / reply(session, actor_text) -> CoachReply
  store.py      # 인메모리 세션 저장 (dict: session_id -> CoachSession)
```

`app.py`에 라우트 2개 추가, Gradio 챗 UI는 `coach_app.py`(또는 기존 gradio_app 확장).

입력 요약은 **기존 `SceneSummary` 재사용**(현재 리팩터본):
`observation: Observation` + `summary` + `intent_alignment` + `anomalies: list[Anomaly]`,
`Anomaly = {timestamp, dimension, what, why_odd, likely_cause, impact_on_intent}`.
코치는 `anomalies`를 후보 문제로, `impact_on_intent`로 크기 순위, `likely_cause`를
"왜 그랬어?" 캐묻기의 참고로 쓴다(단, likely_cause를 배우에게 정답으로 알려주지 않는다).

### schema.py

```python
class CoachTurn(BaseModel):
    role: Literal["ai", "actor"]
    text: str

class CoachReply(BaseModel):          # 에이전트 결정 = LLM 구조화 출력(response_schema)
    action: Literal["probe_intent", "dig_cause", "deflect", "next_problem", "close"]
    utterance: str                    # 배우에게 보일 발화(관찰+질문). close면 마무리 한마디
    focus_timestamp: str              # 지금 쫓는 anomaly 시점(관찰용, 없으면 "")
    done: bool
    reason: Literal["", "gap_stated", "limit", "user_ended"]

class CoachSession(BaseModel):
    session_id: str
    summary: SceneSummary             # 기존 스키마 재사용
    subtext: SubText | None
    turns: list[CoachTurn]
    question_count: int               # AI가 던진 질문 수
    status: Literal["open", "closed"]
    close_reason: str
```

### engine.py (에이전트 코어)

- `start(session_id, summary, subtext=None, *, client, model) -> (CoachSession, CoachReply)`
  - 에이전트가 `summary.anomalies`를 `impact_on_intent` 기준으로 보고 **가장 큰 문제 하나**를 골라
    첫 발화(`action="probe_intent"`) = `[timestamp] {what} — 이거 의도한 거야, 아니면 왜 이렇게 나왔어?`.
  - anomalies가 비면 summary/intent_alignment로 가장 두드러진 지점을 골라 질문(빈 발화 금지).
- `reply(session, actor_text, *, client, model) -> CoachReply`
  - **코드 가드(LLM 앞단)**: 종료 입력("그만" 등) → `close, done, reason="user_ended"`;
    `question_count >= 10` → `close, done, reason="limit"`.
  - 그 외 프롬프트에 요약+이력 실어 LLM 1회 호출 → 에이전트가 `action` 결정:
    배우가 차이 한 줄 말함 → `close, done, reason="gap_stated"`; 잴 수 없는 질문 →
    `deflect`; 답변 위에 더 캐물 여지 → `dig_cause`; 현재 문제 소진 → `next_problem`.
- **client 주입식**(summarizer와 동일 패턴) → 전 계층 mock 가능. `response_schema=CoachReply`.
  LLM 응답 파싱 실패 시 summarizer처럼 1회 재시도 후 `SummaryParseError` 계열로 502.

### store.py

- `InMemorySessionStore`: `create(session)`, `get(session_id)`, `save(session)`. 단순 dict.

### app.py 라우트

- `POST /coach/start` — body: 요약 JSON(`SceneSummary`) + 선택 subtext → 세션 생성, 첫 발화 반환.
  `{session_id, action, utterance, focus_timestamp, done, reason}`.
- `POST /coach/reply` — body: `{session_id, text}` → 다음 발화/종료 반환(같은 CoachReply 필드).

## 데이터 흐름

```
요약 JSON 파일 → /coach/start → CoachSession(인메모리) + 첫 질문(관찰+의도)
배우 타이핑 → /coach/reply → engine.reply → (LLM) 다음 "왜?" 질문 or 종료
반복 → 종료(gap_stated | limit(10) | user_ended)
```

## 에러 처리

- 요약 JSON 파싱 실패 → 400.
- 없는 session_id → 404.
- 이미 closed 세션에 reply → 409(또는 마지막 상태 반환).
- LLM 응답 파싱 실패 → summarizer처럼 1회 재시도 후 502.

## 테스트 (TDD, 전부 mock client)

1. `start`: 첫 발화 `action="probe_intent"`, anomaly의 timestamp/what 근거 + 의도 질문.
2. `start`: anomalies 비면 summary/intent 기반 질문 생성(빈 utterance 아님).
3. `reply`: 배우 답변에 정답 없이 `action="dig_cause"`로 "왜?" 후속 질문 생성.
4. `reply`: 배우가 차이 한 줄 말함 → `action="close", done, reason="gap_stated"`.
5. `reply`: 질문 상한 도달 → 코드 가드로 `action="close", done, reason="limit"`(LLM 호출 안 함).
6. `reply`: 종료 입력 → 코드 가드로 `action="close", done, reason="user_ended"`(LLM 호출 안 함).
7. `reply`: 잴 수 없는 질문 입력 → `action="deflect"`(되돌리는 발화).
8. 가드레일: 생성 발화에 금지어(점수/등급/진정성 등) 미포함(lexical 체크 헬퍼).
9. store: create/get/save 라운드트립, 없는 id → None.

실제 Gemini 통합테스트는 `-m gemini` opt-in(기존 관례), 사용자 승인 후에만.

## 범위 밖 (YAGNI)

- 관찰확인(맞아/아냐) 별도 단계, 힌트, 선택지형 유도.
- 전/후 비교(Q5~Q7), 재촬영, 음성 입력.
- DB 영속화(Confluence는 DB 정본이지만 이번 프로토타입은 인메모리).
- LLM 검사기(별도 재검증 에이전트) — 가드레일은 프롬프트 + lexical 체크로만.
