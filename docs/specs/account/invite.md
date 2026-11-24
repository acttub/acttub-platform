# account.invite 친구 초대

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 1.0.x (SOMA-865). 서버 스위치 `INVITE_ENABLED`(기본 false) 뒤에 있다.
- 화면: 프로필 탭의 「친구 초대」 칸, 리딩 끝 화면의 「친구 초대」 줄. 웹 화면은 없다.
- 테이블: `invite_codes`·`invite_redemptions`(V95), 지급은 `billing_pro_grants`(reason `friend_invite`)

## 기능
회원마다 초대 코드가 하나 있다. 친구가 가입한 뒤 그 코드를 넣고 첫 연습을 끝내면 둘 다 Pro 1개월을 받는다.
초대 경로는 가입 출처(Airbridge·온보딩 질문)와 따로 `invite_redemptions`에 남는다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `GET /v2/invite/me` | 헤더 `Authorization`(게이트 통과 회원) | `{code, can_redeem, redeem_until, redeemed, rewarded, reward_count}` 200. 코드가 없으면 이때 만든다 | 스위치 꺼짐 `invite_unavailable` 404, 게스트 `invite_member_required` 403 |
| `POST /v2/invite/redeem` | 같은 헤더, `{code}` | 위와 같은 모양 200 | 위 둘, `invite_code_not_found` 404, `own_invite_code` 409, `invite_already_redeemed` 409, `invite_window_closed` 409, 요청 사이 탈퇴 `account_deactivated` 403, 한 사람 분당 10회 초과 429 |

두 경로는 실험 스위치 뒤라 OpenAPI 에 싣지 않는다(결제 경로와 같다). 응답에 상대의 이름·id 는 없다.

## 규칙·제약
- 코드: 헷갈리는 0·O·1·I 를 뺀 대문자·숫자 6자리. 사람마다 하나이고 겹치지 않는다. 넣을 때 대소문자·띄어쓰기·하이픈은 가린다.
- 넣기: 본인 코드 불가, 회원당 한 번, 가입 뒤 `INVITE_REDEEM_WINDOW_DAYS`(기본 7)일 안. 게스트는 넣지도 코드를 받지도 못한다. 탈퇴했거나
  게스트인 사람의 코드는 없는 코드로 본다. `can_redeem` 은 아직 넣지 않았고 기간 안일 때만 true 이고, 그때만 `redeem_until` 이 있다.
- 첫 연습: 코드를 넣은 **뒤에** 끝낸 첫 센 연습이다. 센 연습은 연습 날짜(practice.days)와 같은 정의다 — 리딩 회차가 완료로 바뀌었거나
  코칭 대화가 닫히며 노트가 남았을 때. 코드를 넣기 전에 끝낸 연습은 세지 않는다.
- 지급: 첫 연습에서 한 번만(지급 시각 `rewarded_at` 을 채운 쪽만 지급한다). 초대받은 사람은 늘 받는다. 초대한 사람은 활성 회원이고 한국 시간
  이번 달에 받은 초대 보상이 `INVITE_INVITER_MONTHLY_CAP`(기본 5)보다 적을 때만 받는다(`inviter_rewarded`).
  지급과 기록은 한 트랜잭션이라 실패하면 아무것도 남지 않고 다음 연습에서 다시 시도한다. 연습 저장은 지급 실패와 상관없이 성공한다.
- 기간: Pro 1개월 = `billing_pro_grants` 한 줄. 이미 받은 기간(다른 초대 보상·운영 지급)이 남아 있으면 그 끝에 이어 붙인다.
  결제 구독(`billing_subscriptions`)은 보지도 바꾸지도 않는다 — 결제 중인 사람의 지급 기간은 결제 기간과 겹쳐 흐르고, 결제를 끊으면
  남은 지급 기간 동안 Pro 다. Pro 판정은 [billing.subscription](../billing/subscription.md)의 grant 규칙 그대로라 결제 기능이 닫힌 서버에서는
  지급 기간이 있어도 Pro 가 아니다.
- 알림: 지급되면 초대받은 사람에게, 보상을 받았으면 초대한 사람에게도 푸시를 한 번 보낸다(data `kind=invite_reward`, 분석 완료 토글을 따른다).
  상대의 이름은 싣지 않는다.
- 계측: 앱이 초대 공유(`invite_share`), 코드 넣기 성공(`invite_redeem_success`)·실패 사유(`invite_redeem_fail`, `reason`=오류 코드),
  보상 지급(`invite_reward_granted`, 늘어난 `reward_count` 로 안다)을 남긴다. 서버는 지급마다 `invite_reward_granted` 로그 한 줄을 남긴다.
  코드·이메일·이름은 싣지 않는다.
- 스위치가 꺼져 있으면 두 경로는 404 이고 연습 완료 알림은 DB 를 읽지 않는다. 앱은 404 를 보고 초대 칸을 그리지 않는다.
- 약관·안내 문구는 이 기능에서 고치지 않는다. 앱은 보상 조건 한 줄만 보인다.

## 앱
- 프로필 탭: 「친구 초대」 칸에 보상 조건 한 줄, 내 코드, [친구 초대하기] 버튼이 있다. 누르면 OS 공유 시트로 스토어 주소(앱 스토어·플레이 스토어)·코드·
  「가입하고 첫 연습을 끝내면 둘 다 Pro 1개월」을 보낸다. `can_redeem` 이면 같은 칸 안에 「초대 코드 입력」 칸이 있고, 결과는 칸 아래 짧은
  문구로 보인다(팝업·바텀시트 없음, 처리 중에는 「확인하고 있어요」).
- 리딩 끝 화면: 센 회차로 끝났을 때 보상 조건 한 줄과 [친구 초대하기]가 있다(같은 공유).
- 딥링크 `actingapp://invite?code=XXXXXX` 로 열리면 코드를 기기에 맡기고 프로필 탭으로 간다. 넣기 칸이 열려 있으면 그 코드를 채워 둔다
  (자동으로 넣지는 않는다).
