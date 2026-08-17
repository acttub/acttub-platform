# M6 4단계 — 계약 하네스 폐기

**`SOMA-403` 4단계의 결과 정본이다.** 무엇이 사라졌고, 무엇이 그 자리를 대신하며, **무엇은
대신하지 않기로 했는지**를 적는다. 2단계에서 무엇을 옮겼는지는
[M6-contract-migration.md](M6-contract-migration.md)가 정본이고, 이 문서는 그 위에서 실제로
지운 것을 센다.

## 1. 지운 것

| 대상 | 규모 |
|---|---|
| `tools/contract-harness/` | 추적 파일 **42 개** · 1.3M(캐시 포함 78). `tools/` 자체가 사라졌다 |
| CI 잡 `contract-harness`·`contract-harness-java` | `ci.yml` 187 줄. 남은 잡은 **셋**(`web`·`api`·`api-java`) |
| `platform/harness/` | main 8 파일 — 제어 표면(`/__harness/*`)·스텁·DB 투영·`OffsettableClock` |
| `contract` 스프링 프로파일 | `application-contract.yml` · `ContractProviderConfiguration` · `ContractObjectStorage` · `ContractProviderFixture` |
| `@Profile` | 살아남은 파일에서 **10 개** — `!contract` 9 · `contract` 1(`RateLimiterConfiguration`). 조건이 항상 참이 되어 전부 걷었다. 지운 파일 안의 9 개까지 더하면 저장소에 있던 19 개가 전부 사라졌고, main 에 남은 `@Profile` 은 **0** 이다 |
| `FixedWindowRateLimiter` 의 제어 표면 | `advanceContractClock`·`reset`·`contractControlAllowed`·`contractOffsetNanos`. 빈이 프로파일로 갈리던 것도 하나로 합쳤다 |
| 테스트 | 하네스 fixture 에 의존하던 **7 파일** 통째 + 다른 파일에서 케이스 **3 개** 삭제·**2 개** 축소(아래 §3) |

## 2. 하네스가 지키던 것 중 **비어 있던 자리** — 새로 메웠다

착수 전에 `HarnessContractProfileIT` 열 케이스를 하나씩 다른 테스트에 대고 셌다. 대부분은
이미 덮여 있었다.

| 계약 | 지금 지키는 것 |
|---|---|
| `unsupported_provider` 400 · `invalid_provider_token` 401 · `provider_not_configured` 503 | `AuthErrorContractIT` (2단계에 이관) |
| 로그인·갱신 레이트리밋 429, IP 키와 주체 키의 분리 | `RateLimitContractIT` 세 케이스 |
| **분석 완료 트랜잭션** | 🔥 **없었다** → `PostgresAnalysisStoreIT` 신설 |

### 🔥 발견 1 — `PostgresAnalysisStore` 는 실 DB 커버리지가 **0** 이었다

`complete` 는 한 트랜잭션에서 SQL 여섯을 돌린다(요약 INSERT · 대사 INSERT · 연습 세션
`analyzed` · 코치 세션 요약 연결 · 원장 `succeeded` · 리스 확인). 이 경로를 Postgres 위에서
밟는 테스트는 **하네스의 `run-worker-once` 를 통한 `HarnessContractProfileIT` 하나뿐**이었다.
`AnalysisWorkerTest` 는 가짜 저장소로 전이 이름만 세므로 SQL 이 틀려도 초록이다.

→ `PostgresAnalysisStoreIT` 네 케이스로 메웠다. **검사기를 반증했다** — 리스 소유 조건을
빼면 셋이 빨개지고, DB 제약이 통과시키는 **대사 순서 역전**은 이 테스트만 잡는다.

### 발견 2 — 한 연습에 요약은 하나뿐이라 가드 하나는 반증할 수 없다

`summaries.session_id` 가 UNIQUE 다. 그래서 코치 세션 연결의 `summary_id IS NULL` 조건은
"이미 다른 요약에 걸린 같은 연습의 코치 세션"이라는 상태 자체를 만들 수 없어 반증이 불가능하다.
실제로 일어나지 않는 데이터를 심어 초록을 만드는 대신 **테스트 안에 그렇게 적어 두었다.**

### 발견 3 — 저장소가 던지는 `IllegalStateException` 은 밖에서 그 타입이 아니다

`@Repository` 의 예외 번역이 그것을 `DataAccessException` 으로 바꾼다. **부르는 쪽이
`IllegalStateException` 을 잡으면 안 잡힌다** — `AnalysisWorker` 가 `LeaseOwnershipException`
만 따로 보고 나머지를 `Exception` 으로 묶는 것이 그래서 성립한다.

## 3. 함께 사라진 것 — **대신하지 않기로 한 자리**

지운 장치가 보던 것을 전부 옮기지는 않았다. 옮기지 않은 것을 적어 둔다.

| 사라진 검사 | 왜 대신하지 않았나 |
|---|---|
| `HarnessContractProfileIT` 의 **키 없는 격리 기동** (`GEMINI_API_KEY=`) | 키 없이 뜨는 모드가 이제 **없다**. 요구 자체가 사라진 것이지 다른 테스트가 보는 것이 아니다 |
| `GeminiConfigurationTest`·`Analysis/MemoryWorkerSchedulerTest` 의 contract 케이스 | 조건이 사라져 단언할 것이 없다. 꺼진 스위치(`ANALYSIS_WORKER_ENABLED=false`) 케이스는 남겼다 |
| `FixedWindowRateLimiterTest.harnessControlLivesOnlyOnTheContractBean` | 지키던 메서드 둘이 사라졌다 |
| `AuthErrorContractIT.defaultProfileDoesNotRegisterHarnessRoutes` | `/__harness` 라우트가 존재하지 않는다. 404 계약은 같은 파일의 `get("/missing")` 이 덮는다 |
| `sweepExpiredUploads` | 하네스도 **0 건인 것만** 확인했을 뿐 실질 커버리지가 없었다. S3 삭제 권한 누락(M6 스코프 밖)과 얽혀 있어 그대로 둔다 |
| 🔥 **OpenAPI 문서 전체를 FastAPI 정본과 맞대는 것** | 아래 §3-1 |

### 🔥 3-1. 스펙 동등성은 이제 아무도 보지 않는다

하네스의 `verify_openapi_contract` 는 Java springdoc 산출물을 **`apps/api/spec/openapi.json`**
— 즉 `apps/web` 이 `generate:v2-schema` 로 타입을 만드는 바로 그 파일 — 에 대고 **semantic
diff** 했다. `OpenApiSnapshotIT` 는 그것과 다른 일을 한다: **커밋된 자기 스냅샷**과 바이트
비교라, `UPDATE_OPENAPI_SNAPSHOT=1` 로 다시 뜨면 무엇을 바꿨든 초록이다.

**옮기지 않은 이유** — 두 문서는 바이트가 다르다(122K vs 132K). 하네스는 정규화를 거쳐
의미로 비교했으므로, 이 대조를 Java 로 들이려면 **정규화 로직을 통째로 이식**해야 한다.
2단계가 "옮기는 것은 비교가 아니라 기대값" 이라고 선을 그은 이유가 그것이고, 하네스 없이
비교기를 다시 짓는 것은 이 티켓의 스코프 밖이다.

⚠ **그래서 5단계가 이것을 반드시 다뤄야 한다.** 파이썬을 지우면 `apps/api/spec/openapi.json`
이 사라지고, **웹의 타입 생성원이 그 파일이다.** 생성원을 Java springdoc 산출물로 옮기는
순간 두 문서의 차이가 곧 웹 타입의 변화로 드러난다 — 그 변화를 눈으로 확인하는 것이
지금 사라진 대조를 대신하는 마지막 기회다.

## 4. 발견 4 — 어노테이션으로 찾으면 죽은 코드를 놓친다

삭제 대상을 `@Profile` grep 으로 모았더니 `ContractProviderFixture` 가 빠졌다. 어노테이션이
없는 순수 클래스라 잡히지 않았고, **참조가 0 이어도 컴파일은 통과한다.** 클래스 이름으로 다시
훑어 찾았다.

→ 같은 이유로 **`grep`을 두 축으로 돌려야 한다**: 지우는 장치의 *어노테이션*과 *이름* 양쪽.

## 5. 발견 5 — 장치를 지우면 그 장치를 **근거로 인용한 산문**이 거짓이 된다

코드 주석 20 여 곳이 "하네스가 이 값으로 대조한다" · "하네스는 이 자리를 보지 못한다" 로
설계 판단을 정당화하고 있었다. 하네스가 없으면 그 근거가 없다.

- **"하네스가 대조한다"** → 무엇이 지금 지키는지로 바꿨다(`OpenApiSnapshotIT` 등). 지키는 것이
  없으면 없다고 적었다
- **"하네스는 못 잡는다"** → 사각지대인 것은 여전하므로 *왜* 못 보는지로 바꿨다(응답을 맞대는
  검사는 커밋 순서·나중에 재생되는 바이트에 닿지 못한다)
- `RateLimitContractIT` 는 `FixedWindowRateLimiter.reset()` 이 "contract 프로파일에서만
  동작한다"를 **테스트 설계의 안전 근거로 인용**하고 있었다. 그 메서드가 사라졌으므로
  "비우는 수단이 아예 없다"로 고쳤다. 🔎 **처음엔 이 자리를 놓쳤고**, 새로 쓴
  `FixedWindowRateLimiter` javadoc 이 그 낡은 주석을 근거로 가리키기까지 했다 — 거짓이
  서로를 인용하며 강화됐다. 리뷰가 잡았다

📌 **`apps/api` 안의 같은 부류 셋은 일부러 두었다** — `auth/dependencies.py` 의 "헬퍼로 접지
않는다" · `coaching.py` · 기억 스키마 backfill 마이그레이션. 5단계가 그 디렉토리를 통째로 지우므로
지금 고치면 지울 것을 고치는 일이 된다. **위 사슬을 훑을 때 이 셋도 함께 나왔고, 남긴 것은
빠뜨린 것이 아니라 정한 것이다.**

## 6. `check-refs.py` — 폐기된 도구 참조를 면제한다

M1~M4 문서가 하네스 소스를 **34 곳** 가리킨다. 그 문서들은 그 시점의 기록이고 6단계에서 함께
폐기되므로, 파일이 없어진 것만 면제하고 **면제 건수를 출력에 찍는다** — 조용히 넘어가면
"검사했다"로 읽힌다. 면제를 반증했다: 실재 파일의 없는 심볼 · 하네스 밖의 없는 파일 ·
접두어만 닮은 경로(`tools/contract-harness-evil/`) 셋 다 여전히 오류다.

## 7. 5단계로 넘기는 것

- 🔥 **ruleset 의 required status check 에서 `contract-harness`·`contract-harness-java` 를
  뺀다.** 지운 잡을 required 로 남겨 두면 **영원히 오지 않는 관문**이 된다. 5단계가 `api-java`
  잡을 `api` 로 개명하므로 **머지 직전에 한 번에** 맞춘다
- `FastApiInteropIT` 를 지울 때 §2 와 같은 방식으로 **다시 센다** — 지금은
  `invalid_refresh_token` 이 `AuthErrorContractIT` 로 옮겨져 있다
- 🔥 **웹의 타입 생성원을 Java springdoc 으로 옮긴다** — `apps/api/spec/openapi.json` 이
  파이썬과 함께 사라지기 때문이고, 그 전환이 §3-1 의 사라진 대조를 대신할 마지막 기회다
- `apps/api` 안에 남겨 둔 하네스 인용 셋(§5)은 디렉토리와 함께 사라진다
- `REQUIRE_ALEMBIC_CHECK` 와 CI 의 uv 스텝은 파이썬과 함께 사라진다
