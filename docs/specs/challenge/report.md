# challenge.report 신고

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 0.1.0
- 결정 기록: ADR-032
- 화면: A15.4(영상 신고 모달), A15.3(댓글 신고, 메뉴 추가), A17(챌린지 신고, 메뉴 추가)
- 테이블: entry_reports, challenge_entries, entry_comments, challenges

## 기능
회원이 참여작·댓글·챌린지를 사유와 함께 신고한다. 참여작·댓글은 접수 즉시 숨겨지고, 챌린지는 신고가 쌓이면 검토로 넘어간다. 운영이 확인해
되돌리거나 그대로 둔다.

## 의도
신고 대상을 참여작만으로 두면 악성 댓글이나 부적절한 대사(챌린지)를 따로 처리할 수 없어 대상을 셋으로 넓힌다. 즉시 숨김은 서버 노출
차단이고 이미 내려받은 영상까지 회수한다고 약속하지 않는다. 사람 차단은 challenge.block이다.

## 목적
배우가 부적절한 콘텐츠를 바로 안 보게 하고, 운영이 사후에 판단한다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `POST /v2/reports` | `ChallengeReportRequest`(request_id·target_type·target_id·reason 필수, note 선택) | `ReportReceipt` 201, 같은 요청 재전송·같은 대상 재신고 200 | `member_only` 403, `entry_not_found`·`comment_not_found`·`challenge_not_found` 404, `self_report` 422, `request_fingerprint_mismatch` 422, note 길이·값 밖 422, `daily_report_limit` 429 |
| `GET /v2/admin/reports` (운영 토큰, openapi.json에 없음) | `Authorization: Bearer <ADMIN_OPS_TOKEN>`, `status`(received·reviewed), `cursor` | `AdminChallengeReportPage` 200 | 401, status·cursor 422 |
| `PATCH /v2/admin/reports/{id}` (운영 토큰, openapi.json에 없음) | `AdminReportResolution`(resolution·reviewer 필수, note 선택) | `AdminChallengeReport` 200 | 401, `report_not_found` 404, `report_already_reviewed` 422, resolution·reviewer 값 422 |
| 보관 기간 정리 ([challenge.browse](browse.md#입력출력)의 `ChallengeSettlementScheduler.run` 안) | 보관 기간(「상태」의 끝 상태)이 지난 reviewed 신고 | 행 삭제 | — |

## 상태
entry_reports.status.

| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| received | 신고 접수 | challenge.report |
| reviewed(+resolution restored·kept_hidden·dismissed, reviewed_by, reviewed_at) | 운영 판정. received일 때만 | challenge.report |

- 불변 조건: reviewed ⇔ resolution·reviewed_at 있음(`ck_entry_reports_reviewed`). (target_type, target_id, reporter_id) 유일(`uq_entry_reports_target`) —
  한 사람은 한 대상을 한 번 신고한다. (reporter_id, request_id) 유일(`uq_entry_reports_request`).
- 끝 상태: reviewed. 처리 뒤 90일이 지나면 행을 지운다.
- 이 기능이 일으키는 다른 행의 전이:
  - 참여작 visible → hidden_by_report(첫 신고), hidden_by_report → visible(restored·dismissed, 남은 received 없음) (정본: [challenge.entry](entry.md#상태)).
  - 댓글 visible → hidden, hidden → visible(같은 조건) (정본: [challenge.react](react.md#상태)).
  - 챌린지 visible → review(서로 다른 신고자 수가 임계값에 닿음, 「규칙·제약」), review → visible(같은 조건) (정본: [challenge.create](create.md#상태)).

## 규칙·제약
- 신고는 target_type(entry·comment·challenge)·target_id·reporter_id·reason·note(200자, 선택)·status(received·reviewed)·resolution(restored·
  kept_hidden·dismissed)·reviewed_by·reviewed_at·resolution_note·target_version(신고 당시 대상의 content_version; 참여작은 캡션 수정, 댓글·
  챌린지는 불변이라 1)·target_text(신고 당시 캡션·댓글·대사, 참여작·댓글 본문이 파기되면 비운다)를 가진다. 사유는 copyright(저작권 침해 — 대사·영상 출처), inappropriate
  (부적절한 콘텐츠 — 괴롭힘·성적·개인정보 노출 포함), spam(스팸), duplicate(중복 업로드), other(기타, 메모)다. 화면(A15.4)은 다섯을 각각
  선택지로 둔다.
- 신고할 수 있는 대상은 신고자가 지금 볼 수 있는 것([개인 노출 조건](README.md#노출-조건))이다. 볼 수 없는 대상·없는 대상의 새 신고는
  404이고, 본인이 이미 접수한 같은 신고의 재전송만 기존 결과(200)를 돌려준다. 요청은 [요청 재전송](../common.md#요청-재전송) 규칙을 따르고
  유일 범위는 (reporter_id, request_id)다.
- 참여작·댓글은 유효한 첫 신고가 저장되는 순간 숨겨(참여작 status hidden_by_report, 댓글 status hidden) 모든 일반 회원의 목록·상세·새 재생
  요청에서 뺀다(이미 발급된 재생 URL은 만료까지 남는다). 작성자 본인은 참여작은 프로필(P03)에서, 댓글은 원래 자리에서 "확인 중"으로 본다.
- 챌린지는 즉시 숨기지 않는다. 처리되지 않은(received) 신고가 서로 다른 신고자 3명이 되는 순간 moderation review로 올려 목록·피드에서
  뺀다(참여작은 유지). 동시에 3번째가 둘 와도 한 번만 바뀐다. 처리 완료된 신고는 다시 세지 않는다.
- 운영은 관리 경로에서 신고를 처리한다. 첫 확인 24시간, 처리 또는 지연 안내 72시간이 초기 목표다. 판정은 적용하는 순간의 content_version과
  남은 received 신고를 확인한 뒤 적용한다. restored·dismissed는 그 대상에 남은 received 신고가 없을 때 운영 숨김을 해제하고, kept_hidden은 숨김을
  유지한다. 해제해도 작성자의 비공개·삭제·탈퇴와 챌린지 종료는 그대로다. 해제 뒤 같은 사람의 재신고는 유일 제약으로 200이고 다시 숨기지
  않는다(다른 사람의 새 신고는 다시 숨긴다). 캡션이 신고 뒤 바뀌었으면 운영 화면에 두 버전을 보여 준다. 챌린지의 kept_hidden은 review를
  그대로 두고, 챌린지를 내릴지는 운영이 moderation 경로(challenge.create)로 정한다.
- 운영 목록은 접수순 50개씩이고 신고 당시·현재 버전과 본문, 대상 상태, 남은 처리 전 신고 수, 24·72시간 목표 시각을 준다. 신고자 신원은
  없다.
- 본인 콘텐츠는 신고할 수 없다(422 self_report). 하루 20건까지(429 daily_report_limit). 기각(dismissed)만으로 허위 신고를 확정하지 않고 고의
  반복은 운영자가 판단한다.
- 신고자에게 처리 결과를 알리지 않고, 작성자·신고자에게 서로의 신원을 보이지 않는다. 처리 기록에 영상 원본을 따로 복제하지 않는다
  (보관 기간은 「상태」의 끝 상태).
- 작성자가 대상을 지우거나 비공개로 바꿔도 신고 행은 남는다.

## 예외
- 본인 콘텐츠 신고: 422 self_report. 하루 21번째: 429 daily_report_limit. note 201자: 422.
- 이미 숨겨진 참여작을 다른 사람이 신고: 볼 수 없으므로 404. 숨김 전에 접수한 본인 신고의 재전송: 200.
- 되돌린 뒤 같은 사람 재신고: 유일 제약에 걸려 200, 다시 숨기지 않는다. 다른 사람의 새 신고: 다시 숨긴다.
- 없는 대상·볼 수 없는 대상 신고: 404. 신고자가 탈퇴: 신고 행은 남고 신고자는 계정 참조만이다.

## 검증 방법
- 참여작 신고(inappropriate): entry_reports 1행(status received, target_version = 현재 content_version), 참여작 status hidden_by_report, 랭킹·
  피드에서 즉시 빠진다. 작성자 P03에 "확인 중". 이미 발급된 재생 URL: 만료까지 재생된다.
- 댓글 신고: 댓글 status hidden, 목록에서 빠지고 작성자에게는 "확인 중"으로 보인다. 챌린지 신고 1건: 그대로. 서로 다른 3명(received): moderation
  review, 목록·피드에서 빠지고 참여작은 남는다. 두 명이 동시에 3번째: 한 번만 review로 바뀐다. 처리 완료 신고 2건 + 새 신고 1건: review로 가지
  않는다.
- 같은 사람 재신고(숨김 전 접수 건): 200, 행 하나. 숨겨진 뒤 다른 사람의 새 신고: 404.
- 본인 신고: 422 self_report. 하루 21번째: 429. 메모 200자: 200. 201자: 422.
- 운영이 restored로 처리(남은 received 없음): 참여작이 목록에 돌아오고 status reviewed·reviewed_by·reviewed_at이 있다. 남은 received가 하나 더
  있음: 숨김이 풀리지 않는다. dismissed: restored와 같이 해제. kept_hidden: 숨김 유지. 작성자가 그 사이 비공개로 바꿨으면: 비공개 그대로.
  챌린지가 종료됐으면: 종료 상태로 돌아온다. 캡션이 신고 뒤 바뀜: 운영 화면에 두 버전.
- 되돌린 뒤 같은 사람 재신고: 숨기지 않는다. 다른 사람 신고: 다시 숨긴다.
- 작성자가 신고된 참여작을 삭제: status deleted, entry_reports 행은 남는다. 신고자 탈퇴: 행 남음. 처리 완료 91일 뒤: 행 없음.
- 신고자·작성자 응답에 서로의 이름·id가 없다. 처리 목표 시각(24시간·72시간)이 운영 화면에 보인다.
- 게스트 토큰: 403 member_only.

## 범위 밖
- 계정 정지·운영 차단([공통 규칙](../common.md#범위-밖)).
- 신고자에게 처리 결과 알림.
- 이미 내려받은 영상의 회수.
- 기각(dismissed)만으로 허위 신고 확정.
