# app.support-inquiry 웹 문의하기

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 0.1.3
- 화면: 웹 문의하기 폼(로그인 없이 연다), 웹 내 계정의 「내 문의」
- 테이블: support_inquiries

## 기능
웹의 문의하기 폼이 보낸 분류·이메일·본문을 로그인 없이 서버에 접수한다. 운영자는 운영 경로로 접수된 문의를 새것부터 읽고, 답한
문의를 닫는다. 닫은 문의는 웹 「내 문의」에 「종료」로 보인다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `POST /v2/support/inquiries` | 헤더 `X-Acttub-Client`(필수), 선택 `Authorization: Bearer`. 본문 `SupportInquiryRequest`: `category`(`account`·`billing`·`refund`·`usage`·`bug`·`report`·`other`·`feedback`), `email`, `body` | `SupportInquiryResponse` 201: `{id, created_at}` | 칸 규칙 위반·모르는 칸 422(배열), 한 IP 10분 5건 초과 429 `rate limit exceeded` |
| `GET /v2/support/inquiries/mine` | 헤더 `Authorization`(게이트 통과) | `MySupportInquiryList` 200: 내 문의 새것부터 20건. 건마다 `id`·`category`·`summary`(본문 앞 40자)·`status`(`open`·`closed`)·`created_at` | — |
| `GET /v2/admin/support/inquiries` | 헤더 `Authorization: Bearer $ADMIN_OPS_TOKEN`, 질의 `status`(`open`·`closed`, 선택), `limit`(1~200, 기본 50) | `{inquiries: [{id, category, email, body, user_id, client, status, created_at}]}` 200, 새것부터 | 토큰 없음·틀림 401 `Unauthorized`, 질의 값 위반 422(배열) |
| `PATCH /v2/admin/support/inquiries/{id}` | 헤더 `Authorization: Bearer $ADMIN_OPS_TOKEN`, 본문 `{status}`(`open`·`closed`) | 바뀐 문의 한 건(조회의 `inquiries[]` 한 칸과 같은 모양) 200. 같은 값이면 그대로 200 | 토큰 없음·틀림 401 `Unauthorized`, 없는 문의 404 `support_inquiry_not_found`, 값 밖·모르는 칸 422(배열) |

## 상태
| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| open | 접수(기본) | app.support-inquiry |
| closed | 운영자가 답한 뒤 운영 경로로 닫음. 잘못 닫았으면 같은 경로로 open 으로 되돌린다 | app.support-inquiry(운영) |

## 규칙·제약
- 로그인 없이 받는다. `Authorization` 이 없거나 만료·잘못된 토큰이어도 막지 않고 비로그인 문의로 접수한다. 유효한 액세스 토큰이 붙어 있을 때만 `user_id` 를 남긴다(FK 없음 — 탈퇴를 막지 않는다).
- `X-Acttub-Client` 는 다른 `/v2` 경로와 같이 필수다(없으면 426). 값은 `client` 칸에 남는다(100자까지).
- `email`: 앞뒤 공백을 걷은 뒤 254자 이하, `local@도메인.최상위` 모양. 닿는지는 확인하지 않는다.
- `body`: 앞뒤 공백을 걷은 뒤 10~3000 유니코드 코드 포인트.
- 한 IP(`ClientAddress`)에서 10분에 5건까지. 한도는 프로세스 안에서 센다.
- 이메일·본문은 개인정보라 로그에 남기지 않는다. 사용자에게 메일은 보내지 않는다. 팀에는 접수가 저장된 뒤 Slack 「#문의-신고」로
  알린다(`SUPPORT_SLACK_WEBHOOK_URL`, 비어 있으면 보내지 않는다). 알림에는 분류·보낸 곳(회원 여부·클라이언트)·본문 앞 500자·문의 id만 싣고 메일 주소는
  싣지 않는다. 알림이 실패해도 접수는 그대로다.

## 예외
- 검증 실패: 422 배열(`detail[].loc` 는 `body`·칸 이름). 아무것도 저장하지 않는다.
- 한도 초과: 429 `rate limit exceeded`. 저장하지 않는다.

## 검증 방법
- 토큰 없이 접수: 201, `user_id` NULL, `status` open, `client` 가 헤더 값(`SupportInquiryIT`).
- 유효한 토큰: `user_id` 가 남는다. 깨진 토큰: 401 없이 비로그인으로 접수된다.
- 분류 밖·이메일 형식·본문 길이(9자·3001자)·모르는 칸: 422 배열, 행 없음. 공백만 채운 10자는 거절, 이모지는 코드 포인트로 센다(`SupportInquiryServiceTest`).
- 같은 IP 6번째는 429, 다른 IP 는 영향 없음.
- 운영 조회: 토큰 없음 401, 새것부터, `status`·`limit` 필터, 범위 밖 422(`SupportInquiryIT`, 경로 목록은 `AdminEndpointIT`).
- 운영 닫기: closed 로 바꾸면 200 과 바뀐 행, 같은 값 재전송도 200, open 으로 되돌림, 없는 문의 404 `support_inquiry_not_found`,
  `answered` 같은 값 밖·빈 본문 422, 토큰 없음 401. 닫은 문의는 「내 문의」에 `closed` 로 나온다(`SupportInquiryIT`).

## 범위 밖
- 확인 메일·답장 발송, 첨부, 답변 저장·답변 API, 닫은 시각·닫은 사람 기록, 스팸 판정(캡차), 앱 안 문의 화면.
- 여러 서버에 걸친 한도 공유.

## 열린 질문
- 문의 보관 기간과 파기 시점(개인정보 처리방침과 맞춰 정한다).
