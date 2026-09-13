# 영상만 올리는 3층 코칭 계약

SOMA-526. 영상 외 입력을 건너뛴 배우가 현재 표현을 살펴보고, 바라는 전달에 맞춰 다음에 무엇을 달리해볼지 가져가는 흐름이다.

## 적용 범위

웹·앱은 `X-Acttub-Contract: three_layers_v1`을 보낸다. 서버의 `ACTTUB_THREE_LAYERS_ENABLED=true`이고 상황·인물·목표·막힘 상세가 비어 있으며 막힘 대분류가 `그 외`인 신규 연습만 `experience_version=three_layers_v1`로 고정한다. 기존 입력 경로와 구형 클라이언트는 `legacy`다.

기능 플래그의 기본값은 false다. dev에서 실제 연기 영상으로 검증한 뒤 환경 설정으로 켠다. 플래그를 꺼도 이미 만든 새 연습과 노트는 읽을 수 있다. 이 PR은 배포하거나 기존 데이터를 다시 분석하지 않는다. 신형 reader가 없는 예전 서버 바이너리로 되돌리는 방식은 사용하지 않는다.

## 1층: 시간축이 있는 영상 기록

정본은 `summaries.raw`의 `acttub.video_record.v1`이다. 기존 `observations_json`, `uncertainties_json`은 새 기록에서 빈 배열이며 기존 행은 변경하지 않는다. `summaries.id = record_id`이고 정본은 분석 완료 후 덮어쓰지 않는다.

- 원본을 최대 30초 청크로 분석하고 지역 시각·ID를 원본 기준으로 조립한다. 청크마다 최대 6회 생성 예산을 독립적으로 둔다. 구조 오류는 재생성하고, 필요하면 최소 7.5초까지 분할한다. 앞 청크의 실패가 뒤 청크의 예산을 소모하지 않는다.
- 영상 파트에 6 FPS 샘플링을 명시하고 프레임 사이 미세 변화·추정 시각의 한계를 기록한다. LOW thinking으로 청크별 생성 예산을 유지한다. [Gemini 영상 문서](https://ai.google.dev/gemini-api/docs/video-understanding)의 기본 샘플링 한계를 고려한 설정이며 실제 영상으로 비용·시각 품질을 확인한다.
- 전체 대사, 발성·호흡·리듬·시선·얼굴·움직임·환경의 관찰, 변화가 없는 상태, 관찰 한계를 저장한다. 상위 15개 등의 개수 제한을 두지 않는다. 각 구간의 참조와 처음부터 끝까지의 시간축을 검증한다.
- 받아쓰기의 모든 단어 시각과 단어 사이 간격을 보존한다. 무음으로 단정하지 않고 `word_gap`으로 기록한다. ASR와 영상 대사가 충돌하면 양쪽을 보존하고 한계를 남긴다. 모델 추정 시각은 `estimated`, ASR 단어 시각은 `aligned`다.
- 부분 실패는 `processing.status=partial`, `processed_ranges`, `missing_ranges`와 한계로 기록한다. 모든 청크가 실패하면 기존 분석 실패 흐름을 따른다. 2층은 분석 실패 시에도 근거가 없다는 상태로 대화를 열 수 있다.
- 영상 전체를 손실 없이 텍스트로 복원한다고 보장하지 않는다. 보이지 않거나 들리지 않는 부분은 설명을 만들어 채우지 않는다.

프롬프트: `apps/api/src/main/resources/coaching/video-record-prompt.txt`.
출력 스키마: 같은 디렉터리 `three-layer-contracts.schema.json`의 `layer1_chunk`.
공개 상세 응답의 `summary`는 새 기록일 때 `VideoRecordSummaryResponse`다. 원본 기록 전체를 공개 API로 내보내지 않는다.

## 2층: 짧은 메시지와 누적 상태

입력은 현재 상태·실제 메시지·현재 제공된 영상 근거·서버의 길이/조회 예산이다. 영상만 올린 첫 턴의 `user_message`는 null이며, 배우가 하지 않은 말을 actor turn으로 생성하지 않는다.

모델은 `lookup` 또는 `respond`만 반환한다. `lookup`은 이 세션의 저장된 텍스트만 읽으며 S3·원본 영상·다른 세션에 접근할 수 없다. 대사·구간·검색어로 앞뒤 근거를 조회하고 결과를 다음 생성 입력에 실제로 넣는다. 같은 응답 안의 두 번째 조회는 첫 번째 결과를 덮어쓰지 않고 `record_view`에 누적된다. 한 번의 사용자 요청에서 조회 최대 2회, 전체 생성 최대 4회다. 조회는 화면의 대화 턴에 포함하지 않는다. 24,000자 안에서 사실·단어 단위로 페이지를 나눠 큰 단일 구간도 끝까지 조회할 수 있다. `dimensions`는 관찰을 거르고 대사·한계는 맥락으로 유지한다. 페이지의 구간 참조는 `refs_scope=this_page`이며 나머지 사실은 `has_more`와 동일 선택자에 묶인 커서로 요청한다.

`respond`의 message는 기본 120자·2문장, 질문 최대 1개다. 간결한 설명이나 연습 제안만으로 끝낼 수 있다. 짧게 요청하면 80자·1문장, 자세히 요청하면 300자·4문장이다. 한 대화의 코치 응답은 최대 10회이며 배우는 그 전에 마칠 수 있다.

상태는 다음을 분리한다.

| 필드 | 의미 |
| --- | --- |
| context.direction | 배우가 바라는 전달. actor_stated / actor_selected / coach_proposed 구분 |
| context.scene_context | 장면 상황·인물 목표·상대에게 하려는 행동. 모르면 null |
| context.focus, reading | 근거가 있는 현재 초점 하나와 잠정적인 읽힘 |
| proposals | 연습 지시·비교 기준·유지 조건, 제안/선택 여부, 활성/거절/대체 이력 |
| attempts | proposal_id별 실행 보고와 배우가 전한 결과. unknown / not_tried / reported_tried |
| source_catalog | 상태가 실제로 인용한 영상 기록·대화 원문 |

현재 호출에서 제공하지 않은 출처, 배우 발화가 아닌 실행 증거, 단순 동의·종료를 실행으로 바꾸는 전이, 메시지에 없는 숨은 과제, 초점을 바꾸면서 이전 연습을 그대로 유지하는 전이를 거부한다. 출처 검증이 연기 해석의 진실성을 증명하는 것은 아니므로 실제 영상의 코칭 품질도 별도로 확인해야 한다.

검증에 실패한 출력은 저장하거나 보여주지 않는다. 재시도 예산이 끝나면 기존 상태를 유지하고 짧은 안내를 보낸다. 종료 턴에서도 연습 실행이나 동의를 강요하지 않는다.

프롬프트: `coach-prompt.txt`. 출력 스키마: `layer2_turn`.

## 3층: 다음 촬영에 가져갈 연습 노트

서버가 검증된 state/revision으로 `acttub.coach_handoff.v1`을 만들고, `acttub.practice_note.v1`을 조립한다. 모델은 제목과 선택적 짧은 정리만 작성한다. 장면 맥락(`scene_context`)은 노트 정본과 모델 입력에 보존하되 공개 응답에는 내지 않는다. 정리 문장은 이미 기록된 문장과 출처를 그대로 골라야 한다. 생성 실패 시에도 기본 제목으로 노트를 저장한다. 그 실패는 삼키지 않고 `practice_note.copy_fallback` 점수로 남긴다.

- action: 방향·초점·현재 연습이 있다. 연습 지시와 비교 기준을 그대로 제공한다.
- observation: 살펴본 구간은 있고 현재 연습은 없다.
- record_only: 구체적인 초점 없이 마쳤다. 과제나 발전을 만들지 않는다.

새 노트 저장은 모든 내용에 대한 배우의 확인이 아니다. `handoff_confirmations`를 만들지 않으며 `/coach/confirm`을 요구하지 않는다. 실행 결과는 `actor_report`로 표시한다. 다른 제안의 결과를 현재 연습에 옮기지 않는다.

공개 응답은 `acttub.public_practice_note.v1`, `report_type=practice_note`다. 제목·방향·구간·연습·비교 기준·실행 보고·열어 둔 부분을 표시하며 내부 상태와 과거 메시지 원문 카탈로그는 제외한다. 웹과 앱은 새 타입과 기존 analysis/expression 노트를 각각 렌더링한다. 웹 장면 패널은 새 기록의 요약(장면·대사·한계·처리 상태)을 보여준다. 모르는 타입을 expression으로 취급하지 않는다.

프롬프트: `note-prompt.txt`. 모델 출력: `layer3_copy`. 저장 정본: `practice_note`.

## DB·트랜잭션·호환성

V5는 experience_version, coaching_state_json, state_revision을 추가하고 기존 CHECK 허용값을 확장한다. handoff의 `(coach_session_id, state_revision)`은 새 계약에 한해 유일하다. 기존 Flyway 파일은 수정하지 않는다.

LLM과 미디어 처리는 DB 트랜잭션 밖이다. 코치 메시지·state/revision·handoff·note·멱등 응답을 기존 완료 트랜잭션에서 함께 저장한다. revision 충돌은 409이며, lease 소유권을 잃으면 전체 쓰기가 롤백된다. note_id는 practice_reports 행의 id다. 닫히는 reply의 재전송도 저장한 응답을 그대로 반환한다.

구형 클라이언트 목록에서 새 연습/노트는 제외하고 직접 조회는 `client_contract_required` 409로 처리한다. 새 서버는 구형 raw와 노트를 계속 읽는다. 생성 플래그를 끄는 것과 reader를 제거하는 것은 다르다.

새 노트의 이어하기 이력은 제안·선택을 구분한다. 실행 여부 미확정을 미실행으로 바꾸지 않는다. 기존 '확인한 연습 수'에 따른 전역 기억 자동 갱신에는 새 노트를 가짜 확인으로 추가하지 않는다. 지난 연습은 참고 맥락이며 이번 영상이나 이번 의도의 증거로 승격하지 않는다.

## 검증과 적용 순서

1. V5의 신규/기존 DB 경로, fingerprint, JPA 매핑을 Postgres 18 Testcontainers로 검증한다.
2. 기본 영상 입력, 텍스트 lookup, 짧은 답변, 방향 변경·반박·거절, 단순 동의, 조기 종료, 턴 제한, 부분 분석 실패, 모델 출력 오류, lease/revision 충돌을 검사한다.
3. springdoc의 `OpenApiSnapshotIT` 갱신 모드로 스냅샷을 생성하고 diff를 검토한다. `pnpm --filter web generate:v2-schema`로 웹 타입을 재생성한다. 갱신 변수 없이 계약 검사를 다시 통과해야 한다.
4. 웹 lint/build/typecheck/test, 모바일 test, API 전체 테스트와 배포 smoke를 PR CI에서 통과시킨다. 합성 JSON 테스트를 실제 연기 영상의 품질 확인이라고 부르지 않는다.
5. dev에서 정상 음성·작은 음성·무음·가려진 신체·짧은 답변·목표 변경을 실제 영상으로 확인한 뒤 `ACTTUB_THREE_LAYERS_ENABLED=true`를 설정한다. 초기 비용·지연·lookup/재생성/부분 실패 비율을 관측한다.

모델이 노트 제목에 새로운 효과·성과를 붙일 수 없도록 기존 초점 문구의 발췌만 허용한다. 초점이 없으면 서버의 기본 제목을 사용한다.
