# M2 findings — foundation layer

## 결정 1 — 시계 소스 policy matrix

| 층 | 확정 소스 | 경계·주입 |
|---|---|---|
| DB 저장 timestamp | schema의 `server_default=now()`와 갱신 SQL의 transaction `now()` | 한 트랜잭션 안에서 같은 시각을 사용해 `updated_at >= created_at`을 보장한다 |
| 앱 wall clock | 주입된 `java.time.Clock` | JWT `iat`/`exp`, refresh 발급·회전에 사용하며 `exp <= now`를 만료로 판정한다 |
| 경과 시간 | 주입 가능한 monotonic `LongSupplier` (`System.nanoTime`) | rate-limit 고정 window에만 사용해 wall-clock/NTP 역행의 영향을 받지 않는다 |

리스는 원본과 같이 `lease_expires_at < now`일 때만 만료로 본다. DB 저장 시각과 리스 비교 시각은 transaction `now()`로 묶는 방향을 M3 저장소 구현 규칙으로 확정한다. 판별 테스트는 `TimestampPolicyIT.transactionClockNeverMakesUpdatedAtOlderThanCreatedAt`, `JwtServiceTest.expirationBoundaryIsExclusiveAndSkewIsZero`, `FixedWindowRateLimiterTest.spacesAreIndependentAndWindowResets`다.

## 결정 2 — `SKIP LOCKED`를 도입하지 않는다

원본의 정확한 작업 순서와 경합 시맨틱을 우선한다. 가장 오래된 행이 잠겨 있으면 두 번째 worker는 기다린 뒤 조건 재평가에서 0행을 받아 다음 poll로 넘어가며, 두 번째 작업을 앞질러 처리하지 않는다. `SkipLockedDecisionIT.secondWorkerWaitsThenReturnsNoneInsteadOfTakingSecondJob`이 pending 2건과 두 connection으로 이 차이를 판별한다.

## 결정 3 — JSONB canonical 표현은 `JsonNode`

8개 JSONB 컬럼을 전부 Hibernate `@JdbcTypeCode(SqlTypes.JSON)`의 `JsonNode`로 통일한다. object/array 형상을 보존하면서 Java `null`은 SQL NULL, `NullNode`는 JSON `null`로 표현할 수 있고 DTO에서 불필요한 문자열 재파싱을 피한다. `EntityMappingIT.jsonbPreservesFourCases`가 object·array·SQL NULL·JSON `null`을 실제 Postgres 왕복으로 구분한다.

## 이 사이클의 이력

### 허용된 계약 차이 — malformed JSON parser 세부정보

`/SPEC.md` §8-3에 따라 malformed JSON 오류의 `loc[1]` 숫자 offset과 `ctx.error` 문자열은 byte-equivalent 계약에서 제외한다. 두 값은 각각 CPython `json` parser의 byte offset과 parser message를 그대로 노출하므로 Jackson이 동일하게 만들 수 없다. Java는 HTTP 422, `type=json_invalid`, `msg=JSON decode error`, `loc[0]=body`, 빈 object인 `input`을 엄격히 일치시키고, `loc[1]`은 Jackson의 numeric offset, `ctx.error`는 비어 있지 않은 Jackson parser message라는 구조만 보장한다.

### 허용된 계약 차이 — UUID parser 세부정보

`/SPEC.md` §8-3에 따라 `uuid_parsing`의 `type`, 전체 `loc`, `input`, `ctx` 구조는 엄격히 일치시키고, 측정 벡터 `not-a-uuid`의 `msg`와 `ctx.error`도 원본과 일치시킨다. 다만 길이·하이픈 배치 등 다른 malformed UUID에서 `msg`와 `ctx.error`의 parser 문구는 byte-equivalent 계약에서 제외한다. 원본은 Rust `uuid` parser의 오류 문자열을 노출하지만 Java는 Jackson/JDK parser의 오류 문자열만 얻을 수 있어, parser를 재구현하지 않는 한 모든 실패 형태의 문구를 동일하게 만들 수 없다.

### 리뷰에서 기각한 지적 — 원본에도 있는 동작

Phase 5~6 리뷰가 high 로 올렸지만 **원본이 같은 동작을 하므로 기각**했다. 고치면 `/SPEC.md` §3-5·§7 의 "원본 동작 재현"을 어기고 하네스 비교가 깨진다. 지적 내용 자체는 맞으므로, 고칠 값이 있다면 이관 사이클이 아니라 별도 이슈로 다룬다. M1 이 발견한 원본 동작 2가지와 같은 부류다.

1. **프록시 뒤에서 IP 레이트리밋이 한 카운터로 묶인다.** 원본 `auth/router.py:build_router.enforce_ip_rate_limit` 은 `request.client.host` 만 읽고 `X-Forwarded-For` 를 보지 않는다. 실제 배포는 CloudFront→ALB→앱이라 운영에서는 ALB 주소별로, dev 에서는 `127.0.0.1` 하나로 60회를 공유한다. **원본이 이미 그렇다.**
2. **refresh 재사용 폐기에 경쟁 조건이 있다.** 원본 `db/store.py:PostgresStore.rotate_refresh_token` 은 재사용된 **한 행만** `FOR UPDATE` 로 잠근 뒤 `UPDATE ... WHERE user_id=? AND revoked_at IS NULL` 을 건다. 그 UPDATE 의 snapshot 이후 다른 세션이 INSERT 한 토큰은 활성으로 남는다. Java 는 statement 단위로 같은 구조다.

- Phase 3 구현 Codex 스레드: `019fdd0c-e045-7911-ae58-353c2058630e` (이어가려면 `codex resume <thread-id>`)
- Phase 3은 **Codex 단독**으로 진행했다(`/SPEC.md` §11의 사이클별 예외). 구현 샌드박스가 gradle 락 파일과 로컬 소켓을 막아 Codex는 Testcontainers 테스트를 한 건도 실행하지 못했다 — **실행 검증은 전부 Phase 4에서 이뤄졌다.**
