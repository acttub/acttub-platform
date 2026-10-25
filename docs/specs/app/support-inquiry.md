# app.support-inquiry 웹 문의하기

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 0.1.3
- 화면: 웹 문의하기 폼(로그인 없이 연다)
- 테이블: support_inquiries

## 기능
웹의 문의하기 폼이 보낸 분류·이메일·본문을 로그인 없이 서버에 접수한다. 운영자는 운영 경로로 접수된 문의를 새것부터 읽는다.

## 의도
계정이 잠겼거나 로그인이 안 되는 사람도 문의를 남길 수 있어야 한다. 폼을 서버가 받기 전에는 문의가 메일 클라이언트로 흩어져 누락과 추적 불가가 생겼다.

## 목적
배우는 로그인 없이 문의를 보내고 접수 확인(id·시각)을 받는다. 운영자는 한곳에서 문의를 읽고 상태로 거른다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `POST /v2/support/inquiries` | 헤더 `X-Acttub-Client`(필수), 선택 `Authorization: Bearer`. 본문 `SupportInquiryRequest`: `category`(`account`·`billing`·`refund`·`usage`·`bug`·`report`·`other`), `email`, `body` | `SupportInquiryResponse` 201: `{id, created_at}` | 칸 규칙 위반·모르는 칸 422(배열), 한 IP 10분 5건 초과 429 `rate limit exceeded` |
| `GET /v2/admin/support/inquiries` | 헤더 `Authorization: Bearer $ADMIN_OPS_TOKEN`, 질의 `status`(`open`·`closed`, 선택), `limit`(1~200, 기본 50) | `{inquiries: [{id, category, email, body, user_id, client, status, created_at}]}` 200, 새것부터 | 토큰 없음·틀림 401 `Unauthorized`, 질의 값 위반 422(배열) |

## 상태
| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| open | 접수(기본) | app.support-inquiry |
| closed | 운영자가 DB 에서 닫음(이 기능에는 닫는 API 가 없다) | 운영 |

## 규칙·제약
- 로그인 없이 받는다. `Authorization` 이 없거나 만료·잘못된 토큰이어도 막지 않고 비로그인 문의로 접수한다. 유효한 액세스 토큰이 붙어 있을 때만 `user_id` 를 남긴다(FK 없음 — 탈퇴를 막지 않는다).
- `X-Acttub-Client` 는 다른 `/v2` 경로와 같이 필수다(없으면 426). 값은 `client` 칸에 남는다(100자까지).
- `email`: 앞뒤 공백을 걷은 뒤 254자 이하, `local@도메인.최상위` 모양. 닿는지는 확인하지 않는다.
- `body`: 앞뒤 공백을 걷은 뒤 10~3000 유니코드 코드 포인트.
- 한 IP(`ClientAddress`)에서 10분에 5건까지. 한도는 프로세스 안에서 센다.
- 이메일·본문은 개인정보라 로그에 남기지 않는다. 메일·알림은 보내지 않는다.

## 예외
- 검증 실패: 422 배열(`detail[].loc` 는 `body`·칸 이름). 아무것도 저장하지 않는다.
- 한도 초과: 429 `rate limit exceeded`. 저장하지 않는다.

## 검증 방법
- 토큰 없이 접수: 201, `user_id` NULL, `status` open, `client` 가 헤더 값(`SupportInquiryIT`).
- 유효한 토큰: `user_id` 가 남는다. 깨진 토큰: 401 없이 비로그인으로 접수된다.
- 분류 밖·이메일 형식·본문 길이(9자·3001자)·모르는 칸: 422 배열, 행 없음. 공백만 채운 10자는 거절, 이모지는 코드 포인트로 센다(`SupportInquiryServiceTest`).
- 같은 IP 6번째는 429, 다른 IP 는 영향 없음.
- 운영 조회: 토큰 없음 401, 새것부터, `status`·`limit` 필터, 범위 밖 422(`SupportInquiryIT`, 경로 목록은 `AdminEndpointIT`).

## 범위 밖
- 확인 메일·답장 발송, 첨부, 문의 닫기·답변 API, 스팸 판정(캡차), 앱 안 문의 화면.
- 여러 서버에 걸친 한도 공유.

## 열린 질문
- 문의 보관 기간과 파기 시점(개인정보 처리방침과 맞춰 정한다).
