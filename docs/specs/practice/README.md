# 연습

[쓰는 법](../README.md)과 [공통 규칙](../common.md)을 먼저 읽는다.
연습은 제품의 본체다(PRD). 영상을 올리고, 관찰을 받고, 코치와 대화하고, 연습 노트를 남기는 한 바퀴이며, 배우 기억이 연습을
가로질러 남는다. 이미 배포돼 돌고 있는 기능이라 이 문서는 현행 동작을 문장으로 옮기고 1.0.0에서 바꾸는 것만 드러낸다.
바꾸는 것은 크게 셋이다. 영상을 연습에서 독립한 자산으로 두고(보관함), 연습을 회차(묶음의 n차)로 다시 세우고, 분석·대화·노트를
세 테이블로 나눈다. 코치의 행동 규칙(연기를 채점하지 않음, 첫 응답 정책, 도움 버튼, 노트 생성 조건, 배우가 쓴 기억 우선)은
CONTRACT §7·§8-5·§8-6, ADR-027, 아래 「영상만 올리는 연습」과 coach·note의 SOMA-531 절이 정본이고 여기서는 그대로 잇는다.

## 1.0.0 스키마 전환

현행 테이블(V1~V12)에서 1.0.0 테이블로 옮기되, 옛 자료를 잃지 않고 되돌릴 수 있어야 한다(BRANCHING-STRATEGY 「DB와 배포
안전성」). 옛 테이블을 남겨 두는 것만으로는 옛 서버가 새 테이블의 자료를 읽지 못하므로, 새 형식을 읽고 게이트·426을 유지하는
호환 서버를 먼저 배포해 롤백 기준 태그로 삼고 그 뒤에 새 쓰기로 전환한다. 1.0.0은 넓히기·호환 서버·데이터 전환까지다.

| 현행 | 1.0.0 | 옮기는 것 | 옮기지 않는 것·주의 |
|---|---|---|---|
| upload_intents | 예약 장부로 계속 쓴다 + videos | 확정된 업로드마다 videos 행(소유자·객체 키·형식·크기·길이·시각). 장부는 request_id·본문 지문·객체 키·만료·확정 video_id를 보존 | 미완료·만료 업로드는 영상이 아니고 만료 객체는 삭제 장부로 지운다 |
| practice_sessions | practices | id·소유자·영상·상황·인물·목표·막힘·경험 판(legacy·three_layers_v1)·시각. continued_from 체인을 root_id + ordinal로 | 옛 개별 숨김은 legacy_hidden_at에 두고 묶음 hidden_at을 채우지 않는다. 진행 중 회차가 둘 이상인 묶음처럼 새 제약에 맞지 않는 것은 사전 집계해 임의로 닫거나 지우지 않고 호환 경로에 남긴다 |
| transcripts | video_transcripts | 세션 → 영상 연결로 옮기고 원문·순서·단어 시각 보존 | 같은 영상의 서로 다른 전사를 하나로 덮지 않는다 |
| summaries | analyses | 신형 raw는 format = video_record_v1로 acttub.video_record.v1 전체, id = record_id. 기존 갈래(분석·표현)의 결과는 format = legacy로 원문(ObservationPack) 그대로. 모델·완료 시각·상태 | 구형을 신형으로 위장하지 않는다. 새 회차의 기존 갈래 결과도 format = legacy로 analyses에 쓴다 |
| anomalies | 없음 | 구형 기록을 읽는 데 필요한 것만 원문과 함께 보존 | 새 쓰기 없음. 구형 보존이 확인되기 전 삭제 없음 |
| coach_sessions | coach_conversations | id·연습·상태·종료 사유·상태 json·revision | 한 연습에 대화가 여럿인 옛 자료는 최신 하나로 자르지 않고 옛 읽기 경로에 남긴다 |
| coach_turns | coach_messages | 순서·역할·본문·시각 | request_id는 입증된 것만 채운다 |
| coaching_handoffs, handoff_confirmations | 없음(대화 상태·노트로 역할 분리) | 방향·초점·출처·종료 revision과 원문 보존 | 새 노트에 확인 절차를 요구하지 않는다 |
| practice_reports, reports | coach_notes | 노트 id·원문·종류·배우 문장·정정·다음 촬영 제안·시각·source_revision. 기존 갈래 노트는 format = legacy(종류 analysis·expression 그대로), 신형은 format = v2(action·observation·record_only) | analysis·expression을 action·observation으로 이름만 바꾸지 않는다. 새 회차의 기존 갈래 노트도 format = legacy로 coach_notes에 쓴다 |
| actor_memory_entries | actor_memories(성별·나이는 user_profiles) | 네 항목(goal·blockage·speech_self·speech_actual)의 값·작성자·출처·시각 | 자유 입력 나이로 생년월일을 추정하지 않는다 |
| external_operations | ai_jobs(analyze·memory_update만) | 요청 id·본문 지문·대상·소유자·상태·시도·lease·실패 분류·결과 | coach_start·coach_reply·report의 완료 응답은 재전송 호환이 끝날 때까지 남기고 AI 큐로 옮기지 않는다 |
| (없음) | practice_feedback | 새 테이블 | 옛 시트 자료의 역이관은 하지 않는다 |

순서: ① 넓히기(V14 이후, 새 테이블·인덱스, 옛 테이블 불변) → ② 호환 서버(옛·새 자료를 모두 읽고 게이트·426을 유지, 롤백
기준 태그) 배포 → ③ 새 쓰기 전환과 데이터 전환(재실행 가능한 작은 묶음, id 대응·원문·순서·소유권·출처 대조, 새 제약에 맞지 않는
묶음은 사전 집계, 진행 중 AI 작업은 옛 워커가 끝내고 두 큐에서 동시에 돌지 않음) → ④ 줄이기(옛 테이블의 읽기·쓰기를 모두
중단한 버전을 배포한 다음 릴리스부터 삭제 가능). 무손실 대응이 확인되지 않은 자료(구형 분석, 복수 대화)의 테이블은 삭제 시점을
정하지 않는다.

## 연습 자료의 이관·삭제·탈퇴

| 대상 | 게스트 → 회원 이관 | 영상 삭제 | 묶음 숨김 | 탈퇴, 미이관 게스트 30일 파기 |
|---|---|---|---|---|
| videos 행·객체 | user_id 바뀜, 객체 그대로 | 참조(회차·참여작)가 없을 때만 행·객체 삭제(장부) | 그대로 | 객체는 파기, 보관 동의자만 3년(account.withdraw). 행은 최소 메타만 남기고 일반 조회 차단 |
| video_transcripts | 영상을 따라감 | 영상과 함께 삭제 | 그대로 | 사람과 끊어 남긴다 |
| practices | user_id 바뀜 | 그대로(영상 삭제가 막힘) | 첫 행의 hidden_at | 남긴다(접근 차단) |
| analyses, coach_conversations, coach_messages, coach_notes | 회차를 따라감 | 그대로 | 그대로(숨김만) | 사람과 끊어 남긴다. 진행 중 대화의 늦은 저장 차단 |
| actor_memories | account.guest의 팝업 규칙 | 그대로 | 그대로 | 가명처리해 남긴다 |
| ai_jobs | user_id 바뀜, 완료 알림은 회원 폰 | 그대로 | 그대로 | 진행 중 취소, 이력은 남기되 요청 본문의 개인정보는 비운다 |
| practice_feedback | user_id 바뀜 | 그대로 | 그대로 | 연락처 파기, 본문은 사람과 끊어 남긴다 |
| note_ratings | user_id 바뀜 | 그대로 | 그대로 | 한 줄 파기, 평가 값은 사람과 끊어 남긴다 |
| 기기 자료(보관함 복사본·대기 업로드) | 옛 게스트의 쓰기·재시도 중단 | 해당 파일 삭제 | 그대로 | 탈퇴를 실행한 기기는 성공 직후, 다른 기기는 다음 실행이나 계정 종료 확인 때 계정 자료 전부 삭제 |

쓰기의 최종 저장 직전에 현재 소유자·계정 상태·부모 행·lease를 같은 트랜잭션에서 다시 확인한다(reading 공통 규칙과 같다).
객체 삭제(영상·미확정 업로드 객체)는 삭제 장부(account_cleanup_operations)가 성공까지 재시도한다. 탈퇴한 계정의 일반 API는 403이고
재가입 계정이 옛 자료 id로 조회하면 남의 것과 같은 404다(account.withdraw). 영상 재생 불가와 기록 열람 권한은 별개다. 활성 소유자에게
열람 권한이 있는 기록만 노트·대화를 돌려주고, 영상이 파기됐으면 재생만 막는다.

## 영상만 올리는 연습 (`three_layers_v1`)

SOMA-526. 영상 외 입력을 건너뛴 배우가 현재 표현을 살펴보고, 바라는 전달에 맞춰 다음에 무엇을 달리해볼지 가져가는 흐름이다.
1층은 [practice.analyze](analyze.md), 2층은 [practice.coach](coach.md), 3층은 [practice.note](note.md)에 있다. v1의 2·3층 기록은 커밋 c2b76b09의 [ACTTUB-THREE-LAYERS.md](https://github.com/acttub/acttub-platform/blob/c2b76b09/docs/ACTTUB-THREE-LAYERS.md)에서 본다.

### 적용 범위
웹·앱은 `X-Acttub-Contract: three_layers_v1`을 보낸다. 서버의 `ACTTUB_THREE_LAYERS_ENABLED=true`이고 상황·인물·목표·막힘 상세가 비어 있으며 막힘 대분류가 `그 외`인 신규 연습만 `experience_version=three_layers_v1`로 고정한다. 기존 입력 경로와 구형 클라이언트는 `legacy`다.

기능 플래그의 애플리케이션 기본값은 false다. dev 배포는 영상만 올리는 연습이 새 2·3층을 사용하도록 `DEPLOY_THREE_LAYERS_ENABLED=true`를 전달한다. 배포 스크립트가 이를 release.env에 기록하고 실제 API 컨테이너 값을 확인한다. 운영 배포는 이 값을 지정하지 않고 서버의 기존 설정을 유지한다. 플래그를 꺼도 이미 만든 새 연습과 노트는 읽을 수 있으며 기존 데이터를 다시 분석하지 않는다. 신형 reader가 없는 예전 서버 바이너리로 되돌리는 방식은 사용하지 않는다.

### 2·3층 개정 (SOMA-531, 2026-09-14)
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

### DB·트랜잭션·호환성
V5는 experience_version, coaching_state_json, state_revision을 추가하고 기존 CHECK 허용값을 확장한다. handoff의 `(coach_session_id, state_revision)`은 새 계약에 한해 유일하다. 기존 Flyway 파일은 수정하지 않는다.

LLM과 미디어 처리는 DB 트랜잭션 밖이다. 코치 메시지·state/revision·handoff·note·멱등 응답을 기존 완료 트랜잭션에서 함께 저장한다. revision 충돌은 409이며, lease 소유권을 잃으면 전체 쓰기가 롤백된다. note_id는 practice_reports 행의 id다. 닫히는 reply의 재전송도 저장한 응답을 그대로 반환한다.

구형 클라이언트 목록에서 새 연습/노트는 제외하고 직접 조회는 `client_contract_required` 409로 처리한다. 새 서버는 구형 raw와 노트를 계속 읽는다. 생성 플래그를 끄는 것과 reader를 제거하는 것은 다르다.

새 노트의 이어하기 이력은 제안·선택을 구분한다. 실행 여부 미확정을 미실행으로 바꾸지 않는다. 기존 '확인한 연습 수'에 따른 전역 기억 자동 갱신에는 새 노트를 가짜 확인으로 추가하지 않는다. 지난 연습은 참고 맥락이며 이번 영상이나 이번 의도의 증거로 승격하지 않는다.
