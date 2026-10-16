# billing.pg-review PG 심사 전용 테스트 결제

[공통 규칙](../common.md) · [기능 스펙 목차](../README.md)

- 도입: 0.1.x (SOMA-620)
- 화면: 웹 `/pg-review`, `/pg-review/result` (심사 전용, 검색·홈 메뉴에 노출하지 않는다)
- 테이블: 없음

## 기능
PG(토스페이먼츠) 심사 담당자가 월 3,900원(VAT 포함) 구독 결제 흐름을 눈으로 확인하도록, **실제 돈이 나가지 않는** 테스트
카드 등록과 첫 테스트 승인을 한 번 해 볼 수 있는 심사 전용 경로다. 결제 화면은 토스 SDK 화면만 쓰고 ACTTUB 는 카드 정보를
받지 않는다.

## 의도
유료 구독(10/26 사전 안내, 11/2 시작 예정)의 PG 계약 심사에 "결제 흐름을 시연할 수 있는 화면"이 필요하다. 아직 실제 결제·권한·자동
갱신은 없으므로 일반 사용자의 앱 계정과 완전히 분리한 임시 경로로 둔다.

## 목적
심사 담당자가 심사 전용 로그인으로 들어와 테스트 카드를 등록하면, 서버가 토스 테스트 키로 빌링키를 받아 3,900원을 한 번 테스트
승인하고 결과(승인·실패·결과 불명)를 보여 준다. 구독 권한은 부여되지 않고 다음 달 자동 결제도 없다.

## 입력·출력
경로 기본 `/v2/pg-review`. 공개 OpenAPI(`spec/openapi.json`)에는 싣지 않는다(`@Hidden`). 설정이 꺼져 있으면 빈이 없어 모든
경로가 404 다. 응답 JSON 은 camelCase 다.

| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `GET /config` | 쿠키(선택) | `{available, authenticated, testOnly:true, amount:3900}` 200 | — |
| `POST /login` | `Origin`, 본문 `{username, password}` | `{authenticated:true}` 200 + 세션 쿠키 | `invalid_credentials` 401, `origin_not_allowed` 403, `rate limit exceeded` 429, `pg_review_session_limit` 429, `pg_review_unavailable` 404 |
| `POST /checkout` | `Origin`, 세션 쿠키 | `{clientKey, customerKey, successUrl, failUrl}` 200 | `pg_review_login_required` 401, `origin_not_allowed` 403, `checkout_not_allowed` 409, `rate limit exceeded` 429 |
| `GET /success` | 쿼리 `state`, `customerKey`, `authKey`(토스가 붙임), 세션 쿠키 | 302 → `{origin}/pg-review/result` | 없음(어떤 경우에도 302, 결과는 세션에 기록) |
| `GET /fail` | 쿼리 `state`, `code`(토스가 붙임), 세션 쿠키 | 302 → `{origin}/pg-review/result` | 없음 |
| `GET /result` | 세션 쿠키 | `{status, testOnly:true, amount:3900, orderId?, approvedAt?, errorCode?, message?}` 200 | `pg_review_login_required` 401 |
| `POST /logout` | `Origin` | 204, 쿠키 만료 | `origin_not_allowed` 403 |

`successUrl` 은 `{origin}/v2/pg-review/success?state=…`, `failUrl` 은 `{origin}/v2/pg-review/fail?state=…` 이다. origin 은
설정값이고 브라우저가 정하지 않는다.

## 상태
`status`: `idle`(시도 전·대기) → `processing`(콜백을 받아 토스를 부르는 중) → `approved` | `failed` | `unknown`.

| 상태 | 들어오는 전이(조건) | 다음 |
|---|---|---|
| idle | 로그인, 새 checkout 발급 | processing(성공 콜백), failed(실패 콜백·검증 실패) |
| processing | 성공 콜백의 state·customerKey·세션이 맞음(원자적, 1회) | approved, failed, unknown |
| approved | 승인 응답이 `DONE`, 주문번호 일치, 금액 3,900 | 끝. 같은 세션은 새 checkout 을 받을 수 없다 |
| failed | 토스 거절, 실패 콜백, state/customerKey 불일치, 시도 만료 | 새 checkout 발급 가능(세션당 5회) |
| unknown | 승인 호출의 시간 초과·5xx·처리 중 코드, 응답 검증 불일치, 예상 밖 오류 | 끝. 자동 재시도·새 주문 없음 |

## 규칙·제약
- **분리**: 앱 계정·JWT·무료 한도·유료 권한과 무관하다. 심사 전용 로그인과 쿠키(`acttub_pg_review`)만 쓴다. 클라이언트 판 헤더(426)·
  동의 게이트·액세스 토큰 검사는 이 경로에서 빠진다(토스 콜백은 헤더를 실을 수 없다). 그 밖의 `/v2` 경로는 그대로다.
- **설정**: `ACTTUB_PG_REVIEW_ENABLED`(기본 false), `_ORIGIN`(https 도메인만, 루프백 http 허용), `_USERNAME`,
  `_PASSWORD_SHA256`(무작위 고엔트로피 비밀번호의 SHA-256 hex), `_TOSS_CLIENT_KEY`(`test_ck_`), `_TOSS_SECRET_KEY`(`test_sk_`).
  하나라도 틀리면 기능은 닫힌 채 부팅하고(`config.available=false`, 나머지 404) 이유 코드만 로그에 남긴다. 라이브 키는 받지 않는다.
  시크릿 키는 토스를 부르기 직전에도 다시 검사한다.
- **금액**: 서버 고정 3,900원, 주문명 `ACTTUB Pro 월 구독 테스트`. 요청에서 금액·주문번호를 받지 않는다.
- **세션**: 메모리에만 둔다. 로그인부터 30분(절대), 동시 50개, 접근 때마다 만료 정리. 쿠키는 HttpOnly·SameSite=Lax·Path=`/v2/pg-review`
  (origin 이 https 면 Secure). 로그인마다 새 값을 발급한다(세션 고정 방지). 비밀번호는 SHA-256 상수 시간 비교.
- **요청 보호**: POST 는 `Origin` 이 설정 origin 과 정확히 같아야 한다. 로그인은 IP 당 틀린 시도 분당 10회·전체 분당 60회, checkout 은 IP 당
  분당 20회·세션당 5회, 콜백은 IP 당 분당 30회.
- **콜백**: state(일회용·15분)·customerKey·세션이 모두 맞아야 처리한다. 토스 `authKey` 로 빌링키를 받고
  `POST /v1/billing/{billingKey}`(고정 Idempotency-Key, 응답 대기 65초)로 승인한다. `/v1/payments/confirm` 은 쓰지 않는다. 같은 콜백이 다시
  와도 토스를 다시 부르지 않는다.
- **비밀 값**: authKey·billingKey·시크릿 키는 메모리 지역 변수로만 쓰고 응답·세션·로그·예외 메시지·분석 이벤트에 싣지 않는다. HTTP 오류는
  원인 예외를 붙이지 않고(URL 에 빌링키가 있다) 코드만 가진 예외로 바꾼다. 결과의 `errorCode` 는 토스 오류 코드(대문자·숫자·밑줄)나 우리 코드뿐이다.
- 영속 저장·스케줄러·정기 결제·환불은 없다. 빌링키는 저장하지 않는다.

## 예외
- 승인 호출이 시간 초과·5xx 면 `unknown` 이다. 실패로 단정하지 않고 새 주문도 만들지 않는다. 토스 가맹점 관리자에서 주문번호로 확인한다.
- 승인 응답이 `DONE` 이 아니거나 주문번호·금액이 다르면 `unknown`(`verification_mismatch`).
- 프로세스가 재기동하면 세션과 결과가 사라진다. 다시 로그인한다.
- 테스트 빌링키는 토스 쪽에 남을 수 있다(우리는 저장하지 않는다).

## 검증 방법
- 설정 꺼짐/라이브 키/잘못된 origin·해시 → `available=false`, 로그인 404, 토스 호출 0 (`PgReviewControllerTest`, `PgReviewConfigurationTest`).
- 틀린 비밀번호 → 401, 쿠키 없음. 틀린 시도 11번째 → 429. 맞는 로그인은 한도를 쓰지 않는다.
- Origin 없음/다름 → 403. 만료된 세션·남의 세션 쿠키 → 401.
- state·customerKey 불일치, 만료, 다른 세션의 state → 토스 호출 0.
- 같은 콜백 두 번/동시 6번 → 토스 호출 1번. 금액 3,900·주문명 고정.
- 승인 거절 → `failed`, 시간 초과 → `unknown` 이고 새 checkout 409. 응답 불일치 → `unknown`.
- 토스 호출: Basic(시크릿+`:`), Idempotency-Key, 본문 모양, 5xx·처리 중 코드는 unknown, 오류에 빌링키·authKey 없음 (`TossBillingGatewayTest`).
- 로그에 authKey·billingKey·시크릿 키 없음. 게이트 예외는 `/v2/pg-review/` 에만 적용(`PgReviewGateExemptionTest`).

## 범위 밖
실제 결제, 구독 권한 부여, 자동 갱신 스케줄러, 환불, 일반 사용자 노출, 빌링키 영속 저장, 영수증·세금계산서, 실제 앱 계정과의 연동.

## 열린 질문
- 심사 후 이 경로를 끄는 시점(`ACTTUB_PG_REVIEW_ENABLED=false`)과 본 구독 기능으로 교체하는 방식.
