# M3 — 도메인 이관

**공통 규칙은 `/SPEC.md`를 따른다. 이 문서는 M3 사이클에만 적용된다.**

> **상세화 시점**: M0·M2의 findings가 나온 뒤 사이클 진입 시 그룹별로 보강한다. 지금 확정된 것은 범위·순서·위험 지점·완료 기준이다.

## M2가 이미 깔아 둔 것 — 다시 만들지 않는다

M3는 **엔드포인트만 얹는다.** 아래는 `spec/M2-findings.md`에서 확정돼 테스트로 고정됐다:

| 기반 | 상태 |
|---|---|
| 엔티티 24개 · enum 컨버터 17개 · JSONB `JsonNode` | `ddl-auto: validate` 통과, 4케이스 왕복 고정 |
| 422 계약 변환 | 예외별 type(`extra_forbidden`·`int_parsing`·`int_from_float`·`uuid_parsing`·`enum`·`string_type`·`missing`·`json_invalid`), 중첩 경로 전량 순회 + wire 이름 변환, 배열 index, 거부값 `input`, `ctx` |
| **숫자 파싱**(`12.0`→201 / `12.5`→422) | `ExactIntegerDeserializer`로 해결. **M3 그룹 2의 위험 목록에서 뺀다** |
| unknown key | 전역 `fail-on-unknown-properties: true` + 허용 DTO에만 `@JsonIgnoreProperties`. **M3 범위에서 허용 대상은 `POST /v2/uploads/intents` 하나뿐이다**(`uploads.py:UploadIntentRequest` 가 `extra` 미지정). ⚠ `practice_sessions.py:PracticeSessionRequest` 는 `ConfigDict(extra="forbid")` 라 **거부**한다 — `SOMA-302` 로 허용 목록에서 빠졌고 `/SPEC.md` §6-3 에 경고가 있다. 애노테이션을 붙이면 실제 계약을 깬다 |
| 오류 포맷 | `{"detail": <str>}`, 404·405·인증 필터에서 `ProblemDetail` 미노출 |
| 시계 · `SKIP LOCKED` | policy matrix 확정, `SKIP LOCKED` 미도입(원본 경합 순서 보존) |
| JWT · 레이트리밋 2종 · consent 게이트 | 완료. M3는 `consented_user` 조합을 쓰기만 한다 |

**자동 승계를 완료 조건으로 쓰지 않는다.** M2의 `ValidationErrorContractIT` 는 중첩·배열 케이스를 이미 갖고 있지만, 그것은 합성 DTO 로 만든 것이다. M3 에서 실제로 깨질 만한 곳은 따로 있다:

- **cross-field 규칙** — `web/ApiErrorAdvice.java:ApiErrorAdvice.invalid` 는 `getFieldErrors()` 만 읽고 **global error 를 읽지 않는다.** M3 의 첫 cross-field 검증은 `practice_sessions.py:PracticeSessionRequest.validate_blockage_branch` 이고, 이것을 class-level Bean Validation 으로 구현하면 **`detail` 이 빈 배열로 나갈 수 있다**(가설이지만 코드상 그렇게 보인다)
- **도메인 value error** — `community.py:_trimmed`, `profile.py:UpdateMeRequest` 의 정규화가 만드는 422 는 pydantic 의 `value_error` 메시지·`ctx` 를 그대로 재현해야 한다
- **중첩 응답 스키마** — 요청 DTO 는 대부분 flat 이고, 실제 중첩 컬렉션 위험은 `admissions.py:AdmissionsResponse` 와 `practice_sessions.py:ObservationPackResponse` 같은 **응답·OpenAPI 쪽**이다

각각을 실제 M3 DTO 로 검증한다.

## 목적

LLM에 의존하지 않는 엔드포인트를 이식한다. **`db/store.py` 2,118줄 + `community_store.py` 749줄이 실제로 옮겨지는 구간**이며 가장 긴 사이클이다.

## 범위 — LLM 경로는 전부 M4

`/v2/coach/*`(**3개** — `coaching.py:build_router` 가 start·reply·confirm 을 등록한다)와 **`POST /v2/reports`** 는 OpenAI 를 호출하므로 M3 에서 구현할 수 없다. 생성 호출부는 `coaching.py:_generate_completed_turn_report` 와 `sync_operations.py:generate_source_report` 이고, `ReportReq` 는 `SOMA-318` 로 `acting-report/schema.py:ReportReq` 로 옮겨졌다. M3 에서는 **저장 계층만** 만들고 엔드포인트 노출은 M4 가 한다.

### 판정 방법 — 제어 표면 일부를 M3 로 당긴다

초판은 "구현된 path 집합에 대한 통과"라고만 적었는데 **그대로는 판정할 수 없다.** `tools/contract-harness/contract_harness/backends.py:JavaBackend.control` 이 모든 제어 표면 호출에서 `NotImplementedError` 를 내고, `tools/contract-harness/contract_harness/framework.py:ScenarioContext.db` 는 Java 스키마 이름을 모르면 중단하며, `--only` 는 path 가 아니라 **시나리오 이름**을 고른다. 게다가 시나리오 대부분이 M3 path 와 coach·worker 호출을 한 덩어리에 섞는다(`tools/contract-harness/contract_harness/scenarios/core.py:main_flow`, `tools/contract-harness/contract_harness/scenarios/worker.py:reanalyze`, `tools/contract-harness/contract_harness/scenarios/community.py:admin`).

**결정(2026-08-08, 사용자 승인)**: LLM 과 무관한 제어 표면을 **M3 로 앞당긴다** — 스키마 reset/seed, `db-projection`, `advance-clock`. `run-worker-once`·`run-sweep`·`stub-state` 중 LLM 스텁에 걸리는 부분은 M4 에 남는다. transport 는 `spec/M4-llm.md` 가 확정한 `POST /__harness/<name>` 을 그대로 쓴다(M4 에서 다시 만들지 않도록).

#### 🔎 하네스 어댑터 갭 5개 — Java 제어 표면만으로는 시나리오가 시작조차 못 한다

**2026-08-08 실행 확인**(`/SPEC.md` §12-4). `PYTHONPATH=$PWD ../../apps/api/.venv/bin/python -m contract_harness --target java --only profile` 을 돌리면 Java 서버를 **띄우지도 않은 채** 다음으로 죽는다:

```
[scenario] profile/-: target 중단: AttributeError("'JavaBackend' object has no attribute 'runtime'")
```

`profile` 시나리오의 첫 줄이 `ctx.auth(USER1)` 이기 때문이다. 즉 **Java 쪽에 제어 표면을 아무리 잘 만들어도 하네스 어댑터를 함께 고치지 않으면 어느 시나리오도 첫 스텝을 넘지 못한다.** 위 초판 결정은 Java 쪽 산출물만 적어 이 절반을 빠뜨렸다. `tools/contract-harness` 는 `/SPEC.md` §3-4 의 "`apps/api` 수정 금지" 대상이 아니므로 고칠 수 있다.

| # | 갭 | 위치 | 조치 |
|---|---|---|---|
| 1 | 토큰 발급이 백엔드 in-process 객체에 묶여 있다 | `tools/contract-harness/contract_harness/framework.py:ScenarioContext.token` 이 `backend.runtime.jwt_service` 를 읽는다 | `spec/M1-harness.md` §채택 방식 4 는 원래 **"Python 이 발급하고 양쪽이 소비"** 였다. 구현이 그 의도와 어긋나 있으므로 하네스가 `tools/contract-harness/contract_harness/config.py:JWT_SECRET` 으로 **직접** HS256 토큰을 만들어 양쪽에 같은 값을 준다. 헤더는 `{"alg":"HS256","typ":"JWT"}` 정확히 — `kid` 가 붙으면 `auth/jwt.py:JwtService._decode` 가 거부한다 |
| 2 | 셋업용 DB 조작이 붙을 스키마를 모른다 | `tools/contract-harness/contract_harness/framework.py:ScenarioContext.db` 가 `backend.schema` 를 요구한다 | `JavaBackend` 에 `schema` 를 준다. Java 는 `harness_target` 스키마에 붙어 뜬다 |
| 3 | 제어 표면 미구현 | `tools/contract-harness/contract_harness/backends.py:JavaBackend.control` 이 `NotImplementedError` | `POST /__harness/<name>` 호출로 구현. `FastapiBackend.control` 과 같은 단언(200 아니면 실패)을 건다 |
| 4 | **시나리오 간 격리가 없다** | `tools/contract-harness/contract_harness/runner.py:_run_java_side` 가 `tools/contract-harness/contract_harness/runner.py:run_side` 와 달리 `_reset(schema)` 를 부르지 않는다 | Java 쪽에도 truncate+seed 를 건다. DB 리셋은 하네스가 파이썬에서 직접 하면 되지만 **Java 프로세스가 들고 있는 in-memory 상태**(레이트리밋 카운터, `advance-clock` 오프셋)는 앱이 지워야 한다 — 이것이 "스키마 reset/seed" 제어 표면의 실제 내용이다 |
| 5 | seed parity 가 java 에서 건너뛴다 | `tools/contract-harness/contract_harness/cli.py:_run` 이 java 일 때 `tools/contract-harness/contract_harness/runner.py:verify_seed_parity` 를 건너뛴다 | 갭 2 가 풀리면 조건을 없앤다. `spec/M4-llm.md` 의 같은 항목도 함께 해소된다 |

**판정**: 갭이 메워졌다는 근거는 "테스트가 있다"가 아니라 **`--target java --only profile` 이 인프라 오류가 아니라 응답 diff 로 실패하는 것**이다. 그룹 1 이 끝나면 그 diff 가 0 이 된다.

그리고 **각 그룹이 어떤 시나리오로 판정되는지 표에 적는다.** 시나리오가 coach 를 거쳐 M3 에서 완주 불가능하면 그렇다고 적고, 그 그룹은 Java 통합 테스트로만 판정한다. **어느 그룹도 "하네스로 판정"이라고만 적고 넘어가지 않는다.**

### `openapi.json` 판정은 slice 한다

전체 문서 diff 0 은 **coach 3개와 report POST 를 노출하지 않는 한 원리적으로 불가능**하다(`tools/contract-harness/contract_harness/runner.py:verify_openapi_contract` 가 일반 실행에서 전체를 비교한다). M3 판정은 **명시적 `(method, path)` M3 inventory 로 slice 한 semantic diff 0** 이다. `/v2/coach/*` 와 `POST /v2/reports` 는 Java OpenAPI 와 request mapping 양쪽에 **없어야** 한다. 전체 diff 0 은 M4 의 관문이다.

## 순서

의존이 적은 것부터. 각 그룹이 끝날 때마다 아래 판정 수단을 돌린다.

| # | 그룹 | 주된 위험 | 판정 수단 |
|---|---|---|---|
| 1 | `/v2/me`, `/v2/consents` | **`DISTINCT ON` 2건**(`db/store.py:PostgresStore.list_latest_consent_documents`·`.get_current_user_consents`), nickname 정규화 | 하네스 `profile`·`consent-gate` |
| 2 | `/v2/uploads` | `UPDATE...RETURNING`, presign 리전 고정, unknown key 허용 (숫자 파싱은 M2 에서 해결 — 회귀 확인만) | 하네스 `expired-intent` + Java 통합 |
| 3 | `/v2/practice-sessions` | **위험 함수 #2**, 조건부 키 생략, 멱등 전이표, L3 바이트 동등 | `status-codes`·`inflight-replay` 일부 + Java 통합. `main-flow` 는 coach 를 거쳐 **M3 완주 불가** |
| 4 | `/v2/community` (16) | `community_store.py` 749줄. **위험 함수 #5**, 키셋 커서, 차단 필터, 익명 별칭 | 하네스 `community`·`community-traversal` |
| 5 | `/v2/reports` **GET 2개만** | 목록·상세. `POST` 는 M4 | Java 통합 전용 — GET 을 밟는 시나리오가 report 생성을 선행한다 |
| 6 | `/v2/admissions`, `/v2/admin` | 조건부 LEFT JOIN, `admin_sessions` 의 N+1(`db/store.py:PostgresStore.admin_sessions`), admin 은 조건부 등록 | `admissions` 는 하네스. **`admin` 시나리오는 `/v2/coach/start` 를 쳐서 M3 에서 완주 불가** → Java 통합 |

⚠ 초판은 그룹 1 에 `DISTINCT ON` 3건이라 적고 세 번째로 `PostgresStore.total` 을 들었다. **그런 함수는 없다** — `admin_stats` 안의 지역 `total` helper 는 평범한 `COUNT(*)` 이고 그룹 6 소속이다.

**엔드포인트 개수를 완료 조건으로 쓰지 않는다**(`/SPEC.md` §6-2). inventory 집합 동등성으로 판정하고, admin은 별도 프로파일 inventory를 쓴다.

## 위험 함수 — 그룹보다 먼저 처리

`/SPEC.md` §7-1. 각각을 **먼저 프로토타입 + Testcontainers 테스트로 고정**한 뒤 해당 그룹을 이식한다.

1. **`db/store.py:PostgresStore.complete_practice_report_operation`** — M0에서 확정한 트랜잭션 스타일 적용. **엔드포인트는 M4지만 저장 계층은 여기서.**

   ⚠ **초판은 `complete_report_operation`과 제약명 `reports_session_id_key`를 지목했다. 둘 다 존재하지 않는다.** `SOMA-302`가 리포트 계층을 `practice_reports`로 옮기면서 함수는 재작성됐고, 멱등은 `uq_practice_reports_source_handoff`에 대한 **`ON CONFLICT (source_handoff_id) DO NOTHING RETURNING`** 으로 바뀌어 **제약명 문자열을 보지 않는다**(`/SPEC.md` §6 #10). 따라서 "사전 존재 확인 경로 vs 커밋 시 위반 경로"를 나눠 테스트할 대상 자체가 없다. 산문이라 `check-refs.py`가 잡지 못한 자리다.

   실제 구조는 이렇다 — 삽입이 충돌하면 `RETURNING`이 비어 `False`를 돌려주고, 삽입에 성공하면 `_finish_external_operation`이 lease 소유를 확인해 **잃었으면 `LeaseOwnershipError`로 방금 넣은 리포트까지 함께 롤백**한다.

   고정할 것:
   - 같은 `source_handoff_id` 재요청이 `False`를 받고 **새 행이 생기지 않는다**
   - lease를 빼앗긴 상태의 완료 시도가 **삽입된 리포트까지 롤백**한다
   - **M0의 트랜잭션 검증은 대상만 갈아 그대로 유지한다** — 같은 트랜잭션에서 성공하는 marker write를 먼저 한 뒤 실패를 일으켜 marker가 롤백되는지, 커넥션 풀을 1로 묶어 같은 커넥션에서 즉시 새 트랜잭션이 성공하는지(Postgres 가 aborted 로 남지 않음). 결론은 유효하고 대상 함수만 바뀌었다
   - **M0 산출물 `ReportOperationIT`(13개)는 옛 구조를 프로토타이핑한 것이다**(`/SPEC.md` §7-1 "강등"). 새 함수 기준으로 재조준한다
2. **`create_practice_session_with_analysis_operation`** — 보상 로직. `db/store.py:PostgresStore.create_analysis_retry_operation` 과 **request-id 경합 패턴만 공유한다.**

   ⚠ 초판은 "보상 로직이 복제되어 있다"고 적었지만 **사실이 아니다.** creation 은 새 세션을 먼저 만들고 operation 충돌 시 **그 세션을 삭제**한다. retry 는 **기존** 세션을 잠그고 operation insert 가 성공한 뒤에야 status 를 `ANALYZING` 으로 바꾼다 — 삭제할 새 세션이 없다. 같은 알고리즘으로 구현하거나 같은 기대값을 적용하면 틀린다. creation 은 "패배한 신규 세션 삭제", retry 는 "충돌 시 기존 세션 status 불변 + winning operation replay" 를 각각 테스트한다
3. **`_save_coach_session` + `_load_session`** — `FOR SHARE OF` + 턴 전량 값 비교. 저장 계층만.

   **load/save 성공 테스트 하나로는 고정되지 않는다** — `@Version` 이나 "마지막 턴만 비교" 같은 잘못된 구현도 통과한다. HTTP 동시 reply 시나리오(`tools/contract-harness/contract_harness/scenarios/worker.py:concurrency`)는 `/v2/coach/reply` 를 쓰므로 M4 범위다. 따라서 **저장소 수준에서** 다음을 단언한다: 같은 snapshot 두 벌을 load 해 첫 save 만 성공하고 둘째는 충돌, 기존 턴의 role·text 변경 거부, 턴 수 축소 거부, closed 세션 append 거부, append 성공 시 index 순서 보존
   - 🔁 `SOMA-304`로 코치 저장 계층에 셋이 붙었다: 신규 `db/store.py:PostgresStore.get_oldest_open_coach_session`(`created_at, id` 순 + `hidden_at IS NULL` + 소유권 조인), `.complete_coach_start_operation`의 `restart` 인자(같은 연습 세션의 열린 코치 세션을 일괄 `closed` 전이), 그리고 응답에 실리는 턴 전량(`coaching.py:PublicCoachTurn`). **정렬 기준과 일괄 전이 범위가 곧 계약이다**
4. **`claim_next_external_operation`** — 워커는 M4 가 쓰지만 저장 계층은 여기서. lease 전이표(`/SPEC.md` §5-7)를 그대로 구현한다.

   ⚠ **M2 가 만든 `operation/ExternalOperationClaimer.java:ExternalOperationClaimer.claimNext` 는 미완성이다.** 원본은 claim 성공 후 kind 가 `ANALYZE` 면 **같은 트랜잭션에서** `PracticeSession.status=ANALYZING` 과 `updated_at` 을 갱신하는데, Java 는 operation 만 갱신한다. M2 가 89개 green 이었는데도 새어 나온 이유는 `SkipLockedDecisionIT` 가 raw SQL 로 순서만 검증했기 때문이다. **M3 는 이 클래스를 완성 대상으로 삼는다** — analyze claim 시 operation 과 practice session 이 한 트랜잭션에서 함께 전이되고, report·coach kind 는 세션 status 를 바꾸지 않음을 통합 테스트로 고정한다
5. **`confirm_latest_handoff`** — `/SPEC.md` §7-1 의 다섯 번째. store 에서 **유일한 `ON CONFLICT DO UPDATE`** 라 `DO NOTHING` 관용구를 복사하면 시맨틱이 조용히 달라진다. insert→update 전이, `confirmed` false→true, 그리고 confirmed 일 때 닫히는 coach session 의 **범위**를 통합 테스트로 고정한다.

   ⚠ 초판은 여기에 `complete_report_operation` 을 두고 `confirm_latest_handoff` 를 누락했다. `/SPEC.md` §7-1 은 후자를 위험 함수로, 전자(현 `complete_practice_report_operation`)를 **강등**으로 분류한다. 재조준 테스트는 위 1번에 별도 회귀 항목으로 남긴다
6. **`_ensure_alias`** — 아래 별도 항목

### 위험 함수 #5 — alias 발급 재작성

`community_anonymous_aliases`에는 unique 제약이 **둘** 있다(`db/models.py:CommunityAnonymousAlias`):
- `uq_community_alias_post_user` (post_id, user_id)
- **`uq_community_alias_post_ordinal` (post_id, ordinal)**

따라서 `INSERT ... SELECT MAX(ordinal)+1 ... ON CONFLICT (post_id, user_id) DO NOTHING`은 **부족하다.** 서로 다른 사용자가 동시에 같은 ordinal을 고르면 `(post_id, ordinal)` 위반으로 **댓글 트랜잭션 전체가 실패**한다. 또한 같은 사용자의 충돌에서 `DO NOTHING RETURNING`은 기존 ordinal을 반환하지 않는다.

**채택 방식**: 부모 `community_posts` 행을 `FOR UPDATE`로 잠근 뒤 → 기존 alias 조회(있으면 그 ordinal 반환) → 없으면 `MAX(ordinal)+1` 삽입. **post 단위로 할당을 직렬화**하므로 SAVEPOINT도 재시도 루프도 필요 없다.

원본은 SAVEPOINT + 3회 재시도였으나(`db/community_store.py:CommunityStore._ensure_alias`) `JpaTransactionManager`가 `PROPAGATION_NESTED`를 지원하지 않고 Hibernate가 제약 위반 후 세션 재사용을 보장하지 않으므로, **이식이 아니라 재작성이 유일한 답이다.** 관찰 가능한 동작(같은 사용자는 같은 번호, post 안에서만 유효, 번호는 1부터 연속)은 동일하게 유지한다.

**이것은 의도적인 동시성 동작 변경이다**(2026-08-08 사용자 승인). `/SPEC.md` §3 은 datetime 외 동작 변경을 금지하므로 예외로 기록한다 — 원본 방식이 `JpaTransactionManager` 에서 표현 불가능하다는 것이 근거다. `RuntimeError` 로 전체 롤백하던 실패 경로가 사라지는 것은 개선이지만, **새 락이 만드는 경합은 검증 대상이다.**

부모 행을 잠그면 alias 발급이 comment 생성 밖의 post update·delete 와도 락 순서를 공유하게 된다. "서로 다른 번호 2개"만으로는 교착 가능성을 배제할 수 없으므로 다음을 Testcontainers 로 고정한다:

- 같은 사용자 동시 요청 → 같은 번호, 다른 사용자 동시 요청 → 다른 번호, **어느 쪽도 댓글이 실패하지 않는다**
- 댓글 트랜잭션이 롤백될 때 alias 도 함께 롤백된다
- alias 발급과 post update·delete 가 경합해도 교착하지 않는다 — **락 획득 순서를 하나로 고정**하고 그 순서를 문서화한다(`/SPEC.md` §6 #11 의 락 순서 규칙에 이어 붙인다)

## 커뮤니티 — 놓치기 쉬운 관찰 가능 동작

| 항목 | 실제 동작 | 근거 |
|---|---|---|
| **차단 필터** | `anonymous = true OR author_id NOT IN blocked` — **익명 글은 숨기지 않는다.** 숨기면 차단 전후 비교로 익명 신원을 추론할 수 있다 | `db/community_store.py:_not_blocked` |
| **조회수** | 상세 조회 응답은 **증가 전** `view_count`를 반환한다. 증가는 별도 원자 연산 | `community.py:build_router.get_post` |
| **입력 정규화** | title·body는 trim. **nickname은 내부 공백까지 접는다** | `community.py:_trimmed`, `profile.py:UpdateMeRequest` |
| **키셋 커서** | 글 목록 DESC(`:261-270`) / 댓글 목록 **ASC**(`:568-577`) — 방향이 반대다. base64 인코딩(`:133-146`)까지 그대로 | |
| **좋아요** | 재집계. 증감으로 되돌리지 않는다 | `/SPEC.md` §7-1 |
| **댓글 수** | 원자적 증감. 벌크 UPDATE + 캐시 무효화 | `/SPEC.md` §7-2 |
| **읽기 공개** | 토큰 없이 200 | `/SPEC.md` §6 #16 |

차단 필터는 3곳에서 재사용되므로(`:260`, `:332`, `:567`) Spring에서도 재사용 가능한 형태(`Specification`)로 만든다.

## 완료 기준 체크리스트

- [ ] LLM 비의존 엔드포인트 전부 이식 (inventory 집합 동등성으로 판정)
- [ ] **위험 함수 5개**(`/SPEC.md` §7-1 목록 그대로: creation 보상 · coach 저장 낙관적 락 · `claim_next` · `_ensure_alias` · `confirm_latest_handoff`)가 각각 Testcontainers 테스트로 고정됨
- [ ] **강등된 `complete_practice_report_operation` 재조준 테스트**도 별도로 통과 (중복 시 `False`·새 행 없음, lease 상실 시 insert 롤백, marker 롤백, 커넥션 오염 없음)
- [ ] **`ExternalOperationClaimer` 완성** — analyze claim 이 operation 과 practice session 을 한 트랜잭션에서 전이하고, report·coach kind 는 세션 status 를 바꾸지 않는다
- [ ] **제어 표면 선행분이 Java 에 있다** — 스키마 reset/seed, `db-projection`, `advance-clock`. transport 는 `POST /__harness/<name>`(`spec/M4-llm.md` 확정 형태). 운영 프로파일에 노출되지 않음을 테스트로 단언
- [ ] **하네스 어댑터 갭 5개가 메워졌다** — 토큰 직접 발급 · `JavaBackend.schema` · `JavaBackend.control` · java 쪽 시나리오 간 reset · seed parity 활성화. 판정은 `--target java --only profile` 이 **인프라 오류가 아니라 응답 diff 로** 실패하는 것이며, 그룹 1 이 끝나면 그 diff 가 0 이 된다
- [ ] **그룹별 판정 수단이 전부 초록** — 순서 표의 "판정 수단" 열 그대로. 하네스로 완주 불가능한 그룹(3·5·6)은 Java 통합 테스트로 판정하며, **그 사실이 표에 적혀 있어야 한다**
- [ ] L3 바이트 동등: `POST /v2/practice-sessions`, `POST /v2/practice-sessions/{id}/analyze` (각 백엔드의 최초↔replay)
- [ ] 오류 계약이 구현 범위 안에서 status·detail까지 일치
- [ ] **`openapi.json` 은 M3 inventory 로 slice 한 semantic diff 0** (datetime 통일 제외, admin 은 별도 프로파일). `/v2/coach/*` 3개와 `POST /v2/reports` 가 Java OpenAPI·request mapping 양쪽에 **없다**. 전체 diff 0 은 M4
- [ ] 조건부 키 생략 재현 (`summary`/`error_code`)
- [ ] 멱등 전이표 4케이스 통과
- [ ] `X-Request-Id` 응답 헤더 반환
- [ ] v1 경로 5개 404 — 🔁 `SOMA-318`이 `acting-agent`·`acting-summary`·`acting-report`의 자체 라우터를 **삭제**해 근거가 "마운트되지 않음"에서 "라우터가 없음"으로 바뀌었다. 하네스도 해당 `EXCLUSIONS`를 지웠다(`tools/contract-harness/contract_harness/manifest.py`). 계약(`/SPEC.md` §6 #14)은 그대로 유효하다
- [ ] **`POST /v2/uploads/intents` 만 unknown key 를 허용**한다. `POST /v2/practice-sessions` 는 `extra_forbidden` 422 를 낸다 (양쪽 다 회귀 테스트)
- [ ] **cross-field 검증의 422 형상** — `PracticeSessionRequest.validate_blockage_branch` 대응 규칙이 빈 `detail` 을 내지 않고 pydantic 형상과 일치한다 (`ApiErrorAdvice.invalid` 가 global error 를 읽지 않는 현 구조를 확인할 것)
- [ ] 커뮤니티: 차단 필터가 익명 글을 숨기지 않는다 / 조회수는 증가 전 값 / nickname 내부 공백 접힘 / 커서 방향 정확
- [ ] 동시성: 세션 생성 경합, 재분석 경합, lease 경합 (`tests/test_db_store.py:test_concurrent_practice_creation_replays_the_winning_operation`·`:test_external_operation_idempotency_lease_race_and_atomic_completion` 대응)
- [ ] alias: 같은 사용자 동시 요청은 같은 번호, 다른 사용자는 다른 번호, **어느 쪽도 댓글이 실패하지 않는다**. 댓글 롤백 시 alias 도 롤백. **post update·delete 와 경합해도 교착하지 않고 락 순서가 고정**돼 있다
- [ ] Java가 더 엄격해져 생긴 diff는 **확인 후 수용**으로 기록됨 (`/SPEC.md` §8-3)

## 하지 말 것

1. `/v2/coach/*`, `POST /v2/reports` 엔드포인트 노출 금지 — M4
2. LLM 호출 코드 작성 금지 — M4
3. **완료 기준에 개수를 하드코딩하지 않는다**
4. `admin_sessions`의 N+1은 **고쳐도 된다**(응답이 같다면). 단 기록한다
5. 기존 `apps/api` 수정 금지
6. 스코프 밖 리팩터링 일체
