# SPEC — acting-api FastAPI → Spring Boot 전면 이관 (공통 규칙)

이 문서는 **모든 마일스톤 사이클의 판정 기준**이다. 각 사이클은 이 문서 + `spec/M<n>-*.md`를 함께 읽는다.
리뷰 지적의 수용/기각, 완료 판정 모두 이 문서를 근거로 한다.

- BASE_REF: `47f8384`
- 마일스톤: `spec/M0-spike.md` ~ `spec/M6-cleanup.md`
- 이전 작업 스펙은 `docs/archive/`로 옮겼다.

## 1. 배경과 목적

`apps/api`는 FastAPI 기반 uv 파이썬 모노레포다. `acting-api` 게이트웨이가 `acting-summary`·`acting-agent`·`acting-report`를 in-process로 마운트한다. 규모는 소스 10.1k LOC / 테스트 10.1k LOC / 엔드포인트 약 50개(`apps/api/spec/openapi.json` 29 paths · 61 schemas).

이것을 **Java 21 + Spring Boot 3.4로 전면 이관**한다. LLM 파이프라인까지 포함해 파이썬을 0으로 만들고, 전환 후 백엔드 프로세스는 하나로 유지한다.

**성공의 정의는 "엔드포인트가 동작한다"가 아니라 "기존 응답 계약이 재현된다"이다.** `apps/web`이 `spec/openapi.json`으로 타입을 생성하므로(`pnpm --filter web generate:v2-schema`), 필드 하나·nullable 하나가 어긋나면 프론트가 조용히 깨진다.

## 2. 기술 스택 (확정, 변경 금지)

| 항목 | 결정 |
|---|---|
| 런타임 | Java 21 + Spring Boot 3.4, Spring Web MVC + **virtual threads** (WebFlux 금지) |
| 빌드 | Gradle (Kotlin DSL) + wrapper, `bootJar` |
| 영속 | Spring Data JPA + **JdbcTemplate 하이브리드** (§5) |
| 스키마 | **Flyway가 소유**. Hibernate `ddl-auto: validate` (`create`/`update` 절대 금지) |
| 스펙 | springdoc-openapi |
| 인증 | nimbus-jose-jwt + 커스텀 필터. Apple/Google은 `JwtDecoder`(JWKS 캐시) |
| S3 | AWS SDK v2 `S3Presigner` |
| 테스트 | JUnit 5 + **Testcontainers(Postgres)** + MockMvc |
| 디렉토리 | `apps/api-java/` (M6에서 `apps/api`로 rename) |

## 3. 하지 말 것 (스코프 제한)

1. **DB 스키마를 바꾸지 않는다.** 마이그레이션 신규 작성 금지. Flyway는 기존 스키마를 baseline으로 받는다.
2. **API 계약을 바꾸지 않는다.** 유일한 예외는 §4뿐이다.
3. **스코프 밖 리팩터링 금지.** 원본의 이상해 보이는 구조는 대부분 이유가 있다(§7).
4. **기존 `apps/api`를 수정하지 않는다.** M5 전환 전까지 무손상 유지가 롤백 경로다.
5. **성능 최적화를 명목으로 동작을 바꾸지 않는다.** 특히 §7-1.
6. **`@ManyToOne`/`@OneToMany` 등 JPA 관계 매핑을 만들지 않는다.** 이유는 §5.

## 4. 의도적 breaking change (유일한 예외)

**datetime 포맷을 전 엔드포인트 `Z`로 통일한다.**

현행은 갈라져 있다(FastAPI 0.139.0 / pydantic 2.13.4에서 실측):

| 현행 경로 | 출력 | 해당 엔드포인트 |
|---|---|---|
| dict 반환 → `jsonable_encoder` → `isoformat()` | `...789012+00:00` | `/v2/practice-sessions`(목록·상세·상태), `/v2/uploads/intents`, `/v2/consents/*`, `/v2/auth/*` |
| Pydantic 모델 반환 → `model_dump(mode="json")` | `...789012Z` | `/v2/community/*`, `/v2/me`, `/v2/reports`(목록·상세) |
| `json.dumps` canonical (멱등 replay) | 시간 필드 없음 | `POST /v2/reports`, `/v2/coach/*` |

중첩된 모델도 `Z`가 된다. 방증: `test_coach_reports_v2.py:456-457`이 `/v2/reports`에서만 `.replace("Z", "+00:00")`을 한다.

**결정: 전부 `Z` + 마이크로초 6자리.** 프론트는 전부 `new Date()`/`Date.parse()`를 쓰고(`apps/web/src/features/workspace/workspace-app.tsx:1538`, `community/shell.tsx:113`, `practice/practice-flow.tsx:1312`, `practice/terms-gate.tsx:400`) JS 표준 파서가 둘 다 처리하므로 **무영향**이다.

Jackson 설정: `WRITE_DATES_AS_TIMESTAMPS=false`, `Instant` 또는 `OffsetDateTime`(**`LocalDateTime` 금지**), 소수 자릿수 **6자리 고정**(기본은 나노초까지 갈 수 있음).

`openapi.json` 재생성 → 웹 타입 재생성 → 프론트 확인을 해당 사이클 안에서 완결한다.

## 5. 영속 계층 규칙

### 5-1. JPA로 가는 것

조회 쿼리, 단순 CRUD.

**관계 매핑을 만들지 않는다.** 원본 `models.py`에 `relationship()`이 하나도 없고 전부 FK 컬럼 + 명시적 `join()`이다. UUID 컬럼만 두면 1:1로 대응되며 lazy loading·N+1·`LazyInitializationException`이 구조적으로 발생하지 않는다. 관계 매핑을 추가하는 것은 "개선"이 아니라 새 위험이다.

### 5-2. JdbcTemplate으로 내리는 것 (JPA 표현 불가)

| 패턴 | 위치 |
|---|---|
| `UPDATE ... RETURNING <엔티티>` | `store.py:551`, `571`, `1410`, `1474`, `1760` |
| `INSERT ... ON CONFLICT DO NOTHING RETURNING` | `store.py:257`, `679`, `766`, `1362`; `community_store.py:438`, `736` |
| `DISTINCT ON` | `store.py:419`, `478` |
| `FOR SHARE OF <특정 테이블>` | `store.py:1903` (3-테이블 조인 중 `coach_sessions`만 락) |
| 컬럼식 증감 / 스칼라 서브쿼리 대입 | `community_store.py:423`, `619`, `667` |
| 상관 서브쿼리로 UPDATE 대상 선택 | `store.py:1466` |

`@Modifying`은 rowcount만 반환하므로 RETURNING 계열을 대체할 수 없다. `save()`는 SELECT-then-INSERT라 upsert의 동시성 보장을 깨뜨린다 — 원본이 `ON CONFLICT`를 쓰는 이유가 정확히 그것이다.

### 5-3. 엔티티 매핑 함정

1. **네이티브 Postgres enum 17종.** `values_callable` 때문에 DB 저장값이 Python enum의 `.value`(소문자)다. `@Enumerated(EnumType.STRING)`은 varchar 바인딩이라 PG가 `operator does not exist`로 거부한다. **`IntentImpact`는 값이 한글**(`"반전"`/`"약화"`/`"국소"`, `models.py:48-52`). → **`AttributeConverter` 17개 필수, `@Enumerated` 금지.**
2. **UUID PK 15개 테이블 전부 앱에서 `uuid4()` 생성.** Spring Data `save()`는 `@Id`가 non-null이면 `merge()`를 호출해 불필요한 SELECT가 붙는다. → `Persistable<UUID>` 구현 또는 `em.persist()` 직접. 예외: `CoachSession.id`는 `server_default`가 없고 agent 모듈의 문자열 파싱에서 온다(`store.py:1068`).
3. **`server_default` vs `default` 이원화.** JPA에는 "앱 측 default" 개념이 없다. 필드 초기화값을 주면 항상 INSERT에 실려 `server_default`가 발동하지 않는다. 컬럼별로 판정한다. `focus_timestamp`(`models.py:452`)·`comparison`(`483`)의 `''` 기본값은 null로 두면 NOT NULL 위반.
4. **JSONB 4개** — `summaries.observation`/`.raw`, `reports.biggest_problem`(NOT NULL), `external_operations.response_payload`(NULL 허용). **JSON null(`'null'::jsonb`)과 SQL NULL을 구분**한다. 현재 코드는 SQL NULL을 의도한다(`store.py:1436`, `1743`, `1786`, `1816`).
5. **BIGSERIAL PK 2개** — `Anomaly.id`, `CoachTurn.id`. `IDENTITY` 전략은 JDBC 배치 INSERT를 막는다.
6. **부분 인덱스 3개**(`models.py:802`, `832`, `839`)와 CHECK 제약(`765`)은 Hibernate가 만들 수도 검증할 수도 없다. Flyway가 DDL을 소유해야 하는 결정적 이유다.
7. **`CommunityReport.target_id`는 의도적으로 FK가 없다**(글/댓글 양쪽을 가리킴, `models.py:717` 주석).

### 5-4. 트랜잭션 경계

1. **외부 호출(S3·Gemini)을 트랜잭션 안에 넣지 않는다.** `claim → (수십 초) → complete` 흐름(`analysis_worker.py:92-135`)에서 커넥션이 점유된다. `claim`/`complete`/`fail`/`release`를 각각 별도 트랜잭션 메서드로 분리한다.
2. **내부 헬퍼에 `@Transactional`을 붙이지 않는다.** `_finish_external_operation`(`store.py:1807`), `_save_coach_session`(`1084`), `_load_session`(`1882`), `_add_summary`(`1836`), `_add_report`(`1176`) 등은 호출자 트랜잭션에 참여하는 것이 의도다. self-invocation 함정과 겹친다.
3. **`@Modifying`에는 `clearAutomatically=true, flushAutomatically=true`.** 벌크 UPDATE는 1차 캐시를 우회하므로 이후 같은 트랜잭션에서 엔티티를 계속 쓰는 코드(`store.py:1711`)가 stale해진다.
4. 원본은 `expire_on_commit=False`가 전제라 store 메서드가 **detached 엔티티**를 반환한다. 대응 시 detach 시점을 맞춘다.

## 6. 계약 보존 체크리스트

매 사이클의 리뷰·완료 판정에 그대로 쓴다.

| # | 항목 | 조치 |
|---|---|---|
| 1 | 오류 포맷 `{"detail": <str>}` | Spring 기본 `ProblemDetail`을 **반드시** 오버라이드. 422 validation만 `detail`이 **배열** |
| 2 | Pydantic `extra="forbid"` | `FAIL_ON_UNKNOWN_PROPERTIES=true` + Bean Validation |
| 3 | null 필드 **포함** | `@JsonInclude(NON_NULL)` **전역 사용 금지** (§6-1) |
| 4 | datetime | 전 엔드포인트 `Z` + 마이크로초 6자리 (§4) |
| 5 | enum 표기 | `AttributeConverter` 17개. **`@Enumerated` 금지** |
| 6 | refresh 회전 | 소진 토큰 재사용 시 **해당 유저 전 세션 무효화** (의도된 동작) |
| 7 | 404 | "없음"과 "남의 리소스"를 구분하지 않는다 (존재 노출 방지) |
| 8 | S3 presign | **리전 엔드포인트 고정**. 글로벌 엔드포인트는 신규 버킷에 307 |
| 9 | ffmpeg | 동시 실행 1개 락, 600초 타임아웃, 실패·부재 시 원본 폴백 |
| 10 | 제약명 문자열 의존 | `summaries_session_id_key` 중복 판정(`store.py:1300-1308`)을 `PSQLException.getServerErrorMessage().getConstraint()`로 재현 |
| 11 | 테이블 락 획득 순서 | `upload_intents`→`external_operations`, `practice_sessions`→`reports`. 바꾸면 데드락 |
| 12 | canonical JSON | 멱등 replay는 키 정렬 + 공백 없음 + 한글 raw UTF-8 (`sync_operations.py:147-155`) |
| 13 | `X-Request-Id` 응답 헤더 | 바디만 맞추면 놓친다 (`sync_operations.py:28`, `practice_sessions.py:95`) |
| 14 | v1 경로 404 | `/summarize`, `/coach/start`, `/coach/reply`, `/report`, `/report/history/{id}` 5개 |
| 15 | 숫자 파싱 | `size_bytes: 12.0`(정수형 float) → **201**, `12.5` → **422** |
| 16 | 커뮤니티 읽기 공개 | 스펙엔 `security`가 붙어 있지만 실제로는 `optional_user` — **토큰 없이 200** |

### 6-1. nullable — "null로 보낼 것"과 "키를 생략할 것"이 다르다

`openapi.json`에 `anyOf [T, null]`이 86곳, `default`는 0개다. Pydantic에서 `X | None`을 기본값 없이 쓰면 **required가 된다.**

| 동작 | 대상 |
|---|---|
| **required + `null` 값을 실어 보냄** | `AuthUser.email`, `MeResponse.email/.nickname`, `CoachTurnResponse.reason`, `PostListResponse.next_cursor`, `CommentListResponse.next_cursor`, `AuthorPayload.id/.nickname/.alias`, `CategoryPayload.description`, `BlockPayload.nickname` |
| **optional + 조건부로 키를 추가** | `PracticeSessionDetail.summary`(analyzed일 때만), `.error_code`(failed일 때만) — `practice_sessions.py:248-256` |
| **optional인데 항상 포함** | `PracticeSessionStatusResponse.error_code` — `practice_sessions.py:213-216` |

같은 이름의 필드가 엔드포인트마다 다르게 동작한다. DTO를 분리하거나 직렬화를 수동 제어한다.

### 6-2. 오류 계약은 `openapi.json`에 없다

스펙의 상태코드는 `200/201/202/204/422`뿐이다. **401·403·404·409·413·415·429·503이 전무**하고 422는 FastAPI 자동 생성 `HTTPValidationError`뿐이다. 실제 소스에는 40종의 `(status, detail)` 쌍이 있다.

불규칙에 주의한다 — 대부분 snake_case(`upload_not_found`)인데 일부는 공백 포함 문장이다: `invalid or missing access token`, `session not found`, `summary not found`, `rate limit exceeded`, `request is still processing`, `session is still open`, `session changed concurrently`, `request retry exhausted`.

M1이 이 표를 소스에서 추출해 fixture로 만든다. 이후 사이클은 그것을 기준으로 한다.

## 7. 보존 규칙 — 되돌리면 안 되는 결정

1. **좋아요 카운트는 재집계다** (`community_store.py:416-431`). 증감 방식이 "두 번 눌리면 2 증가"하던 버그 때문에 의도적으로 선택됐다(주석 418-422). 성능 명목으로 증감으로 되돌리면 버그가 부활한다.
2. **댓글 수 증감은 원자적이어야 한다** (`community_store.py:619`, `667`). `post.setCommentCount(get()+1)`로 옮기면 lost update가 새로 생긴다. 벌크 UPDATE로 분리한다.
3. **`_report_count_query`의 FROM 앵커** (`store.py:1310-1327`). 주석에 함정이 기록돼 있다 — 앵커를 명시하지 않으면 `practice_sessions`가 FROM에 두 번 들어가 Postgres가 거부한다.
4. **`SKIP LOCKED`는 현재 0건이다.** 경합 시 블로킹 대기 → 조건 재평가 실패 → 폴링 재시도 구조다. 정확하지만 처리량이 낮다. **원본 동작을 우선 재현한다.** 개선은 M2에서 별도 판단한다.

### 7-1. 이식 위험 상위 5개

| 순위 | 함수 | 위험 |
|---|---|---|
| 1 | `complete_report_operation` (`store.py:1580-1643`) | 수동 세션 + `with db.begin()` + **커밋 예외를 트랜잭션 밖에서 캐치**. Spring 프록시 모델과 구조적 충돌 |
| 2 | `create_practice_session_with_analysis_operation` (`store.py:620-721`) | 100줄/7분기. **충돌 시 방금 만든 세션을 delete하는 보상 로직**(697-714). 유사 구조가 `create_analysis_retry_operation`(723)에 복제 |
| 3 | `_save_coach_session` + `_load_session` (`1084`, `1882`) | `FOR SHARE OF` + 턴 전량 값 비교 낙관적 락(`@Version` 대체 불가) |
| 4 | `claim_next_external_operation` (`1442-1494`) | 분석 파이프라인의 심장. `UPDATE ... WHERE id=(SELECT ... LIMIT 1) ... RETURNING` |
| 5 | `_ensure_alias` (`community_store.py:501-543`) | SAVEPOINT 재시도. `JpaTransactionManager`는 `PROPAGATION_NESTED` 미지원 → **이식이 아니라 재작성** |

## 8. 검증

### 8-1. 매 사이클 공통

- Testcontainers(Postgres) 통합 테스트 통과
- M1 이후: 계약 동등성 하네스 통과
- `openapi.json` diff 0 (§4 항목 제외)

### 8-2. 왜 통합 테스트가 필수인가

기존 `pytest` 8,009 LOC 중 실제 DB를 치는 건 1,618 LOC뿐이고 나머지는 인메모리 fake다. `apps/api/CLAUDE.md`가 명시한다 — **"가짜 Session은 statement를 저장만 하고 실행하지 않는다. Postgres가 SQL 자체를 거부하는 종류의 회귀는 통합 테스트에서만 잡힌다."** `_report_count_query`가 실제 사례다.

**Java 쪽 Testcontainers 테스트를 이식보다 먼저 세운다.** 그리고 `FakePlatformStore` 같은 인메모리 미러를 Java에서 다시 만들지 않는다 — 원본 fake는 `PostgresStore` 시맨틱을 손으로 미러링한 것이라 두 번 틀릴 수 있다.

### 8-3. Java가 더 엄격해져 생기는 diff

원본 라우터는 `response_model=`을 쓰지 않고 `responses={200: {"model": X}}`만 쓴다(문서용, 런타임 필터링 없음). Spring은 DTO 반환 시 스키마가 강제되므로 **Java 쪽이 더 엄격해진다.** Python이 흘리던 여분 필드가 사라져 diff가 나면 Python 버그일 가능성이 높다 → **"수정"이 아니라 "확인 후 수용"으로 처리하고 기록한다.**

## 9. 참조

- 계약의 소스: `apps/api/spec/openapi.json`
- **`apps/api/API.md`는 드리프트했다 — 신뢰하지 않는다.** `GET /v2/reports` 응답 형상이 실제와 다르고 `/v2/me`·`/v2/community/*`·`/v2/admissions*`는 누락
- 응답 형상표: `apps/api/acting-api/tests/test_response_contracts.py:37-272`
- 전 플로우 시나리오: 같은 파일 `:440-698`
- 멱등 전이표: `apps/api/acting-api/tests/test_platform_v2.py:340-381`
- 프로젝트 규약: `CLAUDE.md`, `apps/api/CLAUDE.md`

## 10. 미결 사항

| 시점 | 결정할 것 |
|---|---|
| M0 | Gemini Java SDK가 Files API 업로드·`PROCESSING` 폴링·`responseSchema`를 지원하는가. 미흡하면 `RestClient`로 REST 직접 호출 |
| M0 | 위험 함수 #1의 트랜잭션 관리 스타일 — 선언적 `@Transactional` vs `TransactionTemplate` |
| M2 | 시계 소스 통일 — DB `now()` vs 앱 `Instant.now()`. 현재 혼재하며 리스 만료 비교(`store.py:1423`, `1462`, `1777`)에 영향 |
| M2 | `SKIP LOCKED` 도입 여부 (기본 방침: 원본 동작 우선) |
| M5 | dev 인스턴스 업그레이드 (t2.micro 1GB → t3.small 이상. JVM 도입으로 사실상 필수) |

## 11. 진행 방식

각 마일스톤이 `custom-codex-build` 1사이클이다.

Phase 1(SPEC 확정) → 2(Codex 설계 비판) → **3(이중 구현 + 대조)** → 4(실행 검증) → 5(Claude 리뷰 루프) → 6(Codex 최종 관문) → 7(마무리 커밋)

**Phase 3은 이중 구현이다.** 같은 SPEC으로 Codex(worktree A)와 Claude 서브에이전트(worktree B)가 독립 병렬 작업하고, SPEC 기준으로 대조해 차이 목록을 만든 뒤, 베이스를 정하고 상대 구현의 우월한 부분을 이식해 단일 구현을 확정한다. M1 이후에는 하네스 통과율이 객관 지표가 된다.

사용자 개입은 2회 — 전체 SPEC 묶음 승인(지금), M5 운영 전환 직전. 그 사이 사이클은 자동 연쇄한다.
