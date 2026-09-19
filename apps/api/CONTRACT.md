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

**행동 계약은 이 문서와 대응하는 Java 테스트가 판정한다.** `spec/openapi.json`은 springdoc이
만드는 요청·응답 스키마 산출물이자 웹 타입 생성원이다. 오류와 상태 전이 전체를 표현하지
않으므로, 스키마가 같아도 행동 계약의 검증은 별도로 필요하다.

## 계약 변경 절차

API의 요청·응답·오류·상태 전이를 바꿀 때 아래 순서를 따른다.

1. 변경할 행동 계약과 대응 테스트를 확인하고 백엔드 코드를 수정한다.
2. `apps/api`에서 다음 명령으로 OpenAPI 스냅샷을 재생성한다.

   ```sh
   UPDATE_OPENAPI_SNAPSHOT=1 ./gradlew test --tests '*OpenApiSnapshotIT*'
   ```

   갱신 모드는 파일을 쓴 뒤 **의도적으로 실패**한다. 커밋된 자기 스냅샷과 비교하는 검사이므로
   생성된 diff가 의도한 변경만 담는지 검토하고, 갱신 변수 없이 같은 테스트를 다시 실행한다.
3. 루트에서 `pnpm --filter web generate:v2-schema`로 웹 타입을 생성한 뒤 웹 소비자를 수정한다.
   `apps/web/src/lib/api/v2-schema.d.ts`는 생성 명령으로만 갱신한다. 생성 타입이 없는 모바일은
   요청·응답 타입과 모든 호출부를 직접 검색해 호환성을 확인한다.
4. 백엔드 코드 → OpenAPI → 웹 타입 → 웹 수정과 필요한 모바일 수정을 한 PR에 담는다.

**호환 배포:** DB·API 축소는 **expand → compatible code → contract** 순서로 여러 배포에
나누며, 소비 중인 컬럼·필드를 한 배포에서 제거하지 않는다. DB의 데이터 전환과 릴리스 순서는
[DB와 배포 안전성](../../docs/BRANCHING-STRATEGY.md#db와-배포-안전성)을 따른다.

**완료 기준:** 행동 계약 테스트와 갱신 변수 없는 스냅샷 검사가 통과했고, 생성물 diff 및
웹·모바일의 모든 영향받는 소비자를 확인했다. 축소 변경은 구·신 버전의 호환 배포 순서가 정해졌다.

## 2. 기술 스택 (확정, 변경 금지)

| 항목 | 결정 |
|---|---|
| 런타임 | Java 21 + Spring Boot 3.4, Spring Web MVC + **virtual threads** (WebFlux 금지) |
| 빌드 | Gradle (Kotlin DSL) + wrapper, `bootJar` |
| 영속 | Spring Data JPA + `EntityManager` native SQL로 일원화한다(ADR-024, §5-1·§5-2) |
| 스키마 | **Flyway 가 소유**. `V1__baseline.sql` 에 스키마가 동결돼 있다(§5-5). Hibernate `ddl-auto: validate` (`create`/`update` 절대 금지) |
| DB 연결 | `DATABASE_URL`(`postgresql://…`)을 **JDBC URL + username/password 로 변환**(§5-6). 변수 이름은 유지 |
| 스펙 | springdoc-openapi (`openapi_3_1`) |
| 인증 | nimbus-jose-jwt + 커스텀 필터. Apple/Google 은 `JwtDecoder`(JWKS 캐시) |
| S3 | AWS SDK v2 `S3Presigner` |
| DB 버전 | dev·운영 홈서버와 테스트는 **Postgres 18** 계열로 맞춘다(`deploy/home/compose.yml`). PG18 은 NOT NULL 을 `pg_constraint` 로 물질화하는 등 카탈로그가 달라 16 에서 통과한 스키마 검증이 운영을 보증하지 않는다 |
| 테스트 | JUnit 5 + Testcontainers + MockMvc + **ArchUnit**(패키지 구조 검사, ADR-016). Testcontainers 버전 고정과 DB 실행 조건은 §8-4를 따른다 |

## 4. datetime 포맷

**전 엔드포인트가 `Z` + 마이크로초 6자리다.**

Jackson 설정: `WRITE_DATES_AS_TIMESTAMPS=false`, `Instant` 또는 `OffsetDateTime`
(**`LocalDateTime` 금지**), 소수 자릿수 **6자리 고정**(기본은 나노초까지 갈 수 있다).
`JacksonContractTest` 가 못 박는다.

🔁 이것은 이관에서 **의도적으로 낸 유일한 breaking change** 였다. 파이썬은 경로마다 갈려 있었다
— dict 반환은 `...789012+00:00`, Pydantic 모델 반환은 `...789012Z`. 프론트가 전부
`new Date()`/`Date.parse()` 를 쓰고 JS 표준 파서가 둘 다 처리하므로 무영향이었다.

## 5. 영속 계층 규칙

### 5-1. 운영 DB 접근은 JPA 로 일원화한다

외부 seam은 기존 `app` Port이고, Postgres Adapter가 그 Port를 계속 구현한다. Adapter 내부에서
단순 CRUD·조회는 Spring Data repository·JPQL·projection으로, PostgreSQL 의미가 필요한 연산은
§5-2의 `EntityManager` native SQL로 구현한다. 서비스·Domain Model은 Spring Data interface,
Schema Entity, JPA 타입을 알지 않는다.

Schema Entity는 활성 영속 경로를 매핑하고 `actor_memory_entries`·`push_tokens`도
`ddl-auto: validate` 대상이다. 명시적으로 은퇴한 매핑은 아래 목록으로 한정하며,
`EntityMappingIT`가 나머지 테이블·컬럼의 매핑과 검증 대상의 비공허성을 확인한다.

- 구형 `reports`: 현재 `/v2/reports`와 연습 노트는 `practice_reports`를 사용한다.
- `summaries.observation`·`summary`·`intent_alignment`·`key_moment`·`key_dimension`:
  현재 분석 저장자와 관찰 소비자는 사용하지 않는다.
- `practice_sessions.subtext`: 현재 입력·코칭에서 소비하지 않아 내부 전달도 종료했다.
- `users.role`: 현재 관리자 인증은 별도 운영 토큰이며 사용자 역할 컬럼을 사용하지 않는다.
- `community_*` 일곱 테이블(`community_categories`·`community_posts`·`community_comments`·
  `community_post_likes`·`community_anonymous_aliases`·`community_reports`·`community_blocks`):
  1.0.0에서 커뮤니티의 API와 코드를 내렸다([05-community.md](../../docs/requirements/05-community.md)).
  `/v2/community/**`는 404다. 글·댓글·차단·신고·카테고리 데이터와 CHECK 값 검사
  (`ValueCheckCatalogIT`)는 그대로 두고, 되살릴 때는 git 이력에서 `feature/community`를 가져온다.
- `users.nickname`: 이름은 `user_profiles.name`이 정본이다. V7이 옛 값을 복사했고 Schema Entity는
  이 컬럼을 매핑하지 않으며 조회·수정은 이 컬럼을 보지 않는다. **탈퇴의 파기만 예외로 이 컬럼에
  NULL을 쓴다** — 복사 뒤에도 옛 값이 남아 있고 탈퇴는 이름을 지체 없이 파기해야 하기 때문이다
  (`PostgresProfileRepository#withdraw`). 그래서 물리 삭제는 두 릴리스에 걸친다: 그 쓰기를 걷어낸
  릴리스 다음에 `DROP COLUMN` 한다. 이 쓰기가 남아 있는 동안 `LegacyStorageCompatibilityIT`의 제거
  대상에는 넣지 않는다.

이 목록의 DB 구조와 과거 값은 그대로 보존한다. 물리 축소는 호환 코드의 dev·운영 배포와
실제 데이터·외부 소비·백업/복원 확인 후 별도 릴리스에서 진행한다. 동결 마이그레이션과
fingerprint는 바꾸지 않으며 `LegacyStorageCompatibilityIT`가 현재 스키마의 과거 값 보존과
구형 구조를 제거한 격리 테스트 DB의 기동·현재 기능을 검증한다. `transcripts`, 소비 중인
관찰·대화 요약·종료 사유, 보존 정책이 미정인 메타데이터는 이 목록에 포함하지 않는다.

모든 운영 DB 접근은 Spring Data JPA와 `EntityManager`를 사용하며,
운영 `JdbcTemplate`·`NamedParameterJdbcTemplate`·`DataSource` 직접 접근은 없다. 테스트 fixture와
JPA 밖 독립 검증에는 `JdbcTemplate`을 허용한다.

Schema Entity는 스키마 검증과 런타임 영속화를 함께 맡는다. 자기 feature의 Adapter와 영속 내부
repository만 Schema Entity를 사용할 수 있고, app·domain과 다른 feature에서는 접근하지 않는다.

**관계 매핑은 FK ID + 명시적 JOIN이 기본이다.** 같은 feature 안에서 같은 객체 탐색이 서로 다른
운영 경로 둘 이상에 반복되고 명시적 JOIN보다 단순해지는 것이 증명된 경우에만 lazy 단방향 관계를
허용한다. 그때는 명시적 fetch 계획과 쿼리 수 회귀 검사가 필요하다. 양방향 관계, JPA cascade,
orphan removal은 금지하고 DB FK와 `ON DELETE CASCADE`를 유지한다.

### 5-2. PostgreSQL 의미가 필요한 연산은 custom native SQL 로 남긴다

`UPDATE/INSERT … RETURNING`, `ON CONFLICT`, `DISTINCT ON`, 특정 행 잠금, 컬럼식 증감,
JSON 연산, 상관 서브쿼리 조건부 갱신은 Spring Data `save()`나 조회 후 쓰기로 풀지 않는다.

- `@Modifying` 은 rowcount 만 반환하므로 **RETURNING 계열을 대체할 수 없다.**
- `save()` 는 upsert가 아니며, 조회 후 쓰기는 **동시성 winner 판정을 깨뜨린다.**
- `ON CONFLICT DO UPDATE` 와 `DO NOTHING` 은 의미가 다르므로 기존 문장과 판정을 그대로 옮긴다.
- 반환 행은 data-modifying CTE(`WITH changed AS (… RETURNING …) SELECT …`)와
  `EntityManager.createNativeQuery(sql, Tuple.class)`의 **별칭 기반 `Tuple`**로 매핑한다.
  0행·1행·복합 행, DB 생성 UUID, transaction rollback, 행 잠금은
  `src/test/java/com/acttub/actingapi/platform/schema/EntityManagerNativeSqlIT:updateReturningMapsZeroOneAndCompositeRowsByAlias`와
  같은 파일의 `pushUpsertReturnsDatabaseGeneratedIdAndRebindsTheSameRow`가 PostgreSQL 18에서 증명한다.
- 수동 `Object[]` 행 매핑과 직접 JDBC fallback은 허용하지 않는다.
- native bulk SQL 앞에 필요한 변경은 `flush`하고, 뒤에 같은 Schema Entity를 계속 쓰면
  `clear` 후 재조회한다.

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
   `CoachSession.id` 만 외부에서 오며 `push_tokens.id`는 DB default가 생성한다.
   `HandoffConfirmation` 은 PK 가 `coaching_handoff_id` 로 **FK 겸 PK** 다. 회원당 하나인
   `user_profiles`·`portfolios` 도 PK 가 `user_id` 로 같은 형태다.
   Spring Data `save()` 는 `@Id` 가 non-null 이면 `merge()` 를 호출해 불필요한 SELECT 가
   붙는다. → 앱 생성 PK 는 `Persistable<UUID>` 구현(`AppGeneratedUuidEntity`), 그리고
   **INSERT 전 SELECT 가 없음을 검증**한다
   (`src/test/java/com/acttub/actingapi/platform/schema/EntityMappingIT:allActiveAppGeneratedIdsUsePersistOnSave`).
   push token은 `save()`하지 않고 native upsert의 `RETURNING`으로 DB 생성 ID를 받는다
   (`src/test/java/com/acttub/actingapi/platform/schema/EntityManagerNativeSqlIT:pushUpsertReturnsDatabaseGeneratedIdAndRebindsTheSameRow`).
3. **`server_default` vs 앱 측 default 이원화.** JPA 에는 "앱 측 default" 개념이 없다. 필드
   초기화값을 주면 항상 INSERT 에 실려 `server_default` 가 발동하지 않는다. 컬럼별로 판정한다.
   활성 매핑의 `coach_sessions.conversation_summary`는 `''` 기본값이며
   null 로 두면 NOT NULL 위반이다. `summaries.observations_json`/`.uncertainties_json`도
   같은 부류다. 구형 `reports.comparison`의 DB 기본값도 그대로 보존한다.
4. **활성 JSONB 매핑** — `summaries.raw`/`.observations_json`/`.uncertainties_json`,
   `coaching_handoffs.handoff_json`, `practice_reports.report_json`,
   `external_operations.response_payload`(NULL 허용). 구형 `summaries.observation`과
   `reports.biggest_problem`은 DB에 보존하며 활성 매핑에서 제외한다.
   **JSON null(`'null'::jsonb`)과 SQL NULL 을 구분한다.** External Operation 신규 행의 아직 없는
   응답은 SQL NULL이고, claim·release·fail·resume·sweep가 이전 응답을 비우는 값은 Python
   SQLAlchemy JSONB `None`과 같은 JSON null이다. 완료 응답은 JSON 객체다.
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
   (매핑은 은퇴했고 테이블은 남아 있다, §5-1.)

### 5-4. 트랜잭션 경계

1. **외부 호출(S3·LLM — Gemini·OpenAI 양쪽)을 트랜잭션 안에 넣지 않는다.**
   `claim → (수십 초) → complete` 흐름에서 커넥션이 점유된다. `claim`/`complete`/`fail`/
   `release` 는 각각 별도 트랜잭션 메서드다. `TransactionBoundaryTest` 가 지킨다.
2. **내부 헬퍼에 `@Transactional` 을 붙이지 않는다.** 호출자 트랜잭션에 참여하는 것이
   의도다. self-invocation 함정과 겹친다.
3. **기존 `TransactionTemplate` 경계와 `REQUIRES_NEW` propagation을 유지한다.** SOMA-460에서
   경계를 `@Transactional`로 함께 다시 쓰지 않는다. JDBC autocommit 단일 DML을 EntityManager로
   옮기면 같은 의미의 가장 좁은 `TransactionTemplate` 경계를 추가한다.
4. **native bulk UPDATE 뒤에 같은 트랜잭션에서 읽은 managed Schema Entity를 믿지 않는다.**
   `flush`로 실행 순서를 고정하고, bulk 뒤에는 `clear`·재조회해 1차 캐시의 낡은 값을 버린다.

### 5-5. Flyway 가 스키마를 소유한다

**정본이다.** 스키마 변경은 Flyway 마이그레이션으로 들어가고, API 이미지는 실행 jar를 포함한다 —
마이그레이션이 **앱 기동의 일부**다.

**`V1__baseline.sql` 에 스키마 전체(테이블 + enum 타입 + 인덱스 + 제약 + 초기 커뮤니티
데이터)가 동결돼 있다.** enum 타입 열아홉은 V4 가 지우지만 **V1 은 여전히 그것을 만든다** —
동결이라 고칠 수 없고, 빈 DB 는 V1 → … → V4 를 차례로 밟아 결국 같은 자리에 닿는다.

- **빈 DB**: V1 을 실행해 스키마를 재구축한다. 이것이 없으면 신규 환경·재해 복구가 불가능하다
- **기존 DB(dev·운영)**: 같은 V1 버전으로 `baseline` 을 기록만 한다. DDL 은 실행하지 않는다

애플리케이션의 `baseline-on-migrate`는 비활성으로 유지한다. 기존 DB의 최초 baseline은
명시적인 배포 작업이며, 신규·재해복구 DB는 V1부터 마이그레이션을 적용한다.

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

**환경변수 이름은 유지하고**(로컬 설정과 서버 Compose의 주입 계약을 보존하기 위해), URI 를
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

모니터링 메타데이터는 이 상태 전이 계약을 바꾸지 않는 nullable 확장이다. 마지막 실패 분류는
`expected`·`external`·`unexpected`만 저장하며, 기존 행처럼 분류를 알 수 없으면 NULL을 유지한다.
실패·재큐와 같은 트랜잭션에서 기록하고 재시도 소진까지 보존한다. 미분류를 새로운 도메인 실패
종류나 Expected Rejection으로 바꾸지 않는다. 이전 앱으로 복구할 때 추가 컬럼을 삭제하지 않는다.

실행 횟수와 종료 사건의 관측은 성공한 상태 전이의 커밋을 기준으로 한다. Lease 상실·중복 완료·
롤백은 종료 횟수를 늘리지 않고, 도입 전에 끝난 실패를 재시작이나 집계 조회로 소급 통지하지 않는다.
실패한 External Operation이 나중에 재개되면 새로운 종료 사건이 생길 수 있으므로 고유 접수 건수와
종료 사건 수를 같은 값으로 취급하지 않는다. 실행·대기 시각을 확인할 수 없는 행에서는 영상 길이나
기존 `updated_at` 차이로 처리 시간을 만들어내지 않는다.

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

**④ DML `RETURNING`은 data-modifying CTE + alias `Tuple`로 읽는다.**

```sql
WITH changed AS (
    UPDATE ...
    RETURNING id, status
)
SELECT id, status FROM changed
```

Hibernate native query는 위 문장을 `Tuple.class`로 실행하고 `row.get("id", UUID.class)`처럼
별칭으로 읽는다. 0행은 빈 목록이고 1행·복합 행도 같은 경로다. 컬럼 순서에 결합하는
`Object[]`는 쓰지 않는다. native bulk 앞의 pending 변경은 `flush`, 뒤의 managed entity는
`clear`·재조회한다
(`src/test/java/com/acttub/actingapi/platform/schema/EntityManagerNativeSqlIT:explicitFlushAndClearPreserveNativeMutationOrderingAndVisibility`).

## 6. 계약 보존 체크리스트

| # | 항목 | 조치 |
|---|---|---|
| 1 | 오류 포맷 `{"detail": <str>}` | Spring 기본 `ProblemDetail` 을 **반드시** 오버라이드. 본문 모양이 틀린 422 만 `detail` 이 **배열**이고 규칙에 걸린 422 는 코드 문자열이다. `detail` 옆에 형제 필드를 싣는 오류는 **둘뿐**이다(§6-2) |
| 2 | unknown key 정책 | **전역 `FAIL_ON_UNKNOWN_PROPERTIES=true` + 허용 DTO 에만 `@JsonIgnoreProperties(ignoreUnknown = true)`**(§6-3). 반대 방향은 표현 불가 |
| 3 | null 필드 **포함** | `@JsonInclude(NON_NULL)` **전역 사용 금지**(§6-1) |
| 4 | datetime | 전 엔드포인트 `Z` + 마이크로초 6자리(§4). **JDBC 바인딩은 `OffsetDateTime`**(§5-8) |
| 5 | 상태값 표기 | text 컬럼 + CHECK. 종마다 `AttributeConverter`, **`@Enumerated` 금지**(§5-3-1) |
| 6 | refresh 회전 | 소진 토큰 재사용 시 **해당 유저 전 세션 무효화**(의도된 동작) |
| 7 | 404 | "없음" 과 "남의 리소스" 를 구분하지 않는다(존재 노출 방지) |
| 8 | S3 presign | **리전 엔드포인트 고정.** 글로벌 엔드포인트는 신규 버킷에 307 |
| 9 | ffmpeg | 동시 실행 1개 락, 600초 타임아웃, 실패·부재 시 원본 폴백 |
| 10 | 제약명 문자열 의존 | **`consent_documents` 유니크 위반** 판정을 `PSQLException.getServerErrorMessage().getConstraint()` 로 한다. 그래서 `org.postgresql:postgresql` 이 `runtimeOnly` 가 아니라 `implementation` 이다. 리포트 멱등은 제약명을 보지 않는다(`uq_practice_reports_source_handoff` 에 대한 `ON CONFLICT DO NOTHING`) |
| 11 | 테이블 락 획득 순서 | `upload_intents`→`external_operations`, `practice_sessions`→`practice_reports`. 바꾸면 데드락 |
| 12 | canonical JSON | 멱등 replay 는 키 정렬 + 공백 없음 + 한글 raw UTF-8 |
| 13 | `X-Request-Id` 응답 헤더 | 바디만 맞추면 놓친다 |
| 14 | v1 경로 404 | `/summarize`, `/coach/start`, `/coach/reply`, `/report`, `/report/history/{id}` 5개 |
| 15 | 숫자 파싱 | `size_bytes: 12.0`(정수형 float) → **201**, `12.5` → **422** |
| 16 | 커뮤니티 API 은퇴 | `/v2/community/**` 는 **404** 다(1.0.0, 테이블은 보존 §5-1). 인증이 선택이던 경로는 이것뿐이었다. `Authorization` 헤더가 오면 없는 경로에서도 먼저 검증한다 — 탈퇴한 계정의 토큰은 403 |
| 17 | 미처리 예외 500 | `{"detail":"internal_server_error"}` |
| 18 | 5xx `ApiException` | `ApiException.external(...)`·`ApiException.unexpected(...)` 팩토리로만 원인과 함께 만든다 |
| 19 | 클라이언트 판 426 | `X-Acttub-Client`(예: `app/1.0.0`) 없는 `/v2` 요청은 **426** 이고 `detail` 이 코드가 아니라 **안내 문장**이다. 토큰 검증보다 먼저다(§6-5) |
| 20 | 회원 게이트 | `/v2` 는 표에 적힌 **게이트 밖** 말고 전부 보호 기능이다. 동의 → 프로필 순으로 요청마다 DB 상태로 판정한다(§6-5) |
| 21 | 로그인은 계정을 만들지 않는다 | 처음 온 신원은 200 `signup_required` 와 가입 토큰만 받는다. 계정·신원·동의 행은 가입 제출이 통과한 순간 **한 트랜잭션**으로 생긴다(§6-6) |
| 22 | 제공자 장애는 처음 온 사람에게만 | 서버가 제공자에 물어야 하는 자리(카카오 사용자 정보 API, 애플 코드 교환)가 답하지 않으면 **502 `provider_unavailable`** 이고 아무 행도 없다. 제공자 ID 로 찾아지는 기존 회원은 묻지 않고 로그인된다. **네이버만 예외** — 로그인마다 서버가 코드를 교환하므로 기존 회원도 502 다(§6-7) |
| 23 | 탈퇴는 200 과 최초 탈퇴 시각 | `DELETE /v2/me` 만 **탈퇴한 계정의 토큰을 받는다.** 다시 불러도 같은 본문이다. 바깥 호출(객체 삭제·제공자 해제)이 실패해도 200 이고 7일 동안 다시 시도한다(§6-8) |
| 24 | 저장하는 비밀에는 키 판 접두사 | `uid_hash`·토큰 암호문·정리 장부의 payload 는 `k1:`(전용 키)·`d1:`(`JWT_SECRET` 파생) 로 시작한다. 읽을 때 접두사로 키를 고른다. **접두사 없는 값은 없다**(§6-8) |

### 6-1. nullable — "null 로 보낼 것" 과 "키를 생략할 것" 이 다르다

| 동작 | 대상 |
|---|---|
| **required + `null` 값을 실어 보냄** | `AuthUser.email`, `MeResponse.email`/`.profile`, `Profile` 의 `directions` 를 뺀 전 항목(1.0.0 이전 회원은 `name` 만 차 있다), `CoachTurnResponse.handoff`/`.report`, `CoachConfirmResponse.handoff`, `SourceHandoffIds.analysis`, `MemoryItem.source_practice_session_id`, `ConsentEntryDocument.current_decision`/`.decided_at` |
| **optional + 조건부로 키를 추가** | `PracticeSessionDetail.summary`(status 가 `analyzed` 이고 summary 가 있을 때만), `.error_code`(`failed` 일 때만) |
| **optional 인데 항상 포함** | `PracticeSessionStatusResponse.error_code` |

같은 이름의 필드가 엔드포인트마다 다르게 동작한다. DTO 를 분리하거나 직렬화를 수동 제어한다.

⚠ **위 목록을 손으로 세지 않는다** — 도메인이 늘면 낡는다(실제로 `memory` 가 들어오며 한 줄이
빠진 채였다). 스펙에서 뽑는다: 각 컴포넌트의 `required` 에 있으면서 `anyOf` 에 `type: null` 이
섞인 속성이 그 집합이다.

`default` 가 붙은 필드는 **`anyOf [T, null]` 과 겹치지 않는다** — default 가 있으면 nullable 로
선언되지 않는다. 대부분 컬렉션 기본값(`[]`)이나 불리언이다.

### 6-2. 오류 계약은 대부분 `openapi.json` 에 없다

스펙이 명시하는 도메인 오류는 셋뿐이다 — `POST /v2/consents`의
`409 consent_document_outdated`, 그리고 `POST /v2/auth/login`·`/v2/auth/signup`의
`409 account_exists_with_different_provider`(본문에 `providers`). 그 밖의 상태코드는
`200/201/202/204/422`이고, 422는 자동 생성된 validation 오류뿐이다. 실제 오류는 그보다 훨씬
많다.

**오류 본문은 `detail` 하나다. 형제 필드를 싣는 오류는 둘뿐이다**(`ApiException#with`):

| 오류 | 형제 필드 | 쓰임 |
|---|---|---|
| `403 consent_required` | `pending_consents` — 로그인 응답과 같은 `ConsentDocument` 모양, 전문 포함 | 앱이 그 목록으로 동의 화면을 그린다 |
| `409 account_exists_with_different_provider` | `providers` — 기존 계정의 제공자 이름 | "이미 OO로 가입한 이메일이에요" |

셋째를 더하기 전에 이 표부터 고친다.

**422 는 두 모양이다.** 본문의 모양이 틀린 것(필수 키 빠짐·타입·값 목록 밖·길이 상한)은 `detail` 이
**배열**이고, 규칙에 걸린 것은 다른 오류와 같이 **코드 문자열 하나**다: `under_14`,
`under_14_account_closed`, `authorization_code_required`, `consent_decisions_incomplete`,
`required_consent_cannot_be_declined`. (네이버 로그인에 `authorization_code`·`code_verifier` 가 빠진 것은
본문의 모양이 틀린 것이라 **배열**이다 — 애플의 `authorization_code_required` 와 다르다.) 클라이언트는 `detail` 이 문자열이면 사유로 가르고 배열이면
자기 버그로 다룬다. 선례는 `request_fingerprint_mismatch` 다.

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

미처리 예외의 500 응답은 `{"detail":"internal_server_error"}`다. 5xx
`ApiException`은 분류와 원인을 빠뜨리지 않도록 `ApiException.external(...)`·
`ApiException.unexpected(...)` 팩토리로만 만든다. 일반 생성자에 500 이상을 넣으면
`IllegalArgumentException`으로 거부한다. 4xx 응답은 기존 생성자를 그대로 쓴다.

**숫자를 완료 조건으로 쓰지 않는다** — 추출 방식에 따라 흔들린다(동적 502, admin 기본 401,
멀티라인 detail). 인벤토리의 **집합 동등성**으로 판정한다. `ErrorContractInventoryTest` 가 그
자리이며 **지점 수까지 센다.** admin 2개는 `ADMIN_OPS_TOKEN` 이 있을 때만 등록되므로 조건부
라우트는 따로 센다.

⚠ **커버리지를 문자열 유무로 세지 마라.** `report already exists` 는 더 긴
`report already exists for practice session` 에 부분 일치로 가려, 덮이지 않은 계약이 덮인 것처럼
보인 적이 있다.

### 6-3. unknown key 정책 — 전역 reject + DTO 별 예외

요청 바디 16개 중 **5개가 unknown key 를 허용**한다:

```
POST /v2/auth/login      POST /v2/auth/logout     POST /v2/auth/refresh
POST /v2/consents        POST /v2/uploads/intents
```

나머지 11개는 `additionalProperties: false` 다.

**전역 `fail-on-unknown-properties: true` + 허용할 5개에
`@JsonIgnoreProperties(ignoreUnknown = true)`.**

**반대 방향(전역 허용 + DTO 별 거부)은 Jackson 이 표현하지 못한다** — 실제로 시도해 실패했다.
`ignoreUnknown = false` 는 "거부하라" 가 아니라 **"전역 설정을 따르라"** 는 뜻이라 기본값과 다를
바 없고, 예외가 나지 않는다. Spring Boot 기본값은 `false`(무시)라서, **그 기본을 쓰면 거부해야
할 11개를 닫을 수단이 없다.**

**개수를 박지 말고 `openapi.json` 에서 확인한다** — 이관 중에 이 집합이 7→5 로 바뀐 적이 있다.

응답 쪽은 반대다 — 응답 컴포넌트는 **전부 닫혀 있다.**

### 6-4. 관리용 모니터링 경로

`MANAGEMENT_SERVER_PORT`의 기본값은 -1(리스너 비활성)이며, 별도 관리 포트를 켰을 때도
`MONITORING_TOKEN`이 없거나 맞지 않으면 수집을 허용하지 않는다. 관리 토큰은 사용자 인증을
대체하지 않으며, 일반 API 포트와 웹 프록시를 통해 관리 지표나 DB health를 읽을 수 없다.
포트 판정에는 요청의 Host·Forwarded 헤더를 신뢰하지 않는다.

관리 리스너는 인증된 `GET /actuator/prometheus`와 `GET /actuator/health/db`만 제공한다.
기존 `/health`의 응답과 인증 규칙은 유지하고 DB 연결은 별도 관리 health에서 판정한다.
관리 포트에서 비즈니스 API·OpenAPI·환경변수 조회를 제공하지 않는다.

HTTP 지표의 경로는 라우트 템플릿 등 범위가 정해진 값만 사용한다. 사용자·세션·External Operation
식별자, 원문 URL, 요청 본문, 토큰은 label로 넣지 않는다. 코치·리포트의 진행 중 HTTP 시간은
서버가 요청을 처리하기 시작한 때부터 응답 처리가 끝날 때까지이며, DB의 `running` 나이나 모델
호출 시간과 구분한다. 관리 경로와 장시간 처리 경로는 일반 API 지연 집계에서 제외한다.

오류 건수와 비율은 처음 관측된 라우트·상태 코드의 첫 요청 묶음도 집계해야 한다.
상태 코드 갈래와 일반/장시간 처리 갈래로 나눈 HTTP 집계 계수를 요청 전에 0으로 준비하고,
라우트별 응답시간 histogram과 구분한다. 상세 라우트의 첫 표본에만 `increase()`를 적용해
새 오류가 사라지는 상태를 허용하지 않는다.

### 6-5. 클라이언트 판과 회원 게이트

판정 순서는 **426 → 토큰(401) → 계정 상태(403 `account_deactivated`) → 분당 한도(429) → 동의
(403 `consent_required`) → 프로필(403 `profile_required`)** 이다. 요구사항의 정본은
[00-common.md](../../docs/requirements/00-common.md) 「클라이언트 판과 강제 업데이트」·「게이트와 보호 기능」.

**426**(`platform/security/ClientVersionFilter`): `X-Acttub-Client` 가 없거나 비어 있는 `/v2` 요청은
무엇을 부르든 426 이고 본문은 `{"detail":"새 버전이 나왔어요. 스토어에서 업데이트해 주세요."}` 다.
1.0.0 이전 앱이 모르는 상태 코드의 `detail` 을 그대로 보여 주기 때문에 **여기만 `detail` 이 코드가
아니라 문장이다** — 문구를 고치면 옛 앱의 화면이 바뀐다. 헤더를 보지 않는 자리는 `/v2` 밖
(`/health`·관리 포트), 제공자가 부르는 `/v2/auth/providers/*/disconnect`, 운영 토큰으로 여는
`/v2/admin/**` 다. 서버에 1.0.0 이전의 규칙(로그인 즉시 계정 생성, 필수 문서만 보는 게이트, 닉네임)은
남기지 않는다.

**회원 게이트**(`platform/security/ConsentGateInterceptor`·`AccessGate`): 표는 보호 기능이 아니라
**게이트 밖**을 적는다. 적지 않은 새 경로는 닫힌 채로 시작한다.

| 단계 | 경로 |
|---|---|
| 게이트 밖 | `/v2/auth/**`, `/v2/consents/**`, `GET`·`DELETE /v2/me`, `DELETE /v2/push-tokens`, 공개 `/v2/admissions/**`, 운영 `/v2/admin/**` |
| 동의까지만 | `PUT /v2/me/profile` — 개인정보를 받기 전에 수집 동의가 끝나 있어야 하고, 프로필이 빈 사람이 채우는 자리다 |
| 동의 + 프로필 | 그 밖의 모든 `/v2` |

- 동의 게이트는 **현재 판 문서 가운데 미결정이 하나라도 있으면** 막는다. **선택 문서도 센다** — 거절도
  결정이고, 결정하지 않은 것만 막는다. 결정은 판 단위라 새 판이 나오면 그 문서만 다시 미결정이 된다.
- 1.0.0 이전에 필수 문서를 거절·철회한 기록은 **미결정과 같게** 다룬다. 둘을 가르던
  `consent_blocked`, `X-Acttub-Consent-Entry` 요청 헤더, `entry_status` 의 `blocked` 는 없다.
- 프로필 게이트는 여섯 항목(이름·성별·생년월일·방향 하나 이상·경력·목표)이 다 찼는지 본다. 사진과
  소개는 세지 않는다. 판정은 요청마다 DB 상태로 하므로 토큰을 갱신해도 열리지 않는다.
- 어느 경우에도 막힌 원 요청을 서버가 재실행하지 않는다.
- 게스트의 기능별 동의와 프로필 면제는 이 표에 아직 없다.
- 토큰 없이 여는 공개 조회(`GET /v2/consents/documents`·`/v2/consents/notices`, `/v2/admissions/**`,
  `GET /v2/auth/providers`)는 `Authorization` 헤더가 와도 검증하지 않는다
  (`AccessTokenFilter#shouldNotFilter`) — 만료된 토큰을 전역으로 붙이는 클라이언트가 온보딩 콘텐츠에서
  401 을 받지 않게 한다. 제공자가 부르는 `/v2/auth/providers/*/disconnect` 도 같다 — 카카오는
  `Authorization: KakaoAK <어드민 키>` 를 싣는데, 그것을 액세스 토큰으로 검증하면 알림이 전부 401 이 된다.
- **`account_deactivated` 의 예외는 `DELETE /v2/me` 하나다**(`CurrentUserService`). 탈퇴 도중 앱이 죽어 다시
  누른 사람이 403 을 받으면 기기의 자료를 지우는 다음 단계로 가지 못한다. 그 밖의 모든 경로는 남은 액세스
  토큰을 요청마다 403 으로 막는다.

**고지 문서는 동의 문서가 아니다.** 개인정보 처리방침은 `consent_documents` 의 행이 아니라 배포에 든 고정 파일
(`consent-docs/privacy_policy.md`)이고 `GET /v2/consents/notices` 가 전문을 내준다. 결정할 수 없고 게이트에
걸리지 않는다. 동의 문서 `privacy` 는 "개인정보 수집·이용 동의"다. 새 수집이 생기는 변경은 고지만 고치지 않고
`privacy` 의 판도 올린다(`consent-docs/README.md`) — 웹은 `GET /v2/consents/entry` 의 privacy 행
`current_decision` 하나로 계측을 켜며, 그 값은 **현재 판**에 대한 결정이다.

### 6-6. 로그인과 가입 제출

- `POST /v2/auth/login` 은 어느 쪽이든 **200** 이고 본문의 `result` 로 가른다: 이미 있는 계정은
  `signed_in`(토큰·`user`·`pending_consents`), 처음 온 신원은 `signup_required`(`signup_token`·
  `expires_in`·현재 판 `documents`). **`signup_required` 는 어떤 행도 만들지 않는다.**
- 계정을 찾는 순서가 계약이다: ① 제공자 + 제공자 ID → ② 제공자가 **검증했다고 알린** 이메일(그 계정에
  신원을 붙인다) → ③ 처음 온 신원. 검증되지 않은 이메일이 기존 계정과 겹치면 409 다. 로그인할 때
  검증된 이메일이 바뀌어 있으면 `users.email` 을 따라 바꾸되 다른 계정이 쓰는 주소면 그대로 둔다.
- 요청의 자격 값은 제공자마다 다르다: `id_token`(네이버 말고는 필수 — 빠지면 422 배열),
  애플의 `authorization_code`(없으면 422 `authorization_code_required`), 네이버의
  `authorization_code`·`code_verifier`(둘 다 필수 — 빠지면 422 배열)·`redirect_uri`·`state`(선택).
  자격 값은 422 의 `input` 으로 되돌려 보내지 않고 로그에도 남기지 않는다.
- **가입 토큰**(`feature/auth/app/SignupTokens`)은 서버가 저장하지 않는 **암호화** 토큰(JWE
  `dir`+`A256GCM`)이고 30분 산다. 제공자·제공자 ID·검증된 이메일·(애플·네이버) 탈퇴 때 연결을 끊는 데 쓸
  토큰을 담으며 앱은 읽을 수 없다. 키는 `JWT_SECRET` 에서 용도를 못박아 뽑는다.
- `POST /v2/auth/signup` 은 현재 판 **모든** 문서의 결정(`decisions[]`, 선택 문서 포함)을 받아 계정·신원·
  동의 행을 한 트랜잭션에서 만든다. 결정의 확인이 먼저라 빠진 것이 있으면 어떤 행도 생기지 않는다.
  같은 신원의 계정이 이미 있으면(재시도·동시 제출의 진 쪽) 그 계정의 토큰을 준다.
- 분당 한도는 로그인·가입 제출 모두 **IP 로만** 센다(각각 60회, 키가 다르다). 갱신은 IP 와 주체 둘 다.
- 리프레시 토큰은 30일이다.

### 6-7. 제공자와 연결 끊기 알림

- **켜 둔 제공자**(`integration/oidc/ProviderRegistry`): `AUTH_ENABLED_PROVIDERS`(기본 `google,apple`)에 든
  것만 로그인된다. 꺼 둔 제공자는 모르는 제공자와 같은 **400 `unsupported_provider`** 이고 그 제공자를
  부르지도 않는다. 켜 두었는데 설정(키)이 빠진 것은 **503 `provider_not_configured`** 다 — 앞은 의도한
  상태, 뒤는 운영 사고다. 카카오·네이버는 검수 승인 뒤에 이 값에 이름을 더해 켠다.
  `GET /v2/auth/providers` 는 켜 둔 것을 늘 `google, apple, kakao, naver` 순서로 준다. 개발용 제공자는
  이 스위치와 무관하고 목록에 나오지 않는다.
- **이메일 검증 근거**: 구글·애플은 ID 토큰의 `email_verified`. 카카오는 ID 토큰에 그 표시가 없어
  **처음 온 신원에 한해** 사용자 정보 API(어드민 키, `target_id` = `sub`)의 `is_email_valid` 와
  `is_email_verified` 를 본다 — ID 토큰의 이메일과 같은 주소일 때만 검증으로 친다. 이메일이 없는 카카오
  신원은 물을 것이 없어 부르지 않는다. 네이버는 표시가 없어 `@naver.com` 주소만 검증된 것으로 본다
  (`feature/auth/domain/NaverEmail`).
- **네이버는 서버가 코드를 교환한다**(SOMA-528 결정 I-5): `POST https://nid.naver.com/oauth2/token` 에
  client secret 과 함께 보내 받은 `id_token` 을 JWKS(`https://nid.naver.com/oauth2/jwks`, 발급자
  `https://nid.naver.com`, `aud` = 우리 Client ID)로 검증한다. 앱에 client secret 을 두지 않기 위해서다.
  그래서 네이버의 무응답은 기존 회원에게도 502 다. 함께 받은 refresh token 은 암호화해
  `user_identities.naver_token_encrypted` 에 두고 로그인마다 새 값으로 바꾼다.
- **애플 authorization code** 는 처음 온 신원일 때 로그인 요청에서 바로 바꾼다(5분·1회용). 이메일 겹침
  409 를 먼저 가르므로 409 로 끝날 요청에는 코드를 쓰지 않는다. 바꿔 온 값은 가입 토큰에 실려 가입 제출 때
  `apple_token_encrypted` 로 저장된다. 교환과 폐기의 `client_id` 는 ID 토큰의 `aud` 다. 토큰이 없는 기존
  애플 회원(1.0.0 이전 가입)은 다음 로그인 때 채우되 **실패해도 로그인은 된다.**
- **연결 끊기 알림**(`POST /v2/auth/providers/{naver|kakao}/disconnect`): 제공자가 부른다. 클라이언트 판
  헤더도 액세스 토큰도 보지 않는다. **그 신원 행만 지우고 계정은 그대로 둔다.** 응답 코드도 제공자가
  정한다 — 네이버는 **204**, 카카오는 **200**(사용자 정보가 없어도 200 으로 답하라고 하고, 다른 응답은
  발송 실패로 본다). 모르는 신원도 같은 응답이다(탈퇴로 이미 해시가 된 신원). 보낸 쪽을 확인하지 못하면
  **401 `invalid_provider_signature`** 이고 아무것도 지우지 않는다. 설정이 없으면 503.
  - 네이버(개발가이드 §4.4): 폼으로 `clientId`·`encryptUniqueId`·`timestamp`·`signature`. 키는
    `MD5(client secret)` 앞 16바이트, 서명은 `HmacSHA256("clientId=…&encryptUniqueId=…&timestamp=…")` 의
    URL-safe Base64, 식별자는 `base64(iv + AES128/CBC/PKCS5)` 다. MD5·CBC 는 네이버가 정한 규격이다.
  - 카카오(연결 해제 웹훅): `app_id`·`user_id`·`referrer_type` 과 헤더
    `Authorization: KakaoAK <기본 어드민 키>`. 이 웹훅에는 서명이 없어 **어드민 키의 일치가 검증의 전부다.**
  - ⚠ 값을 **본문에서 직접 푼다.** `RequestBodyCachingFilter` 가 본문을 미리 읽어 두기 때문에 컨테이너가 폼
    값을 파싱하지 못한다(`getParameter` 에는 쿼리 문자열만 남는다). MockMvc 는 이 차이를 가리므로
    `ProviderDisconnectCallbackIT` 는 실제 포트로 부른다.
- 바깥 호출은 전부 `integration/oidc` 의 포트(`AppleTokenClient`·`KakaoUserClient`·`NaverTokenClient`) 뒤에
  있고 테스트는 스텁으로 바꾼다. 코드·토큰·제공자 ID 는 로그에도 예외 메시지에도 싣지 않는다.

### 6-8. 탈퇴

- `DELETE /v2/me` 는 **200** 과 `{ "status": "deactivated", "deactivated_at": … }` 다. 처음이든 다시든 같은
  본문이고 시각은 **최초 탈퇴 시각**이다. 게스트의 토큰도 받는다.
- **한 트랜잭션**(`PostgresProfileRepository#withdraw`)에서: 상태 전환, 이메일 파기(I-3 예외로
  `users.nickname=NULL` 포함), 프로필의 이름·사진·소개 파기와 생년월일 → 5세 단위 `age_band`(아래 끝),
  알림 토글 끄기, 포트폴리오 행째 삭제, 이관 코드 삭제, 리프레시 폐기·푸시 토큰 삭제, 진행 중
  `external_operations` 를 `failed`/`account_deactivated` 로 닫고 lease 떼기(분석 중이던 연습도 `failed`),
  신원의 `provider_uid`·토큰을 비우고 `uid_hash` 채우기. 성별·연령대·방향·경력·목표와 배우 기억은 남는다.
- **신원 행은 지우지 않는다.** `uid_hash` = HMAC-SHA256(provider, provider_uid) 만 남긴다
  (`ck_user_identities_uid_or_hash`). 서버는 해시로 옛 계정을 찾지 않는다 — 같은 제공자로 다시 오면 처음 온
  신원이다. 해시의 쓰임은 보관 동의 철회 요청의 본인 확인 하나다.
- **영상 객체**는 "탈퇴 후 영상·녹음 보관·활용"(`retention`)의 **현재 판에 대한 마지막 결정이 동의**인
  사람 것만 남긴다. 현재 판에 답하지 않았으면 거절로 본다. 사진 객체(프로필·포트폴리오)는 언제나 지운다.
  만 14세 미만으로 드러난 1.0.0 이전 회원은 동의와 무관하게 영상을 파기한다.
- **바깥 호출은 트랜잭션 밖이다**(`feature/profile/app/AccountCleanup`). 탈퇴 트랜잭션은 해제에 쓸 값을
  **파기 전에** `account_cleanup_operations`(V9)로 옮겨 두기만 한다 — `object_delete`(객체 키 목록),
  `apple_revoke`(애플 토큰), `kakao_unlink`(회원번호), `naver_revoke`(refresh token). 커밋 뒤 바로 한 번
  시도하고, 실패하면 5분에서 두 배씩(최대 12시간) 늘려 **7일** 동안 다시 시도한다. 성공하거나 7일이 지나면
  행을 값과 함께 지운다 — **끝난 것은 장부에 남지 않는다.** 구글의 연결 해제는 앱이 SDK 로 한다.
- 실패는 묻지 않는다: 시도가 실패할 때마다 `FailureReporter` 로 보고하고, **애플 폐기를 7일 뒤에도 못 하면
  `AppleRevocationAbandoned` 를 따로 보고한다**(App Store 필수). 값은 보고에 싣지 않는다.
- 이 장부는 `external_operations` 가 아니다(SOMA-528 결정 I-10). 그쪽은 연습 세션에 매여 있고 "최대 3회 뒤
  FAILED" 가 고정 계약이다(§5-7). 장부 통합은 연습 영역 재설계의 일이다.
- **키**(`platform/security/AccountSecrets`, 결정 I-11): `ACCOUNT_IDENTITY_HASH_KEY`·
  `ACCOUNT_TOKEN_ENCRYPTION_KEY`. 비어 있으면 `JWT_SECRET` 에서 용도를 못박아 파생하고 기동 때 경고한다.
  저장하는 값마다 어느 키로 만들었는지를 접두사로 붙인다(`k1:` 전용, `d1:` 파생). 암호화는 AES-256-GCM 이고
  값마다 새 nonce 다. 전용 키를 나중에 넣어도 그 전의 값이 읽힌다 — 신원 해시는 3년을 간다(ADR-029).
  운영자는 철회 요청의 본인 확인에서 두 키 모두로 해시를 계산해 대조한다(`identityHashCandidates`).
- 챌린지 참여작 비공개는 그 테이블이 생길 때 탈퇴 트랜잭션에 더한다. 탈퇴 3년 뒤의 파기(해시 행, 보관하던
  영상)는 매일 도는 일이다.

## 7. 보존 규칙 — 되돌리면 안 되는 결정

1. **좋아요 카운트는 재집계다.** 증감 방식이 "두 번 눌리면 2 증가" 하던 버그 때문에 의도적으로
   선택됐다. 성능 명목으로 증감으로 되돌리면 버그가 부활한다. (1·2는 커뮤니티의 규칙이다. 코드는
   1.0.0에서 내렸고 git 이력의 `feature/community/adapter/db/PostgresCommunityRepository`에 있다 —
   되살릴 때와 챌린지의 좋아요·댓글 집계를 만들 때 같은 규칙을 지킨다.)
2. **댓글 수 증감은 원자적이어야 한다.** `post.setCommentCount(get()+1)` 형태로 옮기면 lost
   update 가 새로 생긴다. 벌크 UPDATE 로 분리한다.
3. **상관 서브쿼리에서 앵커 테이블을 명시한다.** 명시하지 않으면 같은 테이블이 FROM 에 두 번
   들어가 Postgres 가 거부한다. 실제로 한 번 사고가 났던 자리다.
4. **`SKIP LOCKED` 는 현재 0건이다.** 경합 시 블로킹 대기 → 조건 재평가 실패 → 폴링 재시도
   구조다. 정확하지만 처리량이 낮다. 바꾸려면 두 방식을 **구분하는 테스트**를 먼저 세운다 —
   기존 테스트는 구분하지 못한다.

### 7-1. 코칭 응답과 종료 (2026-09-10)

- 요청·응답 DTO와 저장 스키마는 유지한다. 웹·모바일의 도움 버튼은 명확한 텍스트 요청을 준비하며 전송은 별도 동작이다.
- `CoachPrompt:buildChat`은 1층 관찰 팩 전체(장면 요약·전체 흐름·소리 측정값·대사 인용·불확실성)·이전 분석 입력과 현재 세션의 대화 원문 전체를 전달한다. `CoachPrompt:select`의 공통 정책이 갈래별 질문 순서보다 우선한다.
- 막힘을 건너뛴 `그 외`는 `coach-video-first-prompt.txt`를 사용한다. 장면 맥락이 모두 비어도 첫 1~2회 장면 질문이나 고정된 질문 구간을 붙이지 않는다. 시작·후속 응답·재생성 모두 같은 기본 코치를 쓰며, 명시적인 분석·표현 선택의 프롬프트와 기존 analysis handoff·report 계약은 유지한다.
- `CoachResponsePolicy:failures`는 빈 응답, 화면에 그대로 노출될 Markdown 강조·제목·코드 기호와 `JSON need` 형태의 내부 형식 메모, 도움 요청 뒤 직전 응답의 완전 반복, 영어 대화에서 완전히 한국어로 돌아온 설명, 종료 요청·8번째 이후의 continue를 재생성 사유로 삼는다. 두 번 실패하면 확인하지 못한 결론을 만들지 않는 대체 응답을 사용한다.
- 종료 시 생성 실패로 만든 handoff는 `completion_level=unavailable`이다. `ReportEngine:buildReportInput`은 이 상태를 두 갈래 모두에서 차단한다. 저장한 handoff로 다시 요청해도 모델을 호출하지 않는다.
- `HandoffReadiness:hasEnoughAnswers`는 초기 폼 발화·종료어·명확한 도움 요청만인 발화를 내용이 확보된 답변에서 제외한다. 구체적인 문제 설명에 "모르겠어요"가 들어 있다는 이유만으로 제외하지 않는다.
- 코칭은 `TextValidator:validateCoachTurn`으로 근거 설명용 어휘를 허용한다. 다른 표면은 기존 `validateTurn`과 `scanGeneratedStrings`를 유지한다.
- 분석은 표면적인 뜻으로 충분한 장면에 숨은 심리를 강제하지 않는다. 모름 응답을 설명할 때도 새 관계 갈등·과거사·심리 원인을 추가하지 않으며, 불확실하다는 단서를 붙인 것만으로 근거 없는 해석을 허용하지 않는다.

### 7-2. 코치 대화와 노트가 읽는 배우 프로필 (2026-09-19)

코치 대화(시작·후속·재생성)와 노트의 모델 입력에 배우가 저장한 **완성된** 프로필을 조건부로 싣는다
([01-account.md](../../docs/requirements/01-account.md) account.profile). §7-1 의 계약은 그대로다 — 요청·응답 DTO,
저장 스키마, handoff·report 계약을 바꾸지 않는다.

- **부재 시 동일성이 계약이다.** 프로필이 없거나(게스트) 여섯 항목 가운데 하나라도 비어 있으면 포트가 `null` 을 주고,
  그때 프롬프트와 모델 입력은 이 기능이 생기기 전과 **바이트 단위로 같다.** 그래서 시스템 프롬프트 본문을 조건 없이
  바꾸지 않는다 — 프로필을 어떻게 쓸지의 지시는 프로필이 실린 호출에만 붙는다. 기존 고정값
  (`frozen/coach-chat-prompt*.txt`·`coach-regeneration-prompt.txt`·`report-input-*.txt`)이 이것을 지킨다.
- **이음매**는 읽는 쪽의 포트 둘이다: `coach/app/CoachProfile`, `report/app/ReportProfile`. 구현은
  `profile/adapter/reader` 에 있고 간선은 `profile → coach.app`·`profile → report.app` 한 방향이다. 교환 타입은
  소비자의 것이고 값은 표시말이다. **생년월일은 넘기지 않는다** — 제공자가 한국 시간의 오늘로 센 만 나이만 간다.
- **코치**: 문자열 경로는 `CoachPrompt:actorProfileBlock` 이 맨 앞의 독립 블록(`## 배우 프로필`)으로, 구조화 경로는
  `StructuredCoachEngine:input` 이 독립 키 `actor_profile` 로 싣는다. 기억 블록의 1,200자 상한과 분리돼 있다.
  `CoachService` 가 **턴마다 다시 읽는다** — 설정에서 고친 값이 다음 코치 대화부터 반영된다. 읽다 실패하면 보고하고
  프로필 없이 대화를 잇는다(기억과 같은 판단).
- **기억과 겹침**: 완성된 프로필이 있으면 모델에 넘기는 기억 **사본**에서 `gender`·`age` 를 뺀다
  (`CoachSessionSnapshot:priorForModel`). 저장된 기억은 바꾸지 않고, 프로필 성별이 "선택 안 함"이어도 옛 기억으로
  보충하지 않는다. 배우가 말한 목표(`goal`)는 남긴다 — 프로필의 최종 목표(셋 중 하나)와 결이 달라 서로 보완한다.
- **저장하지 않는 입력이다.** 프로필은 대화 turn·코칭 상태·handoff·노트·공개 응답·원장의 응답 어디에도 남지 않는다.
  그래서 배우 발화만 읽는 기억 추출(`memory_update`)로 되먹임되지 않는다.
- **노트**: `ReportEngine:generateReport` 가 받는 사람의 ID 로 프로필을 읽어 `buildReportInput` 의 **최상위**
  `actor_profile` 로(handoff 밖), 구조화 노트의 생성 입력에도 나란히 싣는다. 이미 만든 노트는 프로필이 바뀌어도 다시
  만들지 않는다.
- 입력이 맞다는 것까지가 자동 검증이다. 모델이 그 입력으로 잘 말하는지는 실제 모델로 돌리는 coach eval 과 사람의
  의미 검토가 본다.

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

Docker API 버전 협상이 실패하면 소켓 접근이 가능해도 `/info`가 400으로 거부되고
`Could not find a valid Docker environment`로 보일 수 있다.

- Testcontainers 버전은 BOM에 맡기지 않고 [build.gradle.kts](build.gradle.kts)의
  `extra["testcontainers.version"]`으로 고정한다.
- Gradle `Test` 태스크는 `DOCKER_API_VERSION` 환경변수와 `api.version` 시스템 프로퍼티에
  같은 값을 전달한다. 외부에서 환경변수를 지정했을 때도 둘을 동기화해야 docker-java가
  기본 버전으로 접속하는 실패를 막는다. 기본값과 macOS 소켓 설정은 이 태스크에서 확인한다.
- 테스트 DB는 [PostgresContainerSupport](src/test/java/com/acttub/actingapi/support/PostgresContainerSupport.java)의
  Testcontainers가 띄운다. 이미지 메이저는 §2의 운영 DB와 맞춘다.
- CI의 Docker 조건과 실행 범위는 [ci.yml](../../.github/workflows/ci.yml)의 `api` 잡에서 확인한다.
  DB 연결 수와 테스트 격리는 `PostgresContainerSupport` 및 `src/test/resources/application.properties`를 함께 본다.

### 8-5. 영상만 올리는 새 코칭 계약 (SOMA-526)

첫 질문 개정(SOMA-531): 기본 코치와 새 구조화 코치는 공통 `coach/coach-opening-policy.txt`를 사용한다.
전체 흐름에서 중요한 지점을 고르고 답에 따라 살펴볼 기준이 달라지는 쉬운 질문 하나로 시작한다.
기본 코치에 있던 질문 없는 관찰·해석 시작은 폐기한다. 근거가 있는 첫 응답은 질문 누락·중복과
대표적인 모호한 해석 문구를 재생성 사유로 삼고, 새 경로는 근거 참조·focus 저장·즉시 종료도 검증한다.
대사 인용 안의 물음표는 배우에게 묻는 질문 수에서 제외한다. 의미적 관련성과 선정의 적절성은
자동 검사만으로 보장하지 않는다. 공개 JSON과 DB는 유지한다.

2026-09-14의 2·3층 개정은 [대화와 촬영 노트](../../docs/design/COACHING-NOTE-V2.md)를 따른다.
2층 내부 출력은 직전 답변 인용을 포함한 `acttub.layer2_turn.v2`이며 과제/실행 변경을 허용하지 않는다.
서버는 현재 맥락·원문 대화·근거를 `acttub.coach_handoff.v2`로 전달하고 3층이 다음 촬영 제안 하나를 생성한다.
요약은 확인된 배우 말·관찰의 발췌이고, 제안은 선택·실행으로 승격하지 않는다.
공개 `PublicPracticeNote`와 저장 노트 v1의 필드는 유지한다. v1 handoff는 이전 프롬프트로 처리한다.

`X-Acttub-Contract: three_layers_v1`과 서버 생성 플래그로 선택한 신규 연습은 [3층 계약](../../docs/ACTTUB-THREE-LAYERS.md)을 따른다. 기존 입력 갈래의 응답과 legacy 저장 행은 유지한다. 새 공개 타입은 `VideoRecordSummaryResponse`, `PublicPracticeNote`, handoff branch `coaching`이다. 이 타입을 지원하지 않는 클라이언트에는 목록 필터와 직접 접근 409를 적용한다.

새 계약은 배우가 하지 않은 첫 발화를 만들지 않고, state/revision을 누적한다. 보고서 작성 여부나 턴 수를 배우의 실행·확인 증거로 쓰지 않는다. 새 노트는 handoff_confirmation 없이 생성된다. 모델 출력·참조 검증과 레코드 조회, 조립, 상태 전이의 단위 테스트에 더해 `CoachSessionRepositoryIT`에서 새 필드의 원자적 저장과 충돌을 확인한다.
