# billing.subscription 앱 ACTTUB Pro 정기결제

[공통 규칙](../common.md) · [기능 스펙 목차](../README.md)

- 도입: 1.0.x (SOMA-818). 서버 플래그 `BILLING_APP_ENABLED`(기본 false) 뒤에 있다.
- 화면: pen ⑥ Pro · 안내(P0xJ9), 오늘 무료 코칭 다 씀(a5y1Qr), 무료 대본 1개(WLdNc), 결제 창(t2V04c, 토스 화면), 외부 결제 안내
  (hD5to, iOS), 결제 완료(kqeG6), 설정 · 구독 관리(GmTw6), 결제하지 못했어요(ETD1H), 지금 대본과 바꾸기 확인(K7q5Vk)
- 테이블: `billing_subscriptions`·`billing_checkouts`·`billing_payments`(V63)

## 기능
Pro 는 월 3,900원(부가세 포함) 자동결제다. 결제는 앱 스토어 결제가 아니라 토스페이먼츠 자동결제(카드 등록 → 빌링키 → 첫
3,900원 결제 → 매월 자동결제)다. 무료는 코칭 하루 1회차·리딩 대본 1개 보관이다(한도 강제는 별도 플래그). 구매 복원은 없다
(구독은 계정에 붙는다). 7일 이내 전액 환불은 지금은 운영자가 토스 관리자에서 처리한다(앱 화면 없음).

## 흐름
1. 앱 `POST /v2/billing/checkout {purpose: subscribe|change_card}` → 서버가 일회용 카드 등록 창을 만들고 주소를 준다
   (`/v2/billing/web/checkout/{state}`, 30분, 한 번만). state 원문은 주소에만 있고 DB 에는 SHA-256 만 남는다.
2. 앱은 그 주소를 `expo-web-browser openAuthSessionAsync(url, 'actingapp://billing-result')` 로 연다. 페이지는 토스 SDK v2
   `requestBillingAuth({method:'CARD'})` 를 바로 띄운다. 카드 정보는 토스 화면에서만 입력된다.
3. 토스가 성공(`…/success?customerKey&authKey`)·실패(`…/fail?code`) 콜백으로 브라우저를 보낸다. 서버는 창을 한 번만 집어
   빌링키를 받고(AccountSecrets AES-256-GCM 암호문으로 저장) subscribe 면 3,900원을 승인한다. 어느 결과든
   `actingapp://billing-result?status=done|failed|unknown|canceled|invalid` 로 302 한다.
4. 앱은 돌아오면 `GET /v2/billing/me` 로 서버 상태를 다시 읽어 결제 완료·결제하지 못했어요를 가른다(주소의 status 는 참고만).

iOS 는 2단계 전에 앱 화면으로 외부 결제 안내(hD5to)를 띄운다. 실제 Apple StoreKit External Purchase 시스템 창과 entitlement 는
아직 없다 — 출시 전에 Apple 승인과 네이티브 구현이 필요하다.

## 상태
| status | 뜻 | Pro |
|---|---|---|
| none | 구독 없음(카드만 등록하고 첫 결제가 안 된 경우 포함, 저장값은 expired) | 아니오 |
| active | 자동결제 중. `next_billing_at` = 이번 기간 끝 | 예 |
| canceled | 자동결제만 해지. 이번 기간(`period_end`) 끝까지 | 기간 안이면 예 |
| past_due | 자동결제 실패. `retry_count` 번 실패, `next_billing_at` = 다음 재시도 | 아니오 |
| expired | 끝남(해지 기간 만료·재시도 소진·탈퇴). 빌링키 삭제 | 아니오 |

- 전이: none → active(첫 결제 성공). active → canceled(해지) → expired(기간 끝, 결제 없음). active → past_due(자동결제 거절,
  하루 뒤 재시도) → active(성공) 또는 expired(1회 + 재시도 3회 모두 실패). past_due 에서 해지하면 바로 expired.
- 다음 결제일은 한국 시간 같은 날짜의 다음 달(31일 → 말일).
- 결제 수단 바꾸기는 결제 없이 카드만 바꾼다. past_due 였으면 새 카드로 바로 한 번 결제한다.
- 탈퇴는 구독을 expired 로 바꾸고 빌링키를 지운다. 결제 기록은 남는다.

## 두 번 결제하지 않는다
- 결제 시도 하나 = 주문 ID 하나(`billing_payments.order_id` UNIQUE) = 토스 `Idempotency-Key`. 기록을 먼저 넣고 승인한다.
  같은 주문 ID 가 이미 있으면 새로 승인하지 않고 같은 키로 결과만 다시 묻는다.
- 자동결제 주문 ID 는 (구독, 기간 시작일, 시도 번호)로 정해진다. 재시도는 다음 번호다.
- 결과를 모르면(시간 초과·5xx·검증 불일치) 실패로 단정하지 않고 `unknown` 으로 두고, 스케줄러가 10분 뒤부터 같은 키로 다시
  묻는다(최대 20번). 결과를 모르는 결제가 있는 구독은 새로 결제하지 않고, 그 사람의 새 구독 창도 열지 않는다(409 payment_pending).
- 스케줄러(`BILLING_RENEWAL_POLL_MS`, 기본 10분)는 구독 하나를 `FOR UPDATE SKIP LOCKED` 와 5분 점유로 집는다.

## API (앱 토큰·동의·클라이언트 판 게이트 안, OpenAPI 미게재)
| 경로 | 응답·오류 |
|---|---|
| `GET /v2/billing/me` | `{status, pro, amount, period_end, next_billing_at, card_company, card_last4, retry_count, limits_enforced}` |
| `POST /v2/billing/checkout` | `{checkout_url, return_url, expires_at}`. 403 billing_member_required(게스트), 409 already_subscribed, 409 no_subscription, 409 payment_pending, 422 invalid_purpose, 429 |
| `POST /v2/billing/subscription/cancel` | me. 409 no_subscription |
| `POST /v2/billing/subscription/retry` | me(결제 결과는 status 로). 409 no_subscription, 409 not_past_due, 429 |

기능이 닫혀 있으면(플래그 꺼짐·키가 테스트 키가 아님·주소 설정 오류) 모두 404 `billing_unavailable` 이고 앱은 Pro 진입점을 숨긴다.
브라우저 경로 `GET /v2/billing/web/checkout/{state}`(HTML)·`/success`·`/fail` 은 게이트 밖이다.

## 무료 한도 (`BILLING_FREE_LIMITS_ENABLED`, 기본 false)
결제 기능이 열려 있고 이 플래그가 켜져 있고 Pro 가 아닐 때만 건다. 꺼져 있으면 아무것도 바뀌지 않는다.
- 코칭: 한국 시간 오늘 0시 이후 만든 회차(영상 있는·없는 코칭, 이어하기)가 1개면 새 회차 시작이 429 `free_daily_coaching_limit`
  → 앱 「오늘 무료 코칭을 다 썼어요」 시트. 같은 요청의 재전송은 한도보다 먼저라 막히지 않는다.
- 리딩 대본: 보관 대본이 1개면 새 대본 저장·나누기 요청이 403 `free_script_limit` → 앱 「무료는 대본 1개까지 보관해요」 시트.
  「지금 대본과 바꾸기」는 기존 대본을 지우고(연습 기록도 함께) 새 대본 넣기로 간다. 이미 접수된 나누기 작업의 완료 시점은
  회원 한도(100)로 본다 — 동시에 둘을 넣으면 2개가 될 수 있다.

## 설정
`BILLING_APP_ENABLED`, `BILLING_FREE_LIMITS_ENABLED`, `BILLING_PUBLIC_ORIGIN`(토스가 되돌려 보낼 이 API 의 https 주소),
`BILLING_APP_RETURN_URL`(기본 `actingapp://billing-result`), `BILLING_TOSS_CLIENT_KEY`·`BILLING_TOSS_SECRET_KEY`(지금은 `test_ck_`·`test_sk_`
만 받는다 — 운영 Toss 계약 심사 중), `BILLING_RENEWAL_POLL_MS`. dev `.env` 에서만 켠다.

## 개정: 결제 출처별 구독 (SOMA-818, 1단계)

앱 안에서 브라우저로 토스 결제창을 여는 방식은 Apple 규정에 어긋나 버렸다. 구독은 결제 출처(`provider`)별로 받는다.

- `toss`: 웹(acttub.com) 토스 정기결제. 카드 등록·첫 결제·자동결제 스케줄러·재시도는 이 출처만 처리한다.
- `apple`·`google`: 앱 스토어 구독(2단계). 스토어 알림이 갱신하고, 스케줄러·서버 해지·서버 재결제는 건드리지 않는다.
  스키마는 `store_product_id`·`store_original_transaction_id`(apple)·`store_purchase_token`(google)로 준비돼 있다.
- Pro 판정 = (활성 구독이고 기간 안, 출처 무관) OR (`billing_pro_grants`에 지금 유효한 기간). grant는 카드 없이 서버가 주는 기간
  (예: 11월 무료 한 달)이고 SQL·관리 경로로만 넣는다. 자동 부여 로직은 없다.
- 스위치: `BILLING_WEB_ENABLED`(기본 false)가 꺼져 있으면 카드 등록 창·콜백·재시도·자동결제가 모두 막혀 토스 호출이 나가지 않는다.
  키는 test_·live_ 둘 다 받되 두 키의 종류가 같아야 하고, 값은 환경변수로만 준다. 복귀 주소는 `BILLING_WEB_RETURN_URL`(웹 https).
  `BILLING_APP_ENABLED`(기본 false)는 앱 Pro 화면을 여는 스위치(2단계 자리)이고 토스를 열지 않는다.
- 앱은 웹 결제로 보내는 버튼·링크·문구를 두지 않는다. 웹에서 결제한 구독은 「웹에서 결제한 구독이에요」 한 줄만 보인다.
- 웹: `NEXT_PUBLIC_BILLING_WEB_ENABLED=true` 빌드에서만 `/pricing`의 「Pro 구독하기」가 서버 카드 등록 창으로 간다(꺼져 있으면
  심사용 `/pg-review` 그대로). 결과 화면은 `/pricing/result`. 웹에는 아직 회원 로그인이 없어 게스트는 403 `billing_member_required`다.
