# 요구사항

**작성 중.** 지금 쓰는 것은 1.0.0 목표 상태이고, 배포된 제품의 동작은 아직 `docs/PRD.md`가 말한다.
네 영역을 다 쓰면 루트 CLAUDE.md의 조건부 정본에 이 폴더를 넣는다.

기능마다 무엇을 하고, 왜 하고, 실패하면 어떻게 되고, 어떻게 확인하는지를 적는 문서 묶음이다.
1.0.0에서는 스키마의 컬럼과 API를 정하는 근거가 된다. 테이블과 관계는 ERD에서 합의했다.

요구사항은 경로에 판을 두지 않고 그 자리에서 고친다. 판은 기능의 `도입` 줄이 말하고, 지난 상태는
git 이력이 보관한다. 동작을 바꾸는 PR이 그 기능의 요구사항도 함께 고친다.

## 관련 정본

- ERD 결정 기록: 워크트리의 `.scratch/SOMA-528.md`(추적되지 않음),
  ERD 아티팩트 https://claude.ai/code/artifact/7161a549-3af9-4adf-99af-39798fabd10c
- 화면 정본: https://github.com/acttub/pen 의 `acttub 디자인.pen`
- 제품 범위·API·DB 규칙은 루트 CLAUDE.md의 조건부 정본을 따른다.

## 읽는 순서

이 파일 다음에 영역 파일을 읽는다. 기능 목록은 각 파일의 `##` 헤딩이 정본이다.

| 파일 | 영역 |
|---|---|
| [01-account.md](01-account.md) | 계정 |
| [02-practice.md](02-practice.md) | 연습 |
| [03-reading.md](03-reading.md) | 대본 리딩 |
| [04-challenge.md](04-challenge.md) | 챌린지 |
| [05-community.md](05-community.md) | 커뮤니티 (상태: 후속) |

## 쓰는 법

기능 하나가 아래 틀 하나다. 기본 절은 다섯이고, 나머지 절은 필요할 때만 붙인다.

```markdown
## <영역>.<기능> <기능 이름>
- 도입: <판>
- 화면: <pen 화면 번호>
- 테이블: <ERD 테이블명>

### 기능
### 의도
### 목적
### 예외
### 검증 방법
```

- **id**: `<영역>.<기능>`, 영문 소문자와 하이픈만 쓴다. 이슈·테스트·ADR에서 이 id로 가리킨다.
- **도입**: 이 기능 id가 요구사항에 처음 들어간 판. 이미 있던 기능도 이 문서 묶음이 시작된 1.0.0으로
  적는다. 뒤에 규칙이 바뀌어도 이 줄은 그대로 둔다.
- **상태**: 판에서 뺀 기능에만 `- 상태: 후속`을 적는다. 버린 요구사항은 `docs/archive/`로 옮긴다.
- **결정 기록**: 이 기능에 닿는 ADR 번호. 있을 때만 적는다.
- **화면**: pen 파일의 화면 번호. 예: A1.2, A8.1. 아직 없으면 비워 둔다.
- **테이블**: ERD의 테이블명. 이 줄로 요구사항이 없는 테이블을 찾는다.
- **기능**: 무엇을 하는지 한두 문장.
- **의도**: 왜 넣는지. 어떤 문제나 상황에서 출발했는지.
- **목적**: 배우가 얻는 결과. 성공한 상태를 문장으로 쓴다.
- **예외**: 실패·중단·되돌리기·탈퇴 때 어떻게 되는지.
- **검증 방법**: 완료를 확인하는 방법. 무엇을 넣으면 무엇이 나와야 하는지.

필요할 때만 붙이는 절: 행위자·진입점, 흐름(상태 전이), 데이터(저장·조회·공개 범위), 규칙·제약,
완료 조건, 범위 밖, 열린 질문.

(결정 필요)가 붙은 문장은 권장안이다. 사용자가 정하면 표시를 떼고 그 문장이 규칙이 된다. 구현은
표시가 떼진 문장만 따른다.

기능 하나가 끝난 기준: 다섯 절이 다 있고, 테이블 줄의 이름이 전부 ERD에 있고, 검증 방법의 각
항목이 입력과 기대 결과 한 쌍이고, (결정 필요)가 남아 있지 않다. 문서 묶음이 끝난 기준: ERD의
테이블과 아래 "ERD에 반영할 변경"의 추가 테이블이 모두 어느 기능의 테이블 줄에 나온다. 구현이 끝난 기준: 검증 방법의 항목마다
테스트 하나가 대응한다.

## 공통 규칙

영역마다 반복되는 규칙은 여기에 한 번만 쓰고, 각 기능에는 다른 점만 적는다.

### 게이트와 보호 기능

로그인한 사람이 필수·선택 동의를 모두 결정하고 프로필 필수 항목을 다 채워야 통과하는 문이
게이트다. 순서는 동의 → 프로필이고, 요청마다 DB 상태로 판정하며 토큰을 갱신해도 열리지 않는다.
게이트 밖에 있는 것은 로그인, 게스트 시작, 토큰 갱신, 로그아웃, 동의 문서 조회와 제출, 프로필 입력, 탈퇴,
그리고 게스트의 이관 코드 받기뿐이다.
푸시 토큰 삭제는 로그인 없이 받으므로 게이트와 무관하다. (account.notification)
그 밖의 모든 기능이 보호 기능이며, 게이트를 통과하기 전에는 쓸 수 없다.
웹 게스트는 프로필 게이트를 면제하고, 동의는 기능마다 필요한 문서만 그 기능을 처음 쓸 때 받는다.
(account.guest) 회원은 미결정 문서가 하나라도 있으면 모든 보호 기능이 막히고 게스트는 그 기능의
문서만 보는 것은 의도한 차이다. 서버 게이트 규칙은 둘이다.

### 오류 응답

- 오류 본문은 사유 코드 하나다. 규칙에 걸린 요청의 422도 같은 모양이고, 본문의 모양이 틀린 422만 항목
  배열이다. 앱은 코드가 글자면 사유로 가르고 배열이면 앱 버그로 다룬다.
- 코드 말고 정보를 더 싣는 오류는 둘뿐이다. 게이트의 consent_required는 미결정 문서 목록을, 로그인의
  이메일 겹침은 기존 계정의 제공자 이름을 함께 싣는다. (account.login)
- 없는 것과 남의 것은 같은 404다. 존재 여부를 알려 주지 않는다.

### 클라이언트 판과 강제 업데이트

- 앱과 웹은 요청마다 자기 종류와 판을 헤더(X-Acttub-Client, 예: app/1.0.0)로 보낸다.
- 이 헤더가 없는 요청은 1.0.0 이전 빌드로 보고 426과 업데이트 안내 문장으로 답한다. 1.0.0 이전 앱은
  모르는 상태 코드에 실린 문장을 그대로 보여 준다. 서버에 옛 규칙(로그인 즉시 계정 생성, 필수 문서만
  보는 게이트, 닉네임)을 남기지 않는다. 1.0.0이 막으려는 구멍을 옛 빌드 때문에 열어 두지 않기 위해서다.
- 상태 확인과 제공자가 부르는 콜백은 이 헤더를 보지 않는다.
- 서버 배포부터 새 앱 출시까지(스토어 심사 기간) 1.0.0 이전 앱은 쓸 수 없다. 심사 제출 직전에 배포하고
  통과 즉시 출시해 줄인다. 1.0.0은 이를 받아들인다.
- 새 앱은 426을 받으면 업데이트 안내 화면을 보여 준다. 뒤에 최소 판을 올려 같은 방식으로 안내할 수 있다.

### 탈퇴·삭제

- users 행은 익명화해 남긴다. 프로필은 이름·사진·소개를 지우고 나머지를 가명처리해 남긴다. 챌린지
  댓글은 "탈퇴한 사용자"로 남는다. (account.withdraw)
- 재가입은 새 계정이다. 이전 계정의 데이터는 옮기지 않는다. 영역마다 탈퇴한 사람의 행을 어떻게
  보일지만 따로 정한다.

### 공개 범위

누가 무엇을 볼 수 있는지의 기본값. 기능별로 다른 점만 각 기능의 절에 적는다.

### 검증 방법 공통

기능마다 반복되는 확인 방법을 여기에 모은다. 각 기능의 검증 방법에는 그 기능에만 있는 확인만 남긴다.

- 클라이언트 판 헤더 없이 연습 API 호출: 426과 업데이트 안내 문장. 헤더 없이 상태 확인과 제공자 콜백:
  막히지 않는다.
- 규칙에 걸린 422의 본문: 사유 코드 하나. 필수 항목이 빠진 422의 본문: 항목 배열.

## ERD에 반영할 변경

계정 요구사항(2026-09-17 검토)에서 ERD 합의 뒤에 생긴 변경이다. ERD 아티팩트는 아직 이 목록을
반영하지 않았다.

| 변경 | 내용 | 출처 |
|---|---|---|
| 추가 | user_profile_directions(user_id, direction) | account.profile |
| 추가 | portfolios(1:1), portfolio_credits, portfolio_photos | account.portfolio |
| 추가 | guest_transfer_codes(user_id, code_hash, expires_at, used_at) | account.guest |
| 추가 | notifications(알림함). 컬럼은 challenge.notification에서 정한다 | challenge.notification |
| 컬럼 | user_identities.uid_hash, provider_uid는 NULL 허용 | account.withdraw |
| 값 | user_identities.provider에 guest 추가 | account.guest |
| 값 | users.status에서 suspended 제거 (V4에서 이미 반영됨) | account.login |
| 삭제 | users.signup_* 아홉 컬럼 (V4에서 이미 삭제됨) | account.login |
| 삭제 | users.nickname (user_profiles.name으로). 1.0.0은 값을 옮기고 읽기·쓰기를 끊는다. 탈퇴만 예외로 옛 닉네임을 계속 비운다(파기 공백을 두지 않기 위해서다). 다음 릴리스에서 그 쓰기를 없애고 그다음 릴리스에서 컬럼을 삭제한다. 삭제와 그것을 안 쓰는 코드를 한 릴리스에 묶지 않기 때문이다([DB와 배포 안전성](../BRANCHING-STRATEGY.md#db와-배포-안전성)) | account.profile |
| 컬럼 | user_profiles 알림 토글 둘 → 셋(챌린지 알림 추가) | account.notification |
| 컬럼 | user_profiles 나이는 생년월일로 받고, 탈퇴 때 5세 단위 연령대로 뭉개 남긴다 | account.profile, account.withdraw |
| 컬럼 | user_identities에 애플 토큰(암호화) | account.login |
| 컬럼 | users.age_confirmed_at(게스트의 만 14세 이상 확인 시각) | account.guest |
| 컬럼 | user_identities에 네이버 토큰(암호화). 탈퇴 때 연결 해제에 쓴다 | account.login, account.withdraw |
| 추가 | account_cleanup_operations(탈퇴 뒤 객체 삭제와 제공자 연결 해제의 7일 재시도 장부) | account.withdraw |
| 컬럼 | scripts에 원문, 입력 경로(file·paste·typed·sample), request_id(기기 UUID, 이관 충돌 때 NULL 허용), request_fingerprint(생성 본문 지문, 불변). (user_id, request_id) 유일. ERD 초안의 "줄 수"·"삭제 시각" 컬럼은 두지 않는다(집계·행째 삭제) | reading.script |
| 제약 | script_characters.name은 공백 정리 뒤 비어 있지 않고 같은 script_id 안에서 유일 | reading.script |
| 컬럼 | script_characters.voice_preset(NULL이면 자동). "대사 수" 컬럼은 두지 않는다 | reading.cast |
| 값 | script_lines.kind에 scene(막·장 머리 줄) | reading.script |
| 컬럼 | reading_sessions: my_character_ids(배역 id 배열), mode(read·quiz), start_line_id·end_line_id, advance(silence·manual), record(켬·끔), status(in_progress·completed·stopped), current_line_id(completed면 NULL), elapsed_seconds, progress_seq, line_results(jsonb, 줄마다 {line_id, outcome passed·unmatched·skipped, misses}), request_id(이관 충돌 때 NULL 허용), started_at·ended_at. (user_id, request_id) 유일. ERD 초안의 "목소리"·"읽은 줄 수" 컬럼은 두지 않는다. (script_id) WHERE status = 'in_progress' 부분 유일 | reading.session |
| 컬럼 | reading_recordings: user_id(현재 소유자, 이관 때 갱신·탈퇴 보관 때 유지), object_key(요청마다 다른 키, 재사용 없음), content_type, byte_size(변환 뒤), duration_ms, transcript, transcript_source(stt·none), matched(NULL 가능), request_id, attempt_no. (reading_session_id, line_id) 유일. 탈퇴 보관을 위해 reading_session_id·line_id는 NULL 허용 | reading.recording |
| 컬럼 | line_memorization: status(memorized·not_yet), updated_at. (user_id, line_id) 유일 | reading.memorization |
| 값 | account_cleanup_operations의 작업 종류에 리딩 녹음 객체 삭제(대체·삭제·탈퇴·변환 미반영 객체). 객체 삭제 작업은 성공 전까지 대상 키를 유지하고 7일 연속 실패면 운영자 알림·복구 대상으로 남긴다(제공자 해제 비밀값의 7일 보관과 분리) | reading.recording, account.withdraw |
| 컬럼 | videos: user_id, object_key, content_type, byte_size, duration_ms, width·height, favorite, created_at, purged_at(파일만 파기·탈퇴 파기 뒤 최소 메타만, 재생 불가·총량 제외). 총량은 purged_at 없는 행의 byte_size 합 | practice.record, practice.library |
| 유지·컬럼 | upload_intents는 예약 장부로 새 쓰기를 계속한다. request_id, request_fingerprint, expires_at, 확정 video_id, 객체 검증값(etag) | practice.record |
| 컬럼 | practices: root_id·ordinal((root_id, ordinal) 유일), stage(analyzing·conversing·closed와 종료 사유; 분석 최종 실패·취소·대화 종료 → closed, 재시도 → analyzing; 묶음당 closed 아닌 회차 하나 부분 유일), experience_version(legacy·three_layers_v1), request_id((user_id, request_id) 유일, 이관 충돌 때 NULL 허용), request_fingerprint, 막힘 대분류·세부·서술, 상황·인물·목표(빈 문자열 허용), hidden_at·favorite·title·tags(첫 행), legacy_hidden_at(옛 개별 숨김) | practice.start, practice.resume, practice.library |
| 컬럼 | analyses: practice_id(1:1), format(video_record_v1·legacy), id = record_id(신형), status(ready·partial), model, record(jsonb, 불변; legacy는 ObservationPack 원문), completed_at | practice.analyze |
| 컬럼 | video_transcripts: 영상당 전사 묶음 하나(순서 있는 행), 원본 출처·처리 상태, 생성 예약 공유로 동시 생성 방지 | practice.record, practice.analyze |
| 컬럼 | coach_conversations: start_request_id((practice_id) 1:1), status, close_reason, state(jsonb), state_revision. coach_messages: (conversation_id, turn_index)·(conversation_id, request_id) 유일, request_fingerprint | practice.coach |
| 컬럼 | coach_notes: conversation_id(1:1), format(legacy·v2), title(초점 원문, record_only는 NULL), kind(legacy: analysis·expression / v2: action·observation·record_only), summary_quotes(출처 포함), next_take, actor_words, corrections, tags, fallback, source_revision, legacy 원문 | practice.note |
| 값 | ai_jobs.kind에 analyze·memory_update(리딩·설문·정리 장부는 넣지 않음). status failed의 사유에 cancelled·account_deactivated | practice.analyze, practice.memory |
| 컬럼 | practice_feedback: user_id, practice_id, screen(coach·report), trigger(x·leave·back), body(NULL이면 dismissed), contact_email·contact_phone(90일 뒤 NULL, DB·시트 모두), sheet_synced_at, sheet_seq(변경 순번), request_id. 이관 때 여러 행 보존 | practice.feedback |
| 컬럼 | users.exit_survey_asked_at(이탈 설문 노출 선점 시각). actor_memories 소유자 기준 memory_epoch(기억 세대; 삭제·이관 선택 때 증가, 갱신 작업은 예약 시점 세대를 갖고 다르면 미반영) | practice.feedback, practice.memory |
| 삭제 조건 | 옛 테이블(practice_sessions, transcripts, summaries, anomalies, coach_sessions, coach_turns, coaching_handoffs, handoff_confirmations, practice_reports, reports, actor_memory_entries, external_operations)은 1.0.0에서 삭제하지 않고 호환 읽기 경로가 쓴다(upload_intents는 계속 쓴다). 삭제는 그 테이블의 읽기·쓰기를 모두 중단한 버전을 배포한 다음 릴리스부터이며, 무손실 대응이 확인되지 않은 자료(구형 분석·복수 대화)의 테이블은 시점을 정하지 않는다 | 02-practice 스키마 전환 |
| 값 | account_cleanup_operations의 객체 삭제 종류에 영상 객체·미확정 업로드 객체·파일만 파기 | practice.record, practice.library |
| 컬럼 | challenges: line(1~200자), work(1~100자, 창작은 "창작"), character(100자), scene_note(500자), duration_days(7·14, API 상수), origin(team·member, 불변), host_user_id(team은 NULL, 탈퇴 시 NULL), request_id((host_user_id, request_id) 유일)·request_fingerprint, featured_on(team만, 날짜당 하나), starts_at·ends_at(기간 상태는 시각으로 판정, 컬럼 없음), moderation(visible·review·hidden) | challenge.create |
| 컬럼 | challenge_entries: video_id(삭제 뒤 NULL 허용), caption(300자, 수정 가능), visibility(public·private), status(visible·hidden_by_report·deleted), view_count, final_like_count·final_rank(종료 시 저장), request_id((user_id, request_id) 유일)·request_fingerprint, deleted_at, (challenge_id, video_id) 유일(deleted 제외). 영상 길이 60초 이내 | challenge.entry, challenge.browse |
| 컬럼·제약 | entry_reports: target_type(entry·comment·challenge)·target_id로 대상 확장, (target_type, target_id, reporter_id) 유일, reason(copyright·inappropriate·spam·duplicate·other), note(200자), status(received·reviewed), resolution(restored·kept_hidden·dismissed), reviewed_by·reviewed_at·resolution_note, target_version. 처리 완료 90일 뒤 삭제 | challenge.report |
| 컬럼 | entry_comments: deleted_at(본문 파기·삭제 표시), status(visible·hidden) | challenge.react, challenge.report |
| 추가 | user_blocks(blocker_id, blocked_id, created_at), (blocker_id, blocked_id) 유일. 챌린지 노출 조건과 반응 차단에 쓴다 | challenge.block |
| 컬럼 | entry_ai_reports: status(pending·ready·failed), model, format_version, result(jsonb: 관찰·차이·한계·제안·표본 참여작 id), requested_at, completed_at. 요청 시 생성(하루 3회), 표본 최대 5개 | challenge.ai-report |
| 값 | ai_jobs.kind에 challenge_report | challenge.ai-report |
| 추가 | notifications: id, user_id, kind(entry_liked·entry_commented·challenge_ended·entry_ai_report_ready), actor_user_id(NULL 가능), challenge_id, entry_id, comment_id(NULL 가능), event_key((user_id, event_key) 유일), group_key(10분 구간 묶기), created_at, read_at, expires_at(90일), push_after, push_status(pending·attempted·skipped), push_attempted_at. 이름·본문·주소는 복사하지 않고 조회 때 조립 | challenge.notification |

## 디자인에 반영할 것

pen을 고칠 목록이다. 규칙은 출처 기능의 본문이 정본이고 여기에는 한 줄만 둔다.

| 화면 | 바꿀 것 | 출처 |
|---|---|---|
| A0 로그인 | 카카오·네이버 버튼(안드로이드는 애플 제외), 서버가 알려 준 켜져 있는 제공자만 버튼으로, 마지막 제공자 강조, 이메일 겹침 안내 | account.login |
| A0.1 동의 | 선택 문서 줄(동의·거절 두 버튼), 버튼 문구 "동의하고 계속하기", 문서 이름 "개인정보 수집·이용 동의", 재동의 때 탈퇴 링크 | account.login, account.consent |
| A0.2 프로필 설정 | 나이 칸을 생년월일로, 이름 칸에 "다른 사람에게 보이는 이름이에요", 만 14세 미만 안내 | account.profile |
| A4 설정 | 알림 토글 셋과 밤 10시, 문서마다 판·시행일·결정 시각, 선택 동의 바꾸기 | account.notification, account.consent |
| A4 설정·프로필 | 프로필 여섯 항목과 사진·소개를 고치는 진입점 | account.profile |
| A5 탈퇴 | 안내 문구를 챌린지 기준으로, 지워지는 것에 사진·소개·영상 | account.withdraw |
| 새 화면(앱) | 포트폴리오 편집, 이관 코드 입력, 기억 선택 팝업, 업데이트 안내(426) | account.portfolio, account.guest, 공통 규칙 |
| 새 화면(웹) | 게스트 시작 안내, 기능별 동의 시트("만 14세 이상이에요" 확인 줄 포함), 이관 코드, 옮긴 뒤 안내, 포트폴리오 공개 페이지 | account.guest, account.portfolio |
| 없앨 화면(웹) | W2 로그인, D3.1 동의 결정, 상단 탐색의 아바타 | account.guest |
| 내릴 화면 | 커뮤니티 A3·A3.1·A3.2, D11·D12·D15, WC·WC2·WC3 | 05-community |
| R00 대본 목록 | "분석 완료" 칩 삭제(칩은 연습 중·연습 완료·배역 선택 셋), 검색은 제목·배역만, 카드의 "암기" 칩 | reading.script, reading.memorization |
| R00.3 더보기 | "제목·배역 수정" 시트(제목과 배역 이름만) | reading.script |
| 새 화면(앱) | 대본 확인 화면(배역 이름 고치기·빼기·더하기), 옛 대본 옮기기 안내, 이동통신 모델 내려받기 확인, 회차 삭제·개별 녹음 삭제 | reading.script, reading.cast, reading.recording |
| R02 배역 선택 | 목소리 드롭다운(자동 + 프리셋 M1~M5·F1~F5), 미리 듣기 | reading.cast |
| R03 시작 위치 | 방식 선택(읽어주기·암기 대조), 녹음 켬·끔과 "내 차례 녹음은 내 계정에 저장돼요" | reading.session, reading.recording |
| R03.2 나가기 확인 | 문구 "지금 나가면 N번 대사까지 진행한 걸로 저장돼요. 상세에서 이어서 할 수 있어요". "끝 위치를 정하지 않았어요" 삭제 | reading.session |
| R05 완료 | 코치 카드(촬영으로) 추가, 다시 볼 대사가 없으면 절 숨김, 암기 대조 완료는 "맞춘 줄 K / 시도 N · 아직 안 나온 줄 P" | reading.session |
| R00.2 대본 연습 | 1.0.0에서 쓰지 않음(R03.x와 겹침, 대사별 메모는 범위 밖) | reading.session |
| D13 대본 넣기 | 최근 대본 목록, "서버로 보내지 않아요"·"이 기기에만 저장돼요"·"어디로 가나요" 삭제, 저작권 안내 한 줄 | reading.script |
| D16 대본 확인 | 배역 칩으로 이름 고치기·빼기(지금은 다시 넣기만) | reading.script |
| D17 설정 | 내 배역 여러 개, 가리기 셋, 녹음 켬·끔, "소리는 어디에도 안 나가요" 삭제, 모델 용량 표시, 구간 선택(후속 가능) | reading.cast, reading.session, reading.recording |
| D18 실행 | 나가기 확인, 가리기 토글, 녹음 표시, "방금 말한 것" | reading.session, reading.recording |
| D19 완료 | 다시 볼 대사, 암기 대조 완료 표기(정확도 % 삭제) | reading.session |
| 새 화면(웹) | 대본 상세·회차 목록·이어하기·녹음 재생, 암기 화면(R04·R04.1 대응) | reading.session, reading.recording, reading.memorization |
| R01 업로드 | 네 경로(파일·붙여넣기·직접 쓰기·예시)와 앱의 파일 형식(txt·pdf·docx) | reading.script |
| R03.0 가이드 | 녹음 끔·수동 넘김·암기 대조에 맞게 문구 분기, "항상 자동 녹음·자동 다음"을 약속하지 않음 | reading.session, reading.recording |
| R03.1·R03.2·D18·WR3 | 암기 대조의 발화 확정·첫 미달(다시·넘어가기)·두 번째 미달·입력하기, 음성인식·서버 저장 안내 | reading.session |
| R00·R00.5 | stopped 회차만 남은 대본의 칩("배역 선택")과 다음 행동 | reading.script, reading.session |
| R04·R04.1·웹 암기 | 완료 회차에서 들어온 진입, "외운 대사도 보기"(표시 취소), 원문 듣기와 듣고 따라 말하기의 마이크 구분 | reading.memorization |
| 목소리 준비 실패 | 다시 시도·기기 음성으로 읽기(전달 안내)·글로 보기 셋 | reading.cast |
| A5 탈퇴 | 지워지는 것에 대본·배역·줄·리딩 회차·암기 상태, 보관 동의 녹음(음성·전사) 예외 | account.withdraw, reading.recording |
| 새 화면(앱) | 옛 대본 옮기기 결과(성공·실패·한도 초과·암기 표시 이관) | reading.script, reading.memorization |
| A2.1·A2.2 | "기기에 저장 · 업로드 대기"와 "보관함 저장" 구분, 빈 보관함에 예시 영상 없음, 필터 "최근 7일" | practice.record, practice.library |
| A2.3 | 사용처(회차·챌린지) 표시, 참조 있는 영상 삭제 안내 | practice.library |
| A1.1·A1.2 | 묶음 단위 목록·회차 흐름, 숨김 문구 "기록에서 숨겨요. 영상은 보관함에 남아요", 리딩 회차 섞어 보이기 | practice.library |
| A4.1·D14·WM | 성별·나이 칸 삭제(프로필로), "마칠 때마다 적는다" 카피를 1·3·6회 규칙으로 | practice.memory |
| A7 | "이름은 남지 않아요" → "이름은 보이지 않아요", 건너뛰기도 한 번으로 셈 | practice.feedback |
| A12 | "분석 확정 · 배우님과 맞춘 내용" 카피를 확인 강제 없는 문구로, 화면 이름은 코칭 결과 | practice.note |
| D4 | 이론 선택 줄 삭제, 게스트 분석 횟수 안내 | practice.start, practice.resume |
| 새 화면(웹) | 영상 보관함·영상 상세, 이탈 설문 시트(외부 폼 대체) | practice.library, practice.feedback |
| 새 화면(앱) | 옛 보관함 영상 옮기기 확인, 분석 "그만두기"와 화면 이탈 구분, "파일만 파기" 동작 | practice.record, practice.analyze, practice.library |
| M4·M5·M6·M6.1·M6.1.1·M6.2·M6.3·M8·M9·M7·M7.3·M7.3-b, W6.1-R·W6.1.1-R·W6.3-R·W7-R-b·W8 | 각 기능의 화면 줄에 등록된 대응 화면으로 같은 규칙 적용 | practice.* |
| D7.1.2·M7.1·M7.2 | 기존 갈래 전용(분석 확인 대화·확정)으로 표시. 신형에 확인·후보 선택·직접 문장 작성 강제 없음 | practice.coach, practice.note |
| A10·W6·W6.3-R | "끝날 때까지 이 화면을 켜 두세요" → 화면을 떠나도 분석이 계속됨 | practice.analyze |
| A13·M9·W9-R | "배우님이 고른 한 문장"을 실제 선택이 없는 신형 제안에 자동 표시하지 않음 | practice.note |
| D7 계열·W7-R-b | 시작 뒤 불변인 장면 입력의 "고치기" 제거(대화 정정과 구분) | practice.start, practice.coach |
| D14·WM | 게스트에게 프로필 편집 대신 앱 이관 안내 | practice.memory |
| 영상 업로드 오류 | 크기 초과("너무 커요")와 길이 초과("너무 길어요") 안내 구분 | practice.record |
| A15.4 신고 | 사유를 서버 값 다섯(저작권·부적절·스팸·중복·기타)에 맞추고 기타에 메모 칸 | challenge.report |
| A16.2 등록 | 세 단계(대사 → 작품·인물·메모 → 기간 1주·2주), 중복 대사 안내 | challenge.create |
| A17 랭킹 | 종료된 챌린지의 순위 고정 표시, review·hidden 챌린지 안내 | challenge.browse |
| A18.3 완료 | 비공개 저장 완료 문구 | challenge.entry |
| P03 | 신고로 숨겨진 참여작 "확인 중", 공개·비공개 전환 진입 | challenge.entry, challenge.report |
| 새 화면(앱) | 알림함(최신순·읽음·배지), AI 리포트 화면(관찰·견주기·제안, 점수 없음), 내 챌린지 닫기(참여작 0개·24시간) | challenge.notification, challenge.ai-report, challenge.create |
| A15 반응 메뉴 | "이 사용자 차단" 추가, 공유는 참여작 딥링크 | challenge.block, challenge.react |
| A15.3·A17 | 댓글 신고·챌린지 신고 메뉴 추가, 댓글 하트 삭제(후속), 댓글 최신순 | challenge.report, challenge.react |
| A16 | "종료" 탭 추가, 인기 정렬 기준(좋아요 합·참여작 수) | challenge.browse |
| A17 | 동점 공동 순위, 최신순에 순위 숫자 없음, 좋아요 0이면 1위 배지 없음, 종료 랭킹 고정 표시 | challenge.browse |
| A18 촬영 | 60초 상한 표시 | challenge.entry |
| A18.1·A18.2 | 공개 범위 미리 선택 없음, 공개 시 "다른 참여자의 AI 리포트 비교에 쓰일 수 있어요" 한 줄, "올리면 자동 준비" 문구를 "요청하면 준비" 로 | challenge.entry, challenge.ai-report |
| A4 설정 | 차단 목록·풀기 | challenge.block |
| 챌린지 카드 | 주최자 탈퇴 표시("주최자 탈퇴"), 기획팀 챌린지 표시 | challenge.create |
| 새 문서 | PRD에 챌린지 절(리텐션 부가 기능, ADR-005 예외, 회원·앱·한국어 전용)을 사람이 추가한다 | 04-challenge |

## 처리방침·동의 문서에 반영할 것

동의 문서 새 판과 법무 확인에 넘길 목록이다. 문서를 고치면 판을 올리고 기존 회원은 게이트로 다시
받는다(account.consent).

| 문서 | 반영할 것 | 출처 |
|---|---|---|
| 개인정보 수집·이용 동의 | privacy 문서를 수집·이용 동의로 고쳐 새 판을 낸다. 처리방침은 고지로 분리해 공개 페이지에 싣는다 | account.consent |
| 개인정보 수집·이용 동의 | 필수 수집 항목 여섯과 항목마다 코칭에 쓰는 이유 한 줄 | account.profile |
| 개인정보 처리방침 | 만 14세 미만은 가입할 수 없고, 웹 게스트는 만 14세 이상임을 확인받음 | account.profile, account.guest |
| 개인정보 처리방침 | 탈퇴 때 파기하는 것과 가명처리해 남기는 것, 남기는 목적(통계·연구) | account.withdraw |
| 개인정보 처리방침 | 신원 해시를 탈퇴 후 3년 보관하고 쓰임은 철회 요청의 본인 확인 하나뿐임 | account.withdraw |
| 개인정보 처리방침 | 백업 덤프에 파기 전 데이터가 30일 남음 | account.withdraw |
| 개인정보 처리방침 | 탈퇴 뒤 제공자 연결 해제 재시도를 위해 해제 값을 최대 7일 암호화 보관 | account.withdraw |
| 개인정보 처리방침 | 보관 동의의 철회 연락처와 본인 확인 방법 | account.withdraw |
| 개인정보 처리방침 | 웹 게스트의 자료는 마지막 활동 30일 뒤 파기 | account.guest |
| 개인정보 처리방침 | 포트폴리오 공유 링크로 공개되는 항목 | account.portfolio |
| 이용약관 | 가입 방식에 카카오·네이버, 웹은 로그인 없이 게스트로 이용 | account.login, account.guest |
| 탈퇴 후 영상·녹음 보관·활용(신설, 선택) | 목적(서비스 개선과 AI 모델 학습 둘 다), 기간 3년, 철회 방법, 거절해도 서비스는 같음 | account.withdraw |
| AI 분석 동의 | 리딩에는 필요 없다. 서버가 대본·음성을 분석하지 않는다(03-reading, ADR-031) | account.guest, reading.recording |
| 법무 확인 | 가명처리 보관과 동의 기반 보관의 문구, 자유 글(배우 기억·대화·받아쓰기) 보존, 해시 보관 | account.withdraw |
| 운영 절차 문서 | 보관 동의 철회 요청을 처리하는 절차(해시 대조, 영상·녹음 파기, revoked 기록) | account.withdraw |
| 운영 배포 체크리스트 | 카카오·네이버는 검수 승인 뒤에만 운영에서 켠다 | account.login |
| 운영 배포 체크리스트 | 네이버·카카오 개발자 콘솔에 연결 끊기 콜백 주소를 등록한다(카카오는 POST, 기본 어드민 키) | account.login |
| 운영 배포 체크리스트 | 첫 배포 전에 신원 해시 키와 토큰 암호화 키를 넣는다. 한번 정하면 바꾸지 않는다 | account.withdraw |
| 운영 배포 체크리스트 | 애플 키 셋(팀 ID·키 ID·개인 키)을 넣는다. 없으면 처음 온 애플 신원의 로그인이 503이다 | account.login |
| 운영 배포 체크리스트 | 서버에 웹의 공개 주소(SITE_URL)를 넣는다. 포트폴리오 공유 링크의 주소가 여기서 나온다 | account.portfolio |
| 운영 배포 체크리스트 | 배포 뒤 IP 제한이 방문자마다 따로 걸리는지 한 번 확인한다(한 회선에서 61번째 공개 조회가 429, 다른 회선은 404) | account.guest, account.portfolio |
| 운영 절차 문서 | 보관 동의 철회 절차는 docs/deploy/RETENTION-REVOCATION.md에 있다 | account.withdraw |
| 법무·번역 | 개인정보 수집·이용 동의 v5와 탈퇴 후 보관 동의 v1의 영어판이 아직 없다. 영어 사용자에게는 한국어 본문이 보인다. 법무 확인 뒤 번역본을 manifest에 `en` 행으로 더한다 | account.consent |
| 운영 배포 체크리스트 | 1.0.0 서버는 새 앱의 심사 제출 직전에 배포한다. 그때부터 1.0.0 이전 앱은 426이다 | 공통 규칙 |
| 개인정보 처리방침 | 대본 원문·배역·줄, 리딩 회차, 내 대사 줄 단위 녹음과 전사가 서버에 저장됨(연습 목적, 본인만 봄, 지우면 즉시 삭제) | reading.script, reading.recording |
| 개인정보 처리방침 | 웹의 말한 것 글자로 바꾸기는 브라우저 음성인식을 써 말소리가 브라우저 제공자에게 전달됨. 앱은 기기 안 처리를 보장하는 음성인식만 씀. 배우가 고른 기기 음성 대체는 OS·브라우저 음성 서비스로 대사가 갈 수 있음. 서버는 음성을 분석하지 않고 형식 변환만 함 | reading.cast, reading.session, reading.memorization |
| 개인정보 처리방침 | 삭제는 즉시 조회 차단·DB 삭제이고 객체 삭제는 재시도, 백업 덤프 30일은 별도 | reading.script, reading.recording, account.withdraw |
| 개인정보 처리방침 | 게스트 서버 자료의 30일 파기와 닫힌 브라우저·오프라인 기기의 로컬 자료 제거 시점은 다름 | account.guest, reading |
| 개인정보 수집·이용 동의 | 서버에 저장하는 리딩 원문·음성·전사와 목적(연습)·보유 기간(삭제·탈퇴 시, 보관 동의 3년) | reading.script, reading.recording |
| 탈퇴 후 영상·녹음 보관·활용 | 리딩 녹음(음성·전사)도 대상이며 3년 기한·철회 파기가 같고, 대본 원문·배역 이름은 보관하지 않음. 미동의자의 리딩 전사는 녹음과 함께 파기(영상 받아쓰기 보존 규칙과 다름) | reading.recording, account.withdraw |
| 이용약관 | 사용자가 올린 대본의 권리 책임 | reading.script |
| 법무 확인 | 타인 저작물인 대본을 서버에 저장하고 본인만 열람·즉시 삭제하는 것(원래 기획이 기기 저장을 택한 근거), 보관 녹음의 전사가 대본 문장과 같을 수 있음 | reading.script, reading.recording |
| 법무 확인 | 리딩 전사의 보관 기간·철회 범위와 기존 "받아쓰기 텍스트 보존" 문구의 적용 범위 구분, 외부 음성 서비스(브라우저·OS)에 전달되는 음성·대본 범위와 고지 문구 | reading.recording, reading.session |
| 운영 배포 체크리스트 | 서버의 ffmpeg가 오디오 변환(webm/opus → m4a)을 할 수 있는지와 녹음 객체 저장 경로를 확인한다. 객체 삭제 7일 연속 실패 알림 채널을 정한다 | reading.recording |
| 개인정보 처리방침 | 영상은 720px 업로드본만 서버 보관(원본 없음), 계정당 총량(회원 5GiB·게스트 500MiB), 받아쓰기는 첫 분석 때 생성 | practice.record |
| 개인정보 처리방침 | 이탈 설문은 계정에 연결해 저장하고 구글 시트로 복제, 연락처는 90일 뒤 DB·시트 모두 파기(재시도 포함), 탈퇴 때 즉시 파기 | practice.feedback |
| 개인정보 처리방침 | 미확정 업로드 객체(30분 만료 뒤 삭제), 기기 대기 파일 7일 처리, 탈퇴 실행 기기와 다른 기기의 자료 제거 시점 | practice.record, account.withdraw |
| 개인정보 처리방침 | "파일만 파기"는 영상·받아쓰기를 지우고 회차 기록(대화·노트)은 남김 | practice.library |
| 운영 절차 문서 | 90일 만료·탈퇴 때 시트 연락처 삭제·실패 재시도·완료 확인 절차 | practice.feedback |
| 법무 확인 | 보관만 하는 영상 업로드에 AI 분석 동의를 함께 묶는 방식의 적정성 | practice.record |
| 법무 확인 | 설문 본문의 식별 정보 가능성과 탈퇴 후 보존 문구(연락처 삭제만으로 익명화되지 않음), 구글 시트 전송의 수탁·이전 관계와 고지 | practice.feedback, account.withdraw |
| 운영 절차 문서 | 탈퇴 때 시트의 연락처 삭제 절차 | practice.feedback |
| 개인정보 수집·이용 동의 | 보관만 하는 영상 업로드에도 AI 분석 동의를 함께 받는 이유(다음 길이 분석) | practice.record |
| 개인정보 처리방침 | 챌린지 공개 참여작은 다른 회원에게 이름·사진·영상·캡션이 보이고, 조회수·좋아요·댓글이 집계됨. 비공개는 본인만 | challenge.entry, challenge.browse |
| 개인정보 처리방침 | AI 리포트는 같은 대사의 다른 공개 참여작 영상을 식별 정보 없이 비교 입력으로 씀. 알림함은 90일 보관 | challenge.ai-report, challenge.notification |
| 이용약관 | 챌린지 대사·영상의 저작권 책임과 신고·숨김 처리 | challenge.create, challenge.report |
| 운영 절차 문서 | 신고 검토(되돌림·숨김), 챌린지 review 처리, 오늘의 챌린지 등록 관리 경로 | challenge.report, challenge.create |
| 개인정보 처리방침 | 사람 차단(user_blocks)의 효과와 상대에게 알리지 않음, 신고 기록의 90일 보관과 신원 비공개 | challenge.block, challenge.report |
| 개인정보 처리방침·이용약관 | 공개 참여작은 다른 참여자의 AI 리포트 비교 표본으로 쓰일 수 있음(식별 정보 없이), 비공개는 쓰이지 않음 | challenge.ai-report |
| 운영 절차 문서 | 신고 처리 목표(첫 확인 24시간·처리 72시간), 처리자·판정 기록, 챌린지 review 처리, 오늘의 챌린지 선정 관리 경로 | challenge.report, challenge.create |
| 운영 배포 체크리스트 | 챌린지 관리 경로(기획팀 개설·featured_on·신고 처리)의 접근 권한과 알림 발송 실패 보고 채널 | challenge.create, challenge.notification |

## 범위 밖

1.0.0에서 하지 않는 것.

- 커뮤니티(게시판)는 1.0.0에서 뺀다. 요구사항과 결정은 [05-community.md](05-community.md)에
  보관하고 후속에서 잇는다. 테이블 7개와 기존 글 데이터는 남기고 API·화면만 내린다.
- 계정 정지·운영 차단. 1.0.0에는 신고·운영 숨김·사람 차단(user_blocks, ADR-032)만 있다.
- 챌린지의 댓글 좋아요·답글, 사용자당 하루 한 번 조회수(entry_views), 챌린지 공유 링크의 웹 공개 페이지, 랭킹 캐시 컬럼, 오늘의 챌린지·
  순위 변동·새 참여 푸시, 사용자 개설의 사전 검토, 여러 챌린지를 섞는 전체 피드.
- 가입 유입 경로 추적. users의 signup_* 컬럼은 지우고 signup_attributions 테이블은 만들지 않는다.

## 열린 질문

ERD 세션(2026-09-14)에서 이월한 것.

- 연기 입시: notices.json 정적 유지 vs 테이블.
- 이론 선택은 1.0.0에서 뺐다(practice.start, 2026-09-21).
- "작업·잡·job"과 ai_jobs: 테이블 이름 ai_jobs를 유지하고 용어집에 AI Job(비동기 AI 요청, External Operation의 한 종류)을 더했다
  (2026-09-21). 계정 정리 장부·설문 시트 전송은 AI Job이 아니다.
- 리딩 관련은 2026-09-21에 해소했다(03-reading): 예시 대본은 내장 리소스, 온보딩·가이드 플래그는 기기 저장소,
  script_characters 유지, 서버 TTS 캐시(script_lines.audio_key)는 후속.

리딩 요구사항(2026-09-21)에서 후속으로 남긴 것.

- 웹의 구간 선택 UI(1.0.0 웹은 전체 구간만).
- 한국어 밖 대본의 대조. STT 언어는 앱·브라우저 표시 언어를 따르고 그 밖은 정하지 않았다.
- 녹음 시도를 모두 남기는 것(1.0.0은 같은 줄을 다시 말하면 대체).
- 대본 저장 뒤 다시 나누기(원문은 이를 위해 남긴다).

계정 검토(2026-09-19)에서 나온 것.

- 앱 심사 지침 1.2·Google Play UGC(신고·악성 사용자 차단): 챌린지 1.0.0에 신고(참여작·댓글·챌린지)와 사람 차단(user_blocks)을 함께
  넣어 충족한다(challenge.report, challenge.block, ADR-032, 2026-09-21). 계정 정지는 두지 않는다.
- PRD·ADR-005의 랭킹 금지와 챌린지 좋아요 랭킹: ADR-005 개정(2026-09-21)으로 반응 순서만 예외로 허용했다. PRD의 챌린지 절은 사람이 쓴다.
- 용어집은 "작업·잡·job"을 피하고 External Operation을 쓰는데 1.0.0 ERD의 테이블 이름은 ai_jobs다.
  연습 문서를 쓸 때 용어집을 고칠지 테이블 이름을 바꿀지 정한다.
