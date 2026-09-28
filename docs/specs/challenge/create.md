# challenge.create 개설

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 0.1.0
- 결정 기록: ADR-005(개정 2026-09-21), ADR-032
- 화면: A16.2(새 대사 등록, 스토리형 3단계), A16(대사 목록의 "직접 등록하기"), A16.1(검색 결과 없음의 등록 진입), A17(주최자 관리 메뉴, 미설계)
- 테이블: challenges

## 기능
회원이 연기하고 싶은 대사 한 줄과 작품·인물·장면 메모, 기간을 적어 챌린지를 만든다. 기획팀이 띄우는 챌린지도 같은 행이며 주최자가
없고, 날짜마다 하나를 "오늘의 챌린지"로 선정해 피드 머리에 둔다. 기간이 끝나면 영상은 남고 랭킹만 굳는다.

## 의도
ERD는 챌린지를 "대사 한 줄 + 기간"으로, 사용자 개설과 기획팀 개설을 한 테이블에 두기로 했다. 기간 선택지를 DB가 아니라 API 검증에
두어 기획이 바꿀 수 있게 한다. 오늘의 챌린지는 선정일과 참여 기간이 다른 것이라 갈라 둔다. 사용자 개설은 즉시 공개하되 신고(대상에
챌린지 포함)·차단·하루 개설 한도·중복 방지로 남용을 막는다.

## 목적
배우가 찾는 대사가 없으면 스스로 챌린지를 열어 다른 배우를 부른다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `POST /v2/challenges` | `X-Acttub-Client: app/…`, `ChallengeCreateRequest`(request_id·line·work·duration_days 필수, character·scene_note 선택) | `Challenge` 201, 같은 요청 재전송 200 | `member_only` 403, `account_deactivated` 403, 길이·모르는 필드 422, `invalid_duration` 422, `request_fingerprint_mismatch` 422, `duplicate_challenge` 422, `daily_challenge_limit` 429 |
| `DELETE /v2/challenges/{id}` | id | 204(이미 삭제한 것도 204) | `member_only` 403, `challenge_not_found` 404(없음·남의 것·visible 아님), `challenge_has_entries` 422 |
| `POST /v2/admin/challenges` (운영 토큰, openapi.json에 없음) | `Authorization: Bearer <ADMIN_OPS_TOKEN>`, `AdminChallengeCreateRequest`(request_id·line·work·duration_days 필수, featured_on 선택) | `Challenge` 201, 재전송 200 | 401, origin이 team 아님 422, `invalid_duration` 422, `featured_date_conflict` 422, `request_fingerprint_mismatch` 422 |
| `PATCH /v2/admin/challenges/{id}/moderation` (운영 토큰, openapi.json에 없음) | `ChallengeModerationRequest`(moderation visible·review·hidden) | `Challenge` 200 | 401, 값 밖 422, `challenge_not_found` 404(없음·삭제됨) |

조회(`GET /v2/challenges`, `GET /v2/challenges/{id}`)는 [challenge.browse](browse.md#입력출력)다.

## 상태
challenges.moderation과 삭제 표시(deleted_at). 기간 상태는 계산값이라 컬럼이 없다.

| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| visible | 개설(회원·기획팀)의 시작값. review에서 신고 판정 restored·dismissed이고 그 챌린지에 남은 received 신고 없음. 운영 moderation 변경 | challenge.create, challenge.report |
| review | 처리 전 신고의 서로 다른 신고자 수가 `CHALLENGE_REPORT_THRESHOLD`(3)에 닿음(`PostgresEntryReportRepository`, 챌린지 행 잠금). 운영 moderation 변경 | challenge.report, challenge.create(운영) |
| hidden | 운영 moderation 변경(`PATCH /v2/admin/challenges/{id}/moderation`)만 | challenge.create(운영) |
| 삭제(deleted_at) | 주최자 삭제. visible이고 참여 이력(삭제된 참여작 포함)이 0 | challenge.create |

- 기간 상태: ends_at 이전은 진행 중, 지나면 종료다. 종료되면 새 참여를 막고 기존 정상 공개 참여작은 남으며 랭킹이 굳는다
  (challenge.browse). 같은 대사를 다시 띄우려면 새 행이고 이전 참여작·좋아요·랭킹은 이전 챌린지에 남는다.
- 운영 상태: visible ↔ review(신고 누적으로 운영 검토, 목록·피드에서 제외, 참여작은 유지)·hidden(운영 숨김, 하위 참여작 노출 중단).
  review·hidden에서 visible로 되돌릴 때 기간이 지났으면 종료 상태의 visible이다. hidden은 되돌릴 수 있다(운영 판단).
- 불변 조건: ends_at > starts_at(`ck_challenges_period`). team은 host_user_id NULL(`ck_challenges_team`), featured_on은 team만
  (`ck_challenges_featured_team`)이고 날짜당 하나(`uq_challenges_featured`). 삭제된 행의 moderation은 바꾸지 않는다(`PostgresChallengeRepository.moderate`가 404).
- 끝 상태: 삭제(deleted_at)다. 되돌리는 경로가 없다. hidden은 끝 상태가 아니다.
- 마감 뒤 순위 확정 ranking_state NULL → pending → final (정본: [challenge.browse](browse.md#상태)).

## 규칙·제약
- 챌린지는 대사(1~200자, 필수), 작품(1~100자, 필수, 창작이면 "창작"), 인물(100자, 선택), 장면 메모(500자, 선택), 기간(7일·14일 선택지,
  API 상수), 개설 구분 origin(team·member, 불변), 주최자 host_user_id(team은 NULL), starts_at(공개 개설 시각)·ends_at(서버 계산),
  featured_on(team만, 날짜당 하나), 운영 상태 moderation(visible·review·hidden)을 가진다. 기간 상태(진행·종료)는 ends_at과 현재
  시각으로 정하고 컬럼을 두지 않는다. 글자 수는 앱·서버가 같은 유니코드 코드 포인트 기준으로 센다. 대사는 공백을 한 칸으로
  정리하고 나머지(작품·인물·메모)는 앞뒤 공백만 걷은 뒤 센다.
- 사용자 개설은 A16.2의 세 단계(대사 → 작품·인물·메모 → 기간)로 받고 마지막에 한 요청으로 만든다. request_id 멱등((host_user_id,
  request_id) 유일, 본문 지문 저장, 같은 id·다른 지문은 422 request_fingerprint_mismatch). 회원은 하루(한국 시간) 3개까지 열 수 있고 넘으면
  429 daily_challenge_limit. 같은 사람이 같은 대사(공백 정리 뒤 같은 글)로 진행 중 챌린지를 이미 열었으면 422 duplicate_challenge.
  기획팀 개설 요청(운영 경로)은 회원 개설과 별도의 멱등 범위다.
- 사용자 개설은 즉시 공개(visible)다. 사전 검토는 두지 않는다.
- 개설한 사람은 자동으로 참여하지 않는다. 공개 개설 뒤 대사·작품·기간은 고칠 수 없다. 참여작이 한 번도 생기지 않은 자기 챌린지는 주최자가
  지울 수 있다(deleted_at 표시, 행·요청 이력·한도 계산은 남고 어디에도 보이지 않음). 참여작이 생기면 지울 수 없고 운영 숨김만 있다. 삭제와 첫
  참여는 챌린지 행을 잠가 하나만 성공한다.
- "오늘의 챌린지"는 기획팀 챌린지(origin team) 가운데 featured_on이 오늘(한국 날짜)이고 visible·진행 중인 것이다(미래 날짜는 제외). 없으면
  가장 최근 과거 featured_on의 visible·진행 중 챌린지, 그것도 없으면 참여작이 가장 많은 visible·진행 중 챌린지다. 피드(A15)의 머리와 대사 목록의
  인기·최신 탭 맨 위에 "오늘의 챌린지 · D-N"으로 보인다(종료·내 챌린지 탭에는 고정하지 않는다). 선정일과 참여 기간은 다르다.
- 주최자가 탈퇴하면 host_user_id를 NULL로 돌리고 origin member는 그대로다(기획팀 챌린지로 보이지 않고 "주최자 탈퇴"로 표시).
  users 행은 지워지지 않으므로 애플리케이션이 탈퇴 트랜잭션에서 수행한다.
- 게스트 토큰: 403 member_only. 한국어 설정이 아닌 회원의 개설: 403 member_only와 같은 처리다(탭이 없다).

## 예외
- 대사 201자·빈 대사·빈 작품: 422. 기간 선택지 밖 값: 422 invalid_duration.
- 같은 요청 id·같은 지문 재전송: 같은 챌린지 하나. 다른 지문: 422 request_fingerprint_mismatch.
- 하루 4번째 개설: 429 daily_challenge_limit. 자정(한국 시간) 뒤: 된다.
- 참여작이 생긴 뒤 삭제: 422 challenge_has_entries. 삭제와 첫 참여가 동시: 하나만 성공한다.
- 공개 개설 뒤 대사 수정 요청: 없다(속성 불변).
- 같은 대사로 동시 개설 둘: 하나만 생기고 다른 하나는 422 duplicate_challenge. 삭제한 챌린지의 요청 재전송: 새 챌린지가 생기지 않는다.

## 검증 방법
- 대사·작품·인물·기간 7일로 개설: challenges 1행(origin member, host_user_id 나, moderation visible, starts_at 지금, ends_at = starts_at +
  7일, featured_on NULL, deleted_at NULL).
- 기간 14일로 개설: ends_at = starts_at + 14일. 선택지 밖 10일: 422 invalid_duration.
- 같은 요청 id·같은 지문 두 번: 행 하나. 같은 id·다른 지문: 422 request_fingerprint_mismatch.
- 같은 대사로 다시 개설(진행 중): 422 duplicate_challenge. 같은 대사 동시 개설 둘: 하나만 생긴다. 기존이 종료된 뒤 같은 대사: 새 행이고 이전
  참여작은 이전 행에 남는다.
- 하루 4번째: 429 daily_challenge_limit. 한국 시간 자정 뒤: 다시 3개. 대사 201자: 422. 작품 비움: 422. 작품 "창작": 200. 인물 101자: 422. 메모
  501자: 422. 글자 수는 코드 포인트(이모지 하나 = 1자).
- 개설 직후: 주최자의 참여작이 없다. 공개 개설 뒤 수정 API: 없다.
- 참여작 0개인 자기 챌린지 삭제: deleted_at이 차고 목록·상세에 404, 행은 있다. 삭제 뒤 같은 요청 재전송: 새 행 없음. 참여작 1개: 422
  challenge_has_entries.
- ends_at이 지남: 새 참여 422 challenge_closed, 참여작·랭킹 조회는 그대로다.
- 기획팀이 featured_on 오늘로 만든 visible·진행 중 챌린지: 피드 머리와 인기·최신 탭 맨 위가 그 챌린지다. 종료 탭에는 고정되지 않는다. 회원이
  featured_on을 넣어 개설: 422(team만). 같은 날 두 번째 team 선정: 422(날짜당 하나).
- 오늘 선정이 없고 어제 선정이 진행 중: 어제 것이 보인다. 어제 것도 종료: 참여작이 가장 많은 visible·진행 중 챌린지. 내일 날짜 선정: 오늘은 보이지
  않는다.
- 운영이 review로 바꿈: 목록·피드에서 빠지고 참여작은 남는다. 기간이 지난 뒤 visible로 되돌림: 종료 상태로 보인다.
- 주최자 탈퇴: host_user_id NULL, origin member, 화면에 "주최자 탈퇴", 행·참여작 그대로.
- 게스트 토큰으로 개설: 403 member_only. 한국어가 아닌 회원: 403 member_only.

## 범위 밖
- 사용자 개설의 사전 검토([공통 규칙](../common.md#범위-밖)).
- 공개 개설 뒤 대사·작품·기간 수정.
- 계정 정지·운영 차단([공통 규칙](../common.md#범위-밖)).
