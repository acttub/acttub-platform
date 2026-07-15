# PR #1 리뷰 결정 기록

## 목적

이 문서는 PR #1 (`feat: integrate acting API practice flow`)을 항목별로 검토하면서 결정한 반영 사항을 보존한다. 대화 컨텍스트가 없어도 이후 구현자가 문제를 재현하고 수정할 수 있을 정도로 시나리오, 원인, 수정 범위, 검증 기준을 기록한다.

- 기준 브랜치: `feature/acting-api-docs-20260713`
- 기준 커밋: `a6e01e9`
- 마지막 갱신: 2026-07-16
- 현재 단계: 리뷰 결정 완료, 구현 대기
- 구현 상태: 아래 항목은 아직 코드에 반영하지 않음

## 진행 원칙

1. 리뷰 항목을 하나씩 설명하고 `반영 예정`, `보류`, `반영하지 않음` 중 하나로 결정한다.
2. 리뷰가 끝나기 전에는 제품 코드를 수정하지 않는다.
3. 실제 구현 단계에서는 이 문서의 수정 범위와 검증 기준을 기준으로 작업한다.
4. 이미 배포되었을 수 있는 Supabase migration은 직접 고치지 않고 후속 migration으로 보정한다.

## 결정 요약

| 번호 | 심각도 | 항목 | 결정 | 구현 |
| --- | --- | --- | --- | --- |
| 1 | High | 약관 재동의 또는 profile 직접 INSERT/UPDATE로 정지 상태와 필수 동의 gate를 우회할 수 있음 | 반영 예정 | 미적용 |
| 2 | High | `retry_reply`가 새 요청과 기존 actor turn을 연결하지 않아 완료 상태가 깨짐 | 반영 예정 | 미적용 |
| 3 | High | 동기 영상 분석의 270초 timeout이 정상적인 upstream 처리 시간보다 짧아 세션이 복구 불가능해짐 | 반영 예정 | 미적용 |
| 4 | High | 브라우저가 제출한 `durationMs`만 신뢰해 실제 3분 초과 영상을 분석할 수 있음 | 반영 예정 | 미적용 |
| 5 | High | 중단된 upload intent와 영상 객체를 자동 정리하지 않아 Storage와 DB에 무기한 누적됨 | 반영 예정 | 미적용 |
| 6 | High | commit 후 응답 유실 시 새 `requestId`로 일반 reply 또는 begin을 다시 실행해 중복 side effect가 발생함 | 반영 예정 | 미적용 |
| 7 | Medium | `src/app` 구조에서 Proxy entry가 프로젝트 root에 있어 Next.js가 인증 Proxy를 등록하지 않음 | 반영 예정 | 미적용 |
| 8 | High | `/coach/start`/`restart`의 404까지 기존 acting-api 세션 만료로 오분류해 재시작 루프를 만듦 | 반영 예정 | 미적용 |
| 9 | High | upload intent의 약관 버전은 env에서 저장하지만 Storage RLS는 DB 기준값과 비교해 버전 전환 시 모든 업로드가 막힘 | 반영 예정 | 미적용 |
| 10 | Medium | `2xx` 응답의 JSON parsing 실패를 `null`로 삼켜 성공값으로 반환하고 호출부에 raw TypeError를 발생시킴 | 반영 예정 | 미적용 |
| 11 | Medium | legacy Gemini의 정상 단일 질문에 줄바꿈이 포함되면 정규화 후에도 원본 `\n` 검사로 요청을 실패시킴 | 반영 예정 | 미적용 |
| 12 | Low | 미사용 `practice.ts` client가 현재 canonical endpoint에 legacy DTO를 전송해 재사용 시 즉시 400을 발생시킴 | 반영 예정 | 미적용 |
| 13 | High | acting-api 호출 전 signed URL·Storage 실패도 결과 불명으로 기록해 안전한 분석 재시도를 영구 차단함 | 반영 예정 | 미적용 |
| 14 | High | FastAPI의 확정적인 422 validation 응답을 결과 불명으로 기록해 operation과 세션을 봉인함 | 반영 예정 | 미적용 |
| 15 | High | QuickTime 영상을 `.mp4` filename으로 relay해 upstream의 확장자 기반 MIME 판정을 깨뜨림 | 반영 예정 | 미적용 |
| 16 | High | scene context와 actor reply에 크기 상한이 없어 DB·upstream 비용과 요청 자원을 무제한 소비할 수 있음 | 반영 예정 | 미적용 |
| 17 | Medium | 세션 목록이 pagination 없이 전체 세션과 중첩 상세 데이터를 모두 hydrate함 | 반영 예정 | 미적용 |
| 18 | Medium | Spring Boot 이전 문서가 legacy Gemini 계약을 canonical API로 안내함 | 반영 예정 | 미적용 |

---

## 1. profile mutation을 통한 정지·약관 gate 우회 차단

### 결정

**반영 예정 (High)**

관리자가 설정한 `suspended` 상태는 사용자의 약관 재동의나 브라우저의 직접 DB 요청으로 해제될 수 없어야 한다. Profile 생성과 약관 상태 전이는 server-owned 경로에서만 수행하고, 브라우저는 최초 row를 `active` 상태로 직접 만들 수도 없어야 한다.

### 문제 시나리오

1. 운영자가 어떤 사용자의 `profiles.status`를 `suspended`로 변경한다.
2. 해당 사용자의 Supabase 로그인 세션은 아직 유효하다.
3. 사용자가 `POST /api/v1/terms/acceptances`를 호출한다.
4. 현재 `recordTermsAcceptance()`는 profile을 `upsert`하면서 `status: "active"`를 무조건 기록한다.
5. 서버가 admin client를 우선 사용하므로 RLS도 우회한다.
6. 결과적으로 사용자가 약관에 다시 동의하는 것만으로 운영자의 정지 조치를 해제하고 서비스 접근 권한을 되찾는다.

별도 공격 경로도 있다. 현재 authenticated 사용자의 profile UPDATE 정책은 소유자 ID만 검사하므로, 브라우저에서 자신의 profile에 대해 `status = 'active'`를 포함한 임의 컬럼을 직접 수정할 수 있다.

### 추가 공격 경로: profile 최초 INSERT로 약관 gate 우회

1. Supabase Auth 계정은 있지만 `profiles` row가 없는 사용자가 로그인한다. 직접 Auth API를 사용하거나 과거 데이터/생성 실패가 있으면 이 상태가 생길 수 있다.
2. 현재 INSERT 정책은 `id = auth.uid()`만 검사하므로 authenticated 브라우저가 자신의 profile row를 직접 만들 수 있다.
3. 공격자는 `status = 'active'`와 현재 필수 동의·AI 처리 동의 version/timestamp를 함께 넣는다.
4. migration 012의 active profile constraint는 필수 값이 채워졌는지만 확인하므로 이 INSERT를 거부하지 않는다.
5. `is_active_acttub_profile()`도 현재 버전과 timestamp가 일치하면 활성 사용자로 판단한다.
6. 요구 버전은 인증 응답과 클라이언트 코드에 노출되는 계약값이므로 비밀값으로 이 우회를 막을 수 없다.
7. 결과적으로 사용자는 약관 동의 API를 거치지 않고도 서비스 접근 gate를 통과한다.

### 근거

- `apps/web/src/server/services/auth-context.ts`
  - `getProfileClient()`가 admin client를 우선 선택한다.
  - `recordTermsAcceptance()`가 `status: "active"`를 포함한 profile 전체 `upsert`를 수행한다.
- `apps/web/src/app/api/v1/terms/acceptances/route.ts`
  - 인증 여부만 확인한 뒤 `recordTermsAcceptance()`를 호출하며 정지 상태를 별도로 거부하지 않는다.
- `supabase/migrations/001_acttub_slice1_schema.sql`
  - `profiles owner insert self` 정책의 `with check`가 `id = auth.uid()`만 검사해 브라우저가 `active` profile을 직접 생성할 수 있다.
  - `profiles owner update terms` 정책의 `using`과 `with check`가 모두 `id = auth.uid()`만 검사한다.
- `supabase/migrations/012_canonical_consent_contract.sql`
  - active profile constraint와 `is_active_acttub_profile()`는 status와 현재 동의 version/timestamp를 검사하지만, 그 값을 신뢰할 수 있는 서버 경로에서만 썼는지는 구분하지 않는다.

### 수정 방향

1. 후속 Supabase migration을 추가한다.
2. authenticated 역할의 `profiles` INSERT 권한/정책과 광범위한 UPDATE 권한/정책을 제거한다. 브라우저가 profile을 직접 생성하거나 `status` 및 관리 대상 컬럼을 바꾸지 못하게 한다.
3. profile 최초 생성은 server-owned 경로에서만 수행하고 항상 `pending_terms`로 만든다. 클라이언트 입력으로 status, 필수 동의 version/timestamp를 선택할 수 없게 한다.
4. 약관 동의 갱신만 수행하는 제한된 server-owned RPC를 추가한다.
   - 대상 profile row를 잠근 상태에서 처리한다.
   - `pending_terms -> active` 전이는 허용한다.
   - 이미 `active`인 사용자의 최신 약관 재동의는 허용한다.
   - `suspended`인 경우 아무 필드도 변경하지 않고 실패시킨다.
   - 수정 가능한 필드는 필수 동의 버전/시각, AI 처리 동의 버전/시각, 선택 동의 값/시각 등 약관 관련 필드로 한정한다.
5. `recordTermsAcceptance()`의 광범위한 profile `upsert`를 위 RPC 호출로 교체한다.
6. 약관 API는 정지된 사용자에게 `403`을 반환하고 성공 쿠키를 설정하지 않는다. 구현 시 안정적인 오류 코드(예: `account_suspended`)를 계약에 추가한다.
7. 배포 시 server-owned profile 생성 경로를 먼저 적용·검증한 뒤 브라우저 INSERT/UPDATE 정책을 제거해 정상 OAuth 가입 흐름이 끊기지 않게 한다.
8. 향후 Spring Boot 이전에서도 profile 생성은 `pending_terms`로 시작하고, `suspended` 상태는 약관 동의 흐름보다 우선한다는 규칙을 보존한다.

### 검증 기준

- `suspended` 사용자가 약관 동의 API를 호출해도 `profiles.status`는 `suspended`로 유지된다.
- 위 요청은 `403`이며 성공 응답과 약관 성공 쿠키를 반환하지 않는다.
- profile row가 없는 authenticated 브라우저 client가 `active` profile을 직접 INSERT하려 하면 DB에서 거부된다.
- authenticated 브라우저 client가 profile의 `status`를 직접 `active`로 바꾸려 하면 DB에서 거부된다.
- 정상 OAuth callback의 server-owned 경로는 profile이 없으면 `pending_terms` row를 생성한다.
- `pending_terms` 사용자는 정상 동의 후 `active`가 된다.
- `active` 사용자는 새 약관 버전이 생겼을 때 정상적으로 다시 동의할 수 있다.
- 정지 거부가 발생하면 약관 관련 timestamp와 version도 부분 갱신되지 않는다.

### 필요한 보안 회귀 테스트

- authenticated client의 직접 `active` profile INSERT 거부
- authenticated client의 직접 status UPDATE 거부
- 정상 OAuth callback의 `pending_terms` profile 생성
- server-owned 약관 RPC의 `pending_terms -> active`, active 재동의, suspended 거부 전이
- 정책 교체 후 로그인, 신규 가입, 약관 동의, 기존 활성 사용자 세션의 smoke test

---

## 2. `retry_reply`의 새 request ID와 기존 actor turn 재연결

### 결정

**반영 예정 (High)**

재시도마다 새 `requestId`를 만드는 클라이언트 동작은 올바르다. 문제는 DB가 재사용하는 기존 actor turn의 `request_id`를 새 delivery attempt의 요청 ID로 바꾸지 않는 것이다.

### 문제 시나리오

1. 사용자가 답변을 보내고 최초 요청 ID `A`가 생성된다.
2. actor turn은 `request_id = A`, `delivery_status = 'pending'`으로 저장된다.
3. 외부 acting-api 호출이 재시도 가능한 오류로 실패한다.
4. 해당 actor turn은 `request_id = A`, `delivery_status = 'failed'`, `delivery_retryable = true`가 된다.
5. 사용자가 재시도하면 UI는 새 요청 ID `B`와 기존 `actorTurnId`를 전송한다.
6. `acttub_claim_coach_reply()`는 기존 actor turn을 `pending`으로 돌리지만 `request_id`는 여전히 `A`로 남긴다.
7. 새 upstream operation은 `request_id = B`로 생성된다.
8. 완료 함수는 `request_id = B`인 pending actor turn만 완료하려 하지만 일치하는 row가 없다.
9. actor turn은 `pending`에 남는데 AI turn과 operation은 `completed`가 될 수 있다.
10. completed turn만 사용하는 리포트/조회에서는 사용자의 답변이 빠져 대화 이력이 불완전해진다.

### 근거

- `apps/web/src/features/practice/practice-flow.tsx`
  - `retryReply()`가 `crypto.randomUUID()`로 재시도용 새 `requestId`를 생성한다. 이 동작은 유지한다.
- `supabase/migrations/011_acting_api_pipeline.sql`
  - `acttub_claim_coach_reply()`의 retry 분기는 delivery 상태와 오류만 초기화하고 `request_id`를 갱신하지 않는다.
  - 같은 함수가 새 upstream operation에는 새 `p_request_id`를 저장한다.
  - `acttub_complete_coach_turn()`은 operation의 request ID와 같은 pending actor turn을 완료하지만, 실제 갱신 건수가 0이어도 AI turn 삽입과 operation 완료를 계속한다.

### 수정 방향

1. 기존 `011_acting_api_pipeline.sql`을 직접 수정하지 않고 다음 순번의 후속 migration을 추가한다.
2. `acttub_claim_coach_reply()`를 `create or replace`한다.
   - retry 가능한 failed actor turn을 다시 `pending`으로 바꿀 때 `request_id = p_request_id`도 함께 갱신한다.
   - 기존 actor turn ID와 text는 그대로 재사용한다.
3. `acttub_complete_coach_turn()`을 `create or replace`해 완료 불변식을 강화한다.
   - operation의 `kind`와 `request_id`를 잠금 조회한다.
   - `coach_reply` 또는 `coach_retry_reply`이면 해당 request ID의 pending actor turn을 완료한다.
   - `GET DIAGNOSTICS ... ROW_COUNT`로 갱신 건수가 정확히 1인지 검사한다.
   - 1건이 아니면 예외를 발생시켜 AI turn 삽입과 operation 완료가 함께 롤백되도록 한다.
   - actor turn이 없는 `coach_start`와 `coach_restart`에는 이 검사를 적용하지 않는다.
4. 교체한 함수의 실행 권한을 다시 제한하고 `service_role`에만 필요한 권한을 부여한다.

### 검증 기준

- 최초 요청 `A`가 실패한 뒤 새 요청 `B`로 재시도하면 기존 actor turn의 `request_id`가 `B`로 바뀐다.
- 성공 완료 후 actor turn과 AI turn이 모두 `completed`다.
- 재시도 operation도 `completed`가 된다.
- 저장/조회/리포트 대화 이력에 해당 actor 답변이 포함된다.
- reply/retry operation에 대응하는 pending actor turn이 0건 또는 2건 이상이면 완료 함수가 실패한다.
- 위 불변식 위반 시 AI turn과 완료된 operation이 남지 않는다.
- 같은 요청 ID의 idempotent replay 동작은 유지된다.

### 필요한 회귀 테스트

1. migration lineage 테스트에 새 후속 migration을 포함한다.
2. retry claim이 actor turn의 `request_id`를 새 값으로 바꾸는 계약 테스트를 추가한다.
3. 실제 PostgreSQL에 migration을 순서대로 적용한 뒤 `실패(A) -> 재시도(B) -> 완료(B)` 시나리오를 검증한다.
4. actor turn 매칭 실패 시 트랜잭션이 fail-closed 되는지 검증한다.

---

## 3. 영상 분석을 동기 요청에서 durable background job으로 분리

### 결정

**반영 예정 (High)**

영상 분석을 사용자 HTTP 요청이 끝날 때까지 기다리는 동기 처리에서 분리한다. 세션 생성 API는 분석 작업을 안전하게 등록한 뒤 `ANALYZING` 상태를 즉시 반환하고, 별도의 durable Worker가 실제 acting-api 호출과 결과 저장을 담당한다.

여기서 Worker는 Next.js 요청 내부의 별도 thread나 응답 후 실행하는 Promise가 아니다. DB 또는 durable queue에 저장된 작업을 가져와 처리하는 독립 실행 프로세스다. 프로세스가 재시작되어도 저장된 작업을 다시 확인하고 이어서 처리할 수 있어야 한다.

### 문제 시나리오

1. 사용자가 제품 계약상 허용되는 정상 영상을 업로드하고 세션 생성을 요청한다.
2. 현재 Next.js Route는 DB operation을 만든 뒤 같은 HTTP 요청 안에서 acting-api `/summarize` 응답을 기다린다.
3. acting-api는 15MB 초과 영상의 ffmpeg 압축과 Gemini 파일 ACTIVE 대기에 각각 최대 300초를 사용할 수 있으며 전체 처리에 수 분이 걸릴 수 있다.
4. 플랫폼의 acting-api client는 분석 요청을 270초에 강제 중단한다. Route에도 300초 `maxDuration`이 선언되어 있다.
5. 따라서 acting-api가 271초에 정상 응답해도 플랫폼은 결과를 받지 못한다.
6. 플랫폼은 timeout을 ambiguous failure로 분류하고 분석을 `outcome_unknown`으로 저장한다.
7. 분석 단계의 ambiguous failure는 `retryAllowed: false`, `action: "create_new_session"`이므로 사용자는 같은 작업을 복구하지 못하고 새 연습부터 시작해야 한다.
8. acting-api는 플랫폼 연결이 끊긴 뒤에도 작업을 완료할 수 있어 계산 비용은 사용했지만 결과는 플랫폼에 반영되지 않을 수 있다.

### 근거

- `apps/web/src/server/acting-api/config.ts`
  - `SUMMARY_TIMEOUT_MS`가 `270_000`으로 설정되어 있다.
- `apps/web/src/server/acting-api/client.ts`
  - `/summarize` 요청에 `AbortSignal.timeout(SUMMARY_TIMEOUT_MS)`를 직접 적용한다.
- `apps/web/src/app/api/v1/practice-sessions/route.ts`
  - 세션 생성 Route가 분석 완료까지 기다리며 `maxDuration = 300`이다.
- `apps/web/src/server/services/acting-coach-service.ts`
  - 분석 claim의 DB lease는 780초지만 실제 upstream 요청은 270초에 중단된다.
  - timeout은 `acting_api_timeout`인 ambiguous failure로 저장된다.
  - 분석 ambiguous failure의 복구 지침은 재시도 금지와 새 세션 생성이다.
- `docs/API.md`
  - ffmpeg 압축과 Gemini 파일 ACTIVE 대기는 각각 최대 300초이며 대용량 영상은 전체 처리에 수 분이 걸릴 수 있다고 명시한다.
- `apps/web/src/features/practice/practice-flow.tsx`
  - `outcome_unknown`이면 같은 세션을 재시도하지 못하고 새 연습을 시작하라는 메시지를 표시한다.

### 목표 처리 흐름

```text
브라우저
  -> POST /api/v1/practice-sessions
Next.js Route
  -> 세션과 분석 job을 원자적으로 저장
  <- 202 + status=ANALYZING 즉시 반환
Durable Worker
  -> 저장된 job을 원자적으로 claim
  -> acting-api /summarize 호출
  -> 성공 또는 실패 결과를 DB에 저장
브라우저
  -> GET session 상태 polling
  <- 완료 시 INTERVIEW, 실패 시 안정적인 실패 상태
```

### 수정 방향

1. 분석 작업을 나타내는 durable queue 상태를 DB에 둔다.
   - 기존 `practice_upstream_operations`를 확장하거나 별도 analysis job table을 추가하는 선택은 구현 계획에서 확정한다.
   - 최소 상태는 `queued`, `in_flight`, `completed`, `failed`이며 claim lease와 attempt 정보를 보존한다.
2. 세션 생성 트랜잭션은 세션/take와 분석 job을 함께 저장하고, 외부 acting-api를 호출하지 않은 채 `ANALYZING` DTO를 반환한다.
3. `POST /api/v1/practice-sessions`는 job 저장 성공 후 빠르게 `202 Accepted`를 반환하도록 REST/OpenAPI 계약을 갱신한다.
4. 독립 Worker 실행 단위를 추가한다.
   - Worker는 DB job을 원자적으로 claim한 뒤 acting-api를 호출한다.
   - Worker crash나 lease 만료 후 다른 Worker가 작업을 복구할 수 있어야 한다.
   - 같은 request ID 또는 operation을 중복 처리해도 결과가 중복 저장되지 않아야 한다.
5. UI는 `ANALYZING` 세션을 받은 뒤 `GET /api/v1/practice-sessions/{id}`를 polling한다.
   - 새로고침하거나 브라우저를 닫았다 열어도 DB 상태를 기준으로 분석 진행/완료를 확인한다.
6. Worker는 Next.js Route 안에서 `void promise`, `setTimeout`, in-memory queue로 흉내 내지 않는다. 응답 후 프로세스가 종료되어도 작업이 유실되지 않는 별도 배포 단위여야 한다.
7. 향후 Spring Boot 이전 문서에도 API 요청 처리와 background analysis job 실행의 경계를 기록한다.

### 범위 주의사항

- 현재 저장소에는 Worker 실행 단위와 배포 구성이 없다. 따라서 이 항목은 timeout 상수 한 줄 수정이 아니라 job lifecycle, 실행 프로세스, polling을 추가하는 구조 변경이다.
- `270초 -> 290초`처럼 timeout만 조금 늘리면 upstream 정상 처리 시간이 여전히 더 길 수 있고 300초 Route 한계도 남으므로 해결로 보지 않는다.
- Worker 없이 동기 구조를 유지하려면 지원 영상 크기와 처리 계약 자체를 플랫폼 timeout 안에 항상 끝나는 수준으로 낮춰야 한다. 현재 550MB 및 수 분 처리 계약을 유지한다면 durable job 방식이 필요하다.
- Worker의 구체적인 배포 위치와 queue 기술 선택은 구현 전 별도 설계로 확정하되, 사용자 요청과 분리되고 재시작 후 복구 가능해야 한다는 요구사항은 변경하지 않는다.

### 검증 기준

- 세션 생성 API는 acting-api 분석 완료를 기다리지 않고 job 저장 후 빠르게 `202 + ANALYZING`을 반환한다.
- acting-api가 270초를 넘겨 정상 완료해도 최종 session이 `INTERVIEW`로 전환되고 SceneSummary가 한 번만 저장된다.
- 사용자가 브라우저를 새로고침하거나 닫아도 분석 job은 계속 처리된다.
- Worker가 claim 직후 종료되어도 lease 만료 후 작업이 복구된다.
- 동일 request ID 재전송과 동일 job 재처리가 중복 session, SceneSummary 또는 upstream mutation을 만들지 않는다.
- 분석 실패는 DB에 안정적으로 기록되고 UI가 polling을 종료한다.
- Route 종료 또는 클라이언트 연결 해제가 분석 job을 `outcome_unknown`으로 만들지 않는다.

### 필요한 회귀 테스트

1. 지연 fake acting-api를 사용해 270초 경계를 넘는 분석도 Worker 경로에서 완료되는지 검증한다. 실제 테스트 시간은 fake clock 또는 축소된 timeout 비율을 사용한다.
2. Worker claim 후 강제 종료와 lease 만료를 재현해 다른 Worker가 안전하게 복구하는지 검증한다.
3. 동일 job을 두 Worker가 경쟁해도 한 Worker만 claim하는 DB 동시성 테스트를 추가한다.
4. 세션 생성 `202 -> ANALYZING -> INTERVIEW` polling 흐름을 브라우저 테스트로 검증한다.
5. 중복 request ID와 결과 commit 재시도에 대한 idempotency 테스트를 추가한다.

---

## 4. 업로드 영상 길이를 서버가 직접 검증

### 결정

**반영 예정 (High)**

브라우저가 계산해 제출한 `durationMs`는 빠른 UX 검사용 힌트로만 사용한다. 3분 제한 적용과 DB 저장에는 서버가 실제 Storage 객체를 trusted media probe로 읽어 산출한 길이만 사용한다.

3번 항목에서 추가하기로 한 durable Worker가 acting-api 분석을 시작하기 전에 media 검증을 수행하는 방식을 우선한다. 사용자가 제출한 값이 정상 범위라는 이유만으로 upload intent를 분석 가능 상태로 확정해서는 안 된다.

### 문제 시나리오

1. 사용자가 실제 길이 10분인 MP4를 준비한다. 파일 크기는 550MB 이하이고 Storage에 기록할 MIME과 size는 실제 객체에 맞춘다.
2. 정상 UI는 `HTMLVideoElement.duration`으로 길이를 읽어 3분을 초과하면 차단하지만, 이 코드는 브라우저에 있으므로 API 직접 호출로 건너뛸 수 있다.
3. 사용자는 지정된 Supabase Storage 경로에 실제 10분 영상을 업로드한다.
4. finalize API에 실제 길이 대신 `durationMs: 1000`을 전송한다.
5. Next.js API는 제출된 값이 정수 `1..180000`인지 확인한다.
6. Storage 검증은 객체의 path, MIME, size만 확인하고 영상 container의 실제 길이는 읽지 않는다.
7. Supabase RPC도 제출된 숫자의 범위만 확인한 뒤 `upload_intents.duration_ms = 1000`으로 저장한다.
8. 세션 생성은 이 값을 `practice_takes.duration_ms`로 복사하지만, 실제 분석에는 Storage의 10분 영상을 그대로 acting-api에 전달한다.

### 확인된 재현 결과

마이그레이션을 적용한 임시 PostgreSQL에서 위조한 `1000ms` 값을 finalize RPC에 넣고 session create RPC까지 실행했을 때 다음 상태가 확인되었다.

```text
finalize=1000
claim=claimed
take_duration=1000,analysis=pending
```

DB에는 실제 media metadata와 비교할 정보나 검사가 없으므로 클라이언트가 제출한 값이 그대로 정본처럼 저장된다.

### 근거

- `apps/web/src/features/practice/practice-flow.tsx`
  - 브라우저의 `HTMLVideoElement.duration`으로 길이를 계산하고 3분 제한을 검사한다.
  - finalize API에 이 브라우저 산출 `durationMs`를 전송한다.
- `apps/web/src/app/api/v1/practice-upload-intents/[uploadIntentId]/finalize/route.ts`
  - finalize 요청을 Next.js service로 전달한다.
- `apps/web/src/server/services/acting-coach-service.ts`
  - `durationMs`가 정수 `1..180000`인지 검사할 뿐 실제 영상과 비교하지 않는다.
- `apps/web/src/server/services/coach-session-service.ts`
  - Supabase Storage 객체의 path, MIME, size는 확인하지만 media duration은 읽지 않는다.
- `apps/web/src/server/repositories/supabase-coach-session-repository.ts`
  - 검증되지 않은 `durationMs`를 finalize RPC에 그대로 전달한다.
- `supabase/migrations/011_acting_api_pipeline.sql`
  - finalize RPC는 숫자 범위만 검사해 `upload_intents.duration_ms`에 저장한다.
  - 세션 생성 RPC는 그 값을 `practice_takes.duration_ms`로 복사한다.
- `apps/web/src/server/services/acting-coach-service.ts`의 분석 실행 경로
  - 저장된 duration과 관계없이 실제 signed Storage object를 acting-api에 전송한다.

### 수정 방향

1. 클라이언트의 `durationMs`를 권위 있는 값으로 사용하지 않는다.
   - 기존 DTO 호환을 위해 당분간 받을 수는 있지만 UX 힌트 또는 진단용 reported value로만 취급한다.
   - `upload_intents.duration_ms`와 `practice_takes.duration_ms`에는 이 값을 직접 저장하지 않는다.
2. 업로드 완료와 media 검증 완료 상태를 분리한다.
   - 업로드 직후에는 `uploaded` 또는 `validating` 상태로 두고 분석 가능 상태로 확정하지 않는다.
   - Worker의 trusted probe가 성공한 후에만 `finalized`/analysis eligible 상태로 전환한다.
3. Worker가 Storage object를 trusted media probe로 검사한다.
   - `ffprobe` 또는 동등한 신뢰 가능한 parser/decoder로 MP4/MOV container를 실제로 파싱한다.
   - 실제 duration, container 유형, 파싱 가능 여부를 확인한다.
   - 실제 길이가 `180000ms`를 초과하거나 파일이 손상되었으면 acting-api 호출 전에 거부한다.
4. 서버가 산출한 authoritative duration만 DB에 원자적으로 기록한다.
   - 필요하면 사용자가 제출한 값은 별도 `reported_duration_ms`에 저장하되 권한 판단에는 사용하지 않는다.
   - authoritative duration commit과 분석 가능 상태 전환은 같은 트랜잭션에서 처리한다.
5. acting-api에서 probe를 담당하는 대안을 선택한다면 expensive analysis 전에 길이를 검증하고 측정값을 플랫폼에 반환해야 한다. 플랫폼 DB는 해당 검증 결과를 받은 뒤에만 분석 가능 상태를 확정한다.
6. 3분 초과 거부에는 안정적인 API 오류 코드(예: `video_too_long`)를 사용하고 OpenAPI 및 Spring Boot 이전 계약에도 authoritative media validation을 명시한다.

### 범위 주의사항

- 현재 Next.js finalize Route에서 최대 550MB 객체를 직접 내려받아 검사하면 Route 실행시간과 메모리 문제가 생길 수 있다. 3번 항목의 Worker에서 비동기로 검증하는 편이 안전하다.
- Storage metadata의 `content-type`은 사용자가 업로드할 때 지정할 수 있으므로 실제 container 파싱을 대신하지 못한다.
- 서버가 실제 길이를 확인하기 전에는 acting-api에 영상을 전달하지 않아야 한다. 외부 API에서 뒤늦게 거부하면 업로드 전송과 처리 비용이 이미 발생한다.
- 이 변경으로 finalize 응답 의미 또는 상태가 바뀌면 기존 REST path는 유지하면서 DTO와 OpenAPI의 상태 전이를 명시적으로 갱신한다.

### 검증 기준

- 실제 10분 영상에 `durationMs: 1000`을 제출해도 finalize 또는 media validation이 실패한다.
- 실제 `179999ms` 영상에 다른 값을 제출해도 DB에는 서버가 측정한 authoritative duration만 저장된다. 정책에 따라 mismatch 자체를 명시적으로 거부해도 된다.
- 정확히 `180000ms`인 영상은 허용되고 `180001ms` 영상은 거부된다.
- MP4/MOV MIME을 붙인 손상 파일이나 다른 형식의 파일은 media probe에서 거부된다.
- 검증 실패 영상은 acting-api `/summarize`에 전달되지 않는다.
- `practice_takes.duration_ms`는 클라이언트 요청값이 아니라 서버 probe 결과와 일치한다.
- 브라우저의 사전 3분 검사는 빠른 사용자 피드백을 위해 그대로 유지된다.

### 필요한 회귀 테스트

1. 3분 초과의 작은 MP4 fixture와 위조된 짧은 `durationMs`를 사용한 finalize 통합 테스트를 추가한다.
2. `180000ms` 허용과 `180001ms` 거부 경계 테스트를 추가한다.
3. 손상된 container 및 MIME 위장 fixture가 거부되는지 검증한다.
4. Worker media validation 성공 후 DB의 authoritative duration과 상태 전이가 함께 저장되는지 검증한다.
5. 검증 실패 시 acting-api client가 호출되지 않는지 검증한다.

---

## 5. 중단된 업로드의 자동 정리와 사용자별 quota 추가

### 결정

**반영 예정 (High)**

upload intent의 2시간 TTL을 단순 업로드 권한 만료로만 두지 않고, 만료되거나 소비되지 않은 intent와 Storage object를 실제로 정리하는 background cleanup lifecycle을 추가한다. 인증 사용자 한 명이 intent와 예약/실사용 byte를 무제한 누적하지 못하도록 DB 원자 경계에서 사용자별 quota도 적용한다.

cleanup은 3번 항목의 durable Worker가 실행하는 주기 작업으로 구성한다. 브라우저의 `finally`, 탭 종료 이벤트 또는 사용자의 재요청에 의존하지 않는다.

### 문제 시나리오

1. 사용자가 `POST /api/v1/practice-upload-intents`를 호출한다.
2. 서버는 새로운 intent ID, session ID, 고유 Storage path와 2시간 `expiresAt`을 발급한다.
3. 사용자가 지정 경로에 큰 영상을 직접 업로드한다.
4. finalize 또는 session 생성 전에 브라우저를 닫거나 네트워크가 끊긴다.
5. 2시간 TTL이 지나도 자동으로 intent 상태를 바꾸거나 Storage object를 삭제하는 작업은 실행되지 않는다.
6. 사용자가 나중에 만료된 intent로 finalize를 다시 호출한 경우에만 DB status가 `expired`로 바뀐다. 이 경로도 Storage object는 삭제하지 않는다.
7. 브라우저에는 Storage DELETE 정책이 없고 앱 서버에도 Storage `.remove()` 호출이 없으므로 object는 계속 남는다.
8. 사용자는 새 intent를 반복 발급받을 수 있다. 기존 active intent 개수나 사용자 누적 byte를 검사하지 않으므로 Storage/DB 사용량을 계속 늘릴 수 있다.

finalize까지 끝내고 session 생성 전에 중단한 경우도 문제다. intent는 `finalized`이지만 어떤 session에도 소비되지 않은 채 TTL이 지나며, 이후 session 생성은 불가능해져 확정 orphan이 된다.

### TTL의 현재 의미

현재 `expiresAt`은 Storage에 **새 객체를 INSERT할 수 있는 권한의 만료 시각**일 뿐이다. 이미 업로드된 객체의 보존기간이나 자동 삭제 시각이 아니다.

상태별 현재 결과는 다음과 같다.

| 중단 지점 | TTL 경과 후 현재 결과 |
| --- | --- |
| intent만 생성하고 업로드하지 않음 | `created` intent row가 자동 전환되지 않고 누적됨 |
| 업로드 후 finalize하지 않음 | `created` row와 private object가 무기한 잔존함 |
| finalize 후 session을 생성하지 않음 | `finalized` row와 object가 무기한 잔존하고 이후 소비도 불가능함 |
| TTL 경과 후 finalize를 다시 호출함 | row만 `expired`가 되고 object는 그대로 남음 |

### 확인된 재현 결과

동일 사용자에 대해 최대 크기 intent 100개를 생성하는 것과 같은 DB insert를 수행했을 때 모두 허용되었다.

```text
intents=100,declared_gib=53.71
```

객체 metadata가 연결된 intent를 TTL 경과 상태로 둔 뒤 현재 코드와 같은 status update를 수행해도 Storage object row는 남았다.

```text
after_ttl_status=created,object_rows=1
after_expire_update=expired,object_rows=1
```

Supabase Storage의 실제 byte 삭제에는 service-role Storage API의 `.remove()`가 필요하지만 현재 앱에는 해당 호출이 없다.

### 근거

- `apps/web/src/app/api/v1/practice-upload-intents/route.ts`
  - 로그인과 약관 확인 후 upload intent를 생성한다.
- `apps/web/src/server/services/coach-session-service.ts`
  - 개별 파일의 MIME/size만 검사하고 매 요청마다 새 intent/path와 2시간 TTL을 발급한다.
  - 사용자별 active intent 개수나 누적 byte를 조회하지 않는다.
  - 만료는 finalize 요청이 다시 들어온 시점에만 감지한다.
- `apps/web/src/server/repositories/supabase-coach-session-repository.ts`
  - intent 생성은 단순 row insert다.
  - `expireUploadIntent()`는 DB status만 `expired`로 갱신한다.
- `supabase/migrations/001_acttub_slice1_schema.sql`
  - user별 intent 개수/합계 quota가 없다.
  - Storage INSERT 정책은 unexpired `created` intent만 검사한다.
  - 브라우저 Storage DELETE 정책이 없으며 cleanup은 service role 책임이라고 명시한다.
- `apps/web/src`
  - Supabase Storage `.remove()` 호출, cleanup cron 또는 내부 sweeper route가 없다.
- `docs/supabase/slice1-spring-boot-migration-notes.md`
  - finalization failure 또는 expired intent의 orphan object 제거를 서버 책임으로 규정하지만 구현되어 있지 않다.

### 영향

- 인증 계정 하나가 프로젝트 Storage 용량과 비용을 지속적으로 소모해 전체 사용자 가용성을 낮출 수 있다.
- 사용되지 않은 사적 영상이 사용자가 예상한 TTL 이후에도 남아 개인정보와 보존정책 위험이 생긴다.
- `upload_intents` row도 무한히 증가한다.
- 실제 Storage 제한에 도달하면 정상 사용자의 새 영상 업로드가 실패할 수 있다.

### 수정 방향

1. upload lifecycle에 소비와 cleanup 상태를 명확히 둔다.
   - `created/uploaded/validating/finalized/consumed`와 cleanup claim 상태를 구분하거나 동등한 별도 cleanup job table을 사용한다.
   - session 생성 트랜잭션에서 intent를 `consumed`로 전환해 정상 사용 중인 object를 식별한다.
2. Worker에 idempotent upload sweeper를 추가한다.
   - 만료된 `created` intent와 grace period가 지난 미소비 `finalized` intent를 찾는다.
   - DB lock/lease로 cleanup 대상을 원자적으로 claim한다.
   - service role로 정확한 bucket/path의 Storage object를 `.remove([path])`한다.
   - 삭제 성공 또는 이미 없는 객체는 terminal `expired/cleaned`로 기록한다.
   - 삭제 실패는 `cleanup_failed`와 attempt/error를 기록하고 backoff 후 재시도한다.
3. Storage 삭제와 DB 상태 변경은 하나의 DB transaction이 될 수 없으므로 재시도 가능한 saga로 구현한다.
   - Worker가 object 삭제 후 종료되어도 다음 실행에서 object 없음 상태를 성공으로 처리한다.
   - cleanup claim 중에는 finalize/session create가 같은 intent를 소비하지 못하게 한다.
   - session/take에서 참조 중인 object는 cleanup 대상에서 제외한다.
4. finalize 또는 media validation 실패가 확정된 경우 즉시 best-effort cleanup을 시도하되, 실패/프로세스 종료에 대비해 sweeper가 최종 복구한다.
5. 사용자별 active intent 개수와 byte quota를 DB 원자 경계에서 강제한다.
   - `created` 및 미소비 `finalized` intent의 개수와 예약/실사용 byte를 포함한다.
   - 정확한 상한값은 제품/운영 설정으로 정하되 concurrent 요청으로 초과할 수 없게 RPC/transaction lock을 사용한다.
   - quota 초과는 안정적인 `409` 또는 `429` 오류와 필요 시 `Retry-After`를 반환한다.
6. cleanup 성공/실패, 정리한 byte, 재시도 횟수를 운영 로그와 metric으로 남긴다.

### 범위 주의사항

- 클라이언트가 선언한 `expected_size_bytes`만으로 byte quota를 계산하면 조작될 수 있다. 업로드 후 Storage에서 확인한 actual size도 quota와 cleanup 판단에 반영해야 한다.
- 브라우저 cleanup은 빠른 정리를 위한 보조 수단으로만 사용할 수 있다. 탭 종료와 네트워크 단절 상황 때문에 최종 책임은 서버 Worker에 있어야 한다.
- finalized object의 보존 여부는 intent status만 보지 말고 실제 session/take 참조 또는 명시적인 `consumed` 상태로 판단해야 한다.
- session 삭제와 orphan cleanup은 같은 Storage object를 다룰 수 있으므로 하나의 idempotent deletion primitive를 재사용한다.

### 검증 기준

- 업로드 후 finalize하지 않은 object는 TTL과 grace period가 지나면 Storage에서 삭제된다.
- finalize됐지만 session에서 소비되지 않은 object도 grace period 이후 삭제된다.
- session/take가 참조하는 정상 object는 sweeper가 삭제하지 않는다.
- cleanup을 여러 번 실행해도 같은 object 삭제가 오류나 중복 side effect를 만들지 않는다.
- Storage remove 실패 시 `cleanup_failed`로 기록되고 다음 실행에서 재시도된다.
- Worker가 object 삭제 직후 종료되어도 다음 실행에서 terminal 상태로 수렴한다.
- 같은 사용자가 quota까지는 intent를 만들 수 있지만 N+1 요청은 거부된다.
- 동시에 들어온 여러 intent 생성 요청도 개수/byte quota를 초과하지 못한다.
- cleanup 후 quota가 반환되어 사용자가 새 intent를 만들 수 있다.

### 필요한 회귀 테스트

1. 실제 Supabase test bucket에 업로드한 뒤 TTL 경과와 sweeper 실행 후 object가 사라지는 통합 테스트를 추가한다.
2. 미소비 finalized object 정리와 session-linked object 보존을 각각 검증한다.
3. Storage remove 실패, `cleanup_failed`, 재실행 성공의 idempotency 테스트를 추가한다.
4. finalize/session create와 cleanup의 동시 실행에서 사용 중 object를 삭제하지 않는 DB 동시성 테스트를 추가한다.
5. 단일/동시 사용자 quota 및 cleanup 후 quota 반환 테스트를 추가한다.

---

## 6. 통신 재시도에서 같은 request ID와 resource identity 유지

### 결정

**반영 예정 (High)**

하나의 논리적 mutation에는 하나의 안정적인 `requestId`를 사용한다. 서버 commit 여부를 확인하지 못한 transport retry는 원래 `requestId`와 resource identity를 재사용하고, 확정적으로 실패한 작업을 사용자가 새로 시도하는 business retry만 새 `requestId`를 사용한다.

특히 live 인터뷰의 일반 `reply`와 최초 `begin` 흐름은 응답 유실 후 실제 중복 side effect가 발생하므로 병합 전에 수정한다.

### 두 종류의 재시도 구분

| 종류 | 예시 | request ID 규칙 |
| --- | --- | --- |
| Transport retry | 서버 commit 후 HTTP 응답만 유실되어 동일 요청의 결과를 다시 확인함 | 원래 `requestId` 재사용 |
| Business retry | DB에 retryable failed로 확정된 actor turn을 `retry_reply`로 다시 전달함 | 새 attempt이므로 새 `requestId` 사용 |

`retry_reply`의 새 ID 생성은 2번 항목에서 확인한 대로 정상이다. 다만 하나의 `retry_reply` attempt 자체에서 응답만 유실됐다면 그 attempt의 transport retry에는 같은 ID를 재사용해야 한다.

### 일반 reply 중복 시나리오

1. 사용자가 live 인터뷰에서 답변을 전송하고 요청 ID `A`가 생성된다.
2. 서버와 acting-api 처리가 성공해 actor turn, 다음 AI turn, operation 완료가 DB에 commit된다.
3. HTTP 응답이 브라우저에 도착하기 직전 연결이 끊긴다.
4. 브라우저의 `fetch`는 `TypeError` 또는 `AbortError`로 실패하지만 현재 복구 함수는 일부 `ApiClientError.code`만 처리하므로 DB를 다시 조회하지 않는다.
5. 성공 응답을 받지 못했으므로 입력창의 답변과 오래된 질문이 그대로 남고 `busy`는 해제된다.
6. 사용자가 다시 전송하면 UI는 새 요청 ID `B`를 생성한다.
7. 서버 idempotency는 `(user_id, request_id)` 기준이므로 `B`를 새 operation으로 처리한다.
8. run이 아직 live라면 같은 답변이 다음 질문에 대한 새 actor turn처럼 저장되고 acting-api도 다시 호출된다.

### begin 중복 시나리오

1. 사용자가 영상 업로드, finalize, session create와 분석을 실행한다.
2. session/analysis commit 후 최종 응답만 유실된다.
3. UI는 기존 `uploadIntentId`, `sessionId`, create `requestId`를 unresolved operation으로 보존하지 않는다.
4. 사용자가 다시 시작 버튼을 누르면 새 upload intent, Storage path, session, request ID를 모두 만든다.
5. 같은 영상과 장면 정보에 대해 object, session, upstream analysis가 중복 생성된다.

같은 upload intent/session으로 create 요청만 다시 보냈다면 DB 상태가 중복 분석을 막을 수 있다. 실제 중복의 핵심은 UI가 request ID뿐 아니라 전체 resource identity도 새로 만드는 데 있다.

### 확인된 PostgreSQL 재현 결과

첫 reply를 완료한 뒤 같은 ID와 새 ID로 각각 다시 claim한 결과는 다음과 같다.

```text
claim1=claimed
same_id=replay_completed
new_id=claimed
turns=5,actor=2,ai=3
1:ai:Q1
2:actor:same answer
3:ai:Q2
4:actor:same answer
5:ai:Q3
```

같은 `requestId`를 재사용하면 저장된 완료 결과가 replay되어 side effect가 하나뿐이다. 새 ID를 사용하면 동일 답변과 AI 응답이 추가된다.

### operation별 영향 범위

| Operation | commit 후 새 ID 재실행 결과 | 판단 |
| --- | --- | --- |
| 일반 `reply` | live run이면 새 actor/AI turn과 upstream 호출 발생 | 실제 중복, 수정 필수 |
| 최초 `begin` | UI가 새 intent/path/session까지 만들어 새 분석 실행 | 실제 중복, 수정 필수 |
| `start`/`restart` | 기존 run 상태가 두 번째 실행을 거부 | 중복은 없지만 복구 UX 수정 필요 |
| analysis `retry` | 첫 성공 후 session/take 상태가 두 번째 claim을 거부 | 중복 없음, 같은-ID 복구 권장 |
| report | 첫 성공 후 session=`end`와 unique report가 두 번째 claim을 거부 | 중복 없음, 같은-ID 복구 권장 |
| 성공한 `retry_reply` | actor turn이 더 이상 retry eligible하지 않아 재실행 거부 | 의도된 새 attempt ID 유지 |
| upload finalize | 같은 path/duration의 재호출은 현재도 idempotent return | 직접 중복 원인 아님 |

### 근거

- `apps/web/src/features/practice/practice-flow.tsx`
  - create, start/restart, 일반 reply를 클릭할 때마다 `crypto.randomUUID()`를 즉석 생성한다.
  - 성공 응답을 받아야만 active session과 answer를 갱신한다.
  - `recoverPersistedSession()`은 제한된 `ApiClientError.code`만 처리하고 일반 transport error는 즉시 반환한다.
  - begin 재실행 시 기존 intent/session/request ID를 재사용하지 않고 전체 업로드 흐름을 새로 시작한다.
- `apps/web/src/lib/api/sessions.ts`
  - analysis retry와 report helper도 내부에서 매 호출마다 request ID를 생성한다.
- `supabase/migrations/011_acting_api_pipeline.sql`
  - operation replay는 `(user_id, request_id)`와 fingerprint가 같을 때만 동작한다.
  - 새 request ID는 같은 fingerprint/content라도 별도 operation으로 처리한다.
  - live run의 일반 reply claim은 새 actor turn을 삽입할 수 있다.
- `apps/web/src/server/services/acting-coach-service.ts`
  - 일반 reply claim 후 acting-api 호출과 actor/AI turn commit을 수행한다.

### 수정 방향

1. UI에 pending operation 상태를 둔다.
   - API 호출 전에 `requestId`를 한 번 생성한다.
   - operation kind, 대상 session/run, 필요한 resource ID와 함께 결과가 확정될 때까지 유지한다.
   - 동일 unresolved operation을 다시 확인할 때는 같은 ID를 사용한다.
   - `retryAnalysis()`와 `createPracticeReport()` helper 내부 ID 생성도 제거하고 caller가 안정적인 ID를 전달한다.
2. transport error를 business error와 분리한다.
   - `TypeError`, `AbortError`, 응답 JSON 파싱 실패 등 commit 여부를 알 수 없는 오류는 새 mutation을 허용하기 전에 reconciliation을 수행한다.
   - session ID가 있으면 오류 class/code와 관계없이 먼저 persisted session 또는 operation 상태를 조회한다.
   - 상태가 이미 진행되었다면 UI를 갱신하고 같은 mutation을 다시 POST하지 않는다.
3. request ID 기반 operation status/replay 경계를 제공한다.
   - 기존 POST를 같은 ID와 payload로 다시 보내 persisted response를 replay하거나, authenticated operation status endpoint에서 해당 ID의 상태를 조회한다.
   - page reload까지 복구해야 한다면 민감한 reply text를 브라우저에 장기 저장하기보다 request ID로 서버 operation 상태를 조회하는 방식을 우선한다.
4. begin workflow identity를 보존한다.
   - upload intent 생성 API도 client-generated idempotency key를 받고 `(user_id, request_id)`로 같은 intent를 replay하도록 한다.
   - 발급받은 `uploadIntentId`, `sessionId`, create `requestId`를 workflow가 terminal 상태가 될 때까지 유지한다.
   - create-session 응답 유실 시 새 intent를 만들지 말고 기존 session GET 또는 같은 create request를 replay한다.
   - 3번 항목의 async 분석을 적용하면 `202 + ANALYZING` 응답이 유실되어도 같은 session/job을 조회한다.
5. 일반 reply에 stale-question 방어층을 추가한다.
   - DTO에 `expectedAiTurnId`, `replyToTurnId` 또는 expected ordinal/version을 포함한다.
   - DB claim에서 사용자가 보고 답한 최신 AI turn과 일치할 때만 새 일반 reply를 허용한다.
   - 답변 text 자체로 dedupe하지 않는다. 서로 다른 질문에 사용자가 같은 문장을 답하는 것은 정상일 수 있다.
6. ID 폐기 규칙을 명확히 한다.
   - completed/replayed completed 또는 definitive failed를 확인한 뒤 pending transport operation을 비운다.
   - definitive retryable failure에서 사용자가 `retry_reply`를 시작할 때는 새 attempt ID를 생성한다.
   - outcome unknown 상태에서는 임의의 새 ID로 같은 side effect를 다시 실행하지 않는다.

### 검증 기준

- reply DB commit 후 HTTP 응답을 강제로 유실해도 UI가 persisted Q2 상태를 복구하며 POST/upstream 호출은 한 번뿐이다.
- 같은 request ID로 reply를 두 번 보내면 actor와 AI turn이 각각 한 번만 저장되고 두 번째 요청은 completed result를 replay한다.
- 새 request ID라도 stale `expectedAiTurnId`로 일반 reply를 보내면 DB claim이 거부되고 upstream을 호출하지 않는다.
- begin commit 후 응답 유실 시 기존 session을 조회/replay하며 intent, object, session, analysis job이 각각 하나만 남는다.
- start/restart, analysis retry, report의 transport error도 새 ID 오류 대신 persisted 상태로 복구된다.
- 확정적으로 failed인 actor turn에서 사용자가 시작한 `retry_reply`는 새 attempt ID를 사용한다.
- 같은 retry attempt의 transport retry는 그 attempt의 ID를 재사용한다.
- 같은 request ID에 다른 payload를 보내면 기존 `request_id_conflict` 방어가 유지된다.

### 필요한 회귀 테스트

1. 실제 DB/Route에서 reply commit 직후 response socket을 끊고 UI reconciliation과 단일 side effect를 검증한다.
2. 동일 request ID reply의 completed replay와 actor/AI turn 단일성을 실제 PostgreSQL에서 검증한다.
3. stale expected AI turn과 새 request ID 조합이 거부되는 DB 테스트를 추가한다.
4. create analysis commit 후 response 유실에서 기존 workflow identity가 복구되는 브라우저 테스트를 추가한다.
5. start/restart, analysis retry, report, retry_reply의 commit 후 재호출 matrix 테스트로 두 번째 upstream 호출이 없는지 고정한다.
6. transport retry와 definitive business retry의 request ID 생성 규칙을 단위 테스트로 구분한다.

---

## 7. Next.js Proxy entry를 `src` 안으로 이동

### 결정

**반영 예정 (Medium)**

현재 `apps/web/proxy.ts`를 `apps/web/src/proxy.ts`로 이동해 Next.js가 실제 Proxy entry로 발견하도록 한다. Supabase session refresh와 보호 페이지의 서버 redirect가 빌드 및 런타임에서 동작하는지 검증한다.

API Route에는 별도의 인증/약관 검사가 있으므로 이 문제만으로 보호 데이터가 직접 노출되는 것은 아니다. 그러나 의도한 인증 Proxy가 완전히 비활성화되어 session refresh와 서버 측 진입 차단이 작동하지 않는 기능 결함이다.

### 원인

프로젝트는 App Router를 `apps/web/src/app`에 둔다. Next.js 공식 file-system convention은 `src` 구조를 사용할 경우 `proxy.ts`도 `app`과 같은 수준인 `src/proxy.ts`에 두도록 요구한다.

현재 구조는 다음과 같다.

```text
apps/web/
  proxy.ts          # 현재 위치: Next.js가 Proxy entry로 등록하지 않음
  src/
    app/
    lib/
      supabase/proxy.ts
```

`src/lib/supabase/proxy.ts`는 실제 session/redirect 로직을 담은 일반 모듈이다. 이 모듈을 import하는 convention entry가 잘못된 위치에 있어 실행되지 않는다.

공식 근거:

- [Next.js Proxy file convention](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
- [Next.js `src` directory convention](https://nextjs.org/docs/app/api-reference/file-conventions/src-folder)

### 문제 시나리오

1. 인증되지 않은 사용자가 `/home` 또는 `/practice/new`를 직접 요청한다.
2. 의도한 Proxy는 요청 전에 Supabase claim을 확인하고 `/auth/login?next=...`으로 redirect해야 한다.
3. 실제 빌드에는 Proxy가 등록되지 않아 보호 페이지가 정적 HTML `200 OK`로 반환된다.
4. 브라우저가 JavaScript를 내려받고 `PracticeFlow`가 `/api/v1/auth/session`을 호출한 뒤에야 client redirect가 일어난다.
5. JavaScript가 실행되지 않거나 초기 로딩 중이면 서버 수준의 보호 페이지 redirect는 적용되지 않는다.
6. 모든 요청에서 실행되어야 할 Supabase auth cookie refresh도 Proxy 경로에서는 수행되지 않는다.

### 확인된 build 결과

`pnpm --filter web build` 직후 `apps/web/.next/server/middleware-manifest.json`을 확인한 결과 Proxy 등록 정보가 비어 있었다.

```json
{
  "middleware": {},
  "sortedMiddleware": [],
  "functions": {}
}
```

build route 목록에서도 `/home`, `/practice/new`, `/practice/history`는 Proxy가 없는 정적 페이지로 표시되었다.

### 확인된 런타임 결과

production build를 `next start`로 실행하고 인증 cookie 없이 `/home`을 요청했을 때 redirect가 아니라 다음 응답이 반환되었다.

```text
HTTP/1.1 200 OK
x-nextjs-prerender: 1
Cache-Control: s-maxage=31536000
```

따라서 `updateSupabaseSession()`의 matcher와 redirect 로직이 실제 request pipeline에 들어가지 않았음이 확인되었다.

### 근거

- `apps/web/proxy.ts`
  - `updateSupabaseSession()`을 호출하는 convention entry지만 `src/app`과 같은 수준이 아니다.
- `apps/web/src/lib/supabase/proxy.ts`
  - Supabase `getClaims()`, cookie 갱신, 보호 경로 판별과 login redirect 로직을 구현한다.
- `apps/web/src/app/home/page.tsx`
  - 서버 인증 guard 없이 client `PracticeFlow`만 렌더링한다.
- `apps/web/src/app/practice/new/page.tsx`
  - 서버 인증 guard 없이 client `PracticeFlow`만 렌더링한다.
- `apps/web/src/features/practice/practice-flow.tsx`
  - hydration 후 auth session API를 호출해 미인증 사용자를 client redirect한다.
- `apps/web/tests/auth-owner-gating-contract.test.mjs`
  - Proxy 내부 모듈의 문자열은 검사하지만 convention entry 위치나 build manifest 등록 여부는 검사하지 않는다.

### 수정 방향

1. `apps/web/proxy.ts`를 `apps/web/src/proxy.ts`로 이동한다.
   - named `proxy` export와 matcher는 유지한다.
   - `@/lib/supabase/proxy` import는 현재 `@/* -> src/*` alias를 그대로 사용할 수 있다.
2. `src/lib/supabase/proxy.ts`의 session refresh와 redirect 로직은 convention entry와 분리된 현재 모듈 구조를 유지한다.
3. API Route의 `requireApiAuthenticatedUser()`/`requireApiTermsAccepted()` 검사는 그대로 유지한다. Proxy를 API authorization의 유일한 경계로 사용하지 않는다.
4. 보호 페이지의 server-side guard를 추가할지는 구현 시 defense-in-depth로 검토한다.
   - Proxy는 빠른 redirect와 session refresh를 담당한다.
   - 실제 데이터 접근 권한은 API/service owner 검사에서 계속 강제한다.
5. auth source-contract test가 단순히 helper 모듈 존재만 확인하지 않고 실제 Proxy entry와 런타임 동작을 검증하도록 강화한다.

### 검증 기준

- production build의 middleware/proxy manifest에 Proxy와 matcher가 등록된다.
- 인증 cookie 없이 `/home` 요청 시 `/auth/login?next=/home`으로 서버 redirect된다.
- 인증 cookie 없이 `/practice/new`와 `/practice/history` 요청도 각각 안전한 `next` 경로와 함께 redirect된다.
- 유효한 로그인 세션에서는 보호 페이지가 정상 응답한다.
- 갱신이 필요한 Supabase session에서 Proxy 응답에 최신 auth cookie가 전달된다.
- 정적 asset과 이미지 경로는 matcher 예외가 유지된다.
- API Route의 기존 인증 및 owner 검사는 Proxy 유무와 관계없이 계속 통과한다.

### 필요한 회귀 테스트

1. `src/proxy.ts`가 존재하고 잘못된 root `proxy.ts`가 남지 않는 file-convention 테스트를 추가한다.
2. Next.js production build 후 Proxy manifest가 비어 있지 않은지 검증한다.
3. `next start` 또는 브라우저 테스트에서 미인증 보호 경로의 server redirect를 검증한다.
4. Supabase session refresh가 필요한 cookie fixture로 response cookie 갱신을 검증한다.
5. matcher가 `_next/static`, `_next/image`, favicon 및 이미지 asset을 제외하는지 검증한다.

---

## 8. coach 404를 operation에 따라 구분

### 결정

**반영 예정 (High)**

`/coach/reply`에서 기존 acting-api 세션을 찾지 못해 발생한 404만 `acting_session_expired`로 처리한다. 새 acting-api 세션을 만드는 `/coach/start` 또는 platform restart 경로의 404는 route·base URL·deployment 오류로 분류하고, 방금 만든 interview run을 만료 처리하지 않는다.

### `세션 만료`의 범위

여기서 만료되는 것은 로그인 세션이나 platform DB의 연습 기록이 아니다. `/coach/start`가 반환한 `session_id`로 acting-api 메모리에 보관하던 코칭 대화 상태를 말한다.

- `/coach/start`: 새 acting-api 세션을 생성한다.
- `/coach/reply`: 기존 `session_id`를 사용해 대화를 이어간다.
- acting-api가 재시작·재배포되어 메모리 상태가 사라진 후 `/coach/reply`가 404를 반환하면 실제 세션 만료다.
- 생성 요청인 `/coach/start`의 404는 사라질 기존 세션이 없으므로 만료가 아니다.

platform DB에 저장된 영상, 분석 결과, turn 기록은 acting-api 메모리 세션 만료와 별개로 유지된다.

### 문제 시나리오

1. acting-api base URL이 잘못 배포되거나 게이트웨이에 `/coach/start` route가 없어 404를 반환한다.
2. platform은 아직 acting-api 세션을 만들지 못했지만, 공통 `phase === "coach"` 분기 때문에 이 404를 `acting_session_expired`로 변환한다.
3. catch 경로가 방금 생성한 interview run을 `expired`로 저장한다.
4. UI는 실제 설정·배포 장애 대신 “인터뷰 다시 시작”을 안내한다.
5. 사용자가 다시 시작하면 새 run을 만든 후 동일한 404를 받고 다시 만료 처리한다.
6. 설정이 고쳐지기 전까지 사용자는 재시작 루프에 갇히고, 실패한 run row가 계속 추가될 수 있다.

### 원인

`parseUpstreamResponse()`는 endpoint나 operation을 받지 않고 `analysis | coach | report` phase만 받는다. 따라서 다음 조건이 start, restart, reply에 모두 적용된다.

```ts
if (phase === "coach" && response.status === 404) {
  throw expiredError(runId ?? "");
}
```

start/restart와 reply가 모두 `parseUpstreamResponse(..., "coach", runId)`를 호출하므로 404의 의미를 구분할 정보가 사라진다.

### 근거

- `apps/web/src/server/services/acting-coach-service.ts`
  - `parseUpstreamResponse()`가 coach phase의 모든 404를 `acting_session_expired`로 변환한다.
  - start/restart 경로도 `"coach"` phase를 사용한다.
  - start/restart catch가 해당 코드를 받으면 `expireCoachRun()`을 호출한다.
  - reply 경로는 이미 발급된 acting-api `session_id`를 사용하므로 reply 404에서는 만료 분류가 적절하다.
- `docs/API.md`
  - `/coach/start`는 새 `session_id`를 반환한다.
  - `/coach/reply`는 그 ID를 필수로 받고, 세션이 없으면 404를 반환한다.
  - 코칭 세션은 acting-api 메모리에 저장되어 재시작·재배포 시 소멸할 수 있다.

### 수정 방향

1. upstream 응답 분류에 endpoint 또는 operation context를 전달한다.
   - 예: `coach_start`, `coach_reply`, `analysis`, `report`
   - 또는 `phase` 외에 `operation: "start" | "reply"`를 별도로 전달한다.
2. `/coach/reply` 404만 `acting_session_expired` + `expireCoachRun()` 경로로 보낸다.
3. `/coach/start`/restart 404는 upstream route·base URL·deployment 오류로 분류한다.
   - 클라이언트에는 502 계열의 안정적인 오류 코드를 반환한다.
   - 해당 attempt는 side effect가 없었던 definitive failure로 저장하되, run을 `expired`로 위조하지 않는다.
   - 설정 수정 전에 사용자에게 만료 재시작을 반복 유도하지 않는다.
4. upstream endpoint, HTTP status, platform operation을 구분해 관측 가능한 server log에 남긴다. API key와 payload 본문은 log에 남기지 않는다.
5. 401, 413, 429 및 일반 5xx의 기존 분류는 유지한다.

### 검증 기준

- `/coach/start` 404가 `acting_session_expired` 또는 `restart_interview`로 노출되지 않는다.
- start/restart 404에서 방금 만든 run이 `expired`로 저장되지 않는다.
- start/restart 404는 upstream 경로·배포 문제임을 나타내는 안정적인 502 오류로 응답한다.
- 이미 성공한 `/coach/start` 후 `/coach/reply` 404는 기존과 같이 `acting_session_expired`로 분류하고 해당 run을 만료 처리한다.
- 동일한 start 404를 반복해도 만료 run이 무제한 추가되거나 UI가 재시작 루프를 안내하지 않는다.
- reply 404 분류 변경이 request replay, lease, actor turn 복구 규칙을 깨뜨리지 않는다.

### 필요한 회귀 테스트

1. acting-api client의 start 응답을 404로 stub하고 platform 오류 코드, HTTP status, run 상태를 검증한다.
2. restart 응답 404에서도 `expireCoachRun()`이 호출되지 않는지 검증한다.
3. acting-api client의 reply 응답을 404로 stub하고 `acting_session_expired`, `restart_interview`, run 만료 상태가 유지되는지 검증한다.
4. start/restart/reply의 401, 429, 5xx response matrix를 검증해 다른 오류 의미가 변하지 않도록 고정한다.

---

## 9. upload intent의 약관 버전 기준을 DB로 단일화

### 결정

**반영 예정 (High)**

보안 경계에서 사용하는 현재 약관 버전의 source of truth를 `public.current_acttub_terms_version()` DB 함수 하나로 통일한다. upload intent 저장 시 Next.js env 값으로 `consent_version`을 덮어쓰지 않고 DB default를 사용한다.

### 현재 상태

현재 기본 env 값과 DB 함수가 모두 `2026-07-mvp`를 반환하므로 즉시 장애는 발생하지 않는다. 하지만 다음 두 값이 독립적으로 배포될 수 있다.

- Next.js: `NEXT_PUBLIC_ACTTUB_TERMS_VERSION` 또는 코드 기본값
- Supabase: `public.current_acttub_terms_version()`

`upload_intents.consent_version`에는 이미 DB default가 정의되어 있지만 repository가 env 값을 명시적으로 insert하여 default를 우회한다.

### 문제 시나리오

1. 새 약관 버전 `2026-08`을 배포하며 DB의 `current_acttub_terms_version()`을 먼저 갱신한다.
2. Next.js env가 누락되거나 나중에 배포되어 여전히 `2026-07-mvp`를 반환한다.
3. 사용자가 새 약관에 동의한 후 영상 업로드를 시작한다.
4. Next.js server가 upload intent의 `consent_version`에 env 기준 `2026-07-mvp`를 저장한다.
5. 이 intent insert는 service role을 사용하므로 성공한다.
6. 브라우저가 private Storage에 영상을 insert할 때 RLS는 intent 버전을 DB 현재값 `2026-08`과 비교한다.
7. 버전이 다르므로 RLS가 영상 insert를 거부한다.
8. 신규 upload intent가 계속 잘못된 버전을 저장하므로 env·DB drift가 해소될 때까지 모든 새 영상 업로드가 실패할 수 있다.

env가 DB보다 먼저 갱신되는 반대 순서에서도 같은 문제가 발생한다.

### 근거

- `apps/web/src/lib/config/env.ts`
  - `getAppConfig().termsVersion`이 `NEXT_PUBLIC_ACTTUB_TERMS_VERSION` 또는 코드 기본값을 사용한다.
- `apps/web/src/server/repositories/supabase-coach-session-repository.ts`
  - `createUploadIntent()`가 `consent_version: getAppConfig().termsVersion`을 명시적으로 insert한다.
- `supabase/migrations/001_acttub_slice1_schema.sql`
  - `upload_intents.consent_version`의 default는 `public.current_acttub_terms_version()`이다.
  - Storage INSERT RLS는 `ui.consent_version = public.current_acttub_terms_version()`를 필수로 검사한다.
- `apps/web/src/server/services/auth-context.ts`
  - 인증·약관 gate는 이미 DB RPC로 현재 필수 버전을 조회한다. 따라서 upload intent만 env 기준을 별도로 사용할 이유가 없다.

### 수정 방향

1. upload intent insert payload에서 `consent_version`을 제거한다.
   - PostgreSQL이 column default `public.current_acttub_terms_version()`을 사용하게 한다.
   - 인증을 좌우하는 값은 요청 파라미터나 브라우저 env에서 받지 않는다.
2. `NEXT_PUBLIC_ACTTUB_TERMS_VERSION`을 authorization 결정의 source of truth로 사용하지 않는다.
   - UI 표시 등에 남겨야 한다면 DB 값의 비보안 캐시/힌트로만 취급한다.
   - DB authorization과 서버 판정은 계속 DB RPC 값을 사용한다.
3. 약관 버전 변경은 DB 함수 갱신, 기존 profile 상태 전이, 재동의 흐름을 포함한 migration으로 관리한다.
4. 배포 preflight에서 auth gate, upload intent, Storage RLS가 같은 DB 버전을 사용하는지 검증한다.

### 범위 주의사항

- 약관 버전 문자열을 하드코딩한 새 공통 상수로 옮기는 것은 두 source of truth 문제를 해결하지 못한다.
- Storage RLS의 버전 검사를 제거해 맞추지 않는다. 구버전 동의로 발급된 intent의 업로드를 차단하는 보안 경계는 유지한다.
- 이 항목은 1번의 정지 사용자 재활성화 차단과 연결되지만 별도 문제다. 1번은 profile mutation 권한, 이 항목은 약관 버전의 일관성을 다룬다.

### 검증 기준

- upload intent insert에 `consent_version`을 직접 보내지 않아 DB default가 적용된다.
- DB 현재 약관 버전을 변경한 후 생성한 intent에 새 DB 버전이 자동 저장된다.
- Next.js env에 다른 약관 버전이 남아 있어도 upload intent와 Storage RLS 비교가 어긋나지 않는다.
- 현재 약관에 동의한 active 사용자의 정상 업로드는 성공한다.
- 구버전 동의로 발급된 기존 intent는 새 약관 버전 전환 후 Storage RLS에서 계속 거부된다.
- DB 함수와 profile consent 검증, upload intent snapshot, Storage RLS가 동일한 버전 기준을 사용한다.

### 필요한 회귀 테스트

1. upload intent repository insert payload에 `consent_version`이 포함되지 않는지 검증한다.
2. DB 함수를 새 버전으로 변경한 fixture에서 intent default가 그 버전을 사용하는지 검증한다.
3. env·DB 버전을 의도적으로 다르게 두고도 현재 약관에 동의한 사용자의 intent 생성·Storage insert가 성공하는지 통합 테스트한다.
4. 구버전 intent의 Storage insert가 거부되는 보안 회귀 테스트를 유지한다.

---

## 10. 성공 HTTP 응답의 JSON parsing 실패를 typed error로 처리

### 결정

**반영 예정 (Medium)**

HTTP status가 `2xx`여도 응답 본문이 비었거나 JSON이 아니거나 전송 중 잘렸다면 성공값으로 반환하지 않는다. JSON parsing 실패와 DTO 경계 실패를 안정적인 `ApiClientError` 코드로 변환하고, side effect가 있는 mutation은 6번의 outcome reconciliation 규칙에 연결한다.

### 문제 시나리오

1. Next.js Route, reverse proxy 또는 CDN이 `200 OK`를 반환한다.
2. 응답 본문은 빈 문자열, HTML error page 또는 전송 중 잘린 JSON이다.
3. `response.json()`이 `SyntaxError`로 실패한다.
4. 현재 `parseJsonResponse()`는 이 실패를 `.catch(() => null)`로 제거한다.
5. `response.ok === true`이므로 `null as T`를 성공 결과로 반환한다.
6. 세션 목록 호출부가 `const { sessions } = null`을 실행하며 raw TypeError를 발생시킨다.
7. UI에는 제품이 정의한 API 오류 대신 `Cannot destructure ... of null` 같은 내부 JavaScript message가 노출될 수 있다.

mutation의 경우 문제가 더 크다. POST가 DB에 commit된 후 응답 본문만 손상되었을 수 있으므로, 단순 실패로 보고 새 request ID로 재시도하면 6번의 중복 side effect가 발생할 수 있다.

### 근거

- `apps/web/src/lib/api/sessions.ts`
  - `response.json().catch(() => null)`로 parsing 예외를 제거한다.
  - non-2xx일 때만 `ApiClientError`를 던진다.
  - `2xx` parsing 실패에서는 runtime 검증 없이 `null as T`를 반환한다.
- `apps/web/src/features/practice/practice-flow.tsx`
  - `listPracticeSessions()`가 반환한 값을 객체로 가정하고 즉시 `{ sessions }`를 구조 분해한다.
  - `errorMessage()`는 일반 `Error.message`를 그대로 UI에 보여주므로 raw TypeError message가 노출될 수 있다.
- `docs/PR_1_REVIEW.md` 6번
  - mutation 응답 JSON parsing 실패는 commit 여부를 알 수 없는 transport outcome으로 분류하고 같은 request ID로 reconciliation해야 한다.

### 수정 방향

1. parsing 예외를 `null` 성공값으로 변환하지 않는다.
   - `response.json()`을 명시적인 `try/catch`로 감싼다.
   - parsing에 실패하면 HTTP status와 요청 종류를 보존한 typed error를 던진다.
2. `2xx` invalid body에 `invalid_response` 계열의 안정적인 `ApiClientError.code`를 사용한다.
   - 사용자 message는 “응답을 확인하지 못했어요”처럼 제품 카피로 제한한다.
   - HTML 본문이나 parsing 예외 내부 메시지를 UI에 그대로 노출하지 않는다.
3. non-2xx invalid body도 기존 HTTP status를 보존한 generic `ApiClientError`로 반환한다.
4. 성공 JSON이라도 endpoint가 요구하는 최소 DTO shape와 다르면 typed invalid-response error로 처리한다.
   - 최소한 `null`, array, primitive를 객체 응답으로 cast하지 않는다.
   - 핵심 응답은 endpoint별 runtime guard를 재사용한다.
5. GET의 invalid response는 side effect 없는 일반 재조회 오류로 처리한다.
6. POST/PATCH mutation의 invalid response는 성공 commit 여부가 불명하다.
   - 6번에서 정한 pending request ID를 유지한다.
   - session/operation을 조회해 persisted state를 reconciliation한 후에만 재시도 여부를 판단한다.

### 범위 주의사항

- TypeScript의 `as T`는 runtime validation을 수행하지 않는다. cast를 추가하는 것으로는 문제가 해결되지 않는다.
- 현재 sessions client가 호출하는 API는 JSON 응답을 계약으로 하므로 `204 No Content`를 성공 예외로 취급하지 않는다.
- 모든 DTO validator를 한번에 새로 만드는 과도한 범위 확장은 피한다. 먼저 공통 JSON parsing 경계와 현재 호출부가 사용하는 필수 shape를 고정한다.

### 검증 기준

- `200` + 빈 본문, HTML, 잘린 JSON이 `null` 성공값으로 반환되지 않는다.
- invalid `2xx` 응답이 안정적인 `ApiClientError.code`와 제품 메시지를 사용한다.
- list/get API의 invalid response가 destructuring TypeError로 바뀌지 않는다.
- `400`/`401`/`500` + invalid JSON은 해당 HTTP status를 보존한 typed error로 반환된다.
- mutation commit 후 응답 JSON이 손상되어도 새 request ID로 side effect를 반복하지 않고 persisted state를 복구한다.
- 정상 JSON 응답과 기존 `ApiClientError` mapping은 변하지 않는다.

### 필요한 회귀 테스트

1. `parseJsonResponse()`에 `200` + empty body, HTML, truncated JSON fixture를 전달해 typed error를 검증한다.
2. `200` + `null`, array, primitive 및 필수 field가 없는 object의 endpoint shape 거부를 검증한다.
3. non-2xx invalid JSON이 status를 잃지 않고 generic API error로 변환되는지 검증한다.
4. 세션 목록 로드에서 invalid response가 raw TypeError 대신 안정적인 UI error banner로 표시되는지 검증한다.
5. reply/report/create mutation commit 후 response body만 손상시켜 6번의 request replay·reconciliation이 동작하는지 검증한다.

---

## 11. legacy Gemini 질문의 줄바꿈을 정규화해 허용

### 결정

**반영 예정 (Medium)**

legacy Gemini가 반환한 단일 질문에 `\n` 줄바꿈이 포함되어도 줄바꿈 자체만으로 예외를 던지지 않는다. 연속 공백과 줄바꿈을 하나의 공백으로 정규화한 질문을 사용하되, 불릿 목록과 복수 질문 방어는 유지한다.

이 변경은 canonical `acting-api-v1` 흐름이 아니라 기존 `gemini-question-service.ts` legacy 호환 경로에만 적용한다.

### 문제 시나리오

1. Gemini가 내용은 정상인 질문 하나를 반환하지만 포맷 때문에 앞뒤 또는 문장 중간에 줄바꿈이 포함된다.

   ```text
   \n그 장면에서 왜 멈춼나요?\n
   ```

2. `ensureSafeSingleQuestion()`이 먼저 `question.replace(/\s+/g, " ").trim()`으로 정규화해 다음 정상 문장을 만든다.

   ```text
   그 장면에서 왜 멈추었나요?
   ```

3. 길이와 물음표 개수 검사는 통과한다.
4. 하지만 뒤에서 정규화된 값이 아닌 원본 `question`에 `/[\n•]/` 검사를 실행한다.
5. 원본에 `\n`이 있다는 이유만으로 `GeminiQuestionServiceError`를 던진다.
6. 정상적으로 사용할 수 있던 질문이 저장되지 않고 legacy turn 요청이 upstream error로 실패한다.

### 현재 검사의 의도와 변경 규칙

현재 `/[\n•]/` 검사의 의도는 여러 줄 목록이나 다중 질문을 차단하는 것이다. 다만 `\n`은 목록이 아닌 단순 응답 포맷에도 들어갈 수 있으므로 다음처럼 구분한다.

- `\n`, `\r`, tab, 연속 공백: 하나의 공백으로 정규화하고 허용
- `•` 불릿: 목록 신호로 계속 거부
- `?` 또는 `？`가 두 개 이상: 복수 질문으로 계속 거부
- 정규화 후 길이 및 forbidden product language 검사: 계속 적용

줄바꿈을 허용한다는 것은 UI에 여러 줄로 그대로 출력한다는 뜻이 아니다. 반환·저장하는 질문은 기존처럼 공백을 정규화한 단일 문자열이다.

### 근거

- `apps/web/src/server/services/gemini-question-service.ts`
  - `ensureSafeSingleQuestion()`이 원본 질문의 모든 whitespace를 먼저 정규화한다.
  - 길이, 물음표 개수, forbidden language는 정규화된 문자열을 기준으로 검사한다.
  - 개행·불릿만 원본 `question`을 검사해 무해한 줄바꿈도 거부한다.
- `docs/PRD.md`, `docs/HARNESS.md`, `docs/SUPABASE_SCHEMA.md`
  - 제품 규칙은 질문을 한 번에 하나만 생성·표시하는 것이다.
  - 줄바꿈 문자 자체를 오류로 보도록 요구하지는 않는다.

### 수정 방향

1. `\n`을 이유로 예외를 던지는 검사를 제거한다.
   - 최소 변경은 `/[\n•]/.test(question)`을 `/•/u.test(question)` 또는 `/•/u.test(trimmed)`로 바꾸는 것이다.
   - `question.replace(/\s+/gu, " ").trim()` 정규화는 유지한다.
2. 불릿 목록은 기존처럼 거부한다.
3. 복수 물음표, 길이, forbidden product language 방어를 유지한다.
4. 예외 message는 실제 거부 조건에 맞게 목록 금지 의미로 조정한다.
5. canonical acting-api client·response guard와 현재 `acting-api-v1` session 흐름은 변경하지 않는다.

### 검증 기준

- 정상 단일 질문의 앞·뒤 줄바꿈이 제거되고 질문이 성공한다.
- 문장 중간의 줄바꿈도 공백으로 정규화되어 저장·표시된다.
- 불릿 `•`가 포함된 질문은 계속 거부된다.
- 물음표가 두 개 이상인 질문은 계속 거부된다.
- 정규화 후 질문의 길이 및 forbidden language 검사가 유지된다.
- acting-api canonical 흐름의 질문·reply·report 처리에는 변경이 없다.

### 필요한 회귀 테스트

1. `"\n그 장면에서 왜 멈추었나요?\n"`가 `"그 장면에서 왜 멈추었나요?"`로 정규화되는지 검증한다.
2. 문장 중간 `\n`, `\r\n`, tab, 연속 공백이 하나의 공백으로 정규화되는지 검증한다.
3. `•` 불릿 포함 질문과 물음표 2개 이상 질문이 계속 `GeminiQuestionServiceError`를 발생시키는지 검증한다.
4. forbidden product language와 8~220자 길이 경계 테스트가 그대로 통과한다.

---

## 12. 미사용 legacy API client `practice.ts` 삭제

### 결정

**반영 예정 (Low)**

`apps/web/src/lib/api/practice.ts`를 삭제하고 현재 웹 UI의 practice API client를 `apps/web/src/lib/api/sessions.ts`로 단일화한다. 새 abstraction이나 중복 wrapper를 추가하지 않고, 사용처가 없으며 계약이 깨진 모듈을 제거한다.

### 현재 상태

- `apps/web` 전체에서 `@/lib/api/practice` import는 0건이다.
- 실제 practice UI는 `@/lib/api/sessions`를 사용한다.
- 두 모듈은 같은 `/api/v1/practice-sessions*` endpoint에 대한 fetch wrapper를 중복한다.
- `practice.ts`의 일부 mutation은 현재 endpoint가 수용하지 않는 legacy request DTO를 전송한다.
- 현재 import가 없으므로 지금 사용자 흐름에서 발생하는 runtime 장애는 아니다.

### 문제 시나리오

#### 세션 생성 함수 재사용

1. 개발자가 함수 이름만 보고 `practice.ts`의 `finalizePracticeSession()`을 auto-import한다.
2. 이 함수는 legacy `CreateSessionRequest`를 canonical `POST /api/v1/practice-sessions`에 전송한다.
3. legacy payload는 `medium`, `genre`, `videoUrl`, `durationMs` 등을 사용하고 `requestId`는 없다.
4. 현재 acting-api-v1 endpoint는 `requestId`, `uploadIntentId`, `situation`, `characterContext`, `subtext`를 요구한다.
5. 서버의 exact-body/UUID validation에서 요청이 400으로 거부된다.

#### turn 함수 재사용

1. 개발자가 `createPracticeSessionTurn()`을 import한다.
2. 함수가 legacy payload `{ actorAnswer }`를 `POST /api/v1/practice-sessions/{sessionId}/turns`에 전송한다.
3. 현재 endpoint는 `operation`, `requestId` 및 operation에 따라 `runId`, `text`, `actorTurnId`를 요구한다.
4. `operation is invalid` validation error로 즉시 400을 반환한다.

### 영향

- 현재 runtime 영향은 없지만 잘못된 auto-import를 유도한다.
- 동일 endpoint에 대한 두 client가 서로 다른 request/response type과 error handling을 제공한다.
- `practice.ts`는 `cache: "no-store"`와 `ApiClientError`를 사용하지 않아 활성 client와 계속 drift한다.
- 사용하지 않는 139줄의 코드와 legacy type 의존성이 유지보수 범위를 불필요하게 넓힌다.

### 근거

- `apps/web/src/lib/api/practice.ts`
  - canonical endpoint path에 legacy `CreateSessionRequest`, `CreateTurnRequest`, `CreateSummaryRequest`를 전송하는 mutation wrapper를 포함한다.
  - 별도 fetch/JSON/error parsing helper를 중복한다.
- `apps/web/src/lib/api/sessions.ts`
  - 현재 UI가 사용하는 acting-api-v1 upload, session, analysis, turn, report client다.
- `apps/web/src/lib/api/types.ts`
  - canonical session 생성·turn operation DTO를 정의한다.
- `apps/web/src/lib/api/legacy-types.ts`
  - `practice.ts`가 전송하는 과거 request/response DTO를 정의한다.
- `apps/web/src/server/services/acting-coach-service.ts`
  - canonical create/turn request field를 검증하고 legacy payload를 거부한다.

### 수정 방향

1. `apps/web/src/lib/api/practice.ts`를 전체 삭제한다.
2. 현재 UI의 import는 `apps/web/src/lib/api/sessions.ts`를 계속 사용한다.
3. `practice.ts`의 함수를 `sessions.ts`로 복사하지 않는다.
   - 현재 사용처가 없으며, legacy mutation을 canonical client에 다시 혼합하지 않는다.
4. `legacy-types.ts`와 legacy-compatible read Route는 별도로 사용처를 확인한 후 판단한다.
   - 이 항목의 기본 범위는 죽은 client 파일 삭제다.
   - 기존 legacy 세션 조회 호환성을 증거 없이 함께 제거하지 않는다.
5. 중복 client가 다시 추가되지 않도록 import/source contract test를 최소 범위로 강화한다.

### 검증 기준

- `apps/web/src/lib/api/practice.ts`가 삭제된다.
- 저장소에 `@/lib/api/practice` 또는 삭제된 export의 import/use가 없다.
- practice UI가 `sessions.ts`를 통해 upload·session·turn·report API를 계속 호출한다.
- canonical request payload에 `requestId`, `operation` 등 필수 field가 유지된다.
- legacy session 조회 및 기존 보존 데이터 호환성은 유지된다.
- typecheck, lint, test, build가 통과한다.

### 필요한 회귀 테스트

1. `rg` 또는 source-contract test로 `lib/api/practice` import가 0건인지 검증한다.
2. practice UI의 API import가 `sessions.ts`를 사용하는지 검증한다.
3. upload intent 생성·finalize, canonical session 생성, turn, report client 계약 테스트를 유지한다.
4. `pnpm typecheck`, `pnpm lint`, `pnpm build`로 삭제된 export의 잔여 import가 없음을 확인한다.

---

## 13. acting-api 호출 전 실패와 호출 후 결과 불명 분리

### 결정

**반영 예정 (High)**

영상 분석 source를 준비하는 단계와 acting-api에 요청을 전달한 이후를 명확히 구분한다. Upstream 요청을 시작하기 전에 발생한 실패는 결과가 불명확하지 않으므로 복구 가능한 definitive failure로 기록하고, 요청 전달 후 응답을 확인하지 못한 경우에만 `outcome_unknown`을 사용한다.

### 문제 시나리오

1. 영상 분석 operation이 DB에 `in_flight`로 생성된다.
2. 서버가 Supabase signed URL을 만들지 못하거나 signed URL의 영상 다운로드에서 오류 응답을 받는다.
3. 이 시점에는 `actingApiClient.summarize()`를 호출하지 않았으므로 acting-api가 분석을 실행했을 가능성이 없다.
4. 현재 `runAnalysisClaim()`은 이 오류를 `ambiguousError("analysis", "acting_api_unavailable")`로 만든다.
5. catch block은 이를 `ambiguous` failure로 저장한다.
6. DB는 operation과 take의 분석 상태를 `outcome_unknown`으로 바꾸고 `analysis_retryable = false`로 기록한다.
7. UI는 같은 영상으로 안전하게 재시도할 수 없다고 안내하고 새 연습을 요구한다.
8. 이후 claim도 기존 `outcome_unknown` operation을 발견해 해당 세션의 정상 재시도를 차단한다.

실제로 upstream side effect가 전혀 발생하지 않은 확정적 실패인데도 결과 불명 상태로 잠기므로, 일시적인 Storage 장애 한 번으로 사용자가 업로드와 연습 세션을 모두 다시 만들어야 한다.

### 올바른 분류 경계

- signed URL 생성 실패, 영상 GET의 비정상 응답 등 `summarize()` 호출 전 실패
  - upstream 실행 여부: 실행되지 않음
  - failure class: definitive
  - recovery: 같은 영상으로 재시도 허용
- acting-api 요청을 전달한 뒤 timeout, 연결 종료, 응답 유실 또는 streaming 중단
  - upstream 실행 여부: 완료 여부를 증명할 수 없음
  - failure class: ambiguous
  - recovery: 기존처럼 `outcome_unknown` 처리
- acting-api가 명시적으로 반환한 4xx 등 확정 응답
  - 기존 status별 definitive 분류를 유지한다.

### 근거

- `apps/web/src/server/services/acting-coach-service.ts`
  - `runAnalysisClaim()`은 admin client 부재, signed URL 생성 실패, 영상 GET 실패를 모두 `ambiguousError()`로 만든다.
  - 이 오류들은 `actingApiClient.summarize()` 호출보다 앞에서 발생한다.
  - catch block은 `isDefinitive(mapped)`가 아니면 모두 `failureClass: "ambiguous"`로 저장한다.
  - 현재 definitive code 목록에는 source 영상 준비 실패를 나타내는 code가 없다.
- `supabase/migrations/011_acting_api_pipeline.sql`
  - `acttub_fail_analysis()`는 ambiguous failure를 operation과 take의 `outcome_unknown`으로 저장한다.
  - ambiguous failure의 `analysis_retryable`을 false로 만들며, 이후 claim은 기존 outcome-unknown operation을 replay한다.
- `apps/web/src/features/practice/practice-flow.tsx`
  - `analysisStatus === "outcome_unknown"`이면 안전한 재시도가 불가능하다고 안내하고 retry button을 제공하지 않는다.

### 수정 방향

1. 영상 source 준비 단계와 acting-api dispatch 단계를 코드 구조상 분리한다.
2. signed URL 생성 실패와 영상 GET 비정상 응답에는 `source_video_unavailable` 같은 안정적인 별도 오류 코드를 사용한다.
3. 위 오류는 `definitive`이면서 같은 영상으로 재시도 가능한 분석 실패로 저장한다.
4. `acttub_fail_analysis()`의 retryability 규칙과 API error contract에 새 source 오류 코드를 반영한다.
5. retry endpoint가 기존 Storage 객체를 사용해 새 operation/request ID로 정상 재시도하도록 유지한다.
6. `actingApiClient.summarize()`를 시작한 뒤 발생한 timeout, network error, response parsing 실패 및 request body streaming 오류는 기존처럼 ambiguous로 처리한다.
7. 성공 분석과 acting-api의 명시적 4xx 분류는 변경하지 않는다.
8. 향후 Spring Boot 이전에서도 "upstream dispatch 전에는 definitive, dispatch 후 완료 여부를 모르면 ambiguous"라는 경계를 보존한다.

### 검증 기준

- signed URL 생성이 실패하면 `summarize()`가 호출되지 않는다.
- 위 실패는 operation `failed`, take `analysis_status = 'failed'`, `analysis_retryable = true`로 기록된다.
- Storage 영상 GET이 4xx/5xx를 반환해도 같은 영상의 분석 재시도가 허용된다.
- 재시도는 새 operation/request ID를 사용하며 성공하면 기존 세션이 정상적으로 `INTERVIEW`로 전환된다.
- acting-api 요청 후 timeout이나 응답 유실은 계속 `outcome_unknown`으로 기록된다.
- request body를 전송하는 중 source stream이 실패한 경우도 dispatch 이후이므로 `outcome_unknown`으로 유지된다.
- 정상 분석 및 기존 확정 오류 응답 처리는 회귀하지 않는다.

### 필요한 회귀 테스트

1. signed URL 생성 실패 시 `summarize()` 미호출과 definitive/retryable persistence를 검증한다.
2. Storage GET의 403, 404, 5xx 응답별로 같은 영상 재시도 가능 상태가 되는지 검증한다.
3. source 준비 실패 후 retry claim이 새 operation을 만들고 성공 완료되는지 검증한다.
4. summarize dispatch 후 timeout과 network/stream 오류는 ambiguous outcome으로 남는지 검증한다.
5. 정상 분석, acting-api 400/401/413/429 응답의 기존 분류를 함께 회귀 테스트한다.

---

## 14. FastAPI 422 validation 응답을 definitive rejection으로 처리

### 결정

**반영 예정 (High)**

FastAPI가 request schema validation 실패를 명시적으로 반환한 `422`는 upstream 결과가 불명확한 오류가 아니다. Handler의 정상 처리에 진입하지 못한 확정적 계약 불일치이므로 `acting_api_contract_mismatch`로 저장하고, `outcome_unknown`은 응답 자체를 확인하지 못한 경우에만 사용한다. 동일 payload의 즉시 자동 재시도는 하지 않지만 배포 정합성 복구 후 새 request ID로 안전하게 재시도할 수 있어야 한다.

### 문제 시나리오

1. 플랫폼과 acting-api 사이에 DTO schema drift가 생기거나 일부 서비스만 새 버전으로 배포된다.
2. 플랫폼이 `/summarize`, `/coach/start`, `/coach/reply` 또는 `/report`에 현재 upstream schema와 맞지 않는 body를 보낸다.
3. FastAPI가 request validation 단계에서 `422`를 반환한다.
4. 현재 `parseUpstreamResponse()`는 `400`과 `413`만 definitive rejection으로 분류한다.
5. `422`는 일반 non-2xx 분기로 내려가 `ambiguousError()`가 된다.
6. 분석 take, interview run, actor turn 또는 report operation이 `outcome_unknown`으로 저장된다.
7. 사용자는 upstream handler가 실행되지 않은 요청을 안전하게 재시도할 수 없다는 안내를 받고 세션 복구가 차단된다.

플랫폼 자체 runtime preflight도 빈 `/coach/start` 요청에 `422`가 와야 인증과 route가 정상이라고 판단한다. 즉, 이 저장소가 이미 `422`를 FastAPI validation 계약으로 사용하면서 실제 operation 처리에서만 결과 불명으로 오분류하고 있다.

### 근거

- `apps/web/src/server/services/acting-coach-service.ts`
  - `parseUpstreamResponse()`는 `400`/`413`을 `acting_api_rejected`로 처리하지만 `422`는 `acting_api_unavailable` 원인의 ambiguous error로 처리한다.
  - definitive code와 phase별 retry policy에 `422` 전용 계약 불일치 code가 없다.
- `apps/web/scripts/check-acting-runtime.mjs`
  - 인증 preflight가 빈 `/coach/start` 요청의 기대 응답을 HTTP `422`로 명시한다.
- `supabase/migrations/011_acting_api_pipeline.sql`
  - ambiguous failure는 operation과 관련 take/run/turn을 `outcome_unknown`으로 봉인한다.
  - 현재 analysis/coach retryability와 report 재claim 규칙은 auth/rate-limit만 복구 대상으로 취급하므로 단순히 `acting_api_rejected`로 바꾸면 배포 수정 후에도 세션을 복구할 수 없다.

### 수정 방향

1. `parseUpstreamResponse()`에서 HTTP `422`를 definitive `acting_api_contract_mismatch`로 분류한다.
2. public error는 일반화된 message를 사용하고 upstream validation body를 그대로 노출하지 않는다.
3. `404`의 operation별 처리, `401`, `413`, `429`의 기존 분류는 유지한다.
4. `5xx`, timeout, 연결 종료, dispatch 후 응답 유실은 계속 ambiguous로 처리한다.
5. 새 DB status나 failure class는 추가하지 않고 기존 definitive transition을 재사용한다. 후속 migration에서 `acting_api_contract_mismatch`를 analysis/coach/report의 안전한 재claim 허용 code에 추가한다.
6. 동일 request ID는 최초 422 failure를 stable replay하고 upstream을 다시 호출하지 않는다. 계약이 수정된 뒤 사용자가 명시적으로 재시도하면 새 request ID로 새 operation을 claim한다.
7. upstream contract test로 네 endpoint의 request validation `422`가 handler side effect 이전에 발생한다는 전제를 고정한다. 이 전제가 깨지는 custom `422`는 같은 code로 사용하지 않는다.
8. 향후 Spring Boot client도 FastAPI `422`의 definitive/새-request recovery 규칙을 보존한다.

### 검증 기준

- analysis, coach start/restart, reply, report에서 `422`가 `acting_api_contract_mismatch`로 반환된다.
- 관련 operation은 `failed`이고 `outcome_unknown`이 아니다.
- take, run, actor turn도 phase별 definitive failure 상태를 가지며 결과 불명 상태로 전환되지 않는다.
- 같은 request ID replay는 최초의 stable rejection을 다시 반환하고 upstream을 재호출하지 않는다.
- 계약 수정 후 새 request ID를 사용한 analysis retry, coach start/retry_reply, report 생성은 새 operation을 claim할 수 있다.
- `500`, timeout, dispatch 후 network failure는 계속 ambiguous outcome으로 남는다.
- runtime authentication preflight의 `422` 기대값은 그대로 동작한다.

### 필요한 회귀 테스트

1. 네 operation phase의 fake upstream `422` 응답이 `failureClass: "definitive"`, `safeErrorCode: "acting_api_contract_mismatch"`로 저장되는지 검증한다.
2. DB transition 후 take/run/turn/report operation 어디에도 `outcome_unknown`이 남지 않는지 검증한다.
3. 동일 request ID replay에서 upstream call count가 증가하지 않는지 검증한다.
4. 새 request ID recovery가 네 phase에서 허용되는지 검증한다.
5. `400`/`401`/`413`/`429` 대조군과 `500`/timeout ambiguous 대조군을 함께 검증한다.
6. upstream request validation `422`가 handler side effect 전에 발생한다는 contract test를 추가한다.

---

## 15. QuickTime 분석 relay의 filename과 MIME 일치

### 결정

**반영 예정 (High)**

제품이 허용하는 `video/quicktime` 업로드는 upstream multipart에서도 `.mov` filename으로 전달한다. 브라우저가 제출한 원본 이름은 신뢰하지 않고, finalize에서 검증되어 DB에 저장된 canonical Storage path와 MIME type의 조합으로 relay metadata를 결정한다.

### 문제 시나리오

1. 사용자가 iPhone 등에서 생성한 `video/quicktime` 영상을 업로드한다.
2. upload intent와 Storage object는 `take.mov` 경로를 사용한다.
3. analysis claim source에는 `storagePath`와 `mimeType`은 있지만 별도 `fileName`이 없다.
4. `runAnalysisClaim()`은 `source.fileName`이 없으면 무조건 `take.mp4`를 사용한다.
5. multipart part는 `filename="take.mp4"`, `Content-Type: video/quicktime`이라는 상충하는 metadata를 가진다.
6. upstream의 확장자 기반 임시 파일/MIME 판정은 QuickTime bytes를 MP4로 오인할 수 있다.
7. 지원한다고 명시한 MOV 영상이 분석 실패하거나 잘못된 MIME으로 외부 모델에 전달된다.

이 동작은 initial analysis와 같은 source를 재사용하는 retry analysis 모두에 적용된다. 모든 MOV가 반드시 실패한다고 단정할 수는 없지만, 허용 형식의 metadata를 항상 잘못 전달하는 것은 확정적인 계약 위반이다.

### 근거

- `apps/web/src/server/services/coach-session-service.ts`
  - `video/mp4`와 `video/quicktime`을 모두 허용한다.
  - MIME에 따라 canonical object path를 `take.mp4` 또는 `take.mov`로 만든다.
- `supabase/migrations/013_scene_context_only.sql`
  - initial/retry analysis source에 `storagePath`와 `mimeType`은 포함하지만 `fileName`은 포함하지 않는다.
- `apps/web/src/server/services/acting-coach-service.ts`
  - analysis relay가 `source.fileName ?? "take.mp4"`를 사용하므로 현재 claim에서는 항상 MP4 fallback이 선택된다.
- `apps/web/src/server/acting-api/multipart.ts`
  - 전달받은 fileName을 multipart `Content-Disposition`의 filename에 그대로 넣는다.
- `docs/API.md`
  - acting-api 영상 처리 계약에서 파일 확장자가 처리 metadata로 사용됨을 전제한다.

### 수정 방향

1. 신뢰된 `source.storagePath`의 basename에서 `take.mp4` 또는 `take.mov`를 도출한다.
2. `video/mp4 ↔ take.mp4`, `video/quicktime ↔ take.mov` 조합만 허용한다.
3. DB source의 path/MIME 조합이 불일치하거나 허용 이름이 아니면 upstream dispatch 전에 `source_video_metadata_invalid` 같은 안정적인 오류 코드로 fail-closed 한다.
4. 위 metadata 무결성 오류는 definitive지만 같은 source를 다시 읽어도 회복되지 않으므로 non-retryable로 저장한다. item 13의 일시적인 `source_video_unavailable` retry 정책과 구분한다.
5. 브라우저가 보낸 원본 filename을 relay 기준으로 다시 도입하지 않는다.
6. initial/retry claim payload schema나 DB migration은 불필요하다. 이미 포함된 canonical `storagePath`와 `mimeType`을 사용한다.

### 검증 기준

- QuickTime initial analysis가 `fileName: "take.mov"`, `mimeType: "video/quicktime"`을 사용한다.
- QuickTime retry analysis도 동일한 metadata를 사용한다.
- MP4는 계속 `take.mp4`, `video/mp4`로 전달된다.
- multipart header의 filename과 Content-Type이 실제 조합과 일치한다.
- path/MIME이 불일치하면 summarize를 호출하지 않고 definitive/non-retryable source 오류로 종료한다.
- MP4와 MOV의 정상 업로드·finalize·분석 흐름이 모두 유지된다.

### 필요한 회귀 테스트

1. initial/retry MOV claim이 summarize client에 `take.mov`를 전달하는지 검증한다.
2. multipart body에 `filename="take.mov"`와 `Content-Type: video/quicktime`이 함께 있는지 검증한다.
3. MP4 대조 테스트를 추가한다.
4. `.mov + video/mp4`, `.mp4 + video/quicktime`, 허용되지 않은 basename을 upstream 호출 전에 거부하는지 검증한다.

---

## 16. scene context와 actor reply의 입력 크기 제한

### 결정

**반영 예정 (High)**

인증 여부와 무관하게 AI prompt, operation fingerprint, DB text에 들어가는 사용자 입력에는 서버가 소유하는 명시적 상한이 있어야 한다. 값을 조용히 자르지 않고 operation claim 이전에 안정적인 validation error로 거부한다.

이번 계약의 초기 상한은 다음과 같이 고정한다.

- 정규화된 `situation`: 최대 2,000 Unicode code point
- 정규화된 `characterContext`: 최대 2,000 Unicode code point
- 정규화된 `subtext`: 최대 2,000 Unicode code point
- 위 세 scene context의 합계: 최대 4,000 Unicode code point
- trim한 신규 actor `reply.text`: 최대 2,000 Unicode code point
- practice JSON mutation body: 최대 64 KiB

### 문제 시나리오

1. 인증된 사용자가 scene context 또는 actor reply에 수 MB의 문자열을 전송한다.
2. 현재 validator는 문자열이 비어 있지 않은지만 확인한다.
3. 서버는 전체 값을 JSON parsing, whitespace normalization, request fingerprint hashing에 사용한다.
4. scene context는 session row에 저장되고 `/summarize`와 `/coach/start` payload로 반복 전달된다.
5. actor reply는 upstream 호출 전에 turn row에 저장되고 `/coach/reply`, 이후 report payload에도 포함된다.
6. 공격자는 반복 요청으로 DB 크기, 서버 memory/CPU, upstream token 비용과 응답 지연을 증폭시킬 수 있다.
7. upstream이 oversized payload를 거부하면 이미 operation/turn을 만든 뒤 failure reconciliation까지 수행해야 한다.

Hosting platform의 일반 body 제한은 제품 prompt 예산과 동일하지 않으며 배포 환경에 따라 달라질 수 있으므로, 이를 입력 계약 대신 사용할 수 없다.

### 근거

- `apps/web/src/server/services/acting-coach-service.ts`
  - `normalizeContext()`와 `normalizeReply()`는 non-empty 여부만 검사하고 최대 길이를 제한하지 않는다.
  - scene context와 reply를 operation fingerprint 및 upstream payload에 사용한다.
- `apps/web/src/app/api/v1/practice-*` mutation Route
  - create/turn뿐 아니라 start/retry/restart/report 등도 공통 body byte 상한 없이 `request.json()`으로 전체 body를 읽는다.
- `apps/web/src/features/practice/practice-flow.tsx`
  - scene textarea와 reply textarea에 길이 제한이나 글자 수 안내가 없다.
- `apps/web/src/lib/api/openapi.json`
  - 관련 문자열에 최소 길이는 있지만 `maxLength`가 없다.
- `supabase/migrations/011_acting_api_pipeline.sql`, `supabase/migrations/013_scene_context_only.sql`
  - RPC가 scene context와 actor text를 길이 제한 없이 저장한다.

### 수정 방향

1. app 내부의 단일 contract constant에서 위 field/aggregate 상한을 정의해 server validator, UI, OpenAPI 생성 근거가 같은 값을 사용하게 한다.
2. Unicode code point 기준으로 정규화 후 길이를 계산한다. TypeScript의 UTF-16 code unit 수에만 의존하지 않는다.
3. scene context는 whitespace 정규화 후 field별 상한과 합계 상한을 검사한다.
4. 신규 reply는 trim 후 상한을 검사하되 내부 개행은 보존한다.
5. 초과 입력을 자르지 않고 `400 validation_error`와 field별 오류로 반환한다.
6. 모든 practice JSON mutation Route는 body를 64 KiB까지만 읽는 bounded JSON parser를 사용하고 초과 시 `413 payload_too_large`를 반환한다. `Content-Length` header만 신뢰하지 않고 실제 읽은 byte 수를 제한한다.
7. 64 KiB는 최대 4,000 code point scene context가 JSON escape를 사용하더라도 정상 계약이 body cap에 먼저 걸리지 않도록 잡는다.
8. UI는 native HTML `maxLength`에만 의존하지 않고 동일한 code-point helper로 입력과 counter를 제어한다. 서버를 최종 보안 경계로 유지한다.
9. 배포는 application/RPC validation 추가, 기존 acting-api 및 legacy row 감사·필요한 remediation, 조건부 table constraint 적용 순서로 진행한다. 기존 migration은 수정하지 않는다.
10. 후속 migration에서 acting-api-v1 session context와 actor-role turn에 DB/RPC 제한을 추가하고 security-definer RPC의 직접 호출도 같은 상한을 지키게 한다.
11. OpenAPI에 `maxLength`와 body 초과 오류 계약을 반영한다.
12. `retry_reply`는 상한 안에서 저장된 기존 text를 그대로 재사용하며 새 text로 교체하지 않는다. 기존 oversized row가 있으면 constraint 배포 전에 별도 remediation한다.

### 검증 기준

- 각 field의 정확한 상한값은 성공하고 상한+1은 operation claim 전에 `400`으로 거부된다.
- scene context 합계가 4,000을 넘으면 개별 field가 상한 이하여도 거부된다.
- 64 KiB를 넘는 body는 JSON 전체를 메모리에 적재하지 않고 `413`으로 종료된다.
- 최대 Unicode field/aggregate 계약을 만족하는 정상 JSON은 escape 방식과 무관하게 body cap에 걸리지 않는다.
- oversized create는 session/operation을 만들거나 summarize를 호출하지 않는다.
- oversized reply는 actor turn/operation을 만들거나 coach reply를 호출하지 않는다.
- 한글과 emoji를 포함해 TypeScript, DB, OpenAPI가 같은 Unicode 문자 수 의미를 사용한다.
- 기존 정상 scene 입력, 줄바꿈을 포함한 정상 reply와 retry_reply가 유지된다.

### 필요한 회귀 테스트

1. scene field별 2,000/2,001, 합계 4,000/4,001 경계 테스트를 추가한다.
2. reply 2,000/2,001 경계와 trim 전후 경계를 검증한다.
3. 한글, 조합 문자, surrogate pair emoji의 code-point 계산을 검증한다.
4. oversize 요청에서 repository와 upstream mock이 호출되지 않는지 검증한다.
5. 실제 byte를 제한하는 bounded JSON parser의 chunked body, escaped astral code point, 허위/누락 `Content-Length`를 검증한다.
6. start/retry/restart/report를 포함한 모든 practice JSON mutation Route가 bounded parser를 사용하는지 source contract로 검증한다.
7. 기존 acting-api/legacy oversized row audit와 remediation 후 conditional constraint/RPC validation을 적용할 수 있는지 검증한다.

---

## 17. 세션 목록을 cursor pagination과 경량 DTO로 분리

### 결정

**반영 예정 (Medium)**

세션 목록은 카드에 필요한 경량 projection만 keyset pagination으로 반환하고, turns·scene summary·report·run history를 포함한 전체 session DTO는 사용자가 해당 세션을 열 때 detail endpoint에서 조회한다.

초기 list 계약은 다음과 같이 고정한다.

- `GET /api/v1/practice-sessions?limit=20&cursor=...`
- 기본 page size: 20
- 최대 page size: 50
- 정렬과 cursor key: `(created_at DESC, id DESC)`; 첫 page의 server `snapshotAt`을 이후 cursor에 보존
- 응답: `{ sessions: PracticeSessionListItemDto[], nextCursor: string | null }`

### 문제 시나리오

1. 사용자가 연습 기록을 계속 쌓는다.
2. practice 화면에 진입할 때마다 list endpoint가 visible session 전체를 조회한다.
3. 첫 query는 모든 session과 legacy child relation을 `select(*)`로 hydrate한다.
4. acting-api session이 하나라도 있으면 두 번째 query로 해당 session들의 take, scene summary, 모든 run, 모든 turn, report를 다시 hydrate한다.
5. current run/turn 선별도 SQL이 아니라 전체 결과를 받은 뒤 JavaScript에서 수행한다.
6. 홈 카드는 일부 제목·요약·상태·길이만 사용하지만 전체 transcript와 report JSON이 DB, 서버, 브라우저를 통과한다.
7. 기록이 늘면 PostgREST row/response 제한, server serialization, network payload와 browser memory 때문에 목록 전체가 느려지거나 실패한다.

### 근거

- `apps/web/src/app/api/v1/practice-sessions/route.ts`
  - GET query parameter를 받지 않고 전체 목록을 반환한다.
- `apps/web/src/server/services/coach-session-service.ts`
  - `listSessions()`가 limit/cursor 없이 repository 전체 목록을 요청한다.
- `apps/web/src/server/repositories/supabase-coach-session-repository.ts`
  - `listOwnedSessions()`에 `.limit()`/`.range()`가 없다.
  - `legacySessionSelect`와 `actingSessionSelect`가 `*` 및 모든 nested relation을 선택한다.
  - acting row를 별도 full-hydration query로 다시 읽고 current run/turn을 application에서 필터링한다.
- `apps/web/src/features/practice/practice-flow.tsx`
  - 화면 진입 시 전체 목록을 가져오지만 카드에는 제한된 field만 사용한다.
  - 카드 선택 시 list item 자체를 full active session으로 사용한다.
- `apps/web/src/lib/api/openapi.json`
  - 현재 list response item을 full session DTO로 정의하고 pagination contract가 없다.

### 수정 방향

1. `PracticeSessionListItemDto`를 별도로 정의한다.
   - `id`: UUID string
   - `pipelineVersion`: `"acting-api-v1" | "legacy-gemini-v1"`
   - `legacy`: boolean
   - `status`: `ActingSessionStatus | LegacySessionStatus`
   - `title`: 1~120 Unicode code point
   - `preview`: 최대 240 Unicode code point 또는 `null`
   - `durationMs`: 1~180000 정수 또는 `null`
   - `analysisStatus`: `ActingAnalysisStatus | "generated" | null`
   - `createdAt`, `updatedAt`: ISO timestamp string
   - turns array, 전체 scene summary/report JSON, run history, private field는 포함하지 않는다.
   - legacy 저장 text도 SQL projection 단계에서 code-point 기준으로 잘라 list item 하나의 크기를 제한한다. 전체 원문은 detail endpoint에서만 읽는다.
2. list Route가 `limit`과 opaque cursor를 엄격하게 검증한다. 잘못된 cursor/limit은 `400 validation_error`로 반환한다.
3. `(created_at, id)` keyset pagination으로 `limit + 1`개를 읽어 `nextCursor`를 계산한다. 첫 요청의 server 시각을 `snapshotAt`으로 cursor에 포함하고 이후 page는 `created_at <= snapshotAt` 범위만 읽는다. offset pagination은 사용하지 않는다.
4. owner와 `hidden_at is null` 조건을 DB query/RPC 안에서 유지한다.
5. legacy와 acting-api session을 같은 정렬 기준의 경량 projection으로 반환하는 전용 query/RPC를 추가한다. `select *`와 nested full hydration을 제거한다. Security-definer RPC를 사용하면 고정 `search_path`, 명시적 owner filter와 service-role-only execute grant를 적용한다.
6. 후속 migration에 `(user_id, created_at desc, id desc)` 기반 visible-list index를 추가한다.
7. UI는 첫 20개를 표시하고 명시적인 더 보기 또는 무한 스크롤로 다음 cursor를 요청한다.
8. 카드 선택 시 `GET /api/v1/practice-sessions/{sessionId}`로 full detail을 가져온 뒤 session 화면을 연다.
9. OpenAPI와 Spring Boot 이전 계약에 list/detail DTO 분리를 반영한다.
10. 브라우저의 이전 bundle도 compatibility consumer로 취급한다. 이미 배포된 bundle이 있으면 `view=summary` 같은 additive projection을 먼저 배포하고, summary-aware first-party client 전환과 구버전 관찰 기간이 끝난 뒤 이를 기본 list 계약으로 고정하고 full-list 동작을 폐기한다. 미배포 feature branch라면 merge 전에 바로 clean list DTO로 고정한다.

### 검증 기준

- query parameter가 없으면 최대 20개의 경량 item과 `nextCursor`를 반환한다.
- `limit`은 1~50만 허용한다.
- 같은 `createdAt`을 가진 session이 page 경계에 있어도 중복/누락되지 않는다.
- hidden session과 다른 사용자의 session은 어떤 page에도 나타나지 않는다.
- list query/response에는 turns, 전체 scene summary, report, run history가 없다.
- title/preview가 각각 120/240 code point를 넘지 않아 legacy 원문 크기와 무관하게 item 크기가 제한된다.
- legacy와 acting-api session이 하나의 안정적인 시간순 목록에 함께 나타난다.
- 카드를 열 때 detail endpoint를 별도로 호출하며 기존 full session 화면과 mutation response는 유지된다.
- session 수와 transcript 길이가 늘어도 한 page의 DB read와 JSON 크기가 상한 안에 머문다.

### 필요한 회귀 테스트

1. default/max/invalid limit과 malformed cursor validation을 검증한다.
2. 동일 timestamp와 21개 이상 session에서 중복/누락이 없는지 검증한다. page 1 이후 생성된 새 session은 현재 cursor chain에 섞이지 않고 새로고침 후 첫 page에서 보이는 snapshot semantics를 검증한다.
3. owner isolation, hidden filter, legacy/acting 혼합 정렬을 검증한다.
4. repository source/SQL contract에서 `practice_turns(*)`, `scene_summaries(*)`, `practice_reports(*)`를 list query가 사용하지 않는지 검증한다.
5. security-definer list RPC의 고정 search path, owner isolation, service-role-only execute grant를 검증한다.
6. 120/240 code-point를 넘는 legacy title/preview source가 list projection에서 안전하게 제한되는지 검증한다.
7. list card click이 detail API를 호출하고 전체 session을 정상 표시하는 UI test를 추가한다.
8. 구버전 full-list client와 새 summary client의 additive rollout 또는 미배포 direct cutover 경로를 검증한다.
9. OpenAPI client/response와 Spring Boot migration 문서의 pagination 계약 정합성을 검증한다.

---

## 18. Spring Boot 이전 문서를 acting-api-v1 계약으로 재작성

### 결정

**반영 예정 (Medium)**

`docs/SPRING_BOOT_MIGRATION.md`는 향후 `apps/api` 구현의 계약 문서이므로 현재 acting-api-v1 public REST/DTO/state machine을 canonical로 설명해야 한다. 미사용 client 삭제인 item 12와 별개로 문서 전체의 legacy Gemini 중심 내용을 재작성한다.

### 현재 문서의 잘못된 계약

1. upload finalize 후 DB status가 `created`로 남고 session 생성 시 `finalized`가 된다고 설명한다.
   - 현재 canonical RPC는 finalize 요청에서 즉시 `finalized`로 전환한다.
2. session 생성이 one-time Gemini question seed 생성을 시작한다고 설명한다.
   - 현재는 acting-api `/summarize` 영상 분석을 시작한다.
3. observation PATCH, `/result`, 5~10 answer dialogue와 actor-authored final sentence를 stable REST 흐름으로 제시한다.
   - 이 흐름은 legacy compatibility이며 acting-api-v1 session에는 사용할 수 없다.
4. active `/analysis`, operation-discriminated `/turns`, GET/POST `/report` 계약이 빠져 있다.
5. session status를 `observations_pending`, `questioning`, `completed` 중심으로 설명한다.
   - acting-api-v1은 `ANALYZING -> INTERVIEW -> REPORT -> END`와 별도 run/operation 상태를 사용한다.
6. migration 001/003과 observation/question/result invariant를 이전의 중심으로 삼는다.
   - acting-api persistence와 state transition은 migration 011 이후, scene context contract는 migration 013에서 정의된다.

이 문서를 그대로 구현하면 Spring Boot API가 현재 `sessions.ts` client가 보내는 DTO를 거부하고, 웹이 요구하는 analysis/retry/restart/report 흐름을 제공하지 못한다. 현재 `apps/api`가 비어 있어 runtime 장애는 아직 없지만, 이전이 시작되는 순간 잘못된 백엔드를 만드는 직접적인 구현 위험이다.

### 근거

- `docs/SPRING_BOOT_MIGRATION.md`
  - Stable REST Surface, DTO, Service Invariants, Migration Sequence가 legacy Gemini observation/question/result 흐름을 canonical처럼 설명한다.
- `apps/web/src/lib/api/sessions.ts`, `apps/web/src/lib/api/types.ts`
  - 현재 first-party client의 upload, analysis retry, turn operation, report DTO를 정의한다.
- `apps/web/src/lib/api/openapi.json`
  - current `/api/v1` public contract와 deprecated compatibility route를 구분한다.
- `apps/web/src/server/acting-api/client.ts`
  - canonical upstream 호출은 `/summarize`, `/coach/start`, `/coach/reply`, `/report`다.
- `supabase/migrations/011_acting_api_pipeline.sql`, `supabase/migrations/013_scene_context_only.sql`
  - acting-api-v1 state, operation lease/idempotency, persistence와 scene context를 정의한다.

### 수정 방향

1. 기존 문서를 부분적으로 덧대지 않고 acting-api-v1을 기준으로 핵심 section을 재작성한다.
2. canonical source 우선순위를 명시한다.
   - public HTTP/DTO: `apps/web/src/lib/api/openapi.json`
   - first-party client behavior: `apps/web/src/lib/api/sessions.ts`, `types.ts`
   - DB transition: ordered `supabase/migrations/*`, 특히 011 이후 후속 migration
   - upstream protocol: `apps/web/src/server/acting-api/client.ts`와 `docs/API.md`
3. Stable REST Surface에 auth session, terms acceptance, upload intent create/finalize, session create/list/detail, analysis retry, turn `start|reply|retry_reply|restart`, report GET/POST, canonical `PATCH .../visibility`, `GET .../signed-video-url` 계약을 정확히 기록한다.
4. acting-api-v1 DTO와 `ANALYZING -> INTERVIEW -> REPORT -> END`, operation lease/idempotency/outcome-unknown 규칙을 기록한다.
5. observation/result/summary/metrics, `POST .../hide`, `GET .../video-url`, `/api/v1/sessions/*`는 명시적인 deprecated legacy compatibility appendix로 이동한다.
6. migration 번호 일부만 고정하지 말고 모든 ordered migration을 적용하며 Spring이 보존할 최종 invariant를 설명한다.
7. 현재도 맞는 server-only credential, owner check, private Storage signing, upload limit/TUS hardening 내용은 보존한다.
8. item 1~17에서 결정한 최종 API/DB invariant도 구현 완료 후 문서에 반영한다.
9. 문서와 OpenAPI/client의 active path, status, turn operation, deprecated marker가 어긋나면 실패하는 docs-alignment test를 추가한다.

### 검증 기준

- Spring 문서의 active endpoint가 OpenAPI와 일치한다.
- session create/finalize 순서와 status 전이가 현재 RPC와 일치한다.
- turn request가 `start|reply|retry_reply|restart` discriminator와 request ID 규칙을 설명한다.
- analysis retry와 report GET/POST가 빠짐없이 포함된다.
- legacy observation/result 흐름은 canonical section에 나타나지 않고 deprecated appendix에만 있다.
- ordered migration 적용과 service-role/RPC ownership 경계가 정확히 설명된다.
- 문서만 따라 만든 Spring controller/DTO가 현재 first-party client와 호환된다.

### 필요한 회귀 테스트

1. 문서의 active public route 목록과 OpenAPI non-deprecated route 목록을 비교한다. auth/terms와 practice/upload route를 모두 포함한다.
2. canonical status와 turn operation 문자열이 docs, OpenAPI, TypeScript type에 모두 존재하는지 검증한다.
3. deprecated legacy route가 canonical table에 다시 들어오지 않는지 검증한다.
4. upload limit, credential secrecy, owner check 등 보존해야 할 올바른 문서 조각도 계속 존재하는지 검증한다.

---

## 검토했지만 이번 변경에 포함하지 않는 항목

### 공유 `ACTING_API_KEY`의 rate-limit bucket

- 결정: **반영하지 않음**
- 이유: 해당 key는 바로 다음 버전에서 제거하기로 했으므로 이번 PR에 별도 사용자별 rate-limit 구조를 추가하지 않는다.
- 재검토 조건: key 제거 일정이 미뤄지거나 공유 key가 운영 환경에 계속 남는 경우 즉시 다시 연다.

### turns/report Route의 별도 `maxDuration`

- 결정: **반영하지 않음**
- 이유: 두 upstream 요청은 장시간 영상 분석이 아니며 현재 90초 timeout 안에서 끝나는 요청으로 판단했다. 별도 300초 duration 선언은 이번 범위에 추가하지 않는다.
- 재검토 조건: 실제 hosting timeout이 upstream timeout보다 짧거나 lease 만료 전 process 종료가 관측되는 경우 다시 연다.

### 300 MiB와 550 MiB upload limit 불일치

- 결정: **결함 아님**
- 이유: migration 001의 300 MiB 값은 historical baseline이고 ordered migration 011이 upload intent/take constraint와 Storage bucket limit을 550 MiB로 갱신한다.
- 검증 조건: 신규 환경이 모든 migration을 순서대로 적용하는 deployment check는 유지한다.

---

## 구현 권장 순서와 배포 의존성

1. 각 항목의 실패 시나리오를 재현하는 회귀 테스트와 API/DB contract test를 먼저 추가한다.
2. 계정·약관 경계를 먼저 닫는다.
   - item 1의 server-owned profile 생성/RPC를 배포하고 정상 OAuth 가입을 검증한 뒤 browser INSERT/UPDATE policy를 제거한다.
   - item 9의 DB canonical consent source를 먼저 제공한 뒤 env 기반 write와 Storage RLS 의존을 전환한다.
3. 입력 제한은 item 16의 application validator와 bounded parser, RPC validation, 기존 데이터 감사·remediation, table constraint 순서로 적용한다.
4. operation identity와 상태 전이를 정리한다.
   - item 2와 6의 request/resource identity 규칙을 먼저 고정한다.
   - item 8, 13, 14의 404·dispatch boundary·422 taxonomy와 DB recovery policy를 함께 적용한다.
   - item 15의 filename/MIME integrity 오류는 item 13의 transient source 오류와 분리된 뒤 적용한다.
5. item 3의 durable analysis worker 전환과 item 4의 trusted media duration 검증을 연결하고, item 5의 abandoned upload cleanup이 active job/object를 지우지 않게 한다.
6. item 17은 projection RPC/index를 먼저 additive하게 배포하고 summary-aware API/client를 전환한 뒤 기존 full-list 동작을 제거한다.
7. item 7, 10, 11, 12의 proxy/client/legacy 정리는 위 API contract와 회귀 테스트를 유지하면서 독립적으로 적용한다.
8. item 1~17의 최종 OpenAPI와 migration 상태를 검증한 뒤 item 18의 Spring Boot 이전 문서를 마지막에 재작성한다.
9. 전체 구현 후 targeted test, DB migration test, `pnpm lint`, `pnpm build`와 주요 사용자 흐름 smoke test를 통과해야 완료로 표시한다.

---

## 검토 완료 상태

현재까지 확인한 GitHub review comment와 추가 감사 후보의 반영 여부 결정을 모두 완료했다. 총 열여덟 개 항목은 **반영 예정**이며 제품 코드 구현은 아직 시작하지 않았다. 실제 구현 단계에서는 항목 간 의존성과 migration 배포 순서를 먼저 정리한 뒤, 각 항목의 회귀 테스트와 검증 기준을 충족해야 한다.
