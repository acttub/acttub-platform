# billing.subscription 앱 ACTTUB Pro 정기결제

[공통 규칙](../common.md) · [기능 스펙 목차](../README.md)

- 도입: 1.0.x (SOMA-818). 서버 플래그 `BILLING_APP_ENABLED`(기본 false) 뒤에 있다.
- 화면: pen ⑥ Pro · 안내(P0xJ9), 오늘 무료 코칭 다 씀(a5y1Qr), 무료 대본 3개(WLdNc), 결제 창(t2V04c, 토스 화면), 외부 결제 안내
  (hD5to, iOS), 결제 완료(kqeG6), 설정 · 구독 관리(GmTw6), 결제하지 못했어요(ETD1H), 지금 대본과 바꾸기 확인(K7q5Vk)
- 테이블: `billing_subscriptions`·`billing_checkouts`·`billing_payments`(V64)

## 기능
Pro 는 월 3,900원(부가세 포함) 자동결제다. 결제는 앱 스토어 결제가 아니라 토스페이먼츠 자동결제(카드 등록 → 빌링키 → 첫
3,900원 결제 → 매월 자동결제)다. 무료는 코칭 하루 3회차·리딩 대본 3개 보관이다(한도 강제는 별도 플래그). Pro 는 여기에 고도화된 코칭(상위 AI 모델, 습관을 기억하는 코칭, 장면·대사별로 더 자세한 코칭 노트)을 더한다 — 이 PR(무료 한도 개정)은 문구만이고 구현은 따로다. 구매 복원은 없다
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
- 코칭: 한국 시간 오늘 0시 이후 만든 회차(영상 있는·없는 코칭, 이어하기)가 3개면 네 번째 회차 시작이 429 `free_daily_coaching_limit`
  → 앱 「오늘 무료 코칭을 다 썼어요」 시트. 같은 요청의 재전송은 한도보다 먼저라 막히지 않는다.
- 리딩 대본: 보관 대본이 3개면 새 대본 저장·나누기 요청이 403 `free_script_limit` → 앱 「무료는 대본 3개까지 보관해요」 시트.
  「대본 하나 지우고 넣기」는 보관 대본이 하나면 바로, 둘 이상이면 지울 대본을 고르게 한 뒤(「어떤 대본을 지울까요?」) 그 대본을
  지우고(연습 기록도 함께) 같은 글로 다시 나눈다. 이미 접수된 나누기 작업의 완료 시점은
  회원 한도(100)로 본다 — 한도 직전에 동시에 여러 개를 넣으면 3개를 넘을 수 있다.

### 기존 회원 유예 (SOMA-818)
2026-10-31 23:59 KST 까지 가입한 회원(`users.created_at` < `BILLING_LEGACY_SIGNUP_BEFORE`, 기본 `2026-10-31T15:00:00Z`)에게는 무료 한도(코칭 하루 3회·리딩 대본 3개)를 `BILLING_LEGACY_LIMITS_FROM`(기본 `2026-11-30T15:00:00Z`, 12월 1일 00:00 KST) 전까지 걸지 않는다. 11월 1일부터 가입한 회원은 바로 걸린다. 게스트도 `users` 줄이라 같은 규칙이다. `GET /v2/billing/me` 의 `limits_enforced` 도 같은 판정을 써 회원마다 값이 다르다(앱은 이 값을 쓰지 않고 429·403 응답으로 시트를 띄운다). 한도만 미룬다 — Pro 판정·고품질 목소리·광고는 그대로다. 가입 시각은 바뀌지 않아 프로세스 안에 기억하고, 유예가 끝난 뒤에는 조회하지 않는다.

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

앱의 Pro 구매는 App Store·Google Play 구독이고 RevenueCat 으로 받는다(앱 SDK `react-native-purchases`, 서버는 RevenueCat REST API v1).
상품은 양 스토어 공통 `acttub_pro_monthly`(월 3,900원, 1개월 자동 갱신)과 `acttub_pro_yearly`(연 32,500원 = 월 요금 12개월 46,800원에서 30% 할인,
1년 자동 갱신) 둘이다. Google 은 구독 ID 가 각각 `acttub_pro_monthly`·`acttub_pro_yearly`, 기본 요금제 ID 가 `monthly`·`yearly`다. Apple 은 같은 구독
그룹에 두 상품을 둔다. RevenueCat 에서는 entitlement `pro` 에 두 상품을 붙이고, current offering(`default`)의 `$rc_monthly`·`$rc_annual` 패키지로 판다.
장부 amount 는 산 상품의 정가(3,900·32,500)이고 실제 청구액은 스토어가 정한다. Pro 화면은 월·연을 고르게 하고(기본 월), 오퍼링에 없는 요금제는 고를 수 없다.
연 구독은 앱 스토어 전용이다 — 웹 토스는 계약 조건(서비스 제공 기간 1개월 이내) 때문에 월 구독만 판다. 웹 토스 결제는 이 단계 범위가 아니다.

### 앱이 사용자에게 보이는 동작
- Pro 안내 화면은 서버가 앱 결제를 열었고(`app_enabled`) 아직 Pro 가 아닐 때만 [Pro 시작하기]·[구매 복원]을 그린다. 버튼 위에 상품명,
  스토어가 준 현지화 가격(패키지의 priceString), 자동 갱신 주기, 해지 방법(iOS 설정 > Apple 계정 > 구독, Android Play 스토어 > 결제 및 정기 결제),
  약관 링크를 둔다. 이미 Pro(웹 결제·기간 부여 포함)이면 버튼 대신 「이미 Pro를 이용 중이에요」만 보인다. 앱 안에서 웹 결제로 보내는 링크·문구는 없다.
- 진행 중에는 스피너 대신 짧은 문구(결제창을 여는 중이에요 / 결제를 확인하고 있어요 / 구독을 찾는 중이에요)를 보인다. 팝업·바텀시트는 쓰지 않는다.
- 구독 관리: 스토어 구독이면 「스토어에서 구독 관리」가 스토어의 구독 관리 화면을 연다.
- 빌드에 RevenueCat 공개 SDK 키(`EXPO_PUBLIC_REVENUECAT_IOS_KEY`·`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`)가 없으면 SDK 를 열지 않고 구매 버튼이 눌리지 않는다.

### 구매자 연결
RevenueCat app user id = 우리 user id(UUID)다. 앱은 SDK 를 처음 쓸 때 그 id 로 `configure`, 사람이 바뀌면 `logIn`, 로그아웃하면 `logOut` 한다.
같은 스토어 계정의 구매를 다른 우리 계정이 복원하면 누구에게 줄지는 RevenueCat 프로젝트의 복원 규칙(기본: 새 계정으로 옮김)이 정하고, 옮겨지면
TRANSFER 웹훅으로 양쪽을 다시 읽는다(옛 계정은 expired).

### 동기화 API
`POST /v2/billing/store/sync`(로그인 필요, 앱 헤더·동의 게이트 안, 본문 없음) → `GET /v2/billing/me` 와 같은 모양. 앱은 구매·복원 뒤(네트워크·5xx 는
재시도, 결제 직후 아직 Pro 가 아니면 잠깐 뒤 다시) 부르고 응답의 `pro` 로만 화면을 바꾼다. 서버는 RevenueCat `GET /v1/subscribers/{user id}`(비밀 키)로
entitlement 를 읽어 사람당 한 줄을 덮어쓴다 — 여러 번 불러도 결과가 같다(멱등).
- 404 `billing_unavailable`(앱 결제 꺼짐), 403 `billing_member_required`, 409 `already_subscribed`(토스로 이용 중인데 스토어 구독도 유효 — 토스 줄은 그대로),
  503 `store_unavailable`(RevenueCat 꺼짐·키 거부), 502 `store_upstream_error`(RevenueCat 조회 실패 — 앱이 다시 시도), 429.

### 상태와 Pro 판정
- 출처(provider)는 RevenueCat store 로 정한다: `app_store` → apple, `play_store` → google. 그 밖(프로모션·웹 등)이나 우리 상품이 아니면 스토어 구독으로 보지 않는다.
- 샌드박스 구매(`is_sandbox`)는 `BILLING_REVENUECAT_ALLOW_SANDBOX=true` 인 서버(dev)에서만 Pro 를 연다. 운영은 무시한다.
- 기간 끝(`current_period_end`)은 RevenueCat expires_date. 기간 안: 자동 갱신 끔(`unsubscribe_detected_at`) → `canceled`(기간 끝까지 Pro), 아니면 `active`
  (결제 문제가 있어도 기간 안이면 active). 기간 지남: 결제 유예(`grace_period_expires_date`) 안 → `active`(유예 끝까지), 결제 문제(`billing_issues_detected_at`)
  → `past_due`(Pro 아님), 그 밖 → `expired`. 이번 기간 시작 뒤에 알아챈 환불(`refunded_at`)은 바로 `expired`.
- RevenueCat 에 entitlement 가 없으면(산 적 없음·다른 계정으로 옮겨짐) 남아 있는 스토어 줄을 `expired` 로 끝낸다. 끝난 옛 구매만 있으면 새 줄을 만들지 않는다.
- 스토어 구독은 `active` 여도 기간(+갱신 알림 여유 6시간)이 지나면 Pro 가 아니다 — 웹훅을 못 받아도 영구 Pro 로 남지 않는다.
  `canceled` 는 기간 끝까지만. 토스 구독의 판정은 그대로다.
- 스토어 구독은 서버에서 해지·재시도하지 않는다(409 `managed_by_store`). 스케줄러는 `toss` 줄만 집는다. 탈퇴한(활성 아닌) 사람의 줄은 쓰지 않는다.
- `store_transaction_id` 는 마지막으로 본 스토어 거래 ID 기록일 뿐 유일하지 않다.

### 웹훅 (RevenueCat 서버 호출 — 앱 헤더·토큰·동의 게이트 밖)
- `POST /v2/billing/store-notify/revenuecat` — RevenueCat 대시보드 웹훅. `Authorization` 헤더 전체가 `REVENUECAT_WEBHOOK_AUTH` 와 같아야 한다(SHA-256 뒤 상수
  시간 비교). 비어 있거나 다르면 401. 운영 웹훅은 Production 만, dev 웹훅은 Sandbox 만 받도록 대시보드에서 나눈다.
- 본문의 상태 값은 믿지 않는다. `event` 의 `app_user_id`·`original_app_user_id`·`aliases`·`transferred_from`·`transferred_to` 중 UUID 꼴인 우리 사람(최대 10명)을
  골라 각자 RevenueCat 을 다시 읽어 위 규칙으로 덮어쓴다. 그래서 같은 이벤트가 여러 번 오거나 순서가 바뀌어도 결과가 같다(멱등). `TEST`·익명 ID·기능
  꺼짐은 무시하고 200. 본문 꼴이 틀리면 400, RevenueCat 조회 실패는 502·503 으로 돌려 RevenueCat 이 다시 보내게 한다.

### 설정(모두 기본 꺼짐, 비밀 값은 환경변수로만)
서버: `BILLING_APP_ENABLED`(앱 화면·동기화 API), `BILLING_REVENUECAT_ENABLED`(기본 false), `REVENUECAT_SECRET_API_KEY`(V1 비밀 키), `REVENUECAT_WEBHOOK_AUTH`,
`REVENUECAT_ENTITLEMENT_ID`(기본 pro), `BILLING_REVENUECAT_ALLOW_SANDBOX`(기본 false, dev 만 true).
앱 빌드: `EXPO_PUBLIC_REVENUECAT_IOS_KEY`·`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`(RevenueCat 공개 SDK 키). RevenueCat SDK 는 네이티브 모듈이라 Expo Go 가 아니라
개발 빌드·스토어 빌드에서만 실제 결제가 된다.

### 앱의 복구
서버 동기화 전에 앱이 꺼졌거나 네트워크가 끊겨 결제는 됐는데 Pro 가 안 켜진 구매는, 앱을 켜거나 앞으로 가져올 때(30초 간격) 서버가 앱 결제를 열었고 아직
Pro 가 아닌 사람에 한해 RevenueCat SDK 를 그 사람으로 열고(SDK 가 남은 거래를 올린다), 고객 정보에 활성 `pro` entitlement 가 있으면 서버 동기화를 부른다.
갱신·만료·환불은 웹훅이 반영한다.
