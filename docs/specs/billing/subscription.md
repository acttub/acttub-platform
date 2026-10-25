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

## 개정: 스토어 구독 (SOMA-818, 2단계)

앱의 Pro 구매는 App Store·Google Play 구독이다(RevenueCat 없이 서버가 직접 검증). 상품은 양 스토어 공통 `acttub_pro_monthly`
(월 3,900원, 1개월 자동 갱신). Google 은 구독 ID `acttub_pro_monthly`, 기본 요금제 ID `monthly`. 웹 토스 결제는 이 단계 범위가 아니다.

### 앱이 사용자에게 보이는 동작
- Pro 안내 화면은 서버가 앱 결제를 열었고(`app_enabled`) 아직 Pro 가 아닐 때만 [Pro 시작하기]·[구매 복원]을 그린다. 버튼 위에 상품명,
  스토어가 준 현지화 가격, 1개월 자동 갱신, 해지 방법(iOS 설정 > Apple 계정 > 구독, Android Play 스토어 > 결제 및 정기 결제), 약관 링크를
  둔다. 이미 Pro(웹 결제·기간 부여 포함)이면 버튼 대신 「이미 Pro를 이용 중이에요」만 보인다. 앱 안에서 웹 결제로 보내는 링크·문구는 없다.
- 진행 중에는 스피너 대신 짧은 문구(결제창을 여는 중이에요 / 결제를 확인하고 있어요 / 구독을 찾는 중이에요)를 보인다. 팝업·바텀시트는 쓰지 않는다.
- 구독 관리: 스토어 구독이면 「스토어에서 구독 관리」가 스토어의 구독 관리 화면을 연다(Android 는 상품·패키지 지정).

### 검증 API
`POST /v2/billing/store/verify`(로그인 필요, 앱 헤더·동의 게이트 안) `{platform: ios|android, product_id?, signed_transaction?(iOS 거래 JWS),
purchase_token?(Android)}` → `GET /v2/billing/me` 와 같은 모양. 같은 영수증을 다시 보내도 결과가 같다(멱등).
- 구매자 연결: iOS `appAccountToken`·Android `obfuscatedAccountId` 가 요청 사용자 id(UUID)와 같아야 한다. 다르거나 없으면 403 `store_account_mismatch`.
- 같은 원거래(apple)·구매 토큰(google)이 다른 사용자 줄에 있으면 409 `store_account_conflict`(DB 유니크가 경합의 바닥).
- 토스로 이용 중이거나 다른 스토어 구독이 유효하면 409 `already_subscribed`. 이미 끝난 옛 구매를 복원해도 유효한 줄을 덮지 않는다.
- 그 밖: 404 `billing_unavailable`(앱 결제 꺼짐), 403 `billing_member_required`, 422 `invalid_platform`·`invalid_product`·
  `invalid_store_receipt`(서명·영수증 불량), 409 `payment_pending`(Google 느린 결제 수단 대기), 503 `store_unavailable`(해당 스토어 검증 꺼짐·설정
  오류), 502 `store_upstream_error`(스토어 조회 실패 — 앱이 다시 시도), 429.
- Apple: 공식 app-store-server-library 의 `SignedDataVerifier` 가 JWS 서명 체인(리소스로 둔 Apple Root CA G3), 번들 ID, 앱 Apple ID(운영),
  환경을 검증한다. 운영으로 먼저 검증하고 환경이 다르면 샌드박스로 다시 검증한다. `.p8` 키가 있으면 App Store Server API 로 갱신 정보
  (자동갱신 끔·결제 유예·재시도)를 읽고, 없으면 거래 JWS 만으로 판단한다(자동갱신 끔은 알림이 알려 준다).
- Google: 서비스 계정으로 `purchases.subscriptionsv2.get` 을 조회하고, 승인(acknowledge) 전이면 서버가 승인한다. 앱은 Android 거래를 끝내지 않는다.

### 상태와 Pro 판정
- 기간 끝(`current_period_end`)은 스토어 만료 시각. Apple: 만료 전 자동갱신 끔 → `canceled`(기간 끝까지 Pro), 만료 전 → `active`, 결제 유예 →
  `active`(유예 끝까지), 결제 재시도 중 → `past_due`(Pro 아님), 만료·환불·취소 → `expired`. Google: ACTIVE → `active`(자동갱신 끔이면
  `canceled`), CANCELED → `canceled`, IN_GRACE_PERIOD → `active`(만료 +7일), ON_HOLD·PAUSED → `past_due`, EXPIRED → `expired`.
- 스토어 구독은 `active` 여도 기간(+갱신 알림 여유 6시간)이 지나면 Pro 가 아니다 — 만료 알림을 못 받아도 영구 Pro 로 남지 않는다.
  `canceled` 는 기간 끝까지만. 토스 구독의 판정은 그대로다.
- 스토어 구독은 서버에서 해지·재시도하지 않는다(409 `managed_by_store`). 스케줄러는 `toss` 줄만 집는다.

### 알림 (인증 없는 서버 호출 — 앱 헤더·토큰·동의 게이트 밖)
- `POST /v2/billing/store-notify/apple` `{signedPayload}` — App Store Server Notifications V2. 서명(위와 같은 검증)이 권한이다. 서명이 틀리면 400.
  갱신·만료·환불(REFUND·REVOKE)·자동갱신 끔·결제 재시도·유예를 같은 원거래 줄에 반영한다. 우리 줄이 아닌 알림(앱이 아직 검증하지 않은 구매,
  다른 상품, TEST)은 무시하고 200 으로 돌려준다.
- `POST /v2/billing/store-notify/google` — Pub/Sub 푸시(`message.data` base64 RTDN). 푸시 인증은 설정으로 고른다: `token`(주소의 `?token=` 이 비밀
  값과 같음, 상수 시간 비교) 또는 `oidc`(Google 서명 OIDC 토큰의 서명·발급자·audience·서비스 계정 이메일 확인). 비어 있으면 모두 401. 알림 내용은 믿지 않고
  구매 토큰으로 `subscriptionsv2.get` 을 다시 조회해 현재 상태를 쓴다. 조회 실패는 502 로 돌려 Pub/Sub 이 다시 보내게 한다.
- 멱등: 알림은 현재 상태를 덮어쓰는 방식이라 같은 알림이 여러 번 와도 결과가 같다. Apple 알림은 기간이 앞으로 가지 않는 한 서명 시각이 마지막 기록
  시각보다 이르면(늦게 도착한 옛 알림) 무시한다.

### 설정(모두 기본 꺼짐, 비밀 값은 환경변수로만)
`BILLING_APP_ENABLED`(앱 화면·검증 API), `BILLING_APPLE_ENABLED`·`BILLING_APPLE_BUNDLE_ID`(기본 com.acttub.app)·`BILLING_APPLE_APP_ID`·
`BILLING_APPLE_ONLINE_CHECKS`·`BILLING_APPLE_API_PRIVATE_KEY`·`BILLING_APPLE_API_KEY_ID`·`BILLING_APPLE_API_ISSUER_ID`,
`BILLING_GOOGLE_ENABLED`·`BILLING_GOOGLE_PACKAGE_NAME`(기본 com.acttub.app)·`BILLING_GOOGLE_SERVICE_ACCOUNT_JSON`·`BILLING_GOOGLE_PUSH_AUTH`·
`BILLING_GOOGLE_PUSH_TOKEN`·`BILLING_GOOGLE_PUSH_AUDIENCE`·`BILLING_GOOGLE_PUSH_SERVICE_ACCOUNT`.

### 앱의 복구
서버 확인 전에 앱이 꺼졌거나 네트워크가 끊겨 결제는 됐는데 Pro 가 안 켜진 구매는, 앱을 켜거나 앞으로 가져올 때(30초 간격) 서버가 앱 결제를 열었고 아직
Pro 가 아닌 사람에 한해 스토어의 미완료 거래를 읽어 다시 서버에 확인받는다. 확인 요청은 네트워크·서버 오류에서 재시도하고, iOS 거래는 서버 OK 뒤에만 끝낸다.
