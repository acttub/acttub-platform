# 공통 요구사항

옛 경로는 `docs/requirements/00-common.md`다. 적용된 Flyway 마이그레이션(V9·V13·V14)의 주석이 그 이름으로 부르며, 마이그레이션은 checksum 때문에 고치지 않는다.
쓰는 법과 기능 목록은 [README.md](README.md)에 있다.

## 공통 규칙

영역마다 반복되는 규칙은 여기에 한 번만 쓰고, 각 기능에는 다른 점만 적는다.

### 게이트와 보호 기능

로그인한 사람이 필수·선택 동의를 모두 결정하고 프로필 필수 항목을 다 채워야 통과하는 문이
게이트다. 순서는 동의 → 프로필이고, 요청마다 DB 상태로 판정하며 토큰을 갱신해도 열리지 않는다.
요청의 판정 순서는 426 → 토큰(401) → 계정 상태(403 `account_deactivated`) → 분당 한도(429) → 동의
(403 `consent_required`) → 프로필(403 `profile_required`)이다.

아래 표는 보호 기능이 아니라 **게이트 밖**을 적는다. 적지 않은 새 경로는 닫힌 채로 시작한다.

| 단계 | 경로 |
|---|---|
| 게이트 밖 | 로그인·가입 제출·게스트 시작·토큰 갱신·로그아웃·제공자 목록(`/v2/auth/**`), 동의 문서 조회와 제출(`/v2/consents/**`), 내 정보 조회와 탈퇴(`GET`·`DELETE /v2/me`), 푸시 토큰 삭제(`DELETE /v2/push-tokens` — 로그인 없이 받는다, account.notification), 공개 입시 정보(`/v2/admissions/**`), 공개 조회(`GET /v2/public/**` — 포트폴리오 공유 account.portfolio, 참여작 공유 challenge), 운영 경로(`/v2/admin/**`) |
| 게스트 전용 | 이관 코드 받기(`/v2/guest/**`) — 필요한 동의 문서가 없다. 회원이 부르면 403 `guest_only` (account.guest) |
| 동의까지만 | 프로필 저장(`PUT /v2/me/profile`) — 개인정보를 받기 전에 수집 동의가 끝나 있어야 하고, 프로필이 빈 사람이 채우는 자리다 (account.profile) |
| 동의 + 프로필 | 그 밖의 모든 `/v2`. 보호 기능이며 게이트를 통과하기 전에는 쓸 수 없다 |

- 위 표는 회원의 규칙이다. 게스트의 규칙은 아래 문단과 account.guest에 있다.
- 토큰 없이 여는 공개 조회(동의 문서·고지, 입시 정보, 제공자 목록, `GET /v2/public/**`), 게스트 시작
  (`POST /v2/auth/guest`), 푸시 토큰 삭제(`DELETE /v2/push-tokens`), 제공자가 부르는 연결 끊기 알림은 `Authorization`
  헤더가 와도 검증하지 않는다. 만료된 토큰을 전역으로 붙이는 클라이언트가
  게이트 앞의 공개 콘텐츠에서 401을 받지 않게 한다.
- `account_deactivated`의 예외는 탈퇴(`DELETE /v2/me`) 하나다. 탈퇴 도중 앱이 죽어 다시 누른 사람이 403을
  받으면 기기의 자료를 지우는 다음 단계로 가지 못한다. 그 밖의 모든 경로는 남은 액세스 토큰을 요청마다
  403으로 막는다. (account.withdraw)
- 어느 경우에도 막힌 원 요청을 서버가 재실행하지 않는다.

웹 게스트는 프로필 게이트를 면제하고, 동의는 기능마다 필요한 문서만 그 기능을 처음 쓸 때 받는다.
(account.guest) 회원은 미결정 문서가 하나라도 있으면 모든 보호 기능이 막히고 게스트는 그 기능의
문서만 보는 것은 의도한 차이다. 서버 게이트 규칙은 둘이다.

### 오류 응답

- 오류 본문의 모양(사유 코드 하나, 422의 두 모양, 형제 필드를 싣는 오류)은 [CONTRACT §6-2](../../apps/api/CONTRACT.md#6-2-오류-계약은-대부분-openapijson-에-없다)가 정본이다.
- 없는 것과 남의 것은 같은 404다. 존재 여부를 알려 주지 않는다.

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

- users 행은 익명화해 남긴다. 프로필은 이름·사진·소개를 지우고 나머지를 가명처리해 남긴다. 챌린지
  댓글은 "탈퇴한 사용자"로 남는다. (account.withdraw)
- 재가입은 새 계정이다. 이전 계정의 데이터는 옮기지 않는다. 영역마다 탈퇴한 사람의 행을 어떻게
  보일지만 따로 정한다.

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
| 컬럼·값 | users | account.login, account.guest, practice.feedback |
| 컬럼·값 | user_identities | account.login, account.guest, account.withdraw |
| 컬럼 | user_profiles | account.profile, account.notification, account.withdraw |
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
| 내릴 화면 | 커뮤니티 A3·A3.1·A3.2, D11·D12·D15, WC·WC2·WC3 | community |
| R00 대본 목록 | "분석 완료" 칩 삭제(칩은 연습 중·연습 완료·배역 선택 셋), 검색은 제목·배역만, 카드의 "암기" 칩 | reading.script, reading.memorization |
| R00.3 더보기 | "제목·배역 수정" 시트(제목과 배역 이름만) | reading.script |
| 새 화면(앱) | 대본 확인 화면(배역 이름 고치기·빼기·더하기), 옛 대본 옮기기 안내, 이동통신 모델 내려받기 확인, 회차 삭제·개별 녹음 삭제 | reading.script, reading.cast, reading.recording |
| R02 배역 선택 | 목소리 드롭다운(자동 + 프리셋 M1~M5·F1~F5), 미리 듣기 | reading.cast |
| R03 시작 위치 | 방식 선택(읽어주기·암기 대조), 녹음 켬·끔과 "내 차례 녹음은 내 계정에 저장돼요" | reading.session, reading.recording |
| R03.2 나가기 확인 | 문구 "지금 나가면 N번 대사까지 진행한 걸로 저장돼요. 상세에서 이어서 할 수 있어요". "끝 위치를 정하지 않았어요" 삭제 | reading.session |
| R05 완료 | 코치 카드(촬영으로) 추가, 다시 볼 대사가 없으면 절 숨김, 암기 대조 완료는 "맞춘 줄 K / 시도 N · 아직 안 나온 줄 P" | reading.session |
| R00.2 대본 연습 | 0.1.0에서 쓰지 않음(R03.x와 겹침, 대사별 메모는 범위 밖) | reading.session |
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
| 새 화면(앱) | 알림함(묶음 최신순·읽음·배지), AI 리포트 화면(관찰·견주기·제안, 점수 없음) | challenge.notification, challenge.ai-report |
| A15 반응 메뉴 | "이 사용자 차단" 추가, 공유는 참여작 딥링크 | challenge.block, challenge.react |
| A15.3·A17 | 댓글 신고·챌린지 신고 메뉴 추가, 댓글 하트 삭제(후속), 댓글 최신순 | challenge.report, challenge.react |
| A16 | "종료" 탭 추가, 인기 정렬 기준(좋아요 합·참여작 수) | challenge.browse |
| A17 | 동점 공동 순위, 최신순에 순위 숫자 없음, 좋아요 0이면 1위 배지 없음, 종료 랭킹 고정 표시 | challenge.browse |
| A18 촬영 | 60초 상한 표시 | challenge.entry |
| A18.1·A18.2 | 공개 범위 미리 선택 없음, 공개 시 "다른 참여자의 AI 리포트 비교에 쓰일 수 있어요" 한 줄, "올리면 자동 준비" 문구를 "요청하면 준비" 로 | challenge.entry, challenge.ai-report |
| A4 설정 | 차단 목록·풀기 | challenge.block |
| 챌린지 카드 | 주최자 탈퇴 표시("주최자 탈퇴"), 기획팀 챌린지 표시 | challenge.create |
| A14 | "좌우로 넘겨보세요" → "위아래로 넘겨보세요"(피드는 세로) | challenge.browse |
| A15·A17·P03 | 종료 "집계 중"·검토 대기·최종 확정 구분, 최종 순위와 현재 좋아요 구분, 커서 만료 뒤 새로 조회 | challenge.browse |
| A16·A17 | 오늘의 챌린지 고정은 인기·최신 탭에만, 종료·내 챌린지 탭은 고정 없음 | challenge.browse |
| A15·A15.3·A16·A17·A4 차단 목록 | 프로필 사진 대신 이름 첫 글자 아바타(챌린지는 이름만 공개) | challenge.browse, challenge.react, challenge.block |
| A15.3 | 본인 숨김 댓글 "확인 중" 표시·삭제, 댓글 작성자 차단과 참여작 작성자 차단 구분 | challenge.react, challenge.report, challenge.block |
| A15.4 | 스팸과 중복 업로드를 별도 선택지로(다섯 개) | challenge.report |
| A17 주최자 메뉴 | 참여작이 한 번도 생기지 않은 챌린지 삭제(24시간 제한 없음) | challenge.create |
| P03·AI 리포트 | 파일 파기 뒤 공개·새 생성 불가 안내, 확인 중·비공개 겹칠 때 확인 중 우선 | challenge.entry, challenge.ai-report |
| 알림함 | 묶음 단위 페이지·열람·읽음, 비공개 본인 AI 리포트 진입, 무효가 된 반응은 빠짐 | challenge.notification |

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
| AI 분석 동의 | 리딩에는 필요 없다. 서버가 대본·음성을 분석하지 않는다(reading, ADR-031) | account.guest, reading.recording |
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
| 운영 배포 체크리스트 | 0.1.0 서버는 새 앱의 심사 제출 직전에 배포한다. 그때부터 0.1.0 이전 앱은 426이다 | 공통 규칙 |
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
| 개인정보 처리방침 | 챌린지 공개 항목은 현재 프로필 이름만(account.profile과 같음), 사진·소개는 공개하지 않음 | challenge.browse |
| 개인정보 처리방침 | AI 리포트 비교 입력에는 다른 참여자의 영상(얼굴·목소리 포함)이 이름·계정 식별자 없이 쓰이고 결과에는 표본 식별자를 내지 않음. 표본이 비공개·삭제·숨김·차단·탈퇴되면 기존 리포트에서 그 문장을 제외하되 이미 전달된 내용은 회수하지 않음 | challenge.ai-report |
| 개인정보 수집·이용 동의·AI 분석 동의 | 공개 참여작의 타인 리포트 표본 활용 범위·보유 기간이 기존 판에 담기는지, 새 판이 필요한지 확인 | challenge.ai-report, account.consent |
| 개인정보 처리방침 | 참여작 삭제·탈퇴 시 AI 본문·비교 자료 파기와 생성 이력 90일(탈퇴일 기준), 조회 사건 기록 7일 | challenge.ai-report, challenge.browse |
| 운영 절차 문서 | 신고 판정 전 현재 버전·미처리 신고 확인, 판정별 전이(restored·dismissed 해제, kept_hidden 유지), 24시간 첫 확인·72시간 처리 안내의 수신자·경로 | challenge.report |
| 법무 확인 | 공개 선택에 표본 활용 허용을 묶는 방식과 기존 AI 분석 동의와의 관계, 타인 리포트 생성에 영상·음성을 제공하는 처리 범위 | challenge.ai-report |
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
