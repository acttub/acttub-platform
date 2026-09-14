# 영상만 올리는 코칭: 대화와 촬영 노트 (SOMA-531)

2026-09-14 합의. 1층 영상 기록은 유지한다. 2층은 직전 답변에 이어 현재 연기를 이해하고,
3층이 처음으로 다음 촬영 제안을 만든다. 결과 화면은 **짧은 요약 → 촬영 아이템 하나 → 응원**이다.
프롬프트의 실행 정본은 아래 파일이며 모델에게 실제 JSON Schema를 함께 제공한다.

| 대상 | 실행 파일 |
|---|---|
| 2층 프롬프트 | `apps/api/src/main/resources/coaching/coach-prompt.txt` |
| 2층 응답·2→3 전달 스키마 | 같은 디렉터리 `three-layer-contracts.schema.json`의 `layer2_dialogue_turn`, `coach_handoff_v2` |
| 3층 프롬프트 | 같은 디렉터리 `note-prompt.txt` |
| 3층 생성 스키마 | `layer3_note` |
| 이전 handoff의 노트 생성 | `note-legacy-prompt.txt`, 기존 `layer3_copy` |

## 첫 질문 개정

실행 정본 `coach/coach-opening-policy.txt`를 새 구조화 코치와 기존 영상 우선 코치에 함께 넣는다.
기존 `coach/coach-video-first-prompt.txt`의 질문 없는 관찰·해석 첫 응답 지시도 제거한다.

- “이 답을 알면 영상의 무엇을 더 정확하게 볼 수 있는가?”를 판단하고 질문을 선택한다.
- 전체 대사·흐름, 배우가 이미 적은 방향, 장면에서 중요한 발화·반복·변화를 함께 본다.
  눈에 띄는 고개 움직임·멈춤이나 confidence만으로 첫 주제를 정하지 않는다.
- 배우가 자기 말로 답할 수 있고 답에 따라 살펴볼 기준이 달라지는 미확인 하나를 묻는다.
  이미 받은 목표를 되묻거나 AI가 만든 해석에 동의하게 하지 않는다.
- 새 경로의 첫 `continue`는 질문 하나, 실제 대사/관찰 참조, 해당 참조를 포함하는 `context_update.focus`를 요구한다.
  `controls.min_questions`는 현재 전달된 영상 근거에 따라 갱신되며 조회 후에도 적용된다.
- 대사 인용의 물음표는 질문 개수에 넣지 않는다. 인용만 물음표이고 배우에게 묻는 말은 없으면 거부한다.
- 모델 응답을 반복해 검증해도 실패하면 그 해석을 보여주지 않는다. 영상 근거는 있지만 첫 질문 생성이
  실패한 경우 실패 사실을 알리고 배우가 원한 모습을 묻는 단순 대체 질문을 쓴다. 자료 자체가 없으면 의도를 강제로 묻지 않는다.
- 서식·질문 수·근거 참조 검증은 의미적 관련성이나 한국어 자연스러움을 증명하지 않는다.
  영상별 실제 모델 대화 검토에서 질문의 중요성과 다음 답변의 연결을 별도로 확인해야 한다.

사용자가 첫 질문에 답하기 전에 종료해도 현재 구조는 노트를 만든다. 이때 첫 주제만 남고 방향이
확인되지 않았다면 `practice=null`, `attempts=[]`이며 촬영 제안은 만들지 않는다. 턴 수만으로
코칭의 충분함이나 개선을 판정하지 않는다. 이미 생성된 대화·노트의 원문을 소급해서 바꾸지 않는다.

## 2층 입력과 응답

기존 request/session ID, actor_context, record_view, state_sources, recent_messages, controls를 유지한다.
`last_exchange`가 직전 코치 발화와 이번 사용자 답변을 함께 제공한다. 첫 사용자 발화는 만들지 않는다.
`coaching_state`는 revision, context, response_style, 선택적으로 last_reply만 모델에 보여준다.
예전 상태에 저장된 proposals/attempts는 DB에 보존하되 새 대화의 과제로 사용하지 않는다.

```json
{
  "action": "respond",
  "base_state_revision": 2,
  "message": "상대가 대답하기를 기다리고 싶었군요. 그때 상대는 어떤 반응을 하고 있었어요?",
  "reply_link": {
    "user_message_id": "turn:session:4",
    "actor_quote": "상대의 대답을 기다리고 싶었어요",
    "move": "clarify",
    "evidence_refs": []
  },
  "context_update": null,
  "style_update": null,
  "flow": "continue"
}
```

`context_update=null`은 유지다. 객체를 주면 direction/scene_context/focus/reading/open_points를 모두 준다.
direction과 장면 설정은 배우 원문 인용 및 actor 출처가 필요하다. reading은 null이다.
직전 답변 인용은 해당 메시지에 실제로 있어야 한다. 예전 답변 ID로 다음 질문을 만드는 응답은 거부한다.
move는 open/clarify/explain/correct/acknowledge/close이며 질문 횟수·성격 유형·내부 추론을 뜻하지 않는다.
이 필드는 대화 연결을 추적하는 근거이지 의미적 관련성을 자동 증명하지는 않는다.

`proposal_changes`, `attempt_changes`는 새 출력에서 허용하지 않는다. 재연·촬영·변경 과제를 중간에
시키지 않는다. 대표적인 과제 문구, 추상적 심리 표현, 직전 발화 완전 반복도 검증 단계에서 거부한다.
금지 표현 검사는 보조 장치다. 한국어 자연스러움과 질문의 실제 관련성은 실대화 검토가 필요하다.

`lookup`은 기존 형식 그대로다. 저장된 텍스트를 최대 두 번 조회할 수 있고 원본 영상을 다시 분석하지 않는다.
기본 120자·2문장·질문 최대 하나, 간결 모드 80자·1문장, 요청한 상세 설명은 300자·4문장이다.
최대 코치 응답 10회이며 충분하면 먼저 끝낸다. 동의·연습 실행을 종료 조건으로 요구하지 않는다.

## 2→3 전달

서버가 종료 직후 생성한다. 모델에게 별도 장문의 handoff 요약을 만들게 하지 않는다.

```json
{
  "schema_version": "acttub.coach_handoff.v2",
  "session_id": "session",
  "state_revision": 3,
  "end_reason": "actor_finished",
  "record_ref": {"record_id": "record", "version": 1, "duration_ms": 8000},
  "context": {
    "direction": {"text": "상대의 대답을 기다리고 싶었어요", "origin": "actor_stated", "source_refs": ["m1"]},
    "scene_context": {"situation": null, "character_goal": null, "partner_action": null},
    "focus": {"label": "대사가 끝난 뒤 시선", "utterance_ref": null, "evidence_refs": ["e1"]},
    "reading": null,
    "open_points": []
  },
  "conversation": [
    {"id": "m1", "role": "actor", "text": "상대의 대답을 기다리고 싶었어요"},
    {"id": "c1", "role": "ai", "text": "지금까지 이야기한 내용으로 정리할게요."}
  ],
  "source_catalog": [
    {"id": "m1", "kind": "actor_message", "text": "상대의 대답을 기다리고 싶었어요", "record_id": null, "record_version": null, "start_ms": null, "end_ms": null},
    {"id": "c1", "kind": "coach_message", "text": "지금까지 이야기한 내용으로 정리할게요.", "record_id": null, "record_version": null, "start_ms": null, "end_ms": null},
    {"id": "e1", "kind": "video_observation", "text": "대사가 끝난 뒤 시선이 아래로 내려간다.", "record_id": "record", "record_version": 1, "start_ms": 6000, "end_ms": 7000}
  ]
}
```

위 내용은 가상 예시다. 실제 전달에는 현재 대화 원문 전체와 사용한 근거·조회한 한계를 담는다.
배우의 최종 정정도 대화와 출처 목록에 포함한다. 코치 메시지를 배우 의도의 증거로 바꾸지 않는다.
과제·선택·실행 이력을 새로 생성해 전달하지 않는다.

## 3층 입력과 모델 출력

입력은 `{coach_handoff: 위 객체, controls: {can_propose: boolean, max_next_takes: 1}}`이다.
현재 배우 방향과 함께 논의한 실제 관찰이 있어야 can_propose=true다. 모름만 남았거나,
방향/관찰이 부족하거나, 코치 생성 실패로 끝났으면 촬영 과제를 억지로 만들지 않는다.

```json
{
  "summary": [
    {"source_ref": "m1", "quote": "상대의 대답을 기다리고 싶었어요"},
    {"source_ref": "e1", "quote": "대사가 끝난 뒤 시선이 아래로 내려간다."}
  ],
  "next_take": {
    "instruction": "대사가 끝난 뒤에도 상대의 반응을 기다리는 동안 시선을 그대로 두고 찍어보세요.",
    "comparison": "같은 대목에서 시선이 내려가는 시점을 비교해보세요.",
    "basis_refs": ["m1", "e1"]
  }
}
```

- summary는 최대 두 개, 각각 원문 50자 이내다. 배우의 현재 발화 한 부분과 현재 관찰 한 부분을
  선택하며 서버가 짧은 요약으로 연결한다. 관련 출처 ID만 붙인 새 해석을 요약에 섞지 못한다.
- next_take는 **단일 객체 또는 null**이다. 지시 120자, 비교 기준 100자 이내이며 현재 방향의 배우
  출처와 현재 초점의 실제 관찰을 함께 참조해야 한다. 비교 기준은 저장하되 기본 화면에 추가 항목으로 펼치지 않는다.
- 생성·검증 실패는 한 번 재시도하고, 실패가 계속되면 확인된 관찰만 남긴다. 생성 실패는 계측한다.
- 응원은 모델 출력이 아니라 웹·앱의 고정 문구다: “오늘 촬영도 수고했어요. 다음 촬영도 응원할게요.”
- 출처 검증은 처방의 효과를 증명하지 않는다. 실제 모델의 관련성·말투·제안 적절성은 별도 검수한다.

## 저장·공개 응답·화면

저장 정본은 기존 `acttub.practice_note.v1`을 유지한다. 새 필드나 DB 컬럼을 추가할 필요가 없다.
새 제안은 항상 `practice.selection=proposed`, `selection_refs=[]`, `attempts=[]`다.
3층 제안 문장은 별도 coach_message 출처로 남기고 실제 관찰과 혼동하지 않는다.

| 내용 | 기존 공개 필드 | 화면 |
|---|---|---|
| 짧은 대화 요약 | `summary` | 이번 대화 요약 |
| 다음 촬영 제안 하나 | `practice.instruction` | 다음 촬영에서 해볼 것 |
| 근거와 비교 기준 | `evidence`, `practice.comparison` | 데이터 보존, 기본 화면에서는 생략 |
| 응원 | UI 고정 문구 | 제안 아래 작은 본문 |

제안이 없으면 “이번에는 촬영 아이템을 정하지 않았어요.”라고 표시한다.
기존 공개 필드와 OpenAPI 모양은 줄이거나 바꾸지 않는다. 원문 대화·비공개 출처 목록은 공개하지 않는다.
웹 `PracticeNoteCards`, 앱 `PracticeNoteBody`(완료 및 지난 기록 화면 공용)에 같은 배치를 적용한다.
기존 색상·서체·구분선·버튼·화면 이동을 사용한다.

## 적용 범위와 호환

- 기존 `three_layers_v1` 경험의 다음 코치 호출부터 v2 내부 응답을 사용한다. 원래의 1층 기록은 그대로 쓴다.
- 이미 끝난 v1 handoff의 재생성은 이전 편집 프롬프트를 사용하고 저장된 노트를 다시 생성하지 않는다.
- 신규 경험 선택의 서버 플래그·클라이언트 헤더·빈 입력 조건은 기존 규칙대로다. 이 변경 자체는 플래그를 켜지 않는다.
- 내부 handoff v2는 구버전 API가 생성할 수 없으므로 코드 롤백 때 열린 v2 세션/미완료 노트 작업을
  확인한다. 기존 저장 노트와 공개 응답은 구형 클라이언트에서도 같은 v1 형식이다.
- DB·SQL·마이그레이션 및 1층 추출 프롬프트는 바꾸지 않는다.

## 검증 경계

실행 테스트는 직전 답변 연결, 잘못된 인용·출처, 중간 과제 거부, 짧은 답·정정·종료,
3층 첫 제안 생성과 선택/실행 불변, 실패 폴백, 공개 응답의 비공개 필드 제외, 웹·앱의 세 부분 배치를 확인한다.
실모델에 대해 “ㅁㄹ”, “그 말이 아니야”, “무슨 뜻이야”, “그만”, 지시문 탈취 요청을 이어 보내며
답변 의미와 제안 적절성을 별도로 확인해야 한다. 테스트 스텁 통과는 실제 코칭 품질 검증과 다르다.
