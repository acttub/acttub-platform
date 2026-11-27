# community.messages 배우끼리 1:1 메시지

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 1.2.0 (SOMA-1039)
- 화면:
- 테이블: direct_conversations, direct_messages, community_reports, user_blocks, community_blocks

## 기능
게시판 글이나 댓글의 작성자 이름을 누르면 그 사람과 1:1 대화가 열린다(대화는 글·댓글에서만 시작한다). 글자만 주고받고,
새 메시지가 오면 푸시가 간다. 대화방 머리에는 대화를 연 글의 제목이 한 줄로 보이고, 누르면 그 글로 간다. 프로필 탭의
「메시지」 줄에 안 읽은 수가 보이고, 목록을 거쳐 대화로 들어간다. 대화 상대는 대화방에서 차단하거나 신고할 수 있다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `POST /v2/messages/conversations` | `StartDirectConversationRequest`: `user_id`, 선택 `post_id` | 새 대화 `DirectConversationPayload` 201, 이미 있으면 200 | 자기 자신 400 `cannot_message_self`, 없거나 게스트·탈퇴한 상대 404 `user_not_found`, 지금 보이지 않는 글 404 `post_not_found`, 차단 403 `message_blocked`, 하루 21번째 새 대화 429 `daily_conversation_limit`, 게스트 403 `member_only` |
| `GET /v2/messages/conversations` | `cursor`·`limit`(1~50, 기본 30) | `DirectConversationListResponse` 200 | 깨진 커서 400 `invalid_cursor`, 게스트 403 `member_only` |
| `GET /v2/messages/conversations/{conversation_id}` | | `DirectConversationPayload` 200 | 참여자가 아니면 404 `conversation_not_found` |
| `GET /v2/messages/conversations/{conversation_id}/messages` | `cursor`·`limit`(1~50, 기본 30) | `DirectMessageListResponse` 200, 최근 것부터 | 404 `conversation_not_found`, 400 `invalid_cursor` |
| `POST /v2/messages/conversations/{conversation_id}/messages` | `SendDirectMessageRequest`: `request_id`·`body` | `DirectMessagePayload` 201, 재전송 200 | 404 `conversation_not_found`, 본문 길이 422 배열, 읽을 수 없는 글자 400 `unreadable_text`, 다른 본문의 재전송 422 `request_fingerprint_mismatch`, 상대 탈퇴 403 `partner_unavailable`, 차단 403 `message_blocked`, 하루 301번째 429 `daily_message_limit` |
| `POST /v2/messages/conversations/{conversation_id}/read` | | 204 | 404 `conversation_not_found` |
| `GET /v2/messages/unread-count` | | `DirectUnreadCountResponse` 200 | 게스트 403 `member_only` |
| `POST /v2/messages/conversations/{conversation_id}/reports` | `DirectConversationReportRequest`: `reason`·선택 `detail`(500자) | 204 | 404 `conversation_not_found`, 같은 대화 재신고 409 `already_reported`, 모르는 사유 422 배열 |
| 차단 | 게시판의 `POST /v2/community/blocks`를 그대로 쓴다 | 204 | community README |
| `PushService#onDirectMessage` (보내기 커밋 뒤) | 받는 사람·대화·보낸 사람 이름 | 받는 사람 토큰 전부에 Expo 푸시(data `kind=direct_message`, `conversation_id`) | 실패는 밖으로 내보내지 않고 보고한다. `DeviceNotRegistered` 토큰은 지운다 |

## 상태
없음. 대화와 메시지는 생기기만 하고 지우는 길이 없다. 읽음은 참여자마다 마지막으로 읽은 시각(`starter_read_at`·
`recipient_read_at`)이고 뒤로 가지 않는다.

## 규칙·제약
- 회원 전용이다. 게이트(동의·프로필)를 지난 회원끼리만 주고받고, 게스트는 403 `member_only`다. 게스트에게는 대화를 열 수 없다(404 `user_not_found`).
- 두 사람 사이의 대화는 방향과 무관하게 하나다. 먼저 연 사람이 starter다. 이미 있으면 시작 요청은 그 대화를 200으로 주고 하루 한도를 세지 않는다.
  두 사람이 서로에게 동시에 열어도 하나만 생긴다(두 계정 행을 id 순서로 잠근 뒤 찾는다).
- 시작 글(`post_id`)은 새 대화일 때만 남는다. 대화방 머리의 `origin_post`는 보는 사람에게 지금 보이는 글일 때만 오고, 지워졌거나 가려졌거나
  차단으로 보이지 않으면 `null`이다. 글을 고쳐 제목이 바뀌면 바뀐 제목이 보인다.
- 메시지가 하나도 없는 대화는 목록에 나오지 않는다(연 사람에게도). 목록은 마지막 메시지가 최근인 대화부터다.
- 본문은 글자만이고 앞뒤 공백을 걷은 1~1000자(코드 포인트)다. 글자 규칙은 다른 자유 글과 같다(`InputCharset`). 게시판과 달리 연락처를 막지 않는다
  — 상대역 구하기처럼 1:1로 연락처를 나누는 것이 이 기능의 쓰임새다.
- 이름은 게시판처럼 공개 이름(`user_profiles.name`, 없으면 "배우")이고 익명은 없다. 사진은 프로필 사진(1시간짜리 주소)이다.
- 차단: 사람 차단(`user_blocks`, ADR-032)이 어느 쪽으로든 있으면 시작과 보내기가 403 `message_blocked`다. 0.1.0 전 게시판 차단(`community_blocks`)도
  어느 쪽이든 같다. 차단해도 대화와 지난 메시지는 남아 읽히고, 대화방은 `can_send: false`·`unavailable_reason: message_blocked`를 준다. 차단을 풀면
  (`/v2/me/blocks`) 다시 주고받는다.
- 신고: 대화(상대)를 신고한다. 게시판 신고 표(`community_reports`)에 `target_type = 'conversation'`, `target_id = 대화 id`로 남고, 게시판 신고와 같은
  사유를 받으며 같은 Slack 채널에 「1:1 메시지 대화」로 알린다. 한 사람이 같은 대화를 두 번 신고할 수 없다(409). 두 사람만 보는 대화라 신고 수로 가리지
  않는다. 운영은 대화 id로 메시지를 확인한다.
- 남용 막기: 한국 날짜 하루에 새 대화 20개, 보내기 300개까지다. 같은 사람의 보내기는 계정 행에서 줄을 서서 세므로 한도를 넘는 동시 요청이 없다.
- 요청 재전송([공통 규칙](../common.md#요청-재전송)): 보내기만 `request_id`를 싣는다. 유일 범위는 (sender_user_id, request_id)이고 본문은 대화 id와
  앞뒤 공백을 걷은 본문이다. 재전송은 200이다. 시작은 두 사람의 대화가 하나라 재전송해도 같은 대화라 요청 id가 없다. 읽음은 덮어쓰는 갱신이다.
- 푸시: 받는 사람의 토큰 전부에 보낸다. 같은 대화는 받는 사람마다 1분에 한 번만 간다(`*_pushed_at`을 한 문장으로 당긴 보내기만 보낸다). 잠금 화면에
  보이므로 본문은 싣지 않는다(제목 "새 메시지", 본문 "<이름>님이 메시지를 보냈어요."). 메시지만 끄는 알림 토글은 아직 없다 — 토글 셋을 모두 끈 회원은
  토큰이 없어 받지 않는다([account.notification](../account/notification.md#규칙제약)). 앱은 알림을 누르면 그 대화를 연다.
- 안 읽은 수: 상대가 보냈고 내 읽은 시각 뒤에 온 메시지 수다. 대화방을 열거나 새 메시지를 받으면 앱이 읽음을 남긴다. 내가 보내면 그 시각까지 읽은 것이다.
- 탈퇴: 대화와 메시지 행은 남고(상대의 대화방을 깨지 않는다, ADR-029), 탈퇴한 사람은 상대 화면에 "탈퇴한 사용자"로 보이며 사진이 없다. 탈퇴한 사람에게는
  보낼 수 없고(403 `partner_unavailable`) 새 대화도 열 수 없다(404). 메시지 행이 있는 계정은 행째 지우지 않고 탈퇴 절차로 닫는다(만 14세 미만 닫기,
  `AccountErasure#hasRecords`). 탈퇴 3년 파기는 이 표를 건드리지 않는다.

## 예외
- 푸시가 실패해도 보내기는 그대로 201이다.
- 다른 기기에서 탈퇴가 끝난 뒤 늦게 온 시작·보내기는 [공통 규칙](../common.md#탈퇴와-겹친-쓰기)대로 403 `account_deactivated`이고 행이 남지 않는다.
- 보내는 사이에 상대가 탈퇴하면 403 `partner_unavailable`이고 행이 남지 않는다.
- 대화방을 열 때 시작 글이 사라졌으면 머리 줄 없이 대화만 보인다.

## 검증 방법
- 글 작성자에게 대화를 열고 보내면: 상대의 목록에 한 줄, 안 읽은 수 1. 상대가 대화방을 열면 0. (`MessageEndpointIT`)
- 상대가 반대 방향으로 열면: 같은 대화 id, 200, 대화 행 하나.
- 같은 `request_id`·같은 본문 두 번: 메시지 하나, 200. 다른 본문: 422 `request_fingerprint_mismatch`.
- 메시지 셋을 `limit=2`로: 최근 둘, `next_cursor`로 나머지 하나.
- 자기 자신 400, 없는 상대 404, 가려진 글 404, 게스트 403 `member_only`.
- 상대가 게시판에서 나를 차단하면: 보내기·시작 403 `message_blocked`, 대화방 `can_send: false`. 옛 게시판 차단도 같다.
- 대화 신고: `community_reports`에 `conversation` 행 하나, 다시 신고하면 409.
- 하루 300개 보낸 뒤: 429 `daily_message_limit`. 하루 20개 연 뒤 새 대화: 429, 이미 있는 대화 다시 열기: 200.
- 상대가 탈퇴하면: 이름 "탈퇴한 사용자", 지난 메시지는 보이고 보내기 403 `partner_unavailable`.
- 1분 안에 두 번 보내면: 푸시 시각이 한 번만 당겨진다.
- 앱: 푸시를 누르면 그 대화가 열리고, 대화방에 있는 동안 새 메시지가 몇 초 안에 보인다.

## 범위 밖
- 사진·영상·파일, 메시지 지우기·고치기, 단체 대화, 읽음 표시(상대가 읽었는지 보여 주기).
- 메시지만 끄는 알림 토글.
- 게시판 밖(챌린지·프로필)에서 대화 시작.
- 웹 화면. 앱만 쓴다.

## 열린 질문
- 메시지 알림을 따로 끄는 토글을 둘지(지금은 토글 셋을 다 꺼야 멈춘다).
- 두 사람이 모두 탈퇴한 대화와 탈퇴 3년 뒤의 메시지 본문을 파기할지(지금은 게시판 댓글처럼 남는다). 개인정보 처리방침의 보관 문장과 함께 정한다.
