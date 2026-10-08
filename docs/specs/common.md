# 공통 요구사항

옛 경로는 `docs/requirements/00-common.md`다. 적용된 Flyway 마이그레이션(V9·V13·V14)의 주석이 그 이름으로 부르며, 마이그레이션은 checksum 때문에 고치지 않는다.
쓰는 법과 기능 목록은 [README.md](README.md)에 있다.

## 공통 규칙

영역마다 반복되는 규칙은 여기에 한 번만 쓰고, 각 기능에는 다른 점만 적는다.

### 게이트와 보호 기능

로그인한 사람이 필수·선택 동의를 모두 결정하고 프로필 필수 항목을 다 채워야 통과하는 문이
게이트다. 순서는 동의 → 프로필이고, 요청마다 DB 상태로 판정하며 토큰을 갱신해도 열리지 않는다.
요청의 판정 순서는 426 → 토큰(401) → 계정 상태(403 `account_deactivated`) → 분당 한도(429, 계정마다 분당 60회) → 동의
(403 `consent_required`) → 프로필(403 `profile_required`)이다.

아래 표는 보호 기능이 아니라 **게이트 밖**을 적는다. 적지 않은 새 경로는 닫힌 채로 시작한다.

| 단계 | 경로 |
|---|---|
| 게이트 밖 | 로그인·가입 제출·게스트 시작·토큰 갱신·로그아웃·제공자 목록(`/v2/auth/**`), 동의 문서 조회와 제출(`/v2/consents/**`), 내 정보 조회와 탈퇴(`GET`·`DELETE /v2/me`), 푸시 토큰 삭제(`DELETE /v2/push-tokens` — 로그인 없이 받는다, account.notification), 공개 입시 정보(`/v2/admissions/**`), 오디션 공고 목록(`GET /v2/auditions`, app.audition), 공개 조회(`GET /v2/public/**` — 포트폴리오 공유 account.portfolio, 참여작 공유 challenge), 운영 경로(`/v2/admin/**`) |
| 게스트 전용 | 이관 코드 받기(`/v2/guest/**`) — 필요한 동의 문서가 없다. 회원이 부르면 403 `guest_only` (account.guest) |
| 동의까지만 | 프로필 저장(`PUT /v2/me/profile`) — 개인정보를 받기 전에 수집 동의가 끝나 있어야 하고, 프로필이 빈 사람이 채우는 자리다 (account.profile) |
| 개인정보 동의만 | 웹 유입 최초 기록(`PUT /v2/me/web-attribution`) — 회원·게스트 모두 인증과 현재 개인정보 수집·이용 동의가 필요하고 프로필은 보지 않는다. 앱 `PUT /v2/me/signup-attribution`은 기존 회원 전용 보호 기능을 유지한다. |
| 동의 + 프로필 | 그 밖의 모든 `/v2`. 보호 기능이며 게이트를 통과하기 전에는 쓸 수 없다 |

- 개인정보 동의만 보는 웹 유입 경로를 제외하면 위 표는 회원의 규칙이다. 게스트의 규칙은 아래 문단과 account.guest에 있다.
- 토큰 없이 여는 공개 조회(동의 문서·고지, 입시 정보, 제공자 목록, `GET /v2/public/**`), 게스트 시작
  (`POST /v2/auth/guest`), 푸시 토큰 삭제(`DELETE /v2/push-tokens`), 제공자가 부르는 연결 끊기 알림은 `Authorization`
  헤더가 와도 검증하지 않는다. 만료된 토큰을 전역으로 붙이는 클라이언트가
  게이트 앞의 공개 콘텐츠에서 401을 받지 않게 한다.
- `account_deactivated`의 예외는 탈퇴(`DELETE /v2/me`) 하나다. 탈퇴 도중 앱이 죽어 다시 누른 사람이 403을
  받으면 기기의 자료를 지우는 다음 단계로 가지 못한다. 그 밖의 모든 경로는 남은 액세스 토큰을 요청마다
  403으로 막는다. (account.withdraw)
- 어느 경우에도 막힌 원 요청을 서버가 재실행하지 않는다.

회원과 웹 게스트의 게이트는 의도적으로 다르다. 게스트의 게이트(기능별 문서, 프로필 면제, `member_only`)는
[account.guest](account/guest.md#규칙제약)가 정본이다.

### 오류 응답

- 오류 본문의 모양(사유 코드 하나, 422의 두 모양, 형제 필드를 싣는 오류)은 [CONTRACT §6-2](../../apps/api/CONTRACT.md#6-2-오류-계약은-대부분-openapijson-에-없다)가 정본이다.
- 없는 것과 남의 것은 같은 404다. 존재 여부를 알려 주지 않는다.

### 요청 재전송

재전송이 문제가 되는 쓰기 요청은 기기가 만든 요청 id(`request_id`)를 싣는다. 연결이 끊겨 기기가 같은 요청을 다시 보내도
행·알림·AI 작업이 두 번 생기지 않게 하기 위해서다. 서버는 요청 id를 주체마다 유일하게 두고 본문의 지문을 함께 저장해
재전송을 가른다.

- 같은 요청 id의 재전송은 새로 만들지 않고 처음 요청의 결과를 돌려준다. 이 확인은 상태·하루 횟수·개수·총량 같은 다른
  판정보다 먼저다. 한도에 막 닿은 뒤에도 마지막으로 허용된 요청의 재시도가 한도에 걸려 실패하지 않게 하기 위해서다.
- 같은 요청 id에 본문이 다르면 422 `request_fingerprint_mismatch`다. 본문은 처음 요청 때 저장한 지문(정규화한 본문)으로
  견주고, 지문 칸이 없는 기능은 저장된 값과 견준다.
- 게스트를 회원으로 옮길 때 두 계정의 요청 id가 겹치면 게스트 쪽 값을 비우고 옮긴다. 자료는 잃지 않는다(account.guest).
- 기능 파일에는 이 절과 다른 점만 적는다: 요청 id의 유일 범위(예: 사람마다 (user_id, request_id)), 무엇을 본문으로 보는지,
  처음 결과가 지워진 뒤 같은 id가 오면 어떻게 되는지, 재전송의 응답 코드, 이 절을 따르지 않는 점(예: 녹음은 본문을 견주지
  않는다, reading.recording).
- 요청 id 없이 (대상, 사람) 유일인 연결 행으로 저장하는 켜기·끄기(좋아요·저장·차단)와 같은 값을 덮어쓰는 갱신(암기 표시)은
  다시 보내도 결과가 같아 이 절을 쓰지 않는다.

### 클라이언트 판과 강제 업데이트

- 앱과 웹은 요청마다 자기 종류와 판을 헤더(X-Acttub-Client, 예: app/0.1.0)로 보낸다.
- 이 헤더가 없거나 비어 있는 `/v2` 요청은 무엇을 부르든 0.1.0 이전 빌드로 보고 426과 업데이트 안내 문장
  `{"detail":"새 버전이 나왔어요. 스토어에서 업데이트해 주세요."}`로 답한다. 0.1.0 이전 앱은 모르는 상태 코드에
  실린 `detail`을 그대로 보여 주기 때문에 여기만 `detail`이 코드가 아니라 문장이다. 문구를 고치면 옛 앱의
  화면이 바뀐다. 서버에 옛 규칙(로그인 즉시 계정 생성, 필수 문서만
  보는 게이트, 닉네임)을 남기지 않는다. 0.1.0이 막으려는 구멍을 옛 빌드 때문에 열어 두지 않기 위해서다.
- `/v2` 밖(상태 확인·관리 포트), 제공자가 부르는 연결 끊기 콜백, 운영 토큰으로 여는 `/v2/admin/**`는 이 헤더를
  보지 않는다.
- 서버 배포부터 새 앱 출시까지(스토어 심사 기간) 0.1.0 이전 앱은 쓸 수 없다. 심사 제출 직전에 배포하고
  통과 즉시 출시해 줄인다. 0.1.0은 이를 받아들인다.
- 새 앱은 426을 받으면 업데이트 안내 화면을 보여 준다. 뒤에 최소 판을 올려 같은 방식으로 안내할 수 있다.

### 탈퇴·삭제

- 탈퇴가 계정 자료에 하는 일과 재가입은 [account.withdraw](account/withdraw.md#규칙제약), 영역 자료에 하는 일은 각 영역
  README의 「…이관·삭제·탈퇴」 표가 정본이다. 영역마다 탈퇴한 사람의 행을 어떻게 보일지만 따로 정한다.
- 다른 사람에게 보이던 행(챌린지 댓글, 챌린지 알림의 행동한 사람, 되살릴 때의 커뮤니티 글·댓글)은 작성자가 탈퇴해도
  지우지 않고 작성자를 "탈퇴한 사용자"로 보인다. 지우면 남의 글타래가 깨지기 때문이다(ADR-029). 이름은 행에 복사해 두지
  않고 조회 때 조립하므로([account.profile](account/profile.md#규칙제약)) 탈퇴한 뒤에는 이 표시로 바뀐다. 어느 행을 남기는지는
  영역 표([챌린지](challenge/README.md#챌린지-자료의-삭제탈퇴), [커뮤니티](community/README.md#보관하는-결정))가 정한다.

### 탈퇴와 겹친 쓰기

게이트는 계정 상태를 요청의 앞머리에서 보므로, 게이트를 지난 쓰기가 다른 기기의 탈퇴와 겹칠 수 있다. 그래서 쓰기는
저장하는 순간에 계정이 아직 활성인지 다시 본다.

- 쓰기가 먼저 끝나면 탈퇴가 그 뒤에 파기한다.
- 탈퇴가 먼저 끝났으면 쓰지 않고 403 `account_deactivated`로 답한다. 게이트가 했을 답과 같아서, 앱은 이 사유로 옛
  계정의 쓰기와 재시도를 멈추고 기기의 자료를 지운다.
- 탈퇴는 users 행을 남기므로, 이 확인이 없으면 파기한 값(이름·생년월일)이 다시 차고 지운 행(포트폴리오)이 되살아난다.
- 다르게 답하는 기능은 그 기능의 입구 표에 적는다. 푸시 토큰 등록은 저장하지 않고 204다([account.notification](account/notification.md#입력출력)).
- 게스트 이관도 옛 게스트 계정을 닫으므로, 부모 행 없이 새로 만드는 옛 게스트의 쓰기(대본 등록 등)는 이관 뒤에도 이 절대로
  403이다. 부모 행에 매달린 쓰기, 바깥 호출을 기다린 뒤의 저장, 부모 행이 지워진 쓰기는 [저장 직전 재확인](#저장-직전-재확인)이 정한다.

잠금과 트랜잭션은 [CONTRACT §6-8](../../apps/api/CONTRACT.md#6-8-탈퇴)의 "탈퇴와 겹친 쓰기"가 정본이다.

### 저장 직전 재확인

게이트는 요청의 앞머리에서 계정을 보고, 녹음 변환·분석·코치 응답처럼 기다리는 일이 있는 동안에는 시간이 흐른다. 그 사이
다른 기기의 게스트 이관·탈퇴나 부모 행의 삭제가 먼저 끝날 수 있으므로, 연습과 리딩의 쓰기는 최종 저장하는 순간에 쓰기가
기대는 것을 다시 본다.

- 요청한 사람의 자료에 쓰는 요청(대본·회차·녹음·암기, 연습의 시작·이어하기 등): 부모 행(대본·회차·영상·연습)이 아직 있고
  주인이 요청한 사람인지 본다. 아니면 쓰지 않는다(응답은 기능마다 다르고, 리딩은 없는 것과 같은 404다). 부모 행 없이 새로
  만드는 쓰기(대본 등록 등)는 계정이 활성인지 보고, 아니면 [탈퇴와 겹친 쓰기](#탈퇴와-겹친-쓰기)대로 403이다.
- 모델을 기다린 뒤의 저장(분석 완료·코치 응답·기억 갱신): 부모 행의 지금 주인에게 저장하되 그 계정이 활성인지 본다. 뒤에서
  도는 작업은 lease가 그대로인지도 보고, 기억 갱신은 기억 세대도 본다(practice.memory). 이관 뒤에는 지금 주인(회원)에게
  저장되고, 탈퇴 뒤에는 저장하지 않는다(코치 응답은 403, 작업은 failed/account_deactivated로 닫는다 — [공통 상태](#공통-상태)).
- 저장하지 못한 쓰기가 이미 저장소에 올린 객체(녹음 등)는 삭제 장부로 지운다.
- 쓰기가 먼저 끝났으면 뒤따른 이관·탈퇴·삭제가 그 행까지 함께 옮기거나 지운다. 어느 쪽이든 옛 계정에 새 행이 남지 않는다.
- 기능마다의 결과는 각 기능 파일의 「예외」에, 잠그는 행과 순서는 CONTRACT §6-8·§6-14·§6-15에 있다.

### 공개 범위

다른 사람에게 무엇이 보이는지의 기본값(이름만 공개, 나머지는 본인만)은 [account.profile](account/profile.md#규칙제약)이
정한다. 기능별로 다른 점만 각 기능의 절에 적는다.

### 공통 상태

ai_jobs.status — 연습과 챌린지가 함께 쓰는 비동기 AI 작업 장부(AI Job). 종류는 `AiJobKind`이고, 종류마다 무엇을
하고 어떤 실패가 즉시 끝나는지는 그 기능 파일(practice.analyze, practice.memory, challenge.ai-report)이 적는다. 각 기능의
「상태」 절에는 이 표를 쓴다는 사실과 자기 전이만 적는다.

| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| pending | 작업 생성(분석 시작·이어하기·재시도, 대화 종료 뒤 기억 갱신 예약, AI 리포트 요청), running에서 일시 실패로 놓기(시도 수 유지) | practice.start, practice.resume, practice.analyze, practice.memory, challenge.ai-report |
| running | pending 선점(시도 수 +1, lease_token·만료 시각). 시도 수가 3 미만일 때만 | practice.analyze, practice.memory, challenge.ai-report |
| succeeded | running에서 완료. lease_token이 그대로일 때 | practice.analyze, practice.memory, challenge.ai-report |
| failed | running에서 즉시 실패(사유는 종류별), 3회 소진 뒤 정리(앞서 놓을 때 적힌 사유를 유지하고, 없을 때만 max_attempts), 취소(cancelled — 분석 그만두기·참여작 삭제), 탈퇴(account_deactivated), 기억 세대 불일치(memory_epoch_stale) | practice.analyze, practice.memory, challenge.entry, challenge.ai-report, account.withdraw |

- 불변 조건: (user_id, request_id)당 작업 하나(`uq_ai_jobs_user_request`). 완료·실패·놓기는 lease_token이 그대로일 때만 통하고,
  바뀌었으면 저장 전체를 되돌린다. 만료가 지나도 토큰이 그대로면 완료를 받는다. 놓기는 시도 수를 되돌리지 않는다(최대 3회).
- 선점은 pending만 집는다. 만료된 running을 다시 집지 않는다(practice.analyze 「열린 질문」).
- 끝 상태: succeeded·failed. 재시도는 같은 행을 되살리지 않고 새 작업을 만든다.

옛 연습 흐름의 호환 원장 `external_operations`의 상태 전이(만료된 running의 회수 포함)는
[CONTRACT §5-7](../../apps/api/CONTRACT.md#5-7-external_operations-lease-상태-전이--고정-계약)이 정본이다.

### 검증 방법 공통

기능마다 반복되는 확인 방법을 여기에 모은다. 각 기능의 검증 방법에는 그 기능에만 있는 확인만 남긴다.

- 클라이언트 판 헤더 없이 연습 API 호출: 426과 업데이트 안내 문장. 헤더 없이 상태 확인과 제공자 콜백:
  막히지 않는다.
- 규칙에 걸린 422의 본문: 사유 코드 하나. 필수 항목이 빠진 422의 본문: 항목 배열.
- 미결정 동의 문서가 있는 회원의 보호 API 호출: 403 `consent_required`와 미결정 문서 목록. 토큰을 갱신해도 같다. 모두
  결정하면(선택 문서는 거절도 결정이다) 같은 토큰으로 허용된다.
- 동의를 마치고 프로필이 덜 찬 회원의 보호 API 호출: 403 `profile_required`. 다 채우면 같은 토큰으로 허용된다.
- 게이트를 지난 쓰기보다 다른 기기의 탈퇴가 먼저 끝나면: 403 `account_deactivated`이고 파기한 값이 되살아나지 않는다.
  다르게 답하는 기능의 확인은 그 기능의 검증 방법에 있다.
- 요청 id를 싣는 쓰기를 같은 id·같은 본문으로 두 번: 행 하나이고 두 응답이 같은 대상을 가리킨다. 같은 id·다른 본문: 422
  `request_fingerprint_mismatch`. 하루 한도에 닿은 뒤 마지막으로 허용된 요청의 재전송: 한도 오류 없이 처음 결과.
- 부모 행(대본·회차)을 지우거나 이관한 뒤 늦게 도착한 그 아래의 쓰기(진행 저장·녹음·암기): 옛 계정에 행이 없다.

## ERD에 반영할 변경

계정 요구사항(2026-09-17 검토)에서 ERD 합의 뒤에 생긴 변경이다. ERD 아티팩트는 아직 이 목록을
반영하지 않았다. 컬럼·값·제약의 정본은 마이그레이션(`apps/api/src/main/resources/db/migration/`)이고, 그 값이
무엇을 뜻하는지는 출처 기능 파일이 정한다.

| 변경 | 테이블 | 출처 |
|---|---|---|
| 추가 | user_profile_directions | account.profile |
| 추가 | portfolios, portfolio_credits, portfolio_photos | account.portfolio |
| 추가 | guest_transfer_codes | account.guest |
| 추가 | account_cleanup_operations | account.withdraw |
| 추가 | entry_view_events | challenge.browse |
| 추가 | notification_pushes | challenge.notification |
| 추가 | notifications | challenge.notification |
| 추가 | user_blocks | challenge.block |
| 추가 | evening_reminder_sends | account.notification |
| 추가 | reading_voice_cache, reading_voice_usage | reading.cloud-voice |
| 컬럼·값 | users | account.login, account.guest, practice.feedback |
| 컬럼·값 | user_identities | account.login, account.guest, account.withdraw |
| 컬럼 | user_profiles | account.profile, account.notification, account.withdraw |
| 컬럼 | push_tokens | account.notification |
| 삭제 | users.nickname([CONTRACT §5-1](../../apps/api/CONTRACT.md#5-1-운영-db-접근은-jpa-로-일원화한다)의 순서로) | account.profile |
| 컬럼·제약 | scripts, script_characters, script_lines | reading.script, reading.cast |
| 컬럼 | reading_sessions, reading_recordings, line_memorization | reading.session, reading.recording, reading.memorization |
| 컬럼 | videos, upload_intents | practice.record, practice.library |
| 컬럼 | practices | practice.start, practice.resume, practice.library |
| 컬럼 | analyses, video_transcripts | practice.analyze |
| 컬럼 | coach_conversations, coach_messages, coach_notes | practice.coach, practice.note |
| 컬럼 | practice_feedback | practice.feedback |
| 컬럼 | actor_memories | practice.memory |
| 값 | ai_jobs, account_cleanup_operations | practice.analyze, practice.memory, challenge.ai-report, reading.recording |
| 컬럼 | challenges, challenge_entries | challenge.create, challenge.entry, challenge.browse |
| 컬럼·제약 | entry_comments, entry_reports, entry_ai_reports | challenge.react, challenge.report, challenge.ai-report |
| 삭제 조건 | 옛 연습 테이블 | [practice 「0.1.0 스키마 전환」](practice/README.md#010-스키마-전환) |

## 디자인에 반영할 것

pen을 고칠 목록이다. 무엇을 어떻게 바꾸는지(문구·수치)는 출처 기능의 본문이 정본이고 여기에는 바꿀 요소만 둔다.

| 화면 | 바꿀 것 | 출처 |
|---|---|---|
| A0 로그인 | 제공자 버튼 목록, 마지막 제공자 강조, 이메일 겹침 안내 | account.login |
| A0.1 동의 | 선택 문서 줄, 저장 버튼 문구, privacy 문서 이름, 재동의 팝업 | account.login, account.consent |
| A0.2 프로필 설정 | 생년월일 칸, 이름 칸 안내 문구, 만 14세 미만 생년월일 칸 아래 안내 | account.profile |
| A4 설정 | 알림 토글, 문서별 동의 현황, 선택 동의 바꾸기, 차단 목록·풀기 | account.notification, account.consent, challenge.block |
| A4 설정·프로필 | 프로필 수정 진입점 | account.profile |
| A5 탈퇴 | 안내 문구(지워지는 것·남는 것) | account.withdraw, reading.recording |
| 새 화면(앱) | 포트폴리오 편집, 이관 코드 입력, 기억 선택 팝업, 업데이트 안내(426) | account.portfolio, account.guest, 공통 규칙 |
| 새 화면(웹) | 게스트 시작 안내, 기능별 동의 시트(나이 확인 줄 포함), 이관 코드, 옮긴 뒤 안내, 포트폴리오 공개 페이지 | account.guest, account.portfolio |
| 없앨 화면(웹) | W2 로그인, D3.1 동의 결정, 상단 탐색의 아바타 | account.guest |
| A2.1·A2.2 | 저장 상태 표시(업로드 전·후 구분), 빈 보관함, 필터 | practice.record, practice.library |
| A2.3 | 사용처 표시, 참조 있는 영상의 삭제 안내 | practice.library |
| A1.1·A1.2 | 묶음 단위 목록·회차 흐름, 숨김 문구 | practice.library |
| A4.1·D14·WM | 성별·나이 칸, 기억 갱신 시점 카피 | practice.memory |
| A7 | 수집 범위 문구, 건너뛰기 처리 | practice.feedback |
| A12 | 확인을 강제하는 옛 카피, 화면 이름 | practice.note |
| D4 | 이론 선택 줄, 게스트 분석 횟수 안내 | practice.start, practice.resume |
| 새 화면(웹) | 영상 보관함·영상 상세, 이탈 설문 시트 | practice.library, practice.feedback |
| 새 화면(앱) | 옛 보관함 영상 옮기기 확인, 분석 그만두기와 화면 이탈 구분, 파일만 파기 | practice.record, practice.analyze, practice.library |
| M4·M5·M6·M6.1·M6.1.1·M6.2·M6.3·M8·M9·M7·M7.3·M7.3-b, W6.1-R·W6.1.1-R·W6.3-R·W7-R-b·W8 | 각 기능의 화면 줄에 등록된 대응 화면 | practice.* |
| D7.1.2·M7.1·M7.2 | 기존 갈래 전용 표시, 신형의 확인·후보 선택·자기 정리 문장 | practice.coach, practice.note |
| A10·W6·W6.3-R | 화면 유지 안내 문구 | practice.analyze |
| A13·M9·W9-R | 제안의 선택 표시 | practice.note |
| D7 계열·W7-R-b | 장면 입력의 고치기 | practice.start, practice.coach |
| D14·WM | 게스트의 프로필 편집 자리 | practice.memory |
| 영상 업로드 오류 | 크기 초과와 길이 초과 안내 | practice.record |
| D18·WR3 | 암기 대조의 발화 확정·미달 처리·입력하기, 음성인식·서버 저장 안내 | reading.session |
| 웹 암기 | 완료 회차에서의 진입, 외운 대사 다시 보기(표시 취소), 원문 듣기와 따라 말하기의 마이크 구분 | reading.memorization |
| D13 대본 넣기 | 최근 대본 목록, 기기 저장 안내 삭제, 저작권 안내, 서버 나누기 팝업(앱 R2.4·R2.7·R2.8·R2.11~R2.15와 같은 뜻) | reading.script |
| D16 대본 확인 | 없앤다 — 웹도 확인 화면 없이 바로 저장한다 | reading.script |
| D17 설정 | 내 배역 여러 개, 가리기, 녹음 켬·끔과 소리 안내 삭제, 모델 용량, 구간 선택 | reading.cast, reading.session, reading.recording |
| D18 실행 | 나가기 확인, 가리기 토글, 녹음 표시, 말한 것 표시 | reading.session, reading.recording |
| D19 완료 | 다시 볼 대사, 암기 대조 완료 표기 | reading.session |
| 목소리 준비 실패(웹) | 세 선택지 화면 | reading.cast |
| 새 화면(앱) | 알림함, AI 리포트 | challenge.notification, challenge.ai-report |
| 새 화면(웹) | 대본 상세·회차 목록·이어하기·녹음 재생, 암기 화면 | reading.session, reading.recording, reading.memorization |
| A14 | 넘기는 방향 안내 | challenge.browse |
| A15 반응 메뉴 | 사용자 차단 메뉴, 공유(참여작 딥링크) | challenge.block, challenge.react |
| A15.3 | 본인 숨김 댓글 표시·삭제, 댓글 작성자·참여작 작성자 차단 구분 | challenge.react, challenge.report, challenge.block |
| A15.3·A17 | 댓글 신고·챌린지 신고 메뉴, 댓글 하트 삭제, 댓글 정렬 | challenge.report, challenge.react |
| A15.4 신고 | 사유 선택지와 기타 메모 칸 | challenge.report |
| A15·A17·P03 | 종료 집계 상태 구분, 최종 순위와 현재 좋아요 구분, 커서 만료 뒤 새로 조회 | challenge.browse |
| A15·A15.3·A16·A17·A4 차단 목록 | 이름 첫 글자 아바타 | challenge.browse, challenge.react, challenge.block |
| A16 | 종료 탭, 인기 정렬 기준 | challenge.browse |
| A16·A17 | 오늘의 챌린지를 고정하는 탭 | challenge.browse |
| A16.2 등록 | 세 단계 입력, 기간 선택지, 중복 대사 안내 | challenge.create |
| A17 | 순위 표시(공동 순위, 최신순, 1위 배지, 종료 뒤 고정), review·hidden 챌린지 안내 | challenge.browse |
| A17 주최자 메뉴 | 참여작 없는 챌린지 삭제 | challenge.create |
| A18 촬영 | 길이 상한 표시 | challenge.entry |
| A18.1·A18.2 | 공개 범위 선택, 표본 활용 안내, AI 리포트 준비 문구 | challenge.entry, challenge.ai-report |
| A18.3 완료 | 비공개 저장 완료 문구 | challenge.entry |
| P03 | 확인 중 표시, 공개·비공개 전환 진입 | challenge.entry, challenge.report |
| P03·AI 리포트 | 파일 파기 뒤 공개·새 생성 불가 안내, 확인 중·비공개 겹침 표시 | challenge.entry, challenge.ai-report |
| 챌린지 카드 | 주최자 탈퇴 표시, 기획팀 챌린지 표시 | challenge.create |
| 알림함 | 묶음 단위 페이지·열람·읽음, 비공개 본인 AI 리포트 진입, 무효 반응 제외 | challenge.notification |
| 내릴 화면 | 커뮤니티 화면 전부(목록은 community) | community |

## 처리방침·동의 문서에 반영할 것

동의 문서 새 판과 법무 확인에 넘길 목록이다. 판을 올릴지와 기존 회원의 재결정은 [account.consent](account/consent.md#규칙제약)가
정한다. 반영할 문구·수치는 출처 기능의 본문이 정본이다.

| 문서 | 반영할 것 | 출처 |
|---|---|---|
| 개인정보 수집·이용 동의 | privacy 문서의 이름과 처리방침(고지) 분리 | account.consent |
| 개인정보 수집·이용 동의 | 필수 수집 항목과 항목별 이유 | account.profile |
| 개인정보 처리방침 | 만 14세 미만 가입 제한과 게스트 나이 확인 | account.profile, account.guest |
| 개인정보 처리방침 | 탈퇴 때 파기·가명처리하는 것과 남기는 목적 | account.withdraw |
| 개인정보 처리방침 | 신원 해시의 보관 기간과 쓰임 | account.withdraw |
| 개인정보 처리방침 | 백업 덤프의 보관 기간 | account.withdraw |
| 개인정보 처리방침 | 정리 장부가 해제 값·객체 키를 들고 있는 기간 | account.withdraw |
| 개인정보 처리방침 | 보관 동의의 철회 연락처와 본인 확인 방법 | account.withdraw |
| 개인정보 처리방침 | 게스트 자료의 파기 시점 | account.guest |
| 개인정보 처리방침 | 포트폴리오 공유 링크로 공개되는 항목 | account.portfolio |
| 이용약관 | 가입 방식(제공자)과 웹 게스트 이용 | account.login, account.guest |
| 탈퇴 후 영상·녹음 보관·활용(신설, 선택) | 목적, 보관 기간, 철회 방법, 거절해도 같은 서비스 | account.withdraw |
| AI 분석 동의 | 리딩에 AI 분석 동의가 필요 없는 이유 | account.guest, reading.recording |
| 법무 확인 | 가명처리 보관과 동의 기반 보관의 문구, 자유 글(배우 기억·대화·받아쓰기) 보존, 해시 보관 | account.withdraw |
| 운영 배포 체크리스트 | 계정 비밀 키·SITE_URL·애플 키 셋·카카오/네이버 검수 승인과 연결 끊기 콜백 등록·배포 뒤 IP 제한 확인은 [DEPLOY-HOME §2](../deploy/DEPLOY-HOME.md#2-서버-준비와-시크릿)에 있다 | account.login, account.withdraw, account.portfolio, account.guest |
| 개인정보 처리방침 | 서버에 두는 영상(업로드본만), 계정당 총량, 받아쓰기 생성 시점 | practice.record, practice.analyze |
| 개인정보 처리방침 | 이탈 설문의 계정 연결·시트 복제, 연락처 보관 기간과 파기 | practice.feedback |
| 개인정보 처리방침 | 미확정 업로드 객체의 삭제, 기기 대기 파일의 처리, 기기마다 다른 자료 제거 시점 | practice.record, account.withdraw |
| 개인정보 처리방침 | 파일만 파기가 지우는 것과 남기는 것 | practice.library |
| 운영 절차 문서 | 시트 연락처 삭제·실패 재시도·완료 확인 절차 | practice.feedback |
| 법무 확인 | 보관만 하는 영상 업로드에 AI 분석 동의를 함께 묶는 방식 | practice.record |
| 법무 확인 | 설문 본문의 식별 정보와 탈퇴 후 보존 문구, 구글 시트 전송의 수탁·이전 관계와 고지 | practice.feedback, account.withdraw |
| 운영 절차 문서 | 탈퇴 때 시트의 연락처 삭제 절차 | practice.feedback |
| 개인정보 수집·이용 동의 | 보관만 하는 업로드의 AI 분석 동의 이유 | practice.record |
| 개인정보 처리방침 | 리딩 자료(대본·회차·녹음·전사)의 서버 저장과 목적·열람 범위 | reading.script, reading.recording |
| 개인정보 처리방침 | 음성인식·기기 음성으로 밖에 전달되는 범위(앱이 묻지 않고 기기 기본 목소리로 읽는 경우 포함, 화면 고지 없음), 서버의 형식 변환 | reading.cast, reading.cloud-voice, reading.session, reading.memorization |
| 개인정보 처리방침 | 앱 리딩 중 내 차례는 늘 녹음돼 계정에 저장된다(화면 안내 없음) | reading.recording |
| 개인정보 처리방침 | 삭제의 즉시 차단과 객체 삭제 재시도, 백업 보관 | reading.script, reading.recording, account.withdraw |
| 개인정보 처리방침 | 게스트 서버 자료와 기기 로컬 자료의 제거 시점 차이 | account.guest, reading |
| 개인정보 수집·이용 동의 | 리딩 원문·음성·전사의 수집 항목과 목적·보유 기간 | reading.script, reading.recording |
| 탈퇴 후 영상·녹음 보관·활용 | 리딩 녹음(음성·전사)의 보관 범위 | reading.recording, account.withdraw |
| 이용약관 | 사용자가 올린 대본의 권리 책임 | reading.script |
| 법무 확인 | 타인 저작물 대본의 서버 저장과 열람·삭제 범위, 보관 녹음 전사와 대본 문장의 겹침 | reading.script, reading.recording |
| 법무 확인 | 리딩 전사의 보관 범위와 받아쓰기 보존 문구의 구분, 외부 음성 서비스에 전달되는 범위와 고지 | reading.recording, reading.session |
| 운영 배포 체크리스트 | 객체 삭제 실패 알림(`ObjectDeletionOverdue`)을 받을 채널. 서버의 녹음 변환·저장 확인은 [DEPLOY-HOME §6](../deploy/DEPLOY-HOME.md#6-검증-범위)에 있다 | reading.recording |
| 개인정보 처리방침 | 챌린지 공개 참여작에서 다른 회원에게 보이는 항목과 집계, 비공개의 범위 | challenge.entry, challenge.browse |
| 개인정보 처리방침·이용약관 | AI 리포트의 표본 활용(공개 참여작만, 식별 정보 없이, 부적격 표본 문장 제외) | challenge.ai-report |
| 개인정보 처리방침 | 사람 차단의 효과와 비통지, 신고 기록의 보관과 신원 비공개 | challenge.block, challenge.report |
| 개인정보 처리방침 | 보관 기간: 알림함, 파기한 AI 리포트의 생성 이력, 조회 사건 | challenge.notification, challenge.ai-report, challenge.browse |
| 개인정보 수집·이용 동의·AI 분석 동의 | 공개 참여작의 타인 리포트 표본 활용이 기존 판에 담기는지 | challenge.ai-report, account.consent |
| 이용약관 | 챌린지 대사·영상의 저작권 책임과 신고·숨김 처리 | challenge.create, challenge.report |
| 운영 절차 문서 | 신고 검토·판정(판정 전 확인, 판정별 전이, 처리 목표 안내의 수신자·경로, 처리자·판정 기록), 챌린지 review 처리, 오늘의 챌린지 선정 관리 경로 | challenge.report, challenge.create |
| 운영 배포 체크리스트 | 챌린지 관리 경로의 접근 권한, 알림 발송 실패 보고 채널 | challenge.create, challenge.notification |
| 법무 확인 | 공개 선택에 묶은 표본 활용 허용과 AI 분석 동의의 관계, 타인 리포트에 영상·음성을 제공하는 처리 범위 | challenge.ai-report |
| 법무 확인 | 탈퇴 뒤 남는 캡션·댓글·신고 메모의 식별 정보 가능성과 보존 목적·기간 | challenge.entry, challenge.report, account.withdraw |

## 범위 밖

0.1.0에서 하지 않는 것.

- 커뮤니티(게시판). 보관한 결정은 [커뮤니티](community/README.md)에 있다.
- 계정 정지·운영 차단. 0.1.0에는 신고·운영 숨김·사람 차단(user_blocks, ADR-032)만 있다.
- 챌린지의 댓글 좋아요·답글, 사용자당 하루 한 번 조회수(entry_views), 랭킹 캐시 컬럼, 오늘의 챌린지·
  순위 변동·새 참여 푸시, 사용자 개설의 사전 검토, 여러 챌린지를 섞는 전체 피드.

## 열린 질문

- 연기 입시: notices.json 정적 유지 vs 테이블(ERD 세션 2026-09-14에서 이월).

리딩 요구사항(2026-09-21)에서 후속으로 남긴 것.

- 웹의 구간 선택 UI(0.1.0 웹은 전체 구간만).
- 한국어 밖 대본의 대조. STT 언어는 앱·브라우저 표시 언어를 따르고 그 밖은 정하지 않았다.
- 녹음 시도를 모두 남기는 것(0.1.0은 같은 줄을 다시 말하면 대체).
- 대본 저장 뒤 다시 나누기(원문은 이를 위해 남긴다).
