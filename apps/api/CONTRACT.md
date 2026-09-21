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
- `users.nickname`: 이름은 `user_profiles.name`이 정본이다. V9가 옛 값을 복사했고 Schema Entity는
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
| 25 | 게스트의 게이트는 다른 규칙 | 웹 게스트는 **그 기능의 문서만** 보고 프로필을 면제한다. 회원의 규칙과 합치지 않는다(ADR-028). 어느 기능에도 적히지 않은 경로는 게스트에게 **403 `member_only`** 다(§6-9) |
| 26 | 옮겨진 게스트의 사유가 먼저 | 액세스 **403**·갱신 **401** 둘 다 `guest_transferred` 이고 `account_deactivated` 보다 먼저다. `DELETE /v2/me` 도 예외가 아니다(§6-9) |
| 27 | 이관은 한 트랜잭션 | 도메인마다의 "주인 바꾸기" 포트는 **자기 트랜잭션을 열지 않는다.** 도중에 실패하면 어느 행의 주인도 바뀌지 않는다(§6-9) |
| 28 | 로그아웃은 멱등 | 모르는·폐기된·위조된·**남의** 리프레시 토큰이어도 **204** 이고 아무것도 폐기하지 않는다. 푸시 토큰 삭제는 **로그인 없이** 받는다(§6-10) |
| 29 | 포트폴리오 공개 조회는 같은 404 | 꺼진 링크·없는 slug·탈퇴한 사람의 slug 를 가르지 않는다(`portfolio_not_found`). 로그인 없이, **보는 사람의 IP 별** 분당 60회, 응답에 `X-Robots-Tag: noindex`(§6-11) |
| 30 | slug 는 꺼도 남는다 | 처음 켤 때 생긴 난수 slug 를 다시 만들지 않는다 — 껐다 켜도 같은 주소다. `/`·`+`·`=` 가 없는 글자다(웹의 `/p/<slug>` 는 한 단계만 받는다)(§6-11) |
| 31 | 매일 도는 일은 멱등이고 서로를 막지 않는다 | 한 가지가 실패해도 나머지는 돈다. **쓰인 이관 코드는 30일 안에 지우지 않는다**(`guest_transferred` 의 표식)(§6-12) |
| 32 | 회원 자료는 활성 계정에만 쓴다 | 프로필·알림 토글·사진·포트폴리오·푸시 토큰을 쓰는 트랜잭션은 **탈퇴와 같은 `users` 행을 잡고** 상태를 다시 본다. 게이트를 지난 뒤 탈퇴가 끝났으면 쓰지 않는다(403 `account_deactivated`)(§6-8) |
| 33 | 객체 키를 DB 에서 먼저 잃지 않는다 | 사진 키를 덮거나 행을 지우는 트랜잭션이 `object_delete` 를 **같은 트랜잭션에서** 정리 장부에 남긴다. 저장소 삭제가 실패해도 요청은 끝나고 장부가 다시 시도한다(§6-8·§6-11) |
| 34 | IP 제한의 열쇠는 방문자 주소다 | `platform/security/ClientAddress` 한 자리가 구한다. **신뢰하는 프록시가 붙인** `X-Forwarded-For` 만 믿고 오른쪽부터 읽는다(§6-13) |

### 6-1. nullable — "null 로 보낼 것" 과 "키를 생략할 것" 이 다르다

| 동작 | 대상 |
|---|---|
| **required + `null` 값을 실어 보냄** | `AuthUser.email`, `MeResponse.email`/`.profile`, `Profile` 의 `directions` 를 뺀 전 항목(1.0.0 이전 회원은 `name` 만 차 있다), `CoachTurnResponse.handoff`/`.report`, `CoachConfirmResponse.handoff`, `SourceHandoffIds.analysis`, `MemoryItem.source_practice_session_id`, `ConsentEntryDocument.current_decision`/`.decided_at`, `Portfolio.intro`, `PortfolioPhoto.url`, `PortfolioShare.slug`/`.url`, `PublicPortfolio.photo_url`/`.gender`/`.intro`, `PublicPortfolioPhoto.url`, 연습 노트의 `PracticeNote*`·`PublicPracticeNote` 항목들 |
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
`required_consent_cannot_be_declined`, `age_confirmation_required`, `order_mismatch`,
`portfolio_credit_limit_exceeded`, `portfolio_photo_limit_exceeded`, 그리고 리딩의 `no_characters`,
`invalid_characters`, `script_too_long`, `script_limit`, `request_fingerprint_mismatch`, `invalid_line`, `empty_range`,
`recording_too_long`, `recording_quota`(§6-14; 회차의 409 는 `session_closed`, 녹음 변환 실패는 503
`audio_conversion_failed`). (네이버 로그인에 `authorization_code`·`code_verifier` 가 빠진 것은
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

요청 바디 27개 중 **5개가 unknown key 를 허용**한다(2026-09-21, 리딩 대본 뒤):

```
POST /v2/auth/login      POST /v2/auth/logout     POST /v2/auth/refresh
POST /v2/consents        POST /v2/uploads/intents
```

나머지 22개는 `additionalProperties: false` 다. 1.0.0 에서 더한 요청 바디(리딩의 등록·수정 포함)는 전부 닫혀 있다.

**전역 `fail-on-unknown-properties: true` + 허용할 5개에
`@JsonIgnoreProperties(ignoreUnknown = true)`.**

**반대 방향(전역 허용 + DTO 별 거부)은 Jackson 이 표현하지 못한다** — 실제로 시도해 실패했다.
`ignoreUnknown = false` 는 "거부하라" 가 아니라 **"전역 설정을 따르라"** 는 뜻이라 기본값과 다를
바 없고, 예외가 나지 않는다. Spring Boot 기본값은 `false`(무시)라서, **그 기본을 쓰면 거부해야
할 나머지를 닫을 수단이 없다.**

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
| 게이트 밖 | `/v2/auth/**`, `/v2/consents/**`, `GET`·`DELETE /v2/me`, `DELETE /v2/push-tokens`, 공개 `/v2/admissions/**`·`GET /v2/public/**`, 운영 `/v2/admin/**` |
| 게스트 전용 | `/v2/guest/**`(이관 코드 받기) — 필요한 동의 문서가 없다. 회원이 부르면 403 `guest_only` |
| 동의까지만 | `PUT /v2/me/profile` — 개인정보를 받기 전에 수집 동의가 끝나 있어야 하고, 프로필이 빈 사람이 채우는 자리다 |
| 동의 + 프로필 | 그 밖의 모든 `/v2` |

- 동의 게이트는 **현재 판 문서 가운데 미결정이 하나라도 있으면** 막는다. **선택 문서도 센다** — 거절도
  결정이고, 결정하지 않은 것만 막는다. 결정은 판 단위라 새 판이 나오면 그 문서만 다시 미결정이 된다.
- 1.0.0 이전에 필수 문서를 거절·철회한 기록은 **미결정과 같게** 다룬다. 둘을 가르던
  `consent_blocked`, `X-Acttub-Consent-Entry` 요청 헤더, `entry_status` 의 `blocked` 는 없다.
- 프로필 게이트는 여섯 항목(이름·성별·생년월일·방향 하나 이상·경력·목표)이 다 찼는지 본다. 사진과
  소개는 세지 않는다. 판정은 요청마다 DB 상태로 하므로 토큰을 갱신해도 열리지 않는다.
- 어느 경우에도 막힌 원 요청을 서버가 재실행하지 않는다.
- 위 표는 **회원**의 규칙이다. 웹 게스트는 다른 규칙으로 막힌다(§6-9) — 같은 `AccessGate#gatedUser` 가
  주체를 보고 가른다.
- 토큰 없이 여는 공개 조회(`GET /v2/consents/documents`·`/v2/consents/notices`, `/v2/admissions/**`,
  `GET /v2/auth/providers`, `GET /v2/public/**`)는 `Authorization` 헤더가 와도 검증하지 않는다
  (`AccessTokenFilter#shouldNotFilter`) — 만료된 토큰을 전역으로 붙이는 클라이언트가 게이트 앞의 공개
  콘텐츠(동의 문서·입시 정보)에서 401 을 받지 않게 한다. 제공자가 부르는 `/v2/auth/providers/*/disconnect` 도 같다 — 카카오는
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
- **자격 칸**(`platform/web/CredentialField`)은 로그인의 `provider` 말고 전부(`id_token`·`authorization_code`·
  `code_verifier`·`redirect_uri`·`state`), 가입 제출의 `signup_token`, 갱신·로그아웃의 `refresh_token`, 옮기기의
  `code`, 푸시 토큰의 `token` 이다. 이 표시가 하나라도 붙은 요청 본문의 422 배열은: 빠진 칸의 `input`(본문 전체가
  실리는 자리)에 **선언된 칸 가운데 자격 값이 아닌 것만** 싣고(이름을 잘못 쓴 `idToken` 같은 모르는 키도 뺀다),
  자격 칸 자체와 모르는 키의 `input` 은 `"[redacted]"` 다. 무엇이 틀렸는지는 `loc`·`type` 이 말한다
  (`RequestBodyTreeValidator`, `CredentialInputContractIT`).
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
  애플 회원(1.0.0 이전 가입)은 다음 로그인 때 채우되 **실패해도 로그인은 된다.** 그때 애플의 무응답은 삼키지
  않고 보고한다(`AuthService.keepProviderToken` — 계속 못 채우면 탈퇴 때 폐기할 토큰이 없다). 이미 쓰인 코드
  같은 예상된 거절은 보고하지 않는다.
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
- **리딩 자료는 같은 트랜잭션에서 행째 지운다**(`PostgresProfileRepository#eraseReading`, §6-14). 연습 기록과
  달리 사람과 끊어 남기지 않는다 — 대본·배역·줄·회차·암기 상태가 그렇다. **녹음만 보관 동의를 따른다**: 동의가
  있으면 행을 남기고 `reading_session_id`·`line_id` 를 NULL 로 비운 채 `user_id` 를 유지해 3년 파기가 지우고,
  없으면 행(음성과 **전사**)을 지우고 객체 키를 장부(`reading_recording_delete`)에 올린다. 지우기 전에 그
  사람의 `scripts`·`reading_sessions` 행을 `FOR UPDATE` 로 잡는다 — 리딩의 쓰기가 같은 행을 잡으므로 겹쳐도
  순서가 정해진다(먼저 온 쓰기는 함께 지워지고, 늦게 온 쓰기는 없는 행을 보고 404 다).
- **탈퇴와 겹친 쓰기**: 게이트의 계정 상태 확인은 요청의 앞머리에서 끝나므로, 회원 자료를 쓰는 트랜잭션
  (프로필 저장·알림 토글·프로필 사진·포트폴리오·푸시 토큰 등록)은 **탈퇴가 잡는 것과 같은 `users` 행을
  `FOR UPDATE` 로 잡고 활성인지 다시 본다**(`PostgresProfileRepository#lockActive`,
  `PostgresPortfolioRepository#lockOrCreate`, `PostgresPushTokenRepository#register`). 탈퇴는 `users` 행을 남기므로
  FK 는 뒤늦은 쓰기를 막지 못한다 — 이 확인이 없으면 파기한 이름·생년월일이 다시 차고 지운 포트폴리오 행이
  되살아난다. 쓰기가 먼저면 탈퇴가 그 뒤에 파기하고, 탈퇴가 먼저면 쓰지 않고 게이트가 했을 답
  **403 `account_deactivated`** 를 준다(푸시 토큰 등록은 조용히 204).
- **바깥 호출은 트랜잭션 밖이다**(`feature/profile/app/AccountCleanup`). 탈퇴 트랜잭션은 해제에 쓸 값을
  **파기 전에** `account_cleanup_operations`(V11)로 옮겨 두기만 한다 — `object_delete`(객체 키 목록),
  `apple_revoke`(애플 토큰), `kakao_unlink`(회원번호), `naver_revoke`(refresh token), 그리고 `reading_recording_delete`
  (리딩 녹음 객체 키 목록, V13·§6-14 — 실행은 `object_delete` 와 같다). 커밋 뒤 바로 한 번
  시도하고, 실패하면 5분에서 두 배씩(최대 12시간) 늘려 다시 시도한다. 성공하면 행을 값과 함께 지운다 —
  **끝난 것은 장부에 남지 않는다.** 구글의 연결 해제는 앱이 SDK 로 한다.
- **7일이 지난 뒤는 종류가 가른다**(`AccountCleanupRepository.OBJECT_DELETE_KINDS`). **제공자 해제**
  (`apple_revoke`·`kakao_unlink`·`naver_revoke`)는 포기하고 값과 함께 지운다 — 해제에 쓸 값을 그보다 오래 들고
  있지 않는다. **객체 삭제**(`object_delete`·`reading_recording_delete`)는 **성공할 때까지 대상 키를 지우지
  않는다**: `expires_at` 이 지나도 계속 집어 시도하고, 그때마다 `ObjectDeletionOverdue` 로 운영자에게 알린 뒤
  다음 알림을 7일 뒤로 미룬다(같은 작업을 일주일에 한 번보다 자주 알리지 않는다). 키를 먼저 버리면 그 객체를
  아는 곳이 없어 복구할 수 없다(03-reading 「리딩 자료의 이관·삭제·탈퇴」).
- **`object_delete` 는 탈퇴만 쓰는 것이 아니다.** 객체 키를 DB 에서 덮거나 그 행을 지우는 자리는 전부 같은
  트랜잭션에서 장부에 남긴다(`PostgresObjectCleanupLedger`): 프로필 사진의 교체·삭제, **올리다 만 프로필 사진의
  주소를 다시 받을 때 덮이는 앞의 키**, 포트폴리오 사진의 삭제와 시한이 지난 올리기 찌꺼기. 키를 먼저 잃으면
  저장소가 실패했을 때 그 객체를 아는 곳이 없어 탈퇴의 파기도 찾지 못한다. 저장소 삭제가 실패해도 요청은 끝나고
  (204·200) 장부가 보고하며 다시 시도한다. 올리기 주소가 아직 살아 있는 객체는 **그 시한 뒤에** 지운다
  (`next_attempt_at`) — 먼저 지우면 그 뒤에 올라온 객체가 다시 남는다.
- 실패는 묻지 않는다: 시도가 실패할 때마다 `FailureReporter` 로 보고하고, **애플 폐기를 7일 뒤에도 못 하면
  `AppleRevocationAbandoned` 를 따로 보고한다**(App Store 필수). 값은 보고에 싣지 않는다.
- 이 장부는 `external_operations` 가 아니다(SOMA-528 결정 I-10). 그쪽은 연습 세션에 매여 있고 "최대 3회 뒤
  FAILED" 가 고정 계약이다(§5-7). 장부 통합은 연습 영역 재설계의 일이다.
- **키**(`platform/security/AccountSecrets`, 결정 I-11): `ACCOUNT_IDENTITY_HASH_KEY`·
  `ACCOUNT_TOKEN_ENCRYPTION_KEY`. 비어 있으면 `JWT_SECRET` 에서 용도를 못박아 파생하고 기동 때 경고한다.
  저장하는 값마다 어느 키로 만들었는지를 접두사로 붙인다(`k1:` 전용, `d1:` 파생). 암호화는 AES-256-GCM 이고
  값마다 새 nonce 다. 전용 키를 나중에 넣어도 그 전의 값이 읽힌다 — 신원 해시는 3년을 간다(ADR-029).
  운영자는 철회 요청의 본인 확인에서 두 키 모두로 해시를 계산해 대조한다(`identityHashCandidates`). 절차는
  [RETENTION-REVOCATION.md](../../docs/deploy/RETENTION-REVOCATION.md) 이고, 그 문서의 셸 계산과 서버의 해시가 같은
  값임을 `AccountSecretsTest` 가 고정한다.
- 챌린지 참여작 비공개는 그 테이블이 생길 때 탈퇴 트랜잭션에 더한다. 탈퇴 3년 뒤의 파기(해시 행, 보관하던
  영상)는 매일 도는 일이다(§6-12).

### 6-9. 웹 게스트와 이관

- **게스트**는 보통의 `users` 행 + `provider=guest` 신원(서버가 만든 난수)이다. 게스트 여부는 **신원이 전부
  `guest`** 인 것으로 판정하고 `users` 에 컬럼을 늘리지 않는다(`AuthenticatedUser#guest`, 요청마다 한 질의).
  `POST /v2/auth/guest` 는 **201** 이고 `user.id`·`account_type: "guest"` 를 준다. 한 IP 에서 **시간당 10개**다.
  토큰의 구조·갱신·만료는 회원과 같다. 끝난 게스트의 토큰이 붙어 와도 401 로 막지 않는다.
- **게스트의 게이트**(`platform/security/GuestFeature`): 경로가 속한 **기능의 문서만** 본다. 연습
  (`/v2/uploads/**`·`/v2/videos/**`·`/v2/practices/**`·`/v2/practice-sessions/**`·`/v2/practice-feedback/**`·
  `/v2/coach/**`·`/v2/reports/**`·`/v2/me/memory/**`)은 약관·수집·이용 동의·AI 분석 동의, 리딩
  (`/v2/reading/**`)은 약관·수집·이용 동의 둘이다(서버가 대본·음성을 분석하지 않아 AI 분석 동의는 없다 —
  ADR-031, §6-14). **영상을 보관만 하는 데에도 AI 분석 동의를 받는다** — 보관함의 다음 길이 분석이기 때문이고
  1.0.0 은 이를 받아들인다(practice.record, §6-15). **프로필은 보지 않고 선택 문서는 묻지 않는다.** 403
  `consent_required` 의 `pending_consents` 에는 **그 기능에 빠진 문서만** 싣는다. 어느 기능에도 적히지 않은
  경로는 **403 `member_only`** 다 — 적지 않은 새 경로는 게스트에게 닫힌 채로 시작한다.
- **동의**: 게스트의 **첫** 동의에는 `age_confirmed: true` 가 실려야 한다. 없으면 **422
  `age_confirmation_required`**, 있으면 `users.age_confirmed_at` 에 시각을 남기고 그 뒤로는 묻지 않는다.
  게스트가 선택 문서에 결정을 보내면 403 `member_only`. `GET /v2/consents/pending`·`/entry` 는 게스트에게도
  열려 있고 **필수 문서만** 싣는다 — 웹은 `entry` 의 `privacy` 행 `current_decision`(현재 판 기준) 하나로
  계측을 켠다.
- **분석 하루 3회**: 게스트의 분석 요청(새 연습 + 재분석)은 **한국 시간 자정**에 끊는 하루에 3회까지다. 넘으면
  **429 `guest_daily_analysis_limit`**. 작업 장부의 `analyze` 행을 세고 같은 요청 ID 의 재시도는 세지 않는다.
  **세는 일과 작업을 만드는 일은 한 트랜잭션이다**(`PostgresPracticeSessionLedger#overQuota`): 그 게스트의 `users`
  행을 잡은 채 세므로 겹쳐 온 분석 둘이 같은 수를 보고 함께 지나가지 못한다. 같은 요청 ID 의 재전송은 한도보다
  **먼저** 갈라 재생한다. 재분석에서는 한도(429)가 "실패 상태가 아님"(409)보다 먼저다. 잠금 순서는 올린 영상·연습
  행 → `users` 다(이관과 같은 방향).
- **이관 코드**(`POST /v2/guest/transfer-code`, 게스트 전용, **201** `code`·`expires_in`·`expires_at`): 여섯 자리
  숫자, 10분, 1회용, 새로 받으면 이전 코드는 무효다. **해시로만 저장한다**(HMAC — 키는 `JWT_SECRET` 에서
  용도를 못박아 뽑는다). 다른 게스트의 살아 있는 코드와 해시가 겹치면 다시 뽑는다. **유일성은 DB 가 지킨다**
  (V12 의 부분 유니크 인덱스 둘 — 쓰지 않은 코드는 게스트마다 하나, 숫자마다 하나). 겹쳐 온 발급은 뒤의 INSERT 가
  앞의 커밋을 기다렸다가 `ON CONFLICT DO NOTHING` 의 0행으로 끝나고 다시 뽑으면서 앞의 코드를 지운다 — 둘 다 201
  이지만 살아 있는 코드는 하나다. 발급은 코드 행만 잠근다(`users` 행을 잡으면 옮기기와 순서가 엇갈려 교착한다).
- **옮기기**(`POST /v2/guest-transfers`, 게이트를 지난 회원만, **200** `{"transferred":true}`): 코드가 틀림·
  만료·사용·무효는 가르지 않고 **404 `transfer_code_not_found`**. **틀린 시도만** 센다 — 회원당 분당 5회,
  IP 당 분당 10회. 한도를 채운 뒤에는 **맞는 코드도 평가하지 않는다**(429). 모양이 틀린 코드(422 배열)와
  409 는 틀린 시도가 아니다. **자리를 먼저 잡고 평가한다**(`FixedWindowRateLimiter#reserve`): 평가 중인 시도도
  자리를 차지하므로 겹쳐 보낸 추측 스무 개가 같은 수를 보고 함께 평가되지 못한다. 맞은 코드·409·서버 쪽 실패는
  자리를 되돌려 준다.
- **한 트랜잭션**(`feature/transfer/app/GuestTransferService`): 코드 행을 `FOR UPDATE` 로 잡고(같은 코드를 든
  두 요청 가운데 하나만 받는다), 올린 영상·연습·작업 장부·배우 기억과 리딩 자료(대본·회차·녹음·암기 상태)의
  `user_id` 를 회원으로 바꾸고, 게스트를
  닫는다(`deactivated`, **신원 행 삭제**, 리프레시 폐기 — **행은 남긴다**), 코드를 쓴 것으로 적는다. 분석·
  대화·노트는 연습 행에 매달려 따라간다. 동의 기록은 게스트 행에 남는다. 진행 중 작업은 상태와 lease 를
  건드리지 않아 돌던 워커가 그대로 끝내고, 완료 알림은 **그때의 주인(회원)** 에게 간다.
  - **순서는 올린 영상 → 연습 → 작업 장부 → 기억 → 리딩이다.** 앞의 셋은 새 연습을 만드는 쪽과 같은 방향이라(올린
    영상 행을 먼저 잡는다) 겹쳐 만들어진 연습과 작업을 놓치지 않는다. 기억을 작업 장부 **뒤**에 보는 것은 기억
    갱신 워커 때문이다 — 워커는 완료 트랜잭션에서 작업 행을 잡고 **그 행의 지금 주인**에게 기억을 쓴다
    (`MemoryUpdateQueue#complete` 가 주인을 넘긴다. 모델을 기다리기 전에 읽어 둔 자료의 주인을 믿지 않는다).
    이관이 작업 행을 잡은 뒤에 기억을 보면 저장 중이던 갱신이 끝난 뒤의 기억을 보고, 그 뒤의 갱신은 회원에게
    간다. 기억을 먼저 보면 닫힌 게스트에게 기억이 다시 생긴다.
  - 리딩은 맨 뒤다(`reading/app/ReadingOwnership`, §6-14). 옮기기 전에 **게스트의 `users` 행을 `FOR UPDATE` 로
    잡는다** — 리딩의 쓰기가 같은 행을 잡고 활성인지 보므로, 옮기는 사이에 커밋된 대본이 닫힌 게스트에게 남지
    않는다. 게스트와 회원의 `request_id` 가 겹치면 게스트 쪽 값을 NULL 로 비우고 옮긴다.
  - 🔥 각 도메인의 주인 바꾸기 포트(`UploadOwnership`·`PracticeOwnership`·`MemoryOwnership`·
    `platform/ledger/OperationOwnership`·`auth/app/GuestAccounts`·`reading/app/ReadingOwnership`)는 **자기 `TransactionTemplate` 을 쓰지
    않는다.** 몇몇 저장소의 템플릿은 `REQUIRES_NEW` 라(§5-4) 거기에 얹으면 이관과 따로 커밋돼, 도중에 실패해도
    그 행만 회원에게 넘어간 채로 남는다 — 실제로 그렇게 새는 것을 `GuestTransferIT` 가 잡았다.
  - 배우 기억은 **합치지 않는다.** 회원에게 없으면 옮기고, 둘 다 있으면 `memory_choice`(`member`·`guest`)로
    고른 쪽만 남긴다. 고르지 않았으면 **아무것도 옮기지 않고 409 `memory_choice_required`** — 코드는 살아 있다.
- **옮겨진 게스트의 토큰**: 액세스 **403**·갱신 **401**, 둘 다 `detail: "guest_transferred"` 이고
  `account_deactivated` 보다 **먼저**다(`DELETE /v2/me` 도 예외가 아니다). 표식은 **쓰인 이관 코드 행**이다 —
  신원 행을 지우므로 신원으로는 알 수 없다. 그래서 탈퇴의 파기는 **쓰지 않은** 코드만 지운다. 탈퇴로 닫힌
  게스트는 쓰인 코드가 없어 `account_deactivated` 다. 게스트 신원은 탈퇴 때도 **해시 없이 행째 지운다.**

### 6-10. 알림 토글, 푸시 토큰, 로그아웃

- `GET`·`PATCH /v2/me/notification-settings`(보호 기능, 회원만): 토글 셋 `analysis_done`·`challenge`·
  `evening_reminder`. 기본은 모두 켜짐. `PATCH` 는 **보낸 토글만** 바꾸고 **셋 전체**를 돌려준다(앱이 응답으로
  화면과 캐시를 덮는다). 빈 본문·모르는 키·불리언이 아닌 값은 422 배열.
- 분석 완료와 챌린지가 **둘 다** 꺼지면 같은 트랜잭션에서 그 회원의 푸시 토큰을 **전부** 지운다. 그동안에는
  `POST /v2/push-tokens` 가 와도 저장하지 않는다(204) — 그러지 않으면 다른 기기가 앱을 여는 것만으로 토큰이
  되살아난다. **"둘 다 꺼짐" 확인과 저장은 한 트랜잭션이다**(`PostgresPushTokenRepository#register`): 토글 끄기·
  탈퇴와 같은 `users` 행을 잡아 줄을 선 뒤에 읽은 토글로 거른다. 따로 읽고 쓰면 끄는 도중에 끼어든 등록이 살아남는다. 하나만 꺼져 있으면 토큰은 두고 **보내기 직전에** 프로필의 토글을 읽어 거른다.
- `POST /v2/push-tokens` 는 **보호 기능**이다 — 동의와 프로필이 끝난 회원만(동의 전에는 기기 정보를 받지
  않는다). 게스트는 403 `member_only`. `DELETE /v2/push-tokens` 는 **로그인 없이** 받는다: 푸시 토큰을 갖고
  있다는 것이 본인 확인이고 주인을 따지지 않고 그 토큰 행을 지운다. IP 별 분당 60회. `Authorization` 헤더가
  와도 검증하지 않는다 — 막 만료된 토큰을 붙인 로그아웃이 401 로 막히면 옛 계정의 알림이 그 폰에 계속 온다.
- 발송(`PushService#onAnalysisComplete`)은 **어떤 실패도 밖으로 내보내지 않는다.** 분석 완료 처리는 그대로
  끝나고 실패는 `FailureReporter` 로 간다. Expo 의 ticket 이 `DeviceNotRegistered` 인 토큰은 지운다(ticket 은
  보낸 순서대로 온다). 읽을 수 없는 답과 그 밖의 ticket 오류는 종류만 실어 보고한다(`ExpoPushSender.tickets` —
  본문과 토큰은 싣지 않는다). receipt 는 읽지 않는다.
- `POST /v2/auth/logout` 은 **멱등**이다: 요청에 실린 리프레시 토큰 **하나만** 폐기하고, 이미 폐기됐거나
  모르는 토큰·위조된 토큰·**남의 토큰**이면 아무것도 폐기하지 않고 같은 **204** 다(그 토큰이 실재하는지도
  알려 주지 않는다). 본문의 모양(422 배열)과 액세스 토큰(401)은 그대로 본다. 게이트 밖이다.

### 6-11. 포트폴리오

- 회원당 하나이고 **처음 저장할 때** 행이 생긴다. `GET /v2/portfolio` 는 한 번도 편집하지 않았어도 빈 모양으로
  **200** 이다(404 아님). 전부 보호 기능이고 회원만 쓴다 — 게스트의 기능 표에 없어 403 `member_only`.
- 항목마다 따로 저장한다. 소개글·순서 바꾸기·사진 올리기 끝은 **포트폴리오 본문 전체**를 돌려준다(앱이 응답으로
  화면을 덮는다). 경력 추가는 201 과 경력 하나, 수정은 경력 하나, 삭제는 204, 사진 주소 받기는 201
  `photo_id`·`upload_url`·`expires_at`, 공유는 `share` 객체 하나(`enabled`·`slug`·`url`).
- **값의 형태는 422 배열**이다: 소개글 2,000자, 작품명·역할 1~100자(빈 값 포함), 연도 1900~**내년**(한국
  시간의 오늘에서 센다), 종류가 `film·drama·play·musical·ad·other` 밖. 길이는 code point 로 센다.
  **규칙은 사유 코드 하나**다: 쉰한 번째 경력 `portfolio_credit_limit_exceeded`, 열한 번째 사진
  `portfolio_photo_limit_exceeded`, 순서 불일치 `order_mismatch`(빠짐·중복·모르는 id — 아무것도 바꾸지 않는다).
- 이미 지운 경력·사진을 다시 지우면 **404**(`portfolio_credit_not_found`·`portfolio_photo_not_found`). 없는 것과
  남의 것을 가르지 않는다.
- **사진은 프로필 사진과 같은 길**이다(주소 받기 → 직접 올리기 → 끝 알리기, 형식·크기 규칙은
  `integration/storage/PhotoUploadType` 한 벌). 415 가 413 보다 먼저다. 장수는 올리기가 끝난 사진과 **아직 끝나지
  않은 올리기**를 합쳐 센다. 시한(30분)이 지난 올리기는 세지 않고 다음 주소 받기 때 지운다. 끝 알리기는
  멱등이다. 삭제는 행을 지우면서 객체 삭제를 **같은 트랜잭션에서 정리 장부에 올리고** 커밋 뒤에 시도한다
  (`portfolio/app/PortfolioPhotoCleanup` — 구현은 장부의 주인인 `profile`, §6-8). 저장소가 실패해도 204 다.
- 상한과 순서는 **포트폴리오 행을 `FOR UPDATE` 로 잡은 채** 센다(`PostgresPortfolioRepository#lockOrCreate`).
- **공유 링크**: 기본은 꺼짐. slug 는 처음 켤 때 생기는 128비트 난수(base64url, `/`·`+`·`=` 없음)이고 **꺼도
  남는다.** 같은 값을 다시 보내도 200 이다. "새 링크 만들기"는 없다. `url` 은 `<SITE_URL>/p/<slug>` 이고
  `SITE_URL` 이 비어 있으면 `null` 이다 — 주소를 코드에 박아 두지 않는다(SOMA-528 결정 I-8).
- **공개 조회**(`GET /v2/public/portfolios/{slug}`): 로그인 없음·게이트 밖·`Authorization` 을 보지 않는다.
  브라우저가 직접 부르므로 **보는 사람의 IP 별** 분당 60회다. 꺼진 링크·없는 slug·탈퇴한 사람의 slug 는 같은
  404 `portfolio_not_found`. 응답은 이름·프로필 사진·성별·만 나이·소개글·경력(id 없음)·사진(`url` 만)이고
  `X-Robots-Tag: noindex, nofollow` 를 싣는다. 성별이 `unspecified` 면 **`null`** 이다. 추구하는 방향·경력
  구간·목표와 연습·분석은 없다. 프로필의 것은 `portfolio/app/PortfolioOwners` 포트로 받는다(구현은 `profile`).
- 탈퇴하면 포트폴리오를 행째 지우고 사진 객체는 정리 장부로 간다(§6-8).

### 6-12. 매일 도는 일

`feature/profile/app/AccountHousekeeping#runDaily` — 한국 시간 새벽 4시 30분(`ACCOUNT_HOUSEKEEPING_CRON`).
설정이 없으면 켜져 있고 `ACCOUNT_HOUSEKEEPING_ENABLED=false` 로 끈다. **전부 멱등**이고 한 가지가 실패해도
나머지는 돈다(실패는 `AccountHousekeeping.<일 이름>` 으로 보고).

| 일 | 규칙 |
|---|---|
| 리프레시 토큰 | 만료되거나 폐기된 지 **30일** 지난 행을 지운다. 그 전까지는 재사용 탐지와 문제 추적에 쓴다. 한 문장으로 지운다 — 회전된 옛 토큰이 새 토큰을 `replaced_by_id` 로 가리킨다 |
| 게스트 | 마지막 활동 **30일** 지난 **활성** 게스트를 `ProfileService#withdraw` 로 파기한다. 마지막 활동은 가입·토큰 발급·올리기·연습과 **리딩의 쓰기**(대본 등록 `scripts.created_at`, 회차 시작·진행 저장 `reading_sessions.updated_at`, 녹음 올리기 `reading_recordings.updated_at`, 암기 갱신 `line_memorization.updated_at`) 가운데 가장 늦은 것이다(§6-14). 옮겨진 게스트는 이미 닫혀 있어 고르지 않는다 |
| 탈퇴 3년 | 탈퇴한 지 달력으로 **3년** 지난 계정의 신원 해시 행을 지우고, 보관 동의로 남겨 둔 영상 객체와 **리딩 녹음**(행째 지우고 객체는 장부로, §6-14)의 삭제를 정리 장부에 올린다. 한 트랜잭션이다 — 해시 보관 기간이 곧 영상 보관 기간이다(ADR-029). **고르는 기준은 신원이 아니라 `users.deactivated_at` 과 `users.retention_purged_at`(V10)이다** — 제공자의 연결 끊기로 마지막 신원이 먼저 지워진 회원에게는 해시 행이 없다. 파기를 마친 시각을 적으므로 다시 고르지 않는다 |
| 해제 재시도 | `AccountCleanup#runDue`(5분마다도 돈다) — 7일 지난 **제공자 해제**는 값과 함께 지우고, 7일 넘게 실패한 **객체 삭제**는 키를 지키며 운영자에게 알린다(§6-8) |
| 이관 코드 | 쓰였거나 시한이 지난 지 **30일** 지난 행을 지운다. ⚠ 쓰인 코드는 `guest_transferred` 의 표식이라 그 게스트의 리프레시 토큰이 살 수 있는 30일 동안은 지우면 안 된다(§6-9) |

### 6-13. 방문자 IP

IP 로 거는 제한(로그인·가입 제출·갱신, 게스트 만들기, 옮기기의 틀린 시도, 푸시 토큰 삭제, 포트폴리오 공개
조회)의 열쇠는 **방문자 주소**이고 `platform/security/ClientAddress` 한 자리가 구한다. feature 는
`getRemoteAddr` 를 직접 읽지 않는다(`ClientAddressTest` 가 구조로 막는다).

- 배포 경로는 방문자 → Cloudflare → cloudflared → web(Next rewrites) → api 라서 api 가 보는 상대는 **언제나 web
  컨테이너**다. 그것을 열쇠로 쓰면 모든 방문자가 한 칸을 나눠 쓴다.
- **규칙**: 연결한 상대가 신뢰하는 프록시일 때만 `X-Forwarded-For` 를 보고, **오른쪽부터** 신뢰하는 프록시를
  건너뛴 첫 주소가 방문자다. 방문자가 위조해 보낸 값은 프록시가 덧붙인 진짜 주소의 왼쪽에 오므로 제한을 피하지도
  남의 주소를 막지도 못한다. 신뢰하지 않는 상대가 붙인 헤더는 보지 않는다. 주소가 아닌 값은 풀지 않고(이름 조회
  없음) 연결한 상대로 돌아간다 — 헤더가 없는 로컬 개발도 같다.
- 신뢰하는 프록시의 기본은 루프백과 사설 대역이다. `CLIENT_IP_TRUSTED_PROXIES`(쉼표로 가른 CIDR)로 바꾸고
  `none` 으로 끈다(언제나 연결한 상대).
- ⚠ **web 은 헤더를 그대로 넘긴다** — Next 16.2.10 의 rewrite 는 `X-Forwarded-For` 를 덧붙이지도 새로 만들지도
  않는다(실측). 이 규칙은 **web 이 Cloudflare 를 거친 요청만 받는다**는 배포 조건 위에 선다(Compose 는 web 의
  포트를 밖으로 열지 않는다). web 을 직접 여는 길을 만들면 그 길의 방문자는 헤더를 마음대로 쓴다.
- Tomcat `RemoteIpValve`(`server.forward-headers-strategy`)를 쓰지 않는다: scheme·host·port 까지 전달 헤더로
  덮어 모든 요청에 영향을 주는데, 이 서버는 그것들을 헤더로 판정하지 않는다(§6-4). `CF-Connecting-IP` 도 보지
  않는다 — Cloudflare 를 거친 요청에서는 `X-Forwarded-For` 의 맨 오른쪽과 같은 값이고, 출처를 둘로 두면 다른
  길에서 믿을 헤더만 늘어난다.

### 6-14. 대본 리딩 — 대본·회차·녹음·암기와 그 생애 (SOMA-546)

정본은 [03-reading.md](../../docs/requirements/03-reading.md) 의 각 기능과 「리딩 자료의 이관·삭제·탈퇴」 표다. 서버는 대본·음성을 분석하지 않는다
(ADR-031) — 배역 나누기는 기기의 파서가 하고 배우가 확인한 결과가 그대로 온다.

- **경로**는 전부 `/v2/reading/**` 이고 보호 기능이다. 게스트의 기능 표 `READING` 은 약관·수집·이용 동의 둘이며
  AI 분석 동의는 없다(§6-9). 회원은 회원의 게이트(§6-5)를 지난다.
- **스키마(V13)**: `scripts`·`script_characters`·`script_lines`·`reading_sessions`·`reading_recordings`·
  `line_memorization`. 값 목록은 text + CHECK 이고 Java enum 은 `platform/schema` 에 있다(`ScriptSource`·
  `ScriptLineKind`·`ReadingMode`·`ReadingAdvance`·`ReadingSessionStatus`·`TranscriptSource`·`MemorizationStatus`).
  FK 에 `ON DELETE` 가 없다 — 삭제는 애플리케이션이 표대로 순서를 정해 지운다. `scripts.request_id`·
  `reading_sessions.request_id` 는 (user_id, request_id) 유일이고 이관 충돌 때만 NULL 이다.
  `uq_script_characters_script_name` 은 DEFERRABLE 이다 — 이름 수정이 두 배역의 이름을 맞바꿀 때 문장 사이에서
  잠시 겹치므로 수정 트랜잭션이 `SET CONSTRAINTS … DEFERRED` 로 커밋까지 미룬다.
- **등록** `POST /v2/reading/scripts`: 본문은 `request_id`(UUID)·`title`(1~200자)·`source`(`file`·`paste`·`typed`·
  `sample`)·`raw_text`·`characters[{name}]`·`lines[{ordinal, kind, character_index, text}]`. `ordinal` 은 1부터 배열
  순서와 같아야 하고, `character_index` 는 `characters` 의 자리(0부터)로 대사 줄에만 있다 — 어긋나면 422 배열.
  웹은 같은 값을 `X-Request-Id` 헤더에도 싣는다: 헤더는 없어도 되지만 있으면 본문과 같아야 하고 다르면 422 배열
  (`loc: ["header","X-Request-Id"]`). 만들면 **201**, 같은 요청의 재전송이면 **200** 으로 먼저 만든 대본이다.
  응답은 `ReadingScript`(원문은 싣지 않는다).
  - **재전송은 지문으로 가른다.** 생성 요청의 정규화한 본문(제목·입력 경로·원문·배역 이름·줄)의 SHA-256 을
    `request_fingerprint` 에 저장하고 뒤에 제목·배역 이름을 고쳐도 바꾸지 않는다. 같은 `request_id` 에 같은 지문이면
    먼저 만든 대본, 다른 지문이면 422 `request_fingerprint_mismatch`. 대본을 지운 뒤 같은 id 는 새 대본이다.
  - **규칙은 사유 코드 하나**다: 배역 0 `no_characters`, 비거나(공백 정리 뒤) 같은 대본 안에서 겹치는 이름
    `invalid_characters`, 원문 100,000자·줄 본문 총량 100,000자·줄 3,000·배역 50 초과 `script_too_long`, 대본 수
    회원 100·게스트 20 이상 `script_limit`(`domain/ScriptRules`). **재전송은 개수 검사보다 먼저다** — 마지막 허용
    대본의 재시도가 실패하지 않는다. 거절하면 행이 남지 않는다.
  - **쓰기는 `users` 행을 `FOR UPDATE` 로 잡고 활성인지 본다**(`PostgresScriptRepository#lockActive`, §6-8 과 같은
    형태). 게이트를 지난 뒤 탈퇴·이관이 먼저 끝났으면 쓰지 않고 403 `account_deactivated` 다. 같은 회원의 등록이
    겹쳐도 여기서 줄을 서므로 개수 한도가 정확하다.
- **목록** `GET /v2/reading/scripts?q=`: `{ scripts: ReadingScriptCard[], total_count, in_progress_count }`. 최근 고친
  순(`updated_at DESC`)이고 `q` 는 제목과 배역 이름을 ILIKE 로 찾는다(`%`·`_` 는 글자 그대로, 대사 본문은 찾지
  않는다). 머리의 수는 검색과 무관하다. 카드의 `my_character_names` 는 마지막 회차(가장 늦게 시작한 회차)의 내
  배역이고 회차가 없으면 빈 배열, `status` 는 열린 회차가 있으면 `reading`, 없고 마지막 회차가 completed 면
  `completed`, 그 밖(회차 없음·stopped 만 남음)은 `no_cast`, `last_practiced_at` 은 회차의 마지막 갱신 시각
  (없으면 null), `last_activity_at` 은 그것 아니면 등록 시각이다. `dialogue_count`·`recording_count` 는 집계다.
- **상세** `GET /v2/reading/scripts/{id}`: `ReadingScript` — 배역(`voice_preset`, `dialogue_count`), 줄(`dialogue_no`
  는 대사 줄만 센 순번, 지문·장면은 null), `recording_count`, `open_session_id`, `last_session`(id·status·
  my_character_ids·my_character_names·started_at·ended_at). 없는 것과 남의 것은 같은 **404 `script_not_found`**
  (수정·삭제도 같다).
- **수정** `PATCH /v2/reading/scripts/{id}`: `title?`·`characters?[{id, name?, voice_preset?}]` 만. 줄은 받지 않는다
  (모르는 키라 422 배열). 이름은 앞뒤 공백을 정리하고 비거나 겹치면, 이 대본에 없는 배역 id·같은 id 둘·33자 이상
  프리셋이면 422 `invalid_characters`. `voice_preset` 은 **키가 있을 때만** 바꾸고 null 은 "자동"이다. 배역 id·줄의
  연결·지문은 그대로이고 `updated_at` 이 는다. 응답은 상세와 같은 `ReadingScript`.
- **삭제** `DELETE /v2/reading/scripts/{id}`: 배역·줄·회차·녹음·암기 상태를 행째 지우고 **204**. 녹음 객체의 삭제는
  행을 지운 트랜잭션이 정리 장부(`reading_recording_delete`)에 올리고 커밋 뒤에 시도한다(`reading/app/
  ReadingRecordingCleanup`, 구현은 `profile` 의 `PostgresObjectCleanupLedger`). 저장소가 실패해도 204 이고 장부가
  다시 시도한다. DB 가 도중에 실패하면 아무것도 지워지지 않는다.
- **이관**: §6-9. 대본·회차·녹음·암기 상태의 `user_id` 가 바뀌고 `request_id` 충돌은 게스트 쪽을 비운다.

**리딩 회차 (SOMA-546 RA2)** — 정본은 reading.cast·reading.session.

- **시작** `POST /v2/reading/scripts/{id}/sessions`: 본문은 `request_id`·`my_character_ids[]`·`mode`(`read`·`quiz`)·
  `start_line_id`·`end_line_id`·`advance`(`silence`·`manual`)·`record`. `X-Request-Id` 헤더는 대본 등록과 같은 규칙이다.
  만들면 **201**, 같은 `request_id` 의 재전송이면 **200** 으로 먼저 만든 회차다(`reading_sessions` 에는 지문 컬럼이 없어
  저장된 속성 여섯과 대본이 모두 같아야 재전송이고, 하나라도 다르면 422 `request_fingerprint_mismatch`). 응답은
  `ReadingSession`(카드 필드 + `script_id`·속성·`current_line_id`·`progress_seq`·`line_results`·`recordings`).
  - **한 트랜잭션에서 대본 행을 `FOR UPDATE` 로 잡고**(같은 대본의 시작이 여기서 줄을 선다) 열린 회차를 `stopped` 로
    바꾼 뒤 새 회차를 만든다 — 열린 회차는 대본당 하나다(`uq_reading_sessions_open_script` 가 그물). 도중에 실패하면
    닫으려던 회차도 그대로다. `current_line_id` 는 구간의 첫 대사 줄(= `start_line_id`), `started_at` 은 앱 시계다.
  - **규칙은 사유 코드 하나**: 내 배역이 없거나 겹치거나 그 대본의 배역이 아니면 `invalid_characters`, 구간의 줄이 그
    대본의 대사 줄이 아니면(지문·장면·남의 줄·없는 줄) `invalid_line`, 시작 줄이 끝 줄 뒤이거나 구간 안에 내 대사가
    없으면 `empty_range`, 없는 대본·남의 대본 404 `script_not_found`. 모든 배역을 내 배역으로 골라도 된다.
- **목록** `GET /v2/reading/scripts/{id}/sessions`: `{ sessions: ReadingSessionCard[] }`, 최근순(`started_at DESC`). 카드는
  `ordinal`(그 대본에서 시작한 순, 집계)·`status`·`my_character_ids`·`my_character_names`·`range{start_dialogue_no,
  end_dialogue_no}`·`my_dialogue_count`(구간 안 내 대사 수)·`recorded_line_count`(녹음된 줄 수)·`elapsed_seconds`·
  `started_at`·`ended_at`. "이어서 연습 · K / N" 의 N 은 `end_dialogue_no − start_dialogue_no + 1`, K 는 현재 줄의 대사
  번호에서 센다. 없는 대본·남의 대본은 404 `script_not_found`.
- **상세** `GET /v2/reading/sessions/{id}`: `ReadingSession`. `recordings` 는 줄 순서의 녹음 행이고 `playback_url`·
  `playback_expires_at` 은 녹음 기능(RA3)이 채우기 전까지 `null` 이다. 없는 것과 남의 것은 404 `session_not_found`
  (진행 저장·삭제도 같다). 대본이 지워지면 회차도 없다.
- **진행 저장** `PATCH /v2/reading/sessions/{id}/progress`: `progress_seq`(필수, 0 이상)·`current_line_id?`·
  `elapsed_seconds?`(0 이상)·`line_results?[{line_id, outcome passed·unmatched·skipped, misses}]`·`complete?`. 응답은
  `ReadingSessionProgress{current_line_id, elapsed_seconds, progress_seq, status}` 로 **언제나 현재 값**이다.
  - 판정 순서: 404 → completed·stopped 면 **409 `session_closed`** → `progress_seq` 가 저장된 값보다 크지 않으면 아무것도
    바꾸지 않고 200(늦게 온 옛 요청이 최신을 덮지 못한다) → 위치·줄 결과의 줄이 구간 안 대사 줄이 아니면 422
    `invalid_line`(아무것도 바꾸지 않는다) → 반영.
  - 반영: 보낸 항목만 바꾼다. 시간은 `GREATEST(저장값, 보낸 값)` 로 줄지 않고, 줄 결과는 **줄마다 하나, 마지막 사건이
    이긴다**(보낸 줄만 갈아 끼우고 보내지 않은 줄은 남는다). `complete=true` 면 `completed`·`ended_at`(앱 시계)·
    `current_line_id=null`. 회차 행을 `FOR UPDATE` 로 잡은 채 한다 — 이관·삭제가 먼저 끝났으면 남의 것이라 404 이고
    옛 계정에 아무것도 남지 않는다(계정 상태를 따로 보지 않는다 — 행의 주인이 그 답이다).
- **삭제** `DELETE /v2/reading/sessions/{id}`: 회차와 그 녹음 행을 지우고 객체 삭제를 같은 트랜잭션에서 장부
  (`reading_recording_delete`)에 올린 뒤 **204**. 암기 상태는 줄에 매달려 있어 남는다.
- **대본 카드**(§6-14 대본 절)의 `status`·`my_character_names`·`last_practiced_at` 과 상세의 `open_session_id`·
  `last_session` 이 이 회차들로 집계된다. 마지막 회차는 `started_at DESC, id DESC` 의 첫 행이다(같은 시각이면 id 순).

**줄 단위 녹음 (SOMA-546 RA3)** — 정본은 reading.recording. 서버가 음성을 건드리는 유일한 일은 형식 변환이다(ADR-031).

- **올리기** `POST /v2/reading/sessions/{id}/recordings` — **유일한 multipart 요청**이다: `request_id`·`line_id`·`attempt_no`
  (1부터)·`audio`(파일)·`duration_ms`·`transcript_source`(`stt`·`none`)·`transcript?`·`matched?`(`true`·`false`).
  `X-Request-Id` 헤더는 대본 등록과 같은 규칙이다. 칸의 모양(필수·UUID·정수·값 목록, none 인데 전사·대조가 실림)은
  핸들러가 직접 422 **배열**로 만든다 — JSON 본문의 검증기가 닿지 않는 자리다(`RecordingController`).
  `RequestBodyCachingFilter` 는 multipart 를 캐시하지 않는다(컨테이너의 파트 파싱이 원 스트림을 읽는다 —
  `ReadingRecordingUploadServerIT` 가 실제 서버로 본다). 컨테이너 상한은 `spring.servlet.multipart.*`(25MB)이고 넘으면
  핸들러 전이라 **413 `upload_too_large`**(advice) 다.
  - **순서**: 크기·길이 한도(10,000,000바이트·180,000ms 초과 → 422 `recording_too_long`) → 잠그지 않는 사전 확인(회차
    404 `session_not_found`, 구간 안 내 대사 줄이 아니면 422 `invalid_line`, 같은 `request_id` 는 200 현재 값, 같은 줄에
    더 큰(같은) `attempt_no` 가 있으면 200 현재 값) → `audio/mp4`·`audio/m4a`·`audio/x-m4a`·`audio/aac` 가 아니면 ffmpeg
    로 m4a(AAC) 변환(`integration/media/AudioTranscoder`, 실패 → **503 `audio_conversion_failed`**, 행·객체 없음) →
    객체 올림(`reading/{user_id}/{session_id}/{line_id}/{request_id}.m4a`, 스토리지가 없으면 503
    `storage_not_configured`) → **회차 행을 `FOR UPDATE` 로 잡은 최종 저장**(같은 확인을 다시 하고 총량을 본다).
    바깥 호출(변환·올림)은 트랜잭션 밖이다(§5-4).
  - **총량**은 저장된(변환 뒤) `byte_size` 합으로 회원 1,000,000,000·게스트 100,000,000 바이트다. 대체는 앞 녹음의 바이트를
    빼고 센다. 넘으면 422 `recording_quota` 이고 기존은 그대로다(이관으로 넘어도 보존). 최종 저장이 거절(404·422)하거나
    재전송·작은 시도 번호로 끝나면 방금 올린 객체의 키를 **같은 트랜잭션에서** 장부(`reading_recording_delete`)에 올린다.
  - **대체**: 같은 (회차, 줄)에 더 큰 `attempt_no` 가 오면 **행은 하나**(id 그대로)이고 앞 객체는 장부로 지운다. 만들거나
    대체하면 **201**, 재전송·작은 번호는 **200**. 응답은 `ReadingSessionRecording`(재생 주소 포함).
  - 올리기는 회차의 진행 상태와 분리된다 — completed·stopped 에도 받는다(`session_closed` 는 진행 저장에만). 회차·대본이
    지워졌으면 404 이고 녹음은 되살아나지 않는다. 이관이 먼저 끝났으면 회차가 남의 것이라 404 이고 올린 객체는 장부가 지운다.
  - `transcript_source=none` 이면 `transcript`·`matched` 는 NULL 이다. `matched` 는 기기 결과 그대로(인식 불가·무발화 NULL).
- **재생**: 회차 상세와 올리기 응답의 `playback_url` 은 10분 서명 주소이고 `playback_expires_at` 이 만료 시각이다
  (`reading/app/RecordingPlayback`, 조회할 때마다 새로 만든다). 스토리지가 없으면 둘 다 `null`.
- **삭제** `DELETE /v2/reading/recordings/{id}`: 행을 지우고 객체 삭제를 장부에 올린 뒤 **204**. 회차 진행·암기 상태는 그대로다.
  없는 것과 남의 것은 404 `recording_not_found`.
- 저장소 포트 `ObjectStorage` 에 `upload(objectKey, mimeType, Path)` 가 생겼다(서버가 직접 올리는 유일한 객체).

**암기 표시 (SOMA-546 RA4)** — 정본은 reading.memorization. 표시는 (사람, 줄)마다 하나이고 회차·녹음과 무관하다.
외웠는지는 배우가 정한다 — 대조 통과(회차의 `line_results`·녹음의 `matched`)를 서버가 표시로 옮기지 않는다.

- **갱신** `PUT /v2/reading/lines/{line_id}/memorization`: 본문 `{ status }`(`memorized`·`not_yet`, 모르는 값·빠짐·모르는
  키는 422 배열). `request_id` 가 없다 — 같은 값을 다시 보내면 같은 결과라 멱등 지문이 필요 없다. 응답은
  `ReadingLineMemorization{line_id, status, updated_at}` 로 **200** 하나다(만들든 바꾸든).
  - **판정**: 그 줄이 없거나 남의 대본의 줄이면 **404 `line_not_found`** → 지문·장면 줄이면 **422 `invalid_line`** → 대사
    줄이면 배역과 무관하게 받는다(상대역 대사 줄도 200 — 배역 선택은 기기의 것이다). 회차가 있든 없든 같다.
  - **저장**은 `INSERT … ON CONFLICT (user_id, line_id) DO UPDATE` 한 문장이다 — 두 기기의 상반된 갱신은 **마지막 요청이
    남는다**. 같은 상태의 재전송은 `updated_at` 을 바꾸지 않는다(CASE 로 옛 값을 유지). 판정과 저장은 그 줄의 **대본 행을
    `FOR UPDATE` 로 잡은** 트랜잭션 안이다(`PostgresMemorizationRepository`) — 이관이 대본을 옮긴 뒤 옛 게스트의 늦은
    갱신은 남의 것이라 404 이고(게이트가 먼저 403 `guest_transferred` 로 막는 게 보통이다) 닫힌 계정에 행이 남지 않는다.
- **조회** `GET /v2/reading/scripts/{script_id}/memorization`: 그 대본 줄에 남긴 표시의 **배열**(`ReadingLineMemorization[]`)
  이고 줄 순서(`script_lines.ordinal`)다. 행이 없는 줄은 아직 표시하지 않은 줄이라 배열에 없다(표시가 없으면 `[]`).
  없는 대본·남의 대본은 **404 `script_not_found`**. 대상 계산("암기하지 못한 대사 N개", 배역 고르기, 다시 볼 줄)은 기기가
  이 배열과 대본 상세로 한다.
- **생애**: 회차·개별 녹음 삭제는 건드리지 않고(§6-14 회차·녹음 절), 대본 삭제가 그 줄의 행을 함께 지운다
  (`PostgresScriptRepository#delete`). 이관은 `ReadingOwnership.reassign` 이 `user_id` 를 옮긴다. 탈퇴 때 행째 지우는 것은
  RA5 다.
- OpenAPI 컴포넌트: `ReadingMemorizationRequest`·`ReadingMemorizationStatusInput`·`ReadingLineMemorization`(`status` 는
  `MemorizationStatus`).

**생애 — 이관·삭제·탈퇴·파기 (SOMA-546 RA5)** — 정본은 03-reading 「리딩 자료의 이관·삭제·탈퇴」 표다. 다섯 기능이
서로 다르게 말하지 않도록 **그 표 하나가 판정한다.** 표의 다섯 칸을 코드의 자리와 이어 둔다.

| 대상 | 이관(§6-9) | 대본 삭제 | 회차 삭제 | 탈퇴·미이관 게스트 30일 파기(§6-8) |
|---|---|---|---|---|
| `scripts`·`script_characters`·`script_lines` | `user_id` 만(겹친 `request_id` 는 게스트 쪽 NULL) | 행째 | 그대로 | 행째 |
| `reading_sessions` | `user_id` 만(같은 규칙) | 행째 | 행째 | 행째 |
| `reading_recordings` 행 | `user_id` 만 | 삭제 | 삭제 | 보관 동의자만 남김(`user_id` 유지, 회차·줄 NULL), 나머지 삭제 |
| 녹음 객체 | 그대로 | 장부 | 장부 | 보관 동의자는 3년 뒤, 나머지는 곧바로 장부 |
| `line_memorization` | `user_id` 만 | 삭제 | 그대로 | 행째 |

- **DB 삭제는 한 트랜잭션이고 객체 삭제는 커밋 뒤 장부가 재시도한다.** "삭제 도중 실패하면 아무것도 지워지지
  않는다"는 DB 트랜잭션에만 해당한다 — 커밋 뒤 객체 삭제의 실패는 화면에서 이미 지워진 채 장부에 남는다.
- **쓰기는 최종 저장 직전에 다시 본다.** 소유자·계정 상태·부모 행의 존재를 같은 트랜잭션에서 확인하고, 이관·탈퇴·
  삭제가 먼저 끝났으면 옛 계정으로 쓰지 않으며 이미 만든 객체는 장부로 정리한다. 이관·탈퇴·삭제는 **리딩 행을 잠근
  뒤** 진행하므로 둘이 겹쳐도 순서가 정해진다: 대본 등록은 `users` 행(§6-14 등록), 회차 시작·암기 갱신은 대본 행,
  진행 저장·녹음 저장은 회차 행, 탈퇴는 `users` 와 그 사람의 대본·회차 행을 잡는다.
- **게스트의 마지막 활동**에 리딩의 쓰기 다섯이 든다(대본 등록·회차 시작·진행 저장·녹음 올리기·암기 갱신,
  `PostgresProfileRepository#idleGuests`). 웹에서 리딩만 하는 게스트가 30일 파기에 걸리지 않는다.
- **탈퇴·30일 파기**는 `PostgresProfileRepository#eraseReading` 하나다(§6-8). 보관 동의가 없으면 녹음의 **전사도**
  함께 지운다 — 영상 연습의 받아쓰기 보존 규칙과 다르다. 보관 행은 회차·줄 연결이 없어 회차를 조인하는 모든 읽기
  (`PostgresSessionRepository#recordings`·대본의 `recording_count`·녹음 삭제의 소유 확인)에서 자연히 빠진다 —
  **일반 API 에 보이지 않는다**(별도 필터가 아니라 구조가 그렇다).
- **3년 파기**는 영상과 같은 흐름이다(`purgeRetained`, `users.retention_purged_at`). 보관하던 녹음 행을 지우고 객체
  키를 장부에 올린다. 동의 철회는 운영자가 DB 에서 처리하는 절차라 API 가 없다(account.withdraw).
- **객체 삭제 장부**는 성공할 때까지 키를 지키고 7일마다 알린다(§6-8) — 대본·회차·녹음 삭제, 대체된 녹음, 탈퇴
  파기가 모두 같은 `reading_recording_delete` 를 쓴다.

### 6-15. 연습 1.0.0 — 스키마(V14)와 영상 보관함 (SOMA-546)

정본은 [02-practice.md](../../docs/requirements/02-practice.md) 와 「연습 자료의 이관·삭제·탈퇴」 표다. 회차·분석·
대화·노트·기억·설문의 API 는 뒤 티켓이 이 절에 이어 쓴다. **코치의 행동 규칙(§7·§8-5·§8-6, ADR-027)은 바꾸지
않는다** — 1.0.0 이 바꾸는 것은 저장이다.

- **넓히기만 한 V14**: 새 테이블 열(`videos`·`video_transcripts`·`practices`·`analyses`·`coach_conversations`·
  `coach_messages`·`coach_notes`·`actor_memories`·`practice_feedback`·`ai_jobs`)과, `upload_intents` 에 NULL 허용
  컬럼 셋(`request_id`·`request_fingerprint`·`video_id`), `users` 에 `exit_survey_asked_at`·`memory_epoch`. **옛
  테이블은 건드리지 않는다** — `practice_sessions`·`transcripts`·`summaries`·`anomalies`·`coach_sessions`·
  `coach_turns`·`coaching_handoffs`·`practice_reports`·`actor_memory_entries`·`external_operations` 가 그대로 돈다.
  데이터 전환은 Flyway 가 아니라 재실행 가능한 애플리케이션 명령이고, 옛 테이블의 삭제는 읽기·쓰기를 모두 중단한
  버전을 배포한 **다음** 릴리스부터다(02-practice 「1.0.0 스키마 전환」).
  - 값 목록은 text + CHECK 이고 Java enum 은 `platform/schema` 에 있다(`PracticeStage`·`PracticeCloseReason`·
    `ExperienceVersion`·`AnalysisFormat`·`AnalysisStatus`·`NoteFormat`·`NoteKind`·`MemoryField`·`FeedbackScreen`·
    `FeedbackTrigger`·`AiJobKind`·`TranscriptStatus`·`ConversationCloseReason`). 옛 테이블의 값 목록은 그대로 두고
    새 테이블이 자기 것을 갖는다 — `coach_conversations` 의 종료 사유에는 신형의 `system_failure` 가 하나 더 있다.
  - `ai_jobs.failure_reason` 에는 CHECK 를 두지 않는다(분류가 열린 목록이다 — 옛 `external_operations.error_code` 와 같다).
  - **부분 유일 인덱스 둘**: `uq_practices_open_root`(묶음당 closed 아닌 회차 하나 — 409 `practice_in_progress` 가
    여기서 나온다)와 `uq_upload_intents_user_request`(옛 행의 NULL 요청 id 들이 서로 부딪히지 않는다).
  - **테이블이 먼저 서고 코드가 뒤에 선다.** Schema Entity 가 아직 없는 아홉은 `EntityMappingIT.AWAITING_MAPPING`
    에 적혀 있고, 각 기능을 붙이는 티켓이 거기서 빼고 엔티티 수를 올린다.
- **보관함**(`/v2/videos/**`, `feature/video`) — 영상은 연습에서 독립한 자산이다. 코칭 회차와 챌린지 참여작이 같은
  `id` 를 가리키고 객체는 하나다("보내기는 복사가 아니라 참조다").
  - **올리기는 세 단계다**: `POST /v2/videos/intents`(201 `{intent_id, upload_url, expires_at}`) → 기기가 그 주소로
    PUT → `POST /v2/videos/intents/{id}/complete`. 예약 장부(`upload_intents`)가 요청 id·지문·객체 키·시한·확정
    `video_id` 를 들고 있어 **마무리 재전송이 같은 영상**을 돌려준다(만들면 201, 재전송이면 200). 예약은
    `request_id` 로 멱등하고 같은 id 에 다른 본문이면 422 `request_fingerprint_mismatch` 다. `X-Request-Id` 헤더는
    대본 등록과 같은 규칙이다(있으면 본문과 같아야 한다).
  - **한도**: 파일 100MiB·길이 5분(넘으면 422 `video_too_large`·`video_too_long`), 총량은 회원 5GiB·게스트 500MiB
    이고 `purged_at` 없는 행의 `byte_size` 합이다(넘으면 422 `video_quota`, 기존은 보존). 형식은 MP4·MOV 뿐이고
    그 밖은 값 오류(422 **배열**)다. 기기도 같은 값을 검사하지만 서버가 다시 본다.
  - **총량 검사와 확정은 `users` 행을 `FOR UPDATE` 로 잡은 한 트랜잭션**이다 — 한도 직전에 겹쳐 온 확정 둘 가운데
    하나만 통과한다. **바깥 호출(저장소)은 그 트랜잭션 밖이다**(§5-4): 주소를 받고 올라온 객체를 확인하는 일은
    서비스가 하고, 아직 안 올라왔거나 크기가 예약과 다르면 422 `video_not_ready` 다.
  - **시한은 30분**이다. 지난 뒤의 마무리는 422 `upload_expired` 이고 예약을 `expired` 로 닫으며 **미확정 객체의
    삭제를 같은 트랜잭션에서 장부**(`object_delete`)에 올린다.
  - **목록** `GET /v2/videos?filter=all·recent7·favorite&cursor=`: `{videos, next_cursor}` 로 최신 저장순이다(커서는
    저장 시각과 id). 예시 영상을 섞지 않는다. **재생 주소는 상세에만** 있다 — 한 쪽에서 서른 개의 주소를 만들 이유가
    없다.
  - **상세** `GET /v2/videos/{id}`: `Video` + 10분 서명 `playback_url`·`playback_expires_at` + `usage{practice_count,
    entry_count}`. 조회할 때마다 새 주소다. 없는 것과 남의 것은 같은 **404 `video_not_found`**(수정·삭제·파기도 같다).
  - **삭제** `DELETE /v2/videos/{id}`: **참조가 없을 때만** 204 다. 회차나 참여작이 참조하면 422 `video_in_use` 이고
    아무것도 지우지 않는다 — 오류 본문은 코드 하나이고 **사용처는 상세 조회에서** 본다. 지우면 받아쓰기도 함께
    지우고 객체는 장부로 간다. 참조 확인과 삭제는 **영상 행을 잠근 채** 한다(회차 시작과 겹쳐도 하나만 성공한다).
  - **파일만 파기** `POST /v2/videos/{id}/purge-file`: 회차·참여작의 기록은 남기고 객체·받아쓰기만 지운다
    (`purged_at`). 그 영상은 재생 불가로 표시되고 **총량에서 빠진다** — 총량이 가득한 계정이 공간을 되찾는 길이다.
    이미 파기된 영상에 다시 걸면 같은 답이고, 파기했어도 참조가 있으면 삭제는 여전히 422 다.
  - **즐겨찾기** `PATCH /v2/videos/{id}` `{favorite}` → `Video`.
  - **이관**은 `video/app/VideoOwnership` 이 `videos` 와 **예약 장부**를 함께 옮긴다(§6-9의 순서에서 올린 영상 바로
    뒤다). 예약을 두고 가면 옛 게스트의 대기 업로드가 마무리될 자리를 잃는다.
- **회차**(`/v2/practices/**`, `feature/practice` 의 1.0.0 코드) — 영상 하나로 시작하는 연습의 단위다.
  - **시작** `POST /v2/practices`: 본문 `request_id`·`video_id`·`scene{situation, character, goal}`·
    `blockage{category, detail, note}`. **회차 하나와 분석 작업 하나가 한 트랜잭션**이다 — 도중에 실패하면 둘 다
    없다. 첫 회차는 `root_id = 자기`·`ordinal = 1`·`stage analyzing` 이고 `ai_jobs` 에 `analyze` 가 `pending` 으로
    선다. 응답은 **201** `Practice`.
    - **잠그는 순서가 규칙을 세운다**: 시작은 **영상 행**(보관함의 삭제·파기와 같은 행, §6-15 보관함)을 잡고,
      이어하기·재시도는 **묶음의 첫 행**을 잡으며, 게스트의 하루 한도는 **사용자 행**을 잡고 센다.
    - Scene Context 는 셋 모두 선택이고 각 300자, 막힘 서술은 500자다(넘으면 422 **배열**). 비우면 빈 문자열로
      저장하고 **시작 뒤에는 바꾸지 않는다** — 고치는 API 가 없다. 막힘을 고르지 않으면 "그 외/그 외"이고 큰 갈래와
      세부의 조합은 옛 CHECK 와 같다. **이론 선택은 1.0.0 에 없다.**
    - **경험 판**(`experience_version`)은 서버 플래그(`ACTTUB_THREE_LAYERS_ENABLED`)가 켜져 있고 계약 헤더
      `X-Acttub-Contract: three_layers_v1` 이며 **장면·막힘을 하나도 적지 않았을 때만** `three_layers_v1` 이다. 그 밖은
      전부 `legacy` — 본문에 `client_experience` 같은 필드는 없다(헤더가 정본이다).
    - 영상이 없거나 남의 것이거나 `purged_at` 이 찼으면 422 `video_not_ready`. 게스트가 하루 세 번을 넘기면 429
      `guest_daily_analysis_limit`(한국 시간 자정에 끊고, 두 흐름이 공존하는 동안 옛 `external_operations` 의 요청도
      같은 하루에 든다). 같은 `request_id` 에 다른 본문이면 422 `request_fingerprint_mismatch`.
  - **이어하기** `POST /v2/practices/{id}/continue`: 같은 묶음의 다음 차수다. `video_id` 를 보내지 않으면 이어받을
    회차의 영상을 그대로 쓴다. **묶음에 닫히지 않은 회차가 있으면 409 `practice_in_progress`** 이고 본문은 코드
    하나다 — 그 회차 id 는 묶음 조회의 `in_progress_practice_id` 에서 얻는다. 차수는 묶음 잠금과
    `uq_practices_root_ordinal` 로 발급하므로 겹쳐 온 요청 둘 가운데 하나만 받는다.
  - **재시도** `POST /v2/practices/{id}/analyze`(본문 `request_id`): 실패로 닫힌 회차에 새 작업을 걸고 `analyzing` 으로
    돌린다. 아직 실패하지 않았으면 409 `analysis_not_failed`, 묶음에 다른 진행 중 회차가 있으면 409
    `practice_in_progress` 다. 웹이 가정한 `/retry` 가 아니라 **옛 `/v2/practice-sessions/{id}/analyze` 와 같은 꼴**이다.
  - **묶음 목록** `GET /v2/practices?filter=all·favorite·recent30`: `{ groups: [...] }`. 숨긴 묶음은 빠지고 묶음마다
    회차 요약(`note_title`·`conversation_count` 포함)과 `in_progress_practice_id` 가 온다. **제목은 서버가 첫 행의
    `title` 만 준다** — 없으면 화면이 마지막 회차 노트 제목 → 상황 문장 → "제목 없는 연습" 순으로 채운다.
  - **상세·상태** `GET /v2/practices/{id}`·`GET /v2/practices/{id}/status`: `stage` 는 회차의 진행이고
    `analysis_status` 는 관찰 기록의 상태다(**다른 것이다**). 폴링은 앱 4초·웹 10초다. 없는 것과 남의 것은 같은
    **404 `practice_not_found`**.
  - **취소** `POST /v2/practices/{id}/cancel`: "그만두기"다. 작업을 `failed`/`cancelled` 로 닫고 **lease 를 지워** 늦은
    완료와 재큐를 막으며 회차는 `closed` 다. 화면을 떠나는 것은 취소가 아니다. 이미 끝난 분석은 409
    `analysis_already_finished`.
  - **묶음 속성** `PATCH /v2/practices/{root_id}/group` `{favorite?, hidden?, title?}`: 보낸 것만 바꾼다. 숨김은 묶음
    전체이고 **개별 회차 숨김은 없다** — 노트·대화·기억은 지우지 않고 영상은 보관함에 남는다.
- **`ai_jobs` 장부**(`platform/ledger/AiJobLedger`, `platform/operation/PostgresAiJobLedger`): 종류는
  `analyze`·`memory_update` 둘이다. **lease 상태 전이는 `external_operations` 와 같은 고정 계약**이다(§5-7): 만료돼도
  재선점 전이면 완료를 받고, 토큰이 바뀌었으면 거절하며, `release` 는 `attempt_count` 를 되돌리지 않고, 3회 뒤
  sweep 이 닫는다. `failure_reason` 에는 CHECK 가 없다(분류가 열린 목록이다).
- **옛 흐름은 아직 그대로다** — `/v2/uploads/**`·`/v2/practice-sessions/**`·`/v2/coach/**`·`/v2/reports/**`. 코치·노트가
  `practice_session_id` 에 매여 있어 함께 내려야 하고, 그 전환은 PA4 의 일이다(조정자 결정 2026-09-21). 새 회차 흐름은
  `video_id` 기반이라 옛 것과 겹치지 않으므로 둘이 함께 선다. 코치·노트를 `practice_id` 로 옮길 때 이 절을 맞춘다.
- OpenAPI 컴포넌트: 보관함은 `Video`·`VideoList`·`VideoUsage`·`VideoIntent`·`VideoIntentRequest`·`VideoPatch`, 회차는
  `Practice`·`PracticeGroup`·`PracticeGroupList`·`PracticeStatus`·`PracticeJob`·`PracticeScene`·`PracticeBlockage`·
  `PracticeCreateRequest`·`PracticeContinueRequest`·`PracticeAnalyzeRequest`·`PracticeGroupPatch`.

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
  라우팅 경로(`luna_routes_v1`)에서는 그 입력이 **생성 호출**(`CoachingPipeline:generate`)에 실리고 프로필 지시도 그
  호출에만 붙는다 — 분류·다듬기 호출은 프로필을 받지 않는다(분류는 배우가 무엇을 묻는지만 보고, 다듬기는 문장만 본다).
  `CoachService` 가 **턴마다 다시 읽는다** — 설정에서 고친 값이 다음 코치 대화부터 반영된다. 읽다 실패하면 보고하고
  프로필 없이 대화를 잇는다(기억과 같은 판단).
- **기억과 겹침**: 완성된 프로필이 있으면 모델에 넘기는 기억 **사본**에서 `gender`·`age` 를 뺀다
  (`CoachSessionSnapshot:priorForModel`). 저장된 기억은 바꾸지 않고, 프로필 성별이 "선택 안 함"이어도 옛 기억으로
  보충하지 않는다. 배우가 말한 목표(`goal`)는 남긴다 — 프로필의 최종 목표(셋 중 하나)와 결이 달라 서로 보완한다.
- **저장하지 않는 입력이다.** 프로필은 대화 turn·코칭 상태·handoff·노트·공개 응답·원장의 응답 어디에도 남지 않는다.
  그래서 배우 발화만 읽는 기억 추출(`memory_update`)로 되먹임되지 않는다.
- **텔레메트리에는 이름을 가려 보낸다.** 모델에 보내는 입력은 그대로 두고, 같은 입력을 바깥 수탁사(Langfuse)에
  기록할 때만 이름 자리에 `[redacted]` 를 싣는다 — 문자열 경로는 프로필 블록의 이름 줄
  (`CoachPrompt:withoutActorName`), 구조화 경로(라우팅 경로의 생성 호출 포함)와 노트는 최상위 `actor_profile.name`
  (`platform/observability/ActorNameRedaction`). 탈퇴는 이름을 지체 없이 파기하는데 거기 남은 기록은 서버가 지울 수
  없다. 성별·만 나이·방향·경력·목표는 남긴다. 프로필이 없는 호출의 기록은 글자 하나 바뀌지 않는다.
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

아래 첫 질문·단일 프롬프트 설명은 legacy 및 `acttub.coaching.routed-enabled=false` 롤백 경로에 해당한다.
현재 기본 2층은 [Luna 분류와 코드 기반 선택](../../docs/design/LAYER2-LUNA-ROUTES.md)을 따른다.
첫 질문 개정(SOMA-531): 기존 기본 코치와 구조화 코치는 공통 `coach/coach-opening-policy.txt`를 사용한다.
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

### 8-6. 코드에서 선택하는 네 가지 코칭 프롬프트

`three_layers_v1`의 기본 경로는 Luna 분류 → Java의 프롬프트 선택 → 문장 생성 → 문장 다듬기다.
생성 모델에는 선택된 분류의 지침 하나만 전달한다. 이전 `dialogue_progress` 키워드 분기와 고정 답변은 적용하지 않는다.
첫 응답에서 질문을 강제하지 않고 현재 자료로 제공할 수 있는 도움을 우선한다.
생성 모델은 message·context_update·evidence_refs만 출력하며, 서버가 기존 저장 계약의 revision·reply_link·flow를 조립한다.
영상 텍스트 기록 전체·현재 세션 원문 대화·현재 발화를 전달하고, 질문/종료/실행을 사용자 발화와 혼동하지 않는다.
문장 편집 단계는 message만 받고 맥락이나 분류를 수정할 수 없다. 실패하면 원문 초안을 유지한다.
별도 LLM 가드레일 검토는 없다. JSON 형식·근거 참조·원문 인용·길이·revision 검사는 저장 무결성 검사로 유지한다.
공개 API, DB 스키마, 3층 handoff v2는 유지한다. 종료 요청과 턴 한도는 코드가 관리하고 종료 때는 분류를 생략한다.
