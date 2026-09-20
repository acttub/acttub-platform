# 2층: Luna 분류와 코드 기반 프롬프트 선택

## 목적과 적용 범위

`three_layers_v1` 세션의 시작·후속 응답에 적용한다. 기존 legacy 세션의 공개 계약은 유지한다.
하나의 생성 프롬프트가 대화 분류와 코칭을 동시에 결정하던 경로를 분리한다.

1. **분류**: Luna가 영상 기록·이전 대화·현재 발화를 받아 route 하나를 반환한다.
2. **생성**: Java의 enum/switch가 공통 지침 + 선택한 분류 지침 하나 + 저장 형식을 조합한다.
3. **문장 다듬기**: 생성된 message만 편집한다. 영상·대화·상태 갱신 권한을 주지 않는다.

별도의 LLM 가드레일 검토나 ML 분류기를 호출하지 않는다. 종료 요청·턴 한도는 코드가 먼저 처리하며, 종료할 때에는 분류를 생략한다.

## 네 가지 분류

| route | 생성 목적 |
|---|---|
| understand_scene | 장면의 해석을 구체화할 단서를 제공한다 |
| assess_performance | 영상에서 어떻게 전달되는지 관찰에 근거해 설명한다 |
| design_performance | 장면의 목적을 실행 가능한 선택으로 바꾼다 |
| adjust_performance | 실제 시도와 보고된 변화를 반영해 다음 선택을 조정한다 |

현재 명시적 요청이 우선한다. 실제 시도 후 영상 평가를 요청하면 평가이고, 시도 결과의 어려움을 조정하려 하면 조정이다.
동의·실행 의사·해석 정정만으로 실제 연습했다고 판단하지 않는다.

## 입력과 출력

분류 입력은 `video_record`, `conversation_history`, `user_message`, `actor_context`다.
영상 파일·다운로드 주소가 아니라 기존 1층의 텍스트 기록만 사용한다. 첫 발화는 null이며 가짜 배우 메시지를 만들지 않는다.

분류 출력:

```json
{"route":"understand_scene"}
```

생성에는 같은 영상 기록·원문 대화·현재 발화와 기존 맥락, 허용 근거 ID, 길이 제한을 전달한다.
Luna의 판단 이유나 다른 세 분류의 지침은 전달하지 않는다.

생성 출력:

```json
{"message":"배우에게 보여줄 응답", "context_update":null, "evidence_refs":[]}
```

`context_update`는 기존 dialogue_context 스키마를 유지한다. 배우의 실제 원문과 영상 근거를 저장하며,
코치가 제시한 해석을 배우의 목표·실행 결과로 기록하지 않는다. revision, reply_link, flow는 코드가 조립한다.

다듬기 입력/출력:

```json
{"message":"초안", "max_message_chars":120}
```

```json
{"message":"다듬은 문장"}
```

다듬은 최종 문장을 대화·출처·3층 handoff에 동일하게 저장한다. 인용·숫자·질문 수 변경이나 형식 위반,
편집 호출 실패 시 검증된 원문 초안을 유지한다. 이러한 검사는 의미 보존을 완전히 보장하지 않으며 실모델 대화 검토가 필요하다.
`fluent-korean` 설치본은 작업 환경에서 확인하지 못했다. 현재 polish.txt는 이 프로젝트의 자체 편집 지침이며 해당 스킬의 복제본이 아니다.

## 실패 처리와 호출 수

정상 대화는 분류 1회 + 생성 1회 + 다듬기 1회다. 첫 대화도 동일하다.
분류 결과가 유효하지 않거나 호출이 실패하면 임의의 분류로 대체하지 않고 기존 재시도 가능한 오류 계약을 따른다.
생성 출력의 형식·근거·맥락 저장 검사가 실패하면 같은 route에서 최대 한 번 재생성한다.
기존의 키워드 기반 코칭 분기, 손 관찰용 고정 답변, 다단계 모델 조회는 새 경로에서 호출하지 않는다.
기존 레코드 조회 기능과 단일 프롬프트 경로는 롤백용으로 유지한다.

새 경로의 각 HTTP 호출 제한은 20초이며 SDK 내부 재시도를 중첩하지 않는다.
사용자에게 실패 턴을 저장하지 않으며, 종료 생성이 실패하면 기존 종료 대체 문구와 handoff 계약을 유지한다.

## 설정과 관측

- `acttub.coaching.routed-enabled`: 기본 true. false로 이전 2층으로 복귀할 수 있다.
- 분류·다듬기 모델: `gpt-5.6-luna`, reasoning low. 분류는 엄격한 JSON Schema 출력이다.
- 생성 모델: 기존 `OPENAI_CHAT_MODEL` 설정을 사용한다(미설정 시 Luna).
- 관측 단계: `coach.route`, `coach.turn`, `coach.regeneration`, `coach.polish`.
- 모델 호출 메타데이터에 `contract=luna_routes_v1`과 선택된 route를 남긴다. 사용자 화면에는 노출하지 않는다.
- DB 마이그레이션과 웹·앱 응답 형식 변경은 없다. 기존 `acttub.coach_handoff.v2`로 3층에 연결한다.

## 검증

`CoachingPipelineTest`는 네 갈래 선택·기본 Spring 연결·첫 응답·긴 발화·분류 실패·영상 부재·편집 실패·종료·근거 오류를 검사한다.
`OpenAiResponsesClientTest`는 분류 전용 모델과 strict schema, 불완전 응답, 재시도 상한을 검사한다.

합성 데이터 실모델 테스트는 기본 비활성이다. API 키가 제공된 환경에서만 명시적으로 실행한다:

```sh
ACTTUB_ROUTE_LIVE_TEST=1 OPENAI_CHAT_MODEL=gpt-5.6-luna ./gradlew test --tests '*CoachingPipelineLiveTest'
```

합성 대화 결과는 `apps/api/build/route-eval/`에 남는다. 성공 여부와 코칭 품질은 별도로 검토한다.
