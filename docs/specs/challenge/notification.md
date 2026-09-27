# challenge.notification 챌린지 알림·알림함

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 0.1.0
- 화면: 알림함(없음, 디자인에 반영할 것), A4 설정의 챌린지 알림 토글(account.notification), 잠금 화면 푸시
- 테이블: notifications(ERD에 추가), notification_pushes(ERD에 추가), push_tokens, challenge_entries, challenges, entry_ai_reports, user_blocks

토글과 토큰은 account.notification이 맡고, 이 기능은 어떤 사건에 언제 보내고 어떻게 묶는지와 알림함을 맡는다.

## 기능
내 참여작에 좋아요·댓글이 달리면, 내가 참여한 챌린지가 끝나면, 요청한 AI 리포트가 준비되면 푸시로 알리고 알림함에 쌓는다. 챌린지 알림
토글을 끄면 푸시는 가지 않고 알림함에는 남는다.

## 의도
알림함(notifications)은 계정 문서가 추가한 테이블이고 컬럼은 여기서 정한다. 한 행은 수신자 한 명에게 생긴 원인 사건 하나다. 좋아요는
몰려 오므로 묶고, 밤에는 보내지 않는다. 오늘의 챌린지 소개·순위 변동·내 챌린지의 새 참여 푸시는 광고성에 가까워 0.1.0에서 뺀다(후속).
푸시는 최선 노력이고 원래 행동의 성공을 좌우하지 않는다.

## 목적
배우가 자기 영상에 온 반응을 놓치지 않는다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `GET /v2/me/notifications` | `cursor` | `ChallengeNotifications` 200 | `member_only` 403, cursor 422 |
| `POST /v2/me/notifications/read` | `NotificationReadRequest`(group_keys 또는 all_before) | 204 | `member_only` 403, 둘 다 없음 422 |
| `GET /v2/me/notifications/unread-count` | — | `NotificationUnreadCount` 200 | `member_only` 403 |
| 사건 기록 `NotificationEvents.record` (좋아요·댓글 쓰기, 마감 집계, AI 리포트 저장과 같은 트랜잭션) | 원인 사건 | notifications 1행(push_status pending 또는 skipped) | 같은 event_key 재전송은 한 행 |
| `NotificationPushScheduler.run` → `NotificationPushWorker.runOnce` (`CHALLENGE_NOTIFICATION_PUSH_INTERVAL_MS`, 기본 1분, `CHALLENGE_NOTIFICATION_PUSH_ENABLED`) | push_after가 지난 pending 알림 묶음 | 최초·요약 푸시, push_status attempted·skipped | 전송 실패는 운영 보고, "등록되지 않은 기기" 토큰 삭제 |
| 만료 정리 (`ChallengeSettlementScheduler.run` 안, 매시) | expires_at이 지난 알림, 지난 notification_pushes | 행 삭제 | — |

토글(`PATCH /v2/me/notification-settings`)과 푸시 토큰(`/v2/push-tokens`)은 account.notification이다.

## 상태
notifications.push_status와 읽음(read_at).

| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| push pending | 사건 기록 때 토글 켬·토큰 있음(push_after 지정) | challenge.notification |
| push skipped | 사건 기록 때 토글 꺼짐·토큰 없음. 발송 때 재확인 실패 | challenge.notification |
| push attempted(+push_attempted_at) | 발송 워커가 보냄 | challenge.notification |
| 읽지 않음(read_at NULL) → 읽음(read_at) | 묶음 열람, 모두 읽음(그 시각·id까지) | challenge.notification |

- 불변 조건: pending이면 push_after가 있다(`ck_notifications_pending`). (user_id, event_key) 유일(`uq_notifications_event`). challenge_ended ⇔ entry_id NULL
  (`ck_notifications_entry`), entry_commented ⇔ comment_id 있음(`ck_notifications_comment`). notification_pushes는 stage first·summary이고
  (group_key, stage) 유일(`uq_notification_pushes_stage`)이라 묶음마다 최초·요약을 한 번씩만 선점한다.
- 끝 상태: attempted·skipped. 행은 expires_at(생성 + 90일)이 지나거나, 참여작이 삭제되거나, 수신자가 탈퇴하면 지운다.

## 규칙·제약
- 사건 kind는 entry_liked(내 참여작에 좋아요, 수신 = 참여작 작성자), entry_commented(내 참여작에 댓글), challenge_ended(내가 삭제되지 않은
  참여작을 가진 챌린지 종료, 챌린지당 한 번), entry_ai_report_ready(내가 요청한 리포트 완료) 넷이다. 자기 행동은 알리지 않고 차단 관계의
  사건은 생기지 않는다.
- 한 행 = 수신자 한 명의 원인 사건 하나. 컬럼: id, user_id, kind, actor_user_id(반응한 사람, 시스템 사건은 NULL), challenge_id, entry_id
  (challenge_ended는 NULL), comment_id(entry_commented는 필수, 그 밖은 NULL), event_key((user_id, event_key) 유일; 좋아요는 좋아요 행의 원인
  식별자라 취소 뒤 재등록은 새 사건), group_key(수신자·kind·entry·10분 구간), created_at, read_at, expires_at(생성 + 90일), push_after(발송 예정
  시각, 대상 아니면 NULL), push_status(pending·attempted·skipped), push_attempted_at. 참조는 부모 관계가 맞아야 한다(comment_id의 참여작 =
  entry_id). 이름·캡션·댓글 본문·영상 주소는 복사하지 않고 조회 때 현재 권한과 원본으로 조립한다.
- 묶기: 같은 group_key(10분 구간)의 좋아요·댓글은 알림함에서 묶음 한 줄("N명이 좋아해요", "N개의 댓글")로 보인다. N은 현재 유효한(취소·삭제되지
  않은) 서로 다른 행동자 수·댓글 수다. 푸시는 묶음마다 최초 1건(첫 사건 즉시)과 요약 1건(구간 끝, 추가 사건이 있을 때만)이며 (group_key, 발송
  단계)로 한 번만 선점한다(notification_pushes). 발송 전에 취소된 좋아요·삭제된 댓글·차단된 관계·숨겨진 참여작·댓글은 뺀다.
- 밤 시간: 한국 시간 21시~09시의 푸시는 최초 발송 예외 없이 모아 09시에 보낸다(push_after). 알림함에는 즉시 쌓인다. 폰의 저녁 리마인드
  (account.notification)는 별도 규칙이다.
- 토글(user_profiles.notify_challenge)이 꺼져 있거나 푸시 토큰이 없으면 push_status skipped로 알림함에만 쌓인다. 발송 직전에 활성 계정·토글·
  토큰의 현재 주인·한국어 여부와 사건의 현재 노출 조건(반응 알림은 참여작·댓글의 개인 노출 조건과 행동자–수신자 차단, 종료 알림은 챌린지 조회
  권한, AI 완료 알림은 본인 열람 권한)을 다시 확인한다. 잠금 화면 문구는 일반 문구("내 참여작에 새 반응이 있어요")와 알림 식별자만이고
  이름·본문을 넣지 않는다.
- 알림함은 묶음 단위로 20개씩, 묶음의 최신 사건 시각·id 역순이다. 묶음을 누르면 그때까지 포함된 사건 전부가 읽음이 되고 참여작·챌린지·리포트로
  간다(AI 완료 알림은 비공개 참여작이어도 본인 리포트가 열린다). "모두 읽음"은 요청 시각·id까지의 본인 알림만 읽음으로 바꾸고 그 뒤 도착한 것은
  읽지 않음으로 남는다. 읽지 않은 수(사건 수 아닌 묶음 수)는 탭 배지다.
- 90일이 지나면 읽음과 무관하게 매일 도는 일이 지운다. 대상이 삭제·비공개·숨김·차단으로 보이지 않으면 내용을 보이지 않고 "볼 수 없는 영상"
  안내다(본인 AI 리포트는 예외).
- 푸시 발송은 원래 행동(좋아요 저장 등)과 알림함 기록을 커밋한 뒤 별도로 한 번 시도한다. 실패해도 원래 행동은 성공이고 운영에 보고한다.
  푸시 전달은 ai_jobs에 넣지 않는다.
- 탈퇴하면 notifications를 행째 지운다. 행동한 사람이 탈퇴하면 actor는 "탈퇴한 사용자"로 조립된다.

## 예외
- 푸시 발송 실패(토큰 만료): 토큰을 지우고(account.notification) 알림함에는 남는다.
- 같은 참여작에 10분 안 좋아요 30개: 알림함 묶음 한 줄(30명), 푸시는 최초 1건 + 구간 끝 요약 1건. 첫 사건 뒤 추가 반응 없음: 요약 푸시 없음.
- 밤 11시 댓글: 알림함 즉시, 푸시는 아침 9시(최초 즉시 발송 예외 없음).
- 좋아요를 눌렀다 발송 전에 취소: 그 사건은 묶음에서 빠진다. 모두 취소되면 푸시 없음. 취소 뒤 재등록: 새 사건이지만 인원 수는 1.
- 발송 대기 중 차단·댓글 신고 숨김: 그 사건은 발송에서 빠진다.
- 모두 읽음 도중 새 알림 도착: 새 것은 읽지 않음.

## 검증 방법
- 남이 내 참여작에 좋아요(낮 시간): notifications 1행(entry_liked, event_key, comment_id NULL), 최초 푸시 1건(일반 문구), notification_pushes에
  (group_key, first) 1행. 10분 안 29개 더: 알림함 묶음 한 줄 30명, 구간 끝 요약 푸시 1건((group_key, summary)). 추가 반응 없음: 요약 없음.
- 내 참여작에 내 좋아요: 행 없음. 차단 관계: 행 없음. 같은 좋아요 사건 재전송: 행 하나. 취소 뒤 재등록: 사건 2, 묶음 인원 1.
- 남의 댓글: entry_commented 1행(comment_id 필수), 조회 때 댓글 앞부분이 조립되고 행에 본문 복사가 없다. 댓글 삭제 뒤 발송 시각: 푸시 없음.
  댓글이 신고로 숨겨진 뒤 발송 시각: 푸시 없음. 발송 대기 중 행동자를 차단: 푸시 없음.
- 내가 참여한 챌린지 종료: challenge_ended 1행(entry_id NULL, 참여작이 둘이어도 하나). 참여작을 지운 챌린지 종료: 행 없음.
- 요청한 리포트 완료(비공개 참여작): entry_ai_report_ready 1행·푸시, 누르면 리포트가 열린다.
- 밤 11시 첫 좋아요: created_at 밤 11시, push_after 아침 9시, 즉시 발송 없음, 그때 push_attempted_at.
- 토글 끔: push_status skipped, 행 있음. 토큰 없음: skipped. 발송 직전 토큰 주인이 다른 계정으로 바뀜·언어가 ko 아님: 보내지 않는다. 기기 둘:
  둘 다 받는다.
- 알림함 조회: 묶음 20개, 최신 사건 순. 묶음 열람: 포함된 사건 전부 read_at. 모두 읽음(시각 T): T 이전만 read_at, 그 뒤 도착한 것은 NULL. 배지 =
  읽지 않은 묶음 수.
- 91일 지난 행: 없다. 참여작 삭제: 그 알림 행 없음. 비공개된 참여작의 반응 알림 누름: "볼 수 없는 영상". 탈퇴: 행 없음. 탈퇴자가 남긴 좋아요
  알림: actor "탈퇴한 사용자".
- 푸시 서비스가 실패해도 좋아요 저장 응답은 200이고 운영 보고가 남는다.
- 게스트 토큰으로 알림함: 403 member_only.

## 범위 밖
- 오늘의 챌린지 소개·순위 변동·내 챌린지의 새 참여 푸시(후속, [공통 규칙](../common.md#범위-밖)).
- 푸시 전달을 ai_jobs에 넣는 것.
- 알림 토글과 푸시 토큰 관리(account.notification).

## 열린 질문
- 규칙·제약은 90일 지난 알림을 "매일 도는 일"이 지운다고 하지만, 코드는 매시 도는 `ChallengeSettlementScheduler.run`
  (`PostgresEntryRepository.settle`)에서 지운다(CONTRACT §6-20도 매시). 코드를 따라 문서를 고칠지 정한다.
