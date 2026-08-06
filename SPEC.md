# SPEC — acting-api FastAPI → Spring Boot 전면 이관 (공통 규칙)

이 문서는 **모든 마일스톤 사이클의 판정 기준**이다. 각 사이클은 이 문서 + `spec/M<n>-*.md`를 함께 읽는다.
리뷰 지적의 수용/기각, 완료 판정 모두 이 문서를 근거로 한다.

- BASE_REF: `27d6b9b` (2026-08-06 2차 개정 — `SOMA-304` 반영. 1차 개정은 `24dedfc`, 최초 작성은 `47f8384` 기준이었다 — §12 참조)
- 마일스톤: `spec/M0-spike.md` ~ `spec/M6-cleanup.md`
- 이전 작업 스펙은 `docs/archive/`로 옮겼다.

**소스 참조는 `파일:심볼` 형식이다.** 라인 번호를 쓰지 않는다 — 이유와 검사 방법은 §12에 있다.
파이썬 경로는 `apps/api/acting-api/src/acting_api/`(테스트는 `apps/api/acting-api/tests/`) 기준이며,
다른 패키지는 `acting-summary/summarizer.py`처럼 패키지명을 앞에 붙인다.

## 1. 배경과 목적

`apps/api`는 FastAPI 기반 uv 파이썬 모노레포다. `acting-api` 게이트웨이가 `acting-summary`·`acting-agent`·`acting-report`를 in-process로 마운트하고, 공용 LLM·검증 유틸은 `acting-llm` 패키지에 있다.

규모(2026-08-06 2차 실측): `apps/api/spec/openapi.json` **30 paths · 70 schemas · 41 operations**. 🔁 1차 개정의 69 schemas는 `SOMA-304`의 `PublicCoachTurn` 신설로 하루 만에 어긋났다 — **이 수치도 참고값이며, 판정은 언제나 실행 시점의 `openapi.json`으로 한다**(§6-2).

이것을 **Java 21 + Spring Boot 3.4로 전면 이관**한다. LLM 파이프라인까지 포함해 파이썬을 0으로 만들고, 전환 후 백엔드 프로세스는 하나로 유지한다.

**성공의 정의는 "엔드포인트가 동작한다"가 아니라 "기존 응답 계약이 재현된다"이다.** `apps/web`이 `spec/openapi.json`으로 타입을 생성하므로(`pnpm --filter web generate:v2-schema`), 필드 하나·nullable 하나가 어긋나면 프론트가 조용히 깨진다.

## 2. 기술 스택 (확정, 변경 금지)

| 항목 | 결정 |
|---|---|
| 런타임 | Java 21 + Spring Boot 3.4, Spring Web MVC + **virtual threads** (WebFlux 금지) |
| 빌드 | Gradle (Kotlin DSL) + wrapper, `bootJar` |
| 영속 | Spring Data JPA + **JdbcTemplate 하이브리드** (§5) |
| 스키마 | **Flyway가 소유**. `V1__baseline.sql`에 현 스키마를 동결(§5-5). Hibernate `ddl-auto: validate` (`create`/`update` 절대 금지) |
| DB 연결 | `DATABASE_URL`(`postgresql://…`)을 **JDBC URL + username/password로 변환**(§5-6). 이름은 유지 |
| 스펙 | springdoc-openapi |
| 인증 | nimbus-jose-jwt + 커스텀 필터. Apple/Google은 `JwtDecoder`(JWKS 캐시) |
| S3 | AWS SDK v2 `S3Presigner` |
| DB 버전 | **운영 RDS는 Postgres 18.4** (`db.t4g.micro`, 2026-08-06 실측). 컨테이너 이미지도 **18**로 맞춘다 — PG18은 NOT NULL을 `pg_constraint`로 물질화하는 등 카탈로그가 달라 16에서 통과한 스키마 검증이 운영을 보증하지 않는다 |
| 테스트 | JUnit 5 + Testcontainers(Postgres **18**) + MockMvc. **버전을 BOM에 맡기지 않고 고정**하고, 외부 DB 폴백 경로를 둔다 (§8-4) |
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

중첩된 모델도 `Z`가 된다. 방증(초판 작성 시점): `tests/test_coach_reports_v2.py`가 `/v2/reports`에서만 `.replace("Z", "+00:00")`을 했다. ⚠ 그 파일은 `SOMA-302` 로 `tests/test_coach_reports_openai.py` 가 되면서 해당 단언이 사라졌다 — **방증은 없어졌지만 결론(전 엔드포인트 `Z` 통일)은 유지한다.**

**결정: 전부 `Z` + 마이크로초 6자리.** 프론트는 전부 `new Date()`/`Date.parse()`를 쓰고(`apps/web/src/features/workspace/workspace-app.tsx:1538`, `community/shell.tsx:113`, `practice/practice-flow.tsx:1312`, `practice/terms-gate.tsx:400`) JS 표준 파서가 둘 다 처리하므로 **무영향**이다.

Jackson 설정: `WRITE_DATES_AS_TIMESTAMPS=false`, `Instant` 또는 `OffsetDateTime`(**`LocalDateTime` 금지**), 소수 자릿수 **6자리 고정**(기본은 나노초까지 갈 수 있음).

`openapi.json` 재생성 → 웹 타입 재생성 → 프론트 확인을 해당 사이클 안에서 완결한다.

## 5. 영속 계층 규칙

### 5-1. JPA로 가는 것

조회 쿼리, 단순 CRUD.

**관계 매핑을 만들지 않는다.** 원본 `models.py`에 `relationship()`이 하나도 없고 전부 FK 컬럼 + 명시적 `join()`이다. UUID 컬럼만 두면 1:1로 대응되며 lazy loading·N+1·`LazyInitializationException`이 구조적으로 발생하지 않는다. 관계 매핑을 추가하는 것은 "개선"이 아니라 새 위험이다.

### 5-2. JdbcTemplate으로 내리는 것 (JPA 표현 불가)

아래 표는 2026-08-06에 현재 소스에서 다시 뽑은 것이다. **`SOMA-302` 이후 대상이 늘었다** — RETURNING이 5→10건, `ON CONFLICT`가 6→8건이다.

| 패턴 | 위치 (`db/store.py` 기준, 명시된 것만 `db/community_store.py`) |
|---|---|
| `UPDATE/INSERT ... RETURNING` (10) | `PostgresStore.finalize_upload_intent` · `.link_user_identity` · `.get_or_create_external_operation` · `.create_practice_session_with_analysis_operation` · `.create_analysis_retry_operation` · `.claim_external_operation` · `.claim_next_external_operation` · `.complete_practice_report_operation` · `.sweep_expired_upload_intents` · `.sweep_max_attempts_operations` |
| `ON CONFLICT DO NOTHING RETURNING` (7) | `PostgresStore.link_user_identity` · `.get_or_create_external_operation` · `.create_practice_session_with_analysis_operation` · `.create_analysis_retry_operation` · `.complete_practice_report_operation`; `CommunityStore.like_post` · `.block_user` |
| `ON CONFLICT DO UPDATE` (1) | `PostgresStore.confirm_latest_handoff` — **신규**. `DO NOTHING`과 시맨틱이 다르다 |
| `DISTINCT ON` (3) | `PostgresStore.list_latest_consent_documents` · `.get_current_user_consents` · `.total` |
| `FOR SHARE OF <특정 테이블>` (1) | `PostgresStore._load_session` (3-테이블 조인 중 `coach_sessions`만 락) |
| 컬럼식 증감 / 스칼라 서브쿼리 대입 | `CommunityStore._resync_like_count` · `.create_comment` · `.delete_comment` · `.increment_view_count` · `.create_report` · `.get_post` · `.update_post`; `PostgresStore.total` |
| 상관 서브쿼리로 UPDATE 대상 선택 (2) | `PostgresStore.claim_next_external_operation`; `CommunityStore._resync_like_count` |

`@Modifying`은 rowcount만 반환하므로 RETURNING 계열을 대체할 수 없다. `save()`는 SELECT-then-INSERT라 upsert의 동시성 보장을 깨뜨린다 — 원본이 `ON CONFLICT`를 쓰는 이유가 정확히 그것이다.

### 5-3. 엔티티 매핑 함정

1. **네이티브 Postgres enum 17종.** `values_callable` 때문에 DB 저장값이 Python enum의 `.value`(소문자)다. `@Enumerated(EnumType.STRING)`은 varchar 바인딩이라 PG가 `operator does not exist`로 거부한다. **`IntentImpact`는 값이 한글**(`"반전"`/`"약화"`/`"국소"`, `db/models.py:IntentImpact`). → **`@Enumerated` 금지.**

   **매핑 방법 (M0에서 실증)**: `@JdbcTypeCode(SqlTypes.NAMED_ENUM)`과 `AttributeConverter`는 **공존할 수 없다.** 둘을 같이 걸면 EntityManagerFactory 생성이 `Cannot read the array length because "values" is null`로 죽는다. → **커스텀 `JdbcType`**(`setObject(..., Types.OTHER)`)으로 값을 바인딩한다. M0의 `PgEnum`/`PgEnumJdbcType`/`PgEnumConverter`가 그 구현이다.
2. **UUID PK 22개** (PK 24개 − BIGSERIAL 2개). 대부분 앱에서 `uuid4()` 생성이고, `CoachSession.id`만 외부(agent 모듈의 문자열 파싱, `db/store.py:PostgresStore._add_coach_session`)에서 온다. `HandoffConfirmation`은 PK가 `coaching_handoff_id`로 **FK 겸 PK**다. Spring Data `save()`는 `@Id`가 non-null이면 `merge()`를 호출해 불필요한 SELECT가 붙는다. → 앱 생성 PK 전부 `Persistable<UUID>` 구현 또는 `em.persist()` 직접, 그리고 **INSERT 전 SELECT가 없음을 전수 검증**한다.
3. **`server_default` vs `default` 이원화.** JPA에는 "앱 측 default" 개념이 없다. 필드 초기화값을 주면 항상 INSERT에 실려 `server_default`가 발동하지 않는다. 컬럼별로 판정한다. `db/models.py:CoachTurn`·`Report`의 `''` 기본값 컬럼은 null로 두면 NOT NULL 위반이고, `summaries.observations_json`/`.uncertainties_json`·`coach_sessions.conversation_summary`도 같은 부류다.
4. **JSONB 8개** — `summaries.observation`(NULL 허용)/`.raw`/`.observations_json`/`.uncertainties_json`, `coaching_handoffs.handoff_json`, `practice_reports.report_json`, `reports.biggest_problem`, `external_operations.response_payload`(NULL 허용). **JSON null(`'null'::jsonb`)과 SQL NULL을 구분**한다. 현재 코드는 SQL NULL을 의도한다(`db/store.py:PostgresStore.claim_external_operation` 계열).
5. **BIGSERIAL PK 2개** — `Anomaly.id`, `CoachTurn.id`. `IDENTITY` 전략은 JDBC 배치 INSERT를 막는다.
6. **부분 인덱스 3개와 CHECK 제약 4개**(`ck_practice_sessions_blockage_branch`·`ck_coaching_handoffs_branch_kind`·`ck_practice_reports_report_type`·`ck_community_blocks_not_self`)는 Hibernate가 만들 수도 검증할 수도 없다. Flyway가 DDL을 소유해야 하는 결정적 이유다.
   **개수를 SPEC에 박지 않는다** — `FlywayBaselineTest`가 alembic fingerprint에서 세어 따라간다.
   특히 `ck_practice_sessions_blockage_branch`는 `blockage_kind`×`sub_branch` 조합을 묶으므로 **테스트 픽스처가 임의의 값을 넣으면 INSERT가 거부된다.**
7. **`CommunityReport.target_id`는 의도적으로 FK가 없다**(글/댓글 양쪽을 가리킴, `db/models.py:CommunityReport` 주석).

### 5-4. 트랜잭션 경계

1. **외부 호출(S3·LLM — Gemini·OpenAI 양쪽)을 트랜잭션 안에 넣지 않는다.** `claim → (수십 초) → complete` 흐름(`analysis_worker.py:AnalysisWorker.run_once`)에서 커넥션이 점유된다. `claim`/`complete`/`fail`/`release`를 각각 별도 트랜잭션 메서드로 분리한다.
2. **내부 헬퍼에 `@Transactional`을 붙이지 않는다.** `db/store.py`의 `PostgresStore._finish_external_operation`·`._save_coach_session`·`._load_session`·`._add_summary`·`._add_coach_session` 등은 호출자 트랜잭션에 참여하는 것이 의도다. self-invocation 함정과 겹친다.
3. **`@Modifying`에는 `clearAutomatically=true, flushAutomatically=true`.** 벌크 UPDATE는 1차 캐시를 우회하므로 이후 같은 트랜잭션에서 엔티티를 계속 쓰는 코드(`db/store.py:PostgresStore.fail_external_operation`)가 stale해진다.
4. 원본은 `expire_on_commit=False`가 전제라 store 메서드가 **detached 엔티티**를 반환한다. 대응 시 detach 시점을 맞춘다.

### 5-5. Flyway 전략 — baseline만으로는 부족하다

**`V1__baseline.sql`에 현 스키마 전체(24 테이블 + 17 enum 타입 + 인덱스 + 제약 + 초기 커뮤니티 데이터)를 동결한다.** alembic `0001`~`0010`이 만든 최종 결과를 덤프해 만든다. 재생성은 손이 아니라 `apps/api-java/scripts/regen-baseline.sh`가 한다.

- **빈 DB**: V1을 실행해 스키마를 재구축한다. 이것이 없으면 신규 환경·재해 복구가 불가능하다
- **기존 DB(dev·운영)**: 같은 V1 버전으로 `baseline`을 기록만 한다. DDL은 실행하지 않는다

**"스키마 diff 0" 기준에서 `flyway_schema_history` 테이블은 명시적으로 제외한다** — baseline 자체가 이 테이블을 만들기 때문에, 제외하지 않으면 기준이 항상 실패한다.

**빈 DB 재구축 테스트를 완료 기준에 넣는다.** M6에서 alembic을 지우면 이 경로가 유일한 스키마 생성 수단이 된다.

**기대값을 커밋된 fixture 하나에만 의존시키지 않는다.** `V1__baseline.sql`과 `alembic-schema-fingerprint.txt`는 둘 다 alembic 결과의 스냅샷이라, 서로 비교하면 **둘이 같이 낡아도 초록이 뜬다.** dev가 `0006 → 0010`으로 전진하는 동안 실제로 그렇게 됐다. `FlywayBaselineTest.committedFingerprintMatchesLiveAlembic`이 **실행 시점에 alembic을 직접 돌려** fixture와 대조해 이 구멍을 막는다. CI는 `REQUIRE_ALEMBIC_CHECK=1`로 건너뛰기를 금지한다.

### 5-6. `DATABASE_URL` 변환

현재 값은 `postgresql://user:pass@host:5432/db` 형태다(`deploy/bootstrap-dev.sh:92`, `docs/DEPLOY-VPC.md:133`). Python은 SQLAlchemy가 이 URI를 직접 받지만 **Spring/Hikari는 `jdbc:postgresql://…`를 요구한다.**

**환경변수 이름은 유지하고**(M5의 배포 문서·양쪽 서버 api.env를 건드리지 않기 위해), URI를 JDBC URL·username·password로 변환하는 설정 클래스를 둔다. **실제 배포 형식의 URL로 부팅하는 테스트**를 포함한다 — 없으면 dev·운영이 동시에 기동 실패한다.

### 5-8. 네이티브 SQL 작성 규칙 (M0에서 실증됨)

M0의 트랜잭션 프로토타입을 실제 Postgres에 돌려 확인한 두 가지다. **네이티브 SQL을 쓰는 모든 곳에 적용된다** — M3의 `UPDATE ... RETURNING` 5건, `ON CONFLICT` 6건이 전부 해당한다.

**① enum 컬럼에는 명시 캐스팅이 필요하다.**

```sql
-- 실패: operation_status_t = character varying 비교를 Postgres가 거부한다
WHERE status = 'running'
-- 통과
WHERE status = 'running'::operation_status_t
```

`@Enumerated` 금지(§5-3-1)는 JPA 얘기였지만, **JdbcTemplate의 SQL 리터럴에서도 같은 함정이 발현한다.** enum 컬럼을 읽을 때는 `kind::text`처럼 반대 방향 캐스팅을 쓴다.

**② `Instant`는 JDBC 파라미터로 바인딩할 수 없다.**

```
PSQLException: Can't infer the SQL type to use for an instance of java.time.Instant.
```

`timestamptz` 컬럼에는 **`OffsetDateTime`**을 넘긴다(`instant.atOffset(ZoneOffset.UTC)`). Jackson 직렬화에서는 `Instant`가 문제없지만 pgjdbc 바인딩에서는 실패한다 — 두 층을 구분한다.

### 5-7. external_operations lease 상태 전이 — 고정 계약

Python 구현의 의미를 그대로 옮긴다. 하나라도 다르면 재분석 횟수와 최종 `error_code`가 달라진다.

| 상황 | 동작 |
|---|---|
| lease 만료됐지만 아직 재선점 안 됨 | **완료 허용** (`db/store.py:PostgresStore._finish_external_operation` 계열) |
| lease token이 이미 재선점됨 | 완료 실패 + 전체 롤백 |
| `release` (일시적 사유) | **`attempt_count` 유지** — 되돌리지 않는다 (`db/store.py:PostgresStore.release_external_operation`) |
| timeout / parse 오류 / unsupported media | **즉시 `FAILED`** |
| S3·ETag·기타 미분류 오류 | **`PENDING` 재큐** → 3회 소비 후 sweep이 `FAILED` |

`MAX_EXTERNAL_OPERATION_ATTEMPTS = 3` (`db/store.py:MAX_EXTERNAL_OPERATION_ATTEMPTS`). 근거: `analysis_worker.py:analysis_error_code`, `tests/test_db_store.py:test_background_claim_skips_failed_and_transient_release_requeues`.

## 6. 계약 보존 체크리스트

매 사이클의 리뷰·완료 판정에 그대로 쓴다.

| # | 항목 | 조치 |
|---|---|---|
| 1 | 오류 포맷 `{"detail": <str>}` | Spring 기본 `ProblemDetail`을 **반드시** 오버라이드. 422 validation만 `detail`이 **배열** |
| 2 | unknown key 정책 | **DTO별로 옮긴다. 전역 `FAIL_ON_UNKNOWN_PROPERTIES=true` 금지** (§6-3) |
| 3 | null 필드 **포함** | `@JsonInclude(NON_NULL)` **전역 사용 금지** (§6-1) |
| 4 | datetime | 전 엔드포인트 `Z` + 마이크로초 6자리 (§4). **JDBC 바인딩은 `OffsetDateTime`** (§5-8) |
| 5 | enum 표기 | `AttributeConverter` 17개. **`@Enumerated` 금지** |
| 6 | refresh 회전 | 소진 토큰 재사용 시 **해당 유저 전 세션 무효화** (의도된 동작) |
| 7 | 404 | "없음"과 "남의 리소스"를 구분하지 않는다 (존재 노출 방지) |
| 8 | S3 presign | **리전 엔드포인트 고정**. 글로벌 엔드포인트는 신규 버킷에 307 |
| 9 | ffmpeg | 동시 실행 1개 락, 600초 타임아웃, 실패·부재 시 원본 폴백 |
| 10 | 제약명 문자열 의존 | **`consent_documents` 유니크 위반** 판정(`consents.py:_is_consent_document_unique_error`)을 `PSQLException.getServerErrorMessage().getConstraint()`로 재현. ⚠ **대상이 바뀌었다** — 원래 여기 있던 `reports_session_id_key` 중복 판정은 `SOMA-302`로 사라졌고, 리포트 멱등은 `uq_practice_reports_source_handoff`에 대한 `ON CONFLICT DO NOTHING`으로 대체됐다(제약명 문자열을 보지 않는다) |
| 11 | 테이블 락 획득 순서 | `upload_intents`→`external_operations`, `practice_sessions`→`practice_reports`. 바꾸면 데드락 |
| 12 | canonical JSON | 멱등 replay는 키 정렬 + 공백 없음 + 한글 raw UTF-8 (`sync_operations.py:_json_response`) |
| 13 | `X-Request-Id` 응답 헤더 | 바디만 맞추면 놓친다 (`sync_operations.py:SyncOperationClaim.headers`, `practice_sessions.py:_idempotent_response`) |
| 14 | v1 경로 404 | `/summarize`, `/coach/start`, `/coach/reply`, `/report`, `/report/history/{id}` 5개 |
| 15 | 숫자 파싱 | `size_bytes: 12.0`(정수형 float) → **201**, `12.5` → **422** |
| 16 | 커뮤니티 읽기 공개 | 스펙엔 `security`가 붙어 있지만 실제로는 `optional_user` — **토큰 없이 200** |

### 6-1. nullable — "null로 보낼 것"과 "키를 생략할 것"이 다르다

`openapi.json`에 `anyOf [T, null]`이 **97곳**, `default`가 붙은 필드는 **9개**다. Pydantic에서 `X | None`을 기본값 없이 쓰면 **required가 된다.**

`default` 9개는 전부 컬렉션 기본값이거나 불리언이다 — `AdmissionNotice`의 5개·`AdmissionStage.evaluates`·`AdmissionUniversity.resources`가 `[]`, `PostWriteRequest.anonymous`·`CommentWriteRequest.anonymous`가 `false`. **`anyOf [T, null]`과 겹치지 않는다**(default가 있으면 nullable로 선언되지 않았다).

| 동작 | 대상 |
|---|---|
| **required + `null` 값을 실어 보냄** (14) | `AuthUser.email`, `MeResponse.email/.nickname`, `CoachTurnResponse.handoff/.report`, `CoachConfirmResponse.handoff`, `SourceHandoffIds.analysis`, `PostListResponse.next_cursor`, `CommentListResponse.next_cursor`, `AuthorPayload.id/.nickname/.alias`, `CategoryPayload.description`, `BlockPayload.nickname` |
| **optional + 조건부로 키를 추가** | `PracticeSessionDetail.summary`(status가 `analyzed`이고 summary가 있을 때만), `.error_code`(`failed`일 때만) — `practice_sessions.py:build_router.get_session` |
| **optional인데 항상 포함** | `PracticeSessionStatusResponse.error_code` — `practice_sessions.py:build_router.get_session_status` |

나머지 optional nullable 72개 중 68개는 `admissions` 계열(정적 데이터)이라 성격이 다르다.

같은 이름의 필드가 엔드포인트마다 다르게 동작한다. DTO를 분리하거나 직렬화를 수동 제어한다.

### 6-2. 오류 계약은 `openapi.json`에 없다

스펙의 상태코드는 `200/201/202/204/422`뿐이다. **400·401·403·404·409·413·415·429·502·503이 전무**하고 422는 FastAPI 자동 생성 `HTTPValidationError`뿐이다. 실제 소스에는 `HTTPException` 발생 지점이 99곳, 서로 다른 `(status, detail)` 쌍이 **47종**(2026-08-06 조사) 있다.

불규칙에 주의한다 — 대부분 snake_case(`upload_not_found`)인데 일부는 공백 포함 문장이다: `invalid or missing access token`, `session not found`, `practice session not found`, `rate limit exceeded`, `request is still processing`, `request retry exhausted`, `session changed concurrently`, `session is closed`, `practice session analysis is not settled`, `report already exists`, `report already exists for practice session`, `invalid X-Request-Id`.

**같은 상태코드에 두 표기가 공존한다** — 404에 `practice session not found`와 `practice_session_not_found`가 **둘 다** 있고, 409에 `report already exists`와 `report already exists for practice session`이 둘 다 있다. 라우터별로 어느 쪽인지 정확히 갈라야 한다.

M1이 이 표를 소스에서 추출해 fixture로 만든다. 이후 사이클은 그것을 기준으로 한다.

**숫자를 완료 조건으로 쓰지 않는다.** 위 47이라는 값도 추출 방식에 따라 흔들린다(동적 502, admin 기본 401, 멀티라인 detail). committed OpenAPI는 41 operations이며 admin 2개는 `ADMIN_OPS_TOKEN`이 있을 때만 등록된다(`app.py:create_app`, `admin.py:build_router`). **소스/OpenAPI에서 생성한 inventory의 집합 동등성으로 판정**하고, 조건부 라우트는 프로파일별 inventory를 따로 둔다.

### 6-3. unknown key 정책 — 전역 reject 금지

요청 바디 17개 중 **5개가 unknown key를 허용**한다(`additionalProperties`가 `false`가 아님):

```
POST /v2/auth/login      POST /v2/auth/logout     POST /v2/auth/refresh
POST /v2/consents        POST /v2/uploads/intents
```

나머지 12개는 `additionalProperties: false`다.

⚠ **2026-08-06에 집합이 바뀌었다.** `POST /v2/coach/reply`와 `POST /v2/practice-sessions`가 허용 목록에서 **빠졌다**(이제 거부한다). SPEC 초판의 7개 목록을 그대로 옮기면 이 둘이 잘못 열린다.

**전역 `fail-on-unknown-properties: true` + 허용할 5개에 `@JsonIgnoreProperties(ignoreUnknown = true)`.**

```java
@JsonIgnoreProperties(ignoreUnknown = true)
record LoginRequest(...) {}      // 위 5개에만
```

**반대 방향(전역 허용 + DTO별 거부)은 Jackson이 표현하지 못한다** — M0에서 실제로 시도해 실패했다. `ignoreUnknown = false`는 "거부하라"가 아니라 **"전역 설정을 따르라"**는 뜻이라 기본값과 다를 바 없고, 예외가 나지 않는다.

Spring Boot 기본값은 `false`(무시)이고 Pydantic 기본값과 같지만, **그 기본을 쓰면 거부해야 할 9개를 닫을 수단이 없다.** 그래서 전역을 뒤집고 7개를 여는 쪽이 유일한 구현이다.

애노테이션이 붙는 5개는 Python에서 `extra`를 명시하지 않은 집합과 정확히 같아야 한다. **개수를 박지 말고 `openapi.json`에서 생성한다** — 방금 7→5로 바뀐 것이 그 이유다. M1이 **요청 17개 전부에 unknown-field 회귀 테스트**를 둔다.

응답 쪽은 반대다 — 응답 컴포넌트 26개가 **전부 닫혀 있다**(FastAPI가 만드는 `HTTPValidationError` 제외). SPEC 초판이 예외로 뒀던 `SceneSummary`는 `SOMA-302`로 스키마에서 사라졌다(§8-3).

## 7. 보존 규칙 — 되돌리면 안 되는 결정

1. **좋아요 카운트는 재집계다** (`db/community_store.py:CommunityStore._resync_like_count`). 증감 방식이 "두 번 눌리면 2 증가"하던 버그 때문에 의도적으로 선택됐다(함수 주석에 기록). 성능 명목으로 증감으로 되돌리면 버그가 부활한다.
2. **댓글 수 증감은 원자적이어야 한다** (`db/community_store.py:CommunityStore.create_comment`·`.delete_comment`). `post.setCommentCount(get()+1)`로 옮기면 lost update가 새로 생긴다. 벌크 UPDATE로 분리한다.
3. ~~**`_report_count_query`의 FROM 앵커**~~ — **소멸했다.** `SOMA-302`가 리포트 계층을 `practice_reports`로 옮기면서 이 쿼리가 사라졌다. 다만 **함정 자체는 살아 있다**: 상관 서브쿼리에서 앵커 테이블을 명시하지 않으면 같은 테이블이 FROM에 두 번 들어가 Postgres가 거부한다. 새 리포트 집계(`db/store.py:PostgresStore.list_report_summaries`·`.has_report_for_practice_session`)를 이식할 때 같은 규칙을 적용한다.
4. **`SKIP LOCKED`는 현재 0건이다.** 경합 시 블로킹 대기 → 조건 재평가 실패 → 폴링 재시도 구조다. 정확하지만 처리량이 낮다. **원본 동작을 우선 재현한다.** 개선은 M2에서 별도 판단한다.

### 7-1. 이식 위험 상위 5개

**2026-08-06 재산정.** `SOMA-302`가 리포트 계층을 갈아엎으면서 초판의 위험 1위가 사라졌다 — 아래는 현재 소스 기준이다. 모두 `db/store.py`이며, 명시된 것만 `db/community_store.py`다.

| 순위 | 함수 | 위험 |
|---|---|---|
| 1 | `PostgresStore.create_practice_session_with_analysis_operation` | 103줄. **충돌 시 방금 만든 세션을 delete하는 보상 로직.** 거의 같은 구조가 `.create_analysis_retry_operation`(88줄)에 복제돼 있어 **둘을 함께 고쳐야 한다** |
| 2 | `PostgresStore._save_coach_session` + `._load_session` | `FOR SHARE OF <특정 테이블>` + 턴 전량 값 비교 낙관적 락(`@Version`으로 대체 불가). `_load_session`은 109줄로 store에서 가장 길다 |
| 3 | `PostgresStore.claim_next_external_operation` | 분석 파이프라인의 심장. `UPDATE ... WHERE id=(SELECT ... LIMIT 1) ... RETURNING` — 상관 서브쿼리로 UPDATE 대상을 고른다 |
| 4 | `CommunityStore._ensure_alias` | SAVEPOINT 재시도. `JpaTransactionManager`는 `PROPAGATION_NESTED` 미지원 → **이식이 아니라 재작성** |
| 5 | `PostgresStore.confirm_latest_handoff` | **신규**(`SOMA-302`). store에서 유일한 `ON CONFLICT DO UPDATE`라 `DO NOTHING` 관용구를 그대로 복사하면 시맨틱이 조용히 달라진다 |

**강등**: `PostgresStore.complete_practice_report_operation`(구 `complete_report_operation`). 초판의 위험 1위였던 *수동 세션 + 커밋 예외를 트랜잭션 밖에서 캐치* 구조가 `ON CONFLICT (source_handoff_id) DO NOTHING RETURNING` 한 방으로 단순해졌다. **M0의 `ReportOperationIT`는 이 옛 구조를 프로토타이핑한 것이다** — 트랜잭션 스타일 결론은 유효하나 대상 함수는 M3에서 새로 잡는다.

## 8. 검증

### 8-1. 매 사이클 공통

- Testcontainers(Postgres 18) 통합 테스트 통과 — **`ci.yml`의 `api-java` 잡이 PR마다 돌린다**
- 스키마 fixture 드리프트 검사 통과 (`REQUIRE_ALEMBIC_CHECK=1`, §5-5)
- SPEC 참조 드리프트 검사 통과 (§12)
- M1 이후: 계약 동등성 하네스 통과
- `openapi.json` diff 0 (§4 항목 제외)

### 8-2. 왜 통합 테스트가 필수인가

기존 `pytest`의 대부분은 인메모리 fake이고 실제 DB를 치는 것은 일부다. `apps/api/CLAUDE.md`가 명시한다 — **"가짜 Session은 statement를 저장만 하고 실행하지 않는다. Postgres가 SQL 자체를 거부하는 종류의 회귀는 통합 테스트에서만 잡힌다."** 구 `_report_count_query`의 FROM 앵커 사고가 실제 사례다(§7-3).

**그리고 통합 테스트가 있어도 CI가 돌리지 않으면 소용이 없다.** M0 직후 Java 통합 테스트 17개가 깨진 채로 dev가 초록이었다 — `ci.yml`에 Java 잡이 없었기 때문이다. `api-java` 잡이 그 구멍을 막는다(§8-1).

**Java 쪽 Testcontainers 테스트를 이식보다 먼저 세운다.** 그리고 `FakePlatformStore` 같은 인메모리 미러를 Java에서 다시 만들지 않는다 — 원본 fake는 `PostgresStore` 시맨틱을 손으로 미러링한 것이라 두 번 틀릴 수 있다.

### 8-4. Testcontainers ↔ 최신 Docker Engine — 반드시 필요한 설정 (M0 실측)

개발 머신의 Docker Desktop 4.78.0 / **Engine 29.5.3 / API 1.54**에서, Testcontainers는 기본 상태로 `/info`에 Status 400을 받고 `Could not find a valid Docker environment`로 실패한다. 소켓 접근 자체는 되므로(`curl --unix-socket` 성공) 권한이 아니라 **API 버전 협상 실패**다.

**`DOCKER_API_VERSION` 환경변수만으로는 풀리지 않는다.** docker-java는 시스템 프로퍼티 `api.version`을 함께 본다. Gradle `Test` 태스크에 셋 다 준다:

```kotlin
tasks.withType<Test>().configureEach {
    if (System.getenv("DOCKER_API_VERSION") == null) {
        environment("DOCKER_API_VERSION", "1.41")
        systemProperty("api.version", "1.41")          // 이게 빠지면 실패한다
    }
    val socket = File(System.getProperty("user.home"), ".docker/run/docker.sock")
    if (System.getenv("DOCKER_HOST") == null && socket.exists()) {
        environment("DOCKER_HOST", "unix://${socket.absolutePath}")
        environment("TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE", "/var/run/docker.sock")
    }
}
```

Testcontainers 버전은 BOM에 맡기지 않고 고정한다(`extra["testcontainers.version"]`). 이미지는 운영과 같은 **`postgres:18-alpine`**.

CI는 러너의 Docker 버전이 달라 동작이 갈릴 수 있다. `ci.yml:69-80`에 이미 Postgres 서비스가 있으므로, 필요하면 그것을 외부 DB로 쓰는 경로를 함께 둔다.

### 8-3. Java가 더 엄격해져 생기는 diff

원본 라우터는 `response_model=`을 쓰지 않고 `responses={200: {"model": X}}`만 쓴다(문서용, 런타임 필터링 없음). Spring은 DTO 반환 시 스키마가 강제되므로 **Java 쪽이 더 엄격해진다.** Python이 흘리던 여분 필드가 사라져 diff가 나면 Python 버그일 가능성이 높다 → **"수정"이 아니라 "확인 후 수용"으로 처리하고 기록한다.**

초판은 `SceneSummary`가 `additionalProperties: true`라 예외로 뒀지만, **그 스키마는 `SOMA-302`로 사라졌다.** 현재 응답 컴포넌트 26개는 `HTTPValidationError`를 빼고 전부 닫혀 있으므로 예외 조항이 필요 없다.

## 9. 참조

- 계약의 소스: `apps/api/spec/openapi.json`
- **`apps/api/API.md`는 드리프트했다 — 신뢰하지 않는다.** `GET /v2/reports` 응답 형상이 실제와 다르고 `/v2/me`·`/v2/community/*`·`/v2/admissions*`는 누락
- 응답 형상표: `tests/test_response_contracts.py:SUCCESS_RESPONSE_MODELS`·`:RESPONSE_COMPONENT_SHAPES`
- 전 플로우 시나리오: `tests/test_response_contracts.py:test_declared_response_models_validate_real_success_payloads_and_replays`
- 멱등 전이표: `tests/test_platform_v2.py:test_practice_session_running_succeeded_failed_and_fingerprint_branches`
- 프로젝트 규약: `CLAUDE.md`, `apps/api/CLAUDE.md`

## 10. 미결 사항

| 시점 | 결정할 것 |
|---|---|
| ~~M0~~ | ~~Gemini Java SDK가 Files API 업로드·`PROCESSING` 폴링·`responseSchema`를 지원하는가~~ → **M0에서 해결(지원함)**. 단 **영상 분석 한 층에만 해당한다** — 아래 참조 |
| M4 | **OpenAI 클라이언트를 어떻게 만들 것인가.** `SOMA-302`가 코치·리포트를 Gemini에서 OpenAI(`POST /v1/responses`)로 옮겼고, 파이썬 구현도 SDK가 아니라 `httpx` REST 직접 호출이다. 기본안은 `RestClient` 동형 이식 — `spec/M4-llm.md` §A-0 |
| M0 | 위험 함수 #1의 트랜잭션 관리 스타일 — 선언적 `@Transactional` vs `TransactionTemplate` |
| M2 | 시계 소스 통일 — DB `now()` vs 앱 `Instant.now()`. 현재 혼재하며 리스 만료 비교(`db/store.py:PostgresStore.claim_external_operation`·`.claim_next_external_operation`·`.sweep_max_attempts_operations`)에 영향 |
| M2 | `SKIP LOCKED` 도입 여부 (기본 방침: 원본 동작 우선) |
| M5 | ~~dev 인스턴스 업그레이드~~ → **확정: dev·운영 be 둘 다 t3.small 이상 필수.** 운영 be도 t2.micro 954MB이고 **swap이 0**이라 병행 기동이 불가능하다(2026-08-06 실측, `spec/M5-cutover.md` §B). 비용 발생 — 사용자 승인 대상 |

## 11. 진행 방식

각 마일스톤이 `custom-codex-build` 1사이클이다.

Phase 1(SPEC 확정) → 2(Codex 설계 비판) → **3(이중 구현 + 대조)** → 4(실행 검증) → 5(Claude 리뷰 루프) → 6(Codex 최종 관문) → 7(마무리 커밋)

**Phase 3은 이중 구현이다.** 같은 SPEC으로 Codex(worktree A)와 Claude 서브에이전트(worktree B)가 독립 병렬 작업하고, SPEC 기준으로 대조해 차이 목록을 만든 뒤, 베이스를 정하고 상대 구현의 우월한 부분을 이식해 단일 구현을 확정한다. M1 이후에는 하네스 통과율이 객관 지표가 된다.

사용자 개입은 2회 — 전체 SPEC 묶음 승인(지금), M5 운영 전환 직전. 그 사이 사이클은 자동 연쇄한다.

**사이클 시작 전에 `dev` 전진분을 먼저 흡수한다.** M0 종료와 M1 착수 사이에 `SOMA-302`가 들어와 이 SPEC의 사실 관계가 8곳 어긋났고, 위험 1위 함수가 통째로 사라졌다. 앞 사이클의 전제가 아직 성립하는지 확인하지 않고 다음 사이클을 열면, **틀린 SPEC을 근거로 이중 구현 두 벌이 나란히 틀린다.**

## 12. 소스 참조 규약과 드리프트 검사

**라인 번호로 참조하지 않는다.** 초판은 “파일 이름 + 콜론 + 라인 범위” 형태로 111곳을 참조했는데, `dev`가 전진하자 전부 어긋났고 그중 8곳은 **가리키던 심볼 자체가 사라졌는데도 문서만 보면 알 수 없었다.**

- 형식: `` `db/store.py:PostgresStore.claim_next_external_operation` ``
- 경로 기준은 §맨 위에 적었다. 클래스 메서드는 `클래스.메서드`, 모듈 상수는 이름만 쓴다
- 라인 번호가 꼭 필요하면(예: 주석 블록) **심볼을 함께** 적는다

`spec/check-refs.py`가 모든 SPEC 문서의 참조를 훑어 **파일과 심볼이 실재하는지** 검사한다. `ci.yml`의 `api-java` 잡이 이것을 돌리므로, 소스에서 심볼이 사라지면 PR이 빨간불이 된다.

```bash
python3 spec/check-refs.py          # 전체 검사
```

M0 문서(`spec/M0-spike.md`·`spec/M0-findings.md`)는 **그 시점의 기록**이므로 라인 참조를 그대로 둔다. 대신 문서 상단에 스냅샷 시점을 밝히고, 무효가 된 항목에 표시를 남긴다. 검사기는 이 둘을 건너뛴다.

### 🔁 검사기가 잡지 못하는 것 — 심볼은 남고 동작만 바뀔 때

`check-refs.py`는 **참조가 실재하는지**만 본다. `SOMA-304`가 `coaching.py:build_router.coach_start`에 resume 분기를 넣어 **`POST /v2/coach/start`의 멱등 계약을 무효화**했을 때, 심볼은 그대로였으므로 검사기는 102건 전부 통과시켰다. `spec/M1-harness.md`의 L3 대상표는 **성립하지 않는 계약을 가리킨 채 초록불이었다.**

따라서 **사이클 진입 전 점검은 검사기 통과로 대체할 수 없다.** 매 사이클 시작 시 다음을 손으로 확인한다:

1. `git merge-base --is-ancestor <dev tip> <직전 SPEC 개정 커밋>` — 개정이 **실제로** 최신 dev를 보고 쓰였는지. 1차 개정은 본문에 "`SOMA-302`를 반영했다"고 적혀 있었지만 커밋 조상 관계로는 `SOMA-304`를 못 본 상태였다
2. `git diff <직전 SPEC 개정 커밋>..origin/dev -- apps/api` — 변경이 있으면 **SPEC이 인용한 동작 서술**을 그 diff에 대고 읽는다
3. `apps/api/spec/openapi.json`의 operation·컴포넌트·`default`·`anyOf [T,null]` 집합을 개정 시점과 비교
