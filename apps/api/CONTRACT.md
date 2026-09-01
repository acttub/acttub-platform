# CONTRACT — acting-api 가 지키는 계약

이 백엔드가 **지금 지켜야 하는 규칙**이다. 리뷰 지적의 수용·기각, 완료 판정에 그대로 쓴다.

소스 참조는 **`파일:심볼` 형식**이다. 라인 번호를 쓰지 않는다 — `dev` 가 전진하면 라인은 전부
어긋나고, 가리키던 심볼이 사라져도 문서만 봐서는 알 수 없다.

> **§ 번호는 다시 매기지 않는다.** 자바 소스·테스트·`application.yml`·`build.gradle.kts` 가
> `(apps/api/CONTRACT.md §5-4)` 처럼 **번호로** 이 규칙들을 인용한다
> (`grep -rn "CONTRACT.md §" src build.gradle.kts` 로 센다 — **`build.gradle.kts` 는 `src`
> 밖이라 빠뜨리기 쉽다**). 번호를 정리하면 그 인용이 전부 조용히 어긋나므로,
> 이관 사양(`SOMA-287`)에서 쓰던 번호를 그대로 이어받았다. §1·§3·§9~§12 가 없는 것은 그 장들이
> 이관 절차였기 때문이다(`SOMA-403` 6단계에서 폐기). 원문은
> [docs/archive/soma287/SPEC.md](../../docs/archive/soma287/SPEC.md) 에 있다.

**계약의 정본은 `apps/api/spec/openapi.json` 이다.** springdoc 이 만들고 `apps/web` 이 그것으로
타입을 생성하므로(`pnpm --filter web generate:v2-schema`), 필드 하나·nullable 하나가 어긋나면
프론트가 조용히 깨진다.

## 2. 기술 스택 (확정, 변경 금지)

| 항목 | 결정 |
|---|---|
| 런타임 | Java 21 + Spring Boot 3.4, Spring Web MVC + **virtual threads** (WebFlux 금지) |
| 빌드 | Gradle (Kotlin DSL) + wrapper, `bootJar` |
| 영속 | `JdbcTemplate` (§5-1·§5-2) |
| 스키마 | **Flyway 가 소유**. `V1__baseline.sql` 에 스키마가 동결돼 있다(§5-5). Hibernate `ddl-auto: validate` (`create`/`update` 절대 금지) |
| DB 연결 | `DATABASE_URL`(`postgresql://…`)을 **JDBC URL + username/password 로 변환**(§5-6). 변수 이름은 유지 |
| 스펙 | springdoc-openapi (`openapi_3_1`) |
| 인증 | nimbus-jose-jwt + 커스텀 필터. Apple/Google 은 `JwtDecoder`(JWKS 캐시) |
| S3 | AWS SDK v2 `S3Presigner` |
| DB 버전 | **운영 RDS 는 Postgres 18.4**(`db.t4g.micro`). 컨테이너 이미지도 **18** 로 맞춘다 — PG18 은 NOT NULL 을 `pg_constraint` 로 물질화하는 등 카탈로그가 달라 16 에서 통과한 스키마 검증이 운영을 보증하지 않는다 |
| 테스트 | JUnit 5 + Testcontainers(Postgres **18**) + MockMvc + **ArchUnit**(패키지 구조 검사, ADR-016). **버전을 BOM 에 맡기지 않고 고정**하고, 외부 DB 폴백 경로를 둔다(§8-4) |

## 4. datetime 포맷

**전 엔드포인트가 `Z` + 마이크로초 6자리다.**

Jackson 설정: `WRITE_DATES_AS_TIMESTAMPS=false`, `Instant` 또는 `OffsetDateTime`
(**`LocalDateTime` 금지**), 소수 자릿수 **6자리 고정**(기본은 나노초까지 갈 수 있다).
`JacksonContractTest` 가 못 박는다.

🔁 이것은 이관에서 **의도적으로 낸 유일한 breaking change** 였다. 파이썬은 경로마다 갈려 있었다
— dict 반환은 `...789012+00:00`, Pydantic 모델 반환은 `...789012Z`. 프론트가 전부
`new Date()`/`Date.parse()` 를 쓰고 JS 표준 파서가 둘 다 처리하므로 무영향이었다.

## 5. 영속 계층 규칙

### 5-1. 데이터 접근은 전부 `JdbcTemplate` 이다

`JpaRepository`/`CrudRepository` 선언 **0개**, `EntityManager` 직접 사용 **0건**이다. 저장소는
전부 손으로 쓴 SQL 이다. §5-2 가 열거하는 JPA 표현 불가 패턴이 저장소 전반에 퍼져 있어
"단순 CRUD 만 JPA" 라는 경계가 실제 코드에서 성립하지 않았다.

따라서 `schema` 패키지의 `@Entity` 는 **영속화 수단이 아니라 스키마 검증 장치**다 —
`ddl-auto: validate` 가 대조할 대상을 제공하는 것이 유일한 역할이고, 프로덕션 코드에서 한 번도
참조되지 않는다.

⚠ **Entity 수와 테이블 수가 같지 않다.** `actor_memory_entries` 에 대응하는 `@Entity` 가 애초에
만들어진 적이 없어 **그 테이블만 `ddl-auto: validate` 밖에 있다**(→ SOMA-398). 둘이 어긋난
만큼이 검증 밖이라는 뜻이므로, 새 테이블을 만들 때 Entity 를 함께 만들지 않으면 그 테이블은
조용히 검증 대상에서 빠진다. 이 상태를 정본으로 삼는 용어가 `/CONTEXT.md` 의 **Schema Entity** 이며,
충돌하는 서술은 그쪽이 맞다. §5-3(엔티티 매핑 함정)은 그래도 유효하다 — 검증 장치로 쓰려면
매핑이 정확해야 하기 때문이다.

**관계 매핑을 만들지 않는다.** FK 컬럼 + 명시적 `join()` 만 쓴다. UUID 컬럼만 두면 1:1 로
대응되며 lazy loading·N+1·`LazyInitializationException` 이 구조적으로 발생하지 않는다.
관계 매핑을 추가하는 것은 "개선" 이 아니라 새 위험이다.

### 5-2. JPA 로 표현할 수 없는 것들

저장소가 쓰는 SQL 에는 아래가 퍼져 있다 — `UPDATE/INSERT … RETURNING`,
`ON CONFLICT DO NOTHING RETURNING`, `ON CONFLICT DO UPDATE`, `DISTINCT ON`,
`FOR SHARE OF <특정 테이블>`, 컬럼식 증감, 상관 서브쿼리로 UPDATE 대상 선택.

- `@Modifying` 은 rowcount 만 반환하므로 **RETURNING 계열을 대체할 수 없다.**
- `save()` 는 SELECT-then-INSERT 라 **upsert 의 동시성 보장을 깨뜨린다.** `ON CONFLICT` 를 쓰는
  이유가 정확히 그것이다.
- `ON CONFLICT DO UPDATE` 와 `DO NOTHING` 은 시맨틱이 다르다. 관용구를 복사할 때
  조용히 갈린다.

### 5-3. 엔티티 매핑 함정

1. **값 목록은 text 컬럼 + CHECK 다** (SOMA-462). 네이티브 Postgres enum 열아홉을 걷어냈다 —
   Postgres 가 enum **값 삭제를 지원하지 않아**(`dropping an enum value is not implemented`)
   죽은 값 하나를 빼려면 타입을 통째로 갈아야 했고, 값 목록이 바뀌는 것이 정상인 도메인에
   맞지 않는 그릇이었다. 이 레포는 그 전에도 `ck_practice_reports_report_type` 처럼
   text + CHECK 를 쓰고 있었고, 이제 그쪽으로 통일됐다.

   **`@Enumerated(EnumType.STRING)` 은 여전히 금지다.** 이유가 바뀌었을 뿐이다 — 그것은
   Java enum **상수 이름**을 저장하는데, DB 값은 소문자이고 `IntentImpact` 는 **한글**
   (`"반전"`/`"약화"`/`"국소"`)이다. 값 자체가 계약이라 이름으로 바꿔 쓸 수 없다.

   **매핑 방법**: 종마다 `AttributeConverter`(`platform/schema` 의 `PgEnum`·`PgEnumConverter`).
   컬럼이 text 라 커스텀 `JdbcType` 은 더 필요 없다 — 값 바인딩을 위해 두었던
   `PgEnumJdbcType` 과, 기동할 때 `pg_enum` 카탈로그를 대조하던 `PgEnumCatalogVerifier` 는
   대조할 타입이 없어져 함께 은퇴했다. **값 무결성의 그물은 이제 둘이다** — DB 의 CHECK 와,
   모르는 값을 읽을 때 예외를 던지는 `PgEnumConverter#convertToEntityAttribute`.
2. **PK 는 BIGSERIAL 둘을 뺀 나머지가 전부 UUID 다.** 대부분 앱에서 생성하고,
   `CoachSession.id` 만 외부에서 온다. `HandoffConfirmation` 은 PK 가 `coaching_handoff_id` 로 **FK 겸 PK** 다.
   Spring Data `save()` 는 `@Id` 가 non-null 이면 `merge()` 를 호출해 불필요한 SELECT 가
   붙는다. → 앱 생성 PK 는 `Persistable<UUID>` 구현(`AppGeneratedUuidEntity`), 그리고
   **INSERT 전 SELECT 가 없음을 검증**한다(`EntityMappingIT`).
3. **`server_default` vs 앱 측 default 이원화.** JPA 에는 "앱 측 default" 개념이 없다. 필드
   초기화값을 주면 항상 INSERT 에 실려 `server_default` 가 발동하지 않는다. 컬럼별로 판정한다.
   `''` 기본값 컬럼은 `coach_sessions.conversation_summary` 와 `reports.comparison` 둘이며
   null 로 두면 NOT NULL 위반이다. `summaries.observations_json`/`.uncertainties_json` 도 같은
   부류다.
4. **JSONB 8개** — `summaries.observation`(NULL 허용)/`.raw`/`.observations_json`/
   `.uncertainties_json`, `coaching_handoffs.handoff_json`, `practice_reports.report_json`,
   `reports.biggest_problem`, `external_operations.response_payload`(NULL 허용).
   **JSON null(`'null'::jsonb`)과 SQL NULL 을 구분한다.** 현재 코드는 SQL NULL 을 의도한다.
5. **BIGSERIAL PK 2개** — `Anomaly.id`, `CoachTurn.id`. `IDENTITY` 전략은 JDBC 배치 INSERT 를
   막는다.
6. **부분 인덱스와 CHECK 제약**은 Hibernate 가 만들 수도 검증할 수도 없다. Flyway 가 DDL 을
   소유해야 하는 결정적 이유다.
   **개수도 목록도 문서에 박지 않는다** — `FlywayBaselineTest` 가 커밋된 fingerprint
   (`baseline-schema-fingerprint.txt`)에서 세어 따라간다. 지금 무엇이 걸려 있는지는 거기서
   본다: `grep -o 'ck_[a-z_]*' src/test/resources/baseline-schema-fingerprint.txt | sort -u`.
   ⚠ **픽스처를 쓰기 전에 그 표를 본다.** `ck_practice_sessions_blockage_branch` 는
   `blockage_kind`×`sub_branch` 조합을 묶고, `actor_memory_entries` 에는 값의 공백·길이·
   대상 조합을 묶는 제약이 걸려 있다 — **임의의 값을 넣으면 INSERT 가 거부된다.**
7. **`community_reports.target_id` 는 의도적으로 FK 가 없다** — 글과 댓글 양쪽을 가리킨다.

### 5-4. 트랜잭션 경계

1. **외부 호출(S3·LLM — Gemini·OpenAI 양쪽)을 트랜잭션 안에 넣지 않는다.**
   `claim → (수십 초) → complete` 흐름에서 커넥션이 점유된다. `claim`/`complete`/`fail`/
   `release` 는 각각 별도 트랜잭션 메서드다. `TransactionBoundaryTest` 가 지킨다.
2. **내부 헬퍼에 `@Transactional` 을 붙이지 않는다.** 호출자 트랜잭션에 참여하는 것이
   의도다. self-invocation 함정과 겹친다.
3. **벌크 UPDATE 뒤에 같은 트랜잭션에서 읽은 값을 믿지 않는다.** 지금은 데이터 접근이 전부
   `JdbcTemplate` 이라 1차 캐시가 없지만(§5-1), Spring Data 저장소를 들이면 이 함정이 함께
   들어온다.

### 5-5. Flyway 가 스키마를 소유한다

**정본이다.** 스키마 변경은 Flyway 마이그레이션으로 들어가고, 배포는 jar 하나만 보낸다 —
마이그레이션이 **앱 기동의 일부**다.

**`V1__baseline.sql` 에 스키마 전체(테이블 + enum 타입 + 인덱스 + 제약 + 초기 커뮤니티
데이터)가 동결돼 있다.** enum 타입 열아홉은 V4 가 지우지만 **V1 은 여전히 그것을 만든다** —
동결이라 고칠 수 없고, 빈 DB 는 V1 → … → V4 를 차례로 밟아 결국 같은 자리에 닿는다.

- **빈 DB**: V1 을 실행해 스키마를 재구축한다. 이것이 없으면 신규 환경·재해 복구가 불가능하다
- **기존 DB(dev·운영)**: 같은 V1 버전으로 `baseline` 을 기록만 한다. DDL 은 실행하지 않는다

🔥 **V1 은 동결이다. 스키마 변경은 거기 있는 가장 큰 번호 다음으로 새 파일을 만든다.** 두 경로의 이력이 다르기
때문이다 — dev·운영은 `<< Flyway Baseline >>`(type=BASELINE)이라 **checksum 이 없고**, 신규
환경은 V1 을 SQL 로 밟아 checksum 을 갖는다. **V1 을 고치면 dev·운영은 멀쩡한데 신규 환경만
`checksum mismatch` 로 기동하지 못한다** — 재해복구가 필요한 순간에야 드러난다. 관측이 아니라
재현한 것이고, `FlywayBaselineTest.baselineIsFrozen` 이 checksum 을 못박아 막는다.

**"스키마 diff 0" 기준에서 `flyway_schema_history` 테이블은 명시적으로 제외한다** — baseline
자체가 이 테이블을 만들기 때문에, 제외하지 않으면 기준이 항상 실패한다.

**기대값 fixture 는 `baseline-schema-fingerprint.txt` 이고, 재생성은 손이 아니라
`apps/api/scripts/regen-fingerprint.sh` 가 한다**(Docker 만 필요). 스키마가 바뀌는 PR 마다
돌려 결과를 함께 커밋한다.

**앞으로 가는 길이 뚫려 있는지는 따로 본다.** dev·운영에서 **V1 은 기록만 됐고**(BASELINE 이력),
실제로 실행된 것은 그 뒤 마이그레이션들이다. `FlywayForwardMigrationTest` 가 그 경로(BASELINE
이력만 있는 DB)에 커밋하지 않는 프로브를 **다음 빈 번호로**(`FlywaySupport.nextFreeVersion()`)
얹어 확인하고, **baseline 이 마이그레이션보다 높으면 조용히 건너뛰는 것**을 반증으로 함께 보인다.

### 5-6. `DATABASE_URL` 변환

배포가 주는 값은 `postgresql://user:pass@host:5432/db` 형태다. **Spring/Hikari 는
`jdbc:postgresql://…` 를 요구한다.**

**환경변수 이름은 유지하고**(dev·운영 양쪽 서버의 `api.env` 를 건드리지 않기 위해), URI 를
JDBC URL·username·password 로 변환한다 — `platform/config/DatabaseUrl` 과
`DatabaseUrlEnvironmentPostProcessor`. **실제 배포 형식의 URL 로 부팅하는 테스트**를 둔다
(`HealthAndBootIT`) — 없으면 dev·운영이 동시에 기동 실패한다.

### 5-7. `external_operations` lease 상태 전이 — 고정 계약

하나라도 다르면 재분석 횟수와 최종 `error_code` 가 달라진다.

| 상황 | 동작 |
|---|---|
| lease 만료됐지만 아직 재선점 안 됨 | **완료 허용** |
| lease token 이 이미 재선점됨 | 완료 실패 + 전체 롤백 |
| `release` (일시적 사유) | **`attempt_count` 유지** — 되돌리지 않는다 |
| timeout / parse 오류 / unsupported media | **즉시 `FAILED`** |
| S3·ETag·기타 미분류 오류 | **`PENDING` 재큐** → 3회 소비 후 sweep 이 `FAILED` |

최대 시도 횟수는 3 이다. 구현은 `platform/operation/ExternalOperationClaimer` 와
`feature/analysis/app/AnalysisWorker`, 실 DB 검증은 `ExternalOperationIT` 다.

### 5-8. 네이티브 SQL 작성 규칙 (실측)

**네이티브 SQL 을 쓰는 모든 곳에 적용된다.**

**① 상태 컬럼에 캐스팅을 붙이지 않는다** (SOMA-462 에서 뒤집힌 규칙이다).

```sql
-- 통과: 컬럼이 text 다
WHERE status = 'running'
-- 실패: 그런 타입이 이제 없다
WHERE status = 'running'::operation_status_t
```

컬럼이 네이티브 enum 이던 시절에는 `'running'::operation_status_t` 로 **써야만** 했고
(`operation_status_t = character varying` 비교를 Postgres 가 거부했다), 읽을 때는 반대로
`kind::text` 를 붙였다. 지금은 양쪽 다 불필요하고, 남아 있으면 타입이 없어 실패한다.
파라미터도 그냥 `?` 로 둔다 — `setString` 이 맞는 타입이다.

**② `Instant` 는 JDBC 파라미터로 바인딩할 수 없다.**

```
PSQLException: Can't infer the SQL type to use for an instance of java.time.Instant.
```

`timestamptz` 컬럼에는 **`OffsetDateTime`** 을 넘긴다(`instant.atOffset(ZoneOffset.UTC)`).
Jackson 직렬화에서는 `Instant` 가 문제없지만 pgjdbc 바인딩에서는 실패한다 — 두 층을 구분한다.

**③ 응답 순서가 뜻을 가지는 곳은 `CASE` 로 못박는다.**

```sql
-- 사전순으로 갈린다: ai_analysis, privacy, terms
ORDER BY consent_documents.type
-- 뜻대로: 약관 · 개인정보 · AI 분석
ORDER BY CASE latest.type WHEN 'terms' THEN 1 WHEN 'privacy' THEN 2 WHEN 'ai_analysis' THEN 3 END
```

컬럼이 enum 이던 시절에는 **선언 순서**가 정렬 순서였고, 그 순서에 뜻이 실려 있었다.
text 가 되면서 사전순으로 갈리므로, 순서가 화면에 보이는 두 곳은 `CASE` 로 옛 순서를
고정했다 — 동의 문서 목록(`PostgresConsentRepository#listLatestDocuments`)과 배우 기억
항목(`PostgresMemoryRepository#list`). **어긋나도 예외가 나지 않는다** — 순서만 조용히 바뀐다.

⚠ `DISTINCT ON` 이 붙은 질의는 `ORDER BY` 선행 표현식이 자기와 같기를 요구한다. 안쪽에
`CASE` 를 넣으면 `SELECT DISTINCT ON expressions must match initial ORDER BY expressions` 로
거부당하므로, **바깥 질의로 감싸고 거기서 정렬한다.** 안쪽 정렬은 "종류마다 어느 판을
고르는가"를, 바깥 정렬은 "고른 것을 어떤 순서로 보이는가"를 정한다.

## 6. 계약 보존 체크리스트

| # | 항목 | 조치 |
|---|---|---|
| 1 | 오류 포맷 `{"detail": <str>}` | Spring 기본 `ProblemDetail` 을 **반드시** 오버라이드. 422 validation 만 `detail` 이 **배열** |
| 2 | unknown key 정책 | **전역 `FAIL_ON_UNKNOWN_PROPERTIES=true` + 허용 DTO 에만 `@JsonIgnoreProperties(ignoreUnknown = true)`**(§6-3). 반대 방향은 표현 불가 |
| 3 | null 필드 **포함** | `@JsonInclude(NON_NULL)` **전역 사용 금지**(§6-1) |
| 4 | datetime | 전 엔드포인트 `Z` + 마이크로초 6자리(§4). **JDBC 바인딩은 `OffsetDateTime`**(§5-8) |
| 5 | 상태값 표기 | text 컬럼 + CHECK. 종마다 `AttributeConverter`, **`@Enumerated` 금지**(§5-3-1) |
| 6 | refresh 회전 | 소진 토큰 재사용 시 **해당 유저 전 세션 무효화**(의도된 동작) |
| 7 | 404 | "없음" 과 "남의 리소스" 를 구분하지 않는다(존재 노출 방지) |
| 8 | S3 presign | **리전 엔드포인트 고정.** 글로벌 엔드포인트는 신규 버킷에 307 |
| 9 | ffmpeg | 동시 실행 1개 락, 600초 타임아웃, 실패·부재 시 원본 폴백 |
| 10 | 제약명 문자열 의존 | **`consent_documents` 유니크 위반** 판정을 `PSQLException.getServerErrorMessage().getConstraint()` 로 한다. 그래서 `org.postgresql:postgresql` 이 `runtimeOnly` 가 아니라 `implementation` 이다. 리포트 멱등은 제약명을 보지 않는다(`uq_practice_reports_source_handoff` 에 대한 `ON CONFLICT DO NOTHING`) |
| 11 | 테이블 락 획득 순서 | `upload_intents`→`external_operations`, `practice_sessions`→`practice_reports`, `community_posts`→`community_anonymous_aliases`. 바꾸면 데드락 |
| 12 | canonical JSON | 멱등 replay 는 키 정렬 + 공백 없음 + 한글 raw UTF-8 |
| 13 | `X-Request-Id` 응답 헤더 | 바디만 맞추면 놓친다 |
| 14 | v1 경로 404 | `/summarize`, `/coach/start`, `/coach/reply`, `/report`, `/report/history/{id}` 5개 |
| 15 | 숫자 파싱 | `size_bytes: 12.0`(정수형 float) → **201**, `12.5` → **422** |
| 16 | 커뮤니티 읽기 공개 | 스펙엔 `security` 가 붙어 있지만 실제로는 optional — **토큰 없이 200** |

### 6-1. nullable — "null 로 보낼 것" 과 "키를 생략할 것" 이 다르다

| 동작 | 대상 |
|---|---|
| **required + `null` 값을 실어 보냄** | `AuthUser.email`, `MeResponse.email`/`.nickname`, `CoachTurnResponse.handoff`/`.report`, `CoachConfirmResponse.handoff`, `SourceHandoffIds.analysis`, `PostListResponse.next_cursor`, `CommentListResponse.next_cursor`, `AuthorPayload.id`/`.nickname`/`.alias`, `CategoryPayload.description`, `BlockPayload.nickname`, `MemoryItem.source_practice_session_id`, `ConsentEntryDocument.current_decision` |
| **optional + 조건부로 키를 추가** | `PracticeSessionDetail.summary`(status 가 `analyzed` 이고 summary 가 있을 때만), `.error_code`(`failed` 일 때만) |
| **optional 인데 항상 포함** | `PracticeSessionStatusResponse.error_code` |

같은 이름의 필드가 엔드포인트마다 다르게 동작한다. DTO 를 분리하거나 직렬화를 수동 제어한다.

⚠ **위 목록을 손으로 세지 않는다** — 도메인이 늘면 낡는다(실제로 `memory` 가 들어오며 한 줄이
빠진 채였다). 스펙에서 뽑는다: 각 컴포넌트의 `required` 에 있으면서 `anyOf` 에 `type: null` 이
섞인 속성이 그 집합이다.

`default` 가 붙은 필드는 **`anyOf [T, null]` 과 겹치지 않는다** — default 가 있으면 nullable 로
선언되지 않는다. 대부분 컬렉션 기본값(`[]`)이나 불리언이다.

### 6-2. 오류 계약은 대부분 `openapi.json` 에 없다

스펙이 명시하는 도메인 오류는 `POST /v2/consents`의
`409 required_consent_cannot_be_declined` 하나뿐이다. 그 밖의 상태코드는
`200/201/202/204/422`이고, 422는 자동 생성된 validation 오류뿐이다. 실제 오류는 그보다 훨씬
많다.

필수 동의 게이트는 새 클라이언트가 인증 요청에 `X-Acttub-Consent-Entry: 1`을 보냈을 때
미결정을 `403 consent_required`, 기존 거절·철회를 `403 consent_blocked`로 가른다. 이 헤더가
없는 구형 클라이언트에는 둘 다 종전의 `403 consent_required`로 답한다. 어느 경우에도 막힌
원 요청을 서버가 재실행하지 않는다.

불규칙에 주의한다 — 대부분 snake_case(`upload_not_found`)인데 일부는 공백 포함 문장이다:
`invalid or missing access token`, `session not found`, `practice session not found`,
`rate limit exceeded`, `request is still processing`, `request retry exhausted`,
`session changed concurrently`, `session is closed`,
`practice session analysis is not settled`, `report already exists`,
`report already exists for practice session`, `invalid X-Request-Id`.

**같은 상태코드에 두 표기가 공존한다** — 404 에 `practice session not found` 와
`practice_session_not_found` 가 **둘 다** 있고, 409 에 `report already exists` 와
`report already exists for practice session` 이 둘 다 있다. 라우터별로 어느 쪽인지 정확히
갈라야 한다.

**숫자를 완료 조건으로 쓰지 않는다** — 추출 방식에 따라 흔들린다(동적 502, admin 기본 401,
멀티라인 detail). 인벤토리의 **집합 동등성**으로 판정한다. `ErrorContractInventoryTest` 가 그
자리이며 **지점 수까지 센다.** admin 2개는 `ADMIN_OPS_TOKEN` 이 있을 때만 등록되므로 조건부
라우트는 따로 센다.

⚠ **커버리지를 문자열 유무로 세지 마라.** `report already exists` 는 더 긴
`report already exists for practice session` 에 부분 일치로 가려, 덮이지 않은 계약이 덮인 것처럼
보인 적이 있다.

### 6-3. unknown key 정책 — 전역 reject + DTO 별 예외

요청 바디 17개 중 **5개가 unknown key 를 허용**한다:

```
POST /v2/auth/login      POST /v2/auth/logout     POST /v2/auth/refresh
POST /v2/consents        POST /v2/uploads/intents
```

나머지 12개는 `additionalProperties: false` 다.

**전역 `fail-on-unknown-properties: true` + 허용할 5개에
`@JsonIgnoreProperties(ignoreUnknown = true)`.**

**반대 방향(전역 허용 + DTO 별 거부)은 Jackson 이 표현하지 못한다** — 실제로 시도해 실패했다.
`ignoreUnknown = false` 는 "거부하라" 가 아니라 **"전역 설정을 따르라"** 는 뜻이라 기본값과 다를
바 없고, 예외가 나지 않는다. Spring Boot 기본값은 `false`(무시)라서, **그 기본을 쓰면 거부해야
할 12개를 닫을 수단이 없다.**

**개수를 박지 말고 `openapi.json` 에서 확인한다** — 이관 중에 이 집합이 7→5 로 바뀐 적이 있다.

응답 쪽은 반대다 — 응답 컴포넌트는 **전부 닫혀 있다.**

## 7. 보존 규칙 — 되돌리면 안 되는 결정

1. **좋아요 카운트는 재집계다**(`feature/community/adapter/db/PostgresCommunityRepository`).
   증감 방식이 "두 번 눌리면 2 증가" 하던 버그 때문에 의도적으로 선택됐다. 성능 명목으로
   증감으로 되돌리면 버그가 부활한다.
2. **댓글 수 증감은 원자적이어야 한다.** `post.setCommentCount(get()+1)` 형태로 옮기면 lost
   update 가 새로 생긴다. 벌크 UPDATE 로 분리한다.
3. **상관 서브쿼리에서 앵커 테이블을 명시한다.** 명시하지 않으면 같은 테이블이 FROM 에 두 번
   들어가 Postgres 가 거부한다. 실제로 한 번 사고가 났던 자리다.
4. **`SKIP LOCKED` 는 현재 0건이다.** 경합 시 블로킹 대기 → 조건 재평가 실패 → 폴링 재시도
   구조다. 정확하지만 처리량이 낮다. 바꾸려면 두 방식을 **구분하는 테스트**를 먼저 세운다 —
   기존 테스트는 구분하지 못한다.

## 8. 검증

### 8-2. 왜 통합 테스트가 필수인가

**가짜 저장소를 쓰는 단위 테스트는 SQL 이 틀려도 초록이다.** Postgres 가 SQL 자체를 거부하는
종류의 회귀는 실 DB 를 치는 통합 테스트에서만 잡힌다. 파이썬 시절 `FakePlatformStore` 를 쓰던
계약 테스트가 그 구멍으로 Postgres 전용 쿼리 버그를 흘려보낸 사례가 있고, 자바에서도
`PostgresAnalysisStore` 가 같은 이유로 실 DB 커버리지 0 이던 자리를 뒤늦게 찾아
`PostgresAnalysisStoreIT` 를 세웠다.

**그리고 통합 테스트가 있어도 CI 가 돌리지 않으면 소용이 없다.** 이관 초기에 Java 통합 테스트
17개가 깨진 채로 dev 가 초록이었다 — `ci.yml` 에 Java 잡이 없었기 때문이다.

### 8-3. 응답 스키마는 Java 쪽이 더 엄격하다

Spring 은 DTO 반환 시 스키마가 강제된다. 응답 컴포넌트는 전부 닫혀 있으므로 여분 필드가 새어
나가지 않는다.

### 8-4. Testcontainers ↔ 최신 Docker Engine — 반드시 필요한 설정

Docker Desktop 4.78.0 / **Engine 29.5.3 / API 1.54** 에서, Testcontainers 는 기본 상태로
`/info` 에 Status 400 을 받고 `Could not find a valid Docker environment` 로 실패한다. 소켓
접근 자체는 되므로(`curl --unix-socket` 성공) 권한이 아니라 **API 버전 협상 실패**다.

**`DOCKER_API_VERSION` 환경변수만으로는 풀리지 않는다.** docker-java 는 시스템 프로퍼티
`api.version` 을 함께 본다. Gradle `Test` 태스크에 셋 다 준다:

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

Testcontainers 버전은 BOM 에 맡기지 않고 고정한다(`extra["testcontainers.version"]`). 이미지는
운영과 같은 **`postgres:18-alpine`** 이다.

CI 는 러너의 Docker 버전이 달라 동작이 갈릴 수 있다. `ci.yml` 에 Postgres 서비스가 있으므로,
필요하면 그것을 외부 DB 로 쓰는 경로를 함께 둔다.
