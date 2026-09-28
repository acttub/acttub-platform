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
> [docs/archive/soma287/SPEC.md](https://github.com/acttub/acttub-platform/blob/c2b76b09/docs/archive/soma287/SPEC.md) 에 있다.

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
  0.1.0에서 커뮤니티의 API와 코드를 내렸다([community](../../docs/specs/community/README.md)).
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
| 16 | 커뮤니티 API 은퇴 | `/v2/community/**` 는 **404** 다(0.1.0, 테이블은 보존 §5-1). 인증이 선택이던 경로는 이것뿐이었다. `Authorization` 헤더가 오면 없는 경로에서도 먼저 검증한다 — 탈퇴한 계정의 토큰은 403 |
| 17 | 미처리 예외 500 | `{"detail":"internal_server_error"}` |
| 18 | 5xx `ApiException` | `ApiException.external(...)`·`ApiException.unexpected(...)` 팩토리로만 원인과 함께 만든다 |
| 19 | 클라이언트 판 426 | `X-Acttub-Client`(예: `app/0.1.0`) 없는 `/v2` 요청은 **426** 이고 `detail` 이 코드가 아니라 **안내 문장**이다. 토큰 검증보다 먼저다(§6-5) |
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
| **required + `null` 값을 실어 보냄** | `AuthUser.email`, `MeResponse.email`/`.profile`, `Profile` 의 `directions` 를 뺀 전 항목(0.1.0 이전 회원은 `name` 만 차 있다), `CoachTurnResponse.handoff`/`.report`, `CoachConfirmResponse.handoff`, `SourceHandoffIds.analysis`, `MemoryItem.source_practice_session_id`, `ConsentEntryDocument.current_decision`/`.decided_at`, `Portfolio.intro`, `PortfolioPhoto.url`, `PortfolioShare.slug`/`.url`, `PublicPortfolio.photo_url`/`.gender`/`.intro`, `PublicPortfolioPhoto.url`, `PublicChallengeEntry.character`/`.poster_url`, 연습 노트의 `PracticeNote*`·`PublicPracticeNote` 항목들 |
| **optional + 조건부로 키를 추가** | `PracticeSessionDetail.summary`(status 가 `analyzed` 이고 summary 가 있을 때만), `.error_code`(`failed` 일 때만) |
| **optional 인데 항상 포함** | `PracticeSessionStatusResponse.error_code`, `Video.purged_at`/`.playback_url`/`.playback_expires_at`/`.poster_url` |

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
`portfolio_credit_limit_exceeded`, `portfolio_photo_limit_exceeded`, 노트 평가의 `comment_too_long`(§6-15), 그리고 리딩의 `no_characters`,
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

나머지 22개는 `additionalProperties: false` 다. 0.1.0 에서 더한 요청 바디(리딩의 등록·수정 포함)는 전부 닫혀 있다.

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

> 제품 규칙의 정본: [common.md](../../docs/specs/common.md) 「게이트와 보호 기능」·「클라이언트 판과 강제 업데이트」(판정 순서, 게이트 밖 경로 표, 426 문장, `account_deactivated` 의 예외), [account.consent](../../docs/specs/account/consent.md)·[account.profile](../../docs/specs/account/profile.md)(동의·프로필 게이트가 세는 것)

- **426** 은 `platform/security/ClientVersionFilter` 가 토큰 검증보다 먼저 낸다. 헤더를 보지 않는 경로는
  `ClientVersionFilter#shouldNotFilter` 한 곳에 있다.
- **회원 게이트**는 `platform/security/ConsentGateInterceptor` 의 경로 목록(`OUTSIDE_THE_GATE`·`GUEST_ONLY`·
  `CONSENT_ONLY`)과 `AccessGate` 다. common.md 의 표와 이 목록은 같이 바꾼다. 회원과 웹 게스트(§6-9)는 같은
  `AccessGate#gatedUser` 가 주체를 보고 가른다.
- 공개 조회에서 `Authorization` 을 검증하지 않는 자리는 `AccessTokenFilter#shouldNotFilter` 다. 제공자가 부르는
  `/v2/auth/providers/*/disconnect` 도 여기서 뺀다 — 카카오는 `Authorization: KakaoAK <어드민 키>` 를 싣는데, 그것을
  액세스 토큰으로 검증하면 알림이 전부 401 이 된다.
- `account_deactivated` 의 `DELETE /v2/me` 예외는 `CurrentUserService` 에 있다.
- **고지 문서는 동의 문서가 아니다.** 개인정보 처리방침은 `consent_documents` 의 행이 아니라 배포에 든 고정 파일
  (`consent-docs/privacy_policy.md`)이고 `GET /v2/consents/notices` 가 전문을 내준다. 판을 올리는 절차는
  `consent-docs/README.md` 다.

### 6-6. 로그인과 가입 제출

> 제품 규칙의 정본: [account.login](../../docs/specs/account/login.md)(로그인 응답의 두 갈래, 계정을 찾는 순서, 자격 값, 가입 토큰의 수명과 내용, 가입 제출, 분당 한도, 리프레시 30일)

- **자격 칸**(`platform/web/CredentialField`)은 로그인의 `provider` 말고 전부(`id_token`·`authorization_code`·
  `code_verifier`·`redirect_uri`·`state`), 가입 제출의 `signup_token`, 갱신·로그아웃의 `refresh_token`, 옮기기의
  `code`, 푸시 토큰의 `token` 이다. 이 표시가 하나라도 붙은 요청 본문의 422 배열은: 빠진 칸의 `input`(본문 전체가
  실리는 자리)에 **선언된 칸 가운데 자격 값이 아닌 것만** 싣고(이름을 잘못 쓴 `idToken` 같은 모르는 키도 뺀다),
  자격 칸 자체와 모르는 키의 `input` 은 `"[redacted]"` 다(`RequestBodyTreeValidator`, `CredentialInputContractIT`).
- **가입 토큰**(`feature/auth/app/SignupTokens`)은 JWE `dir`+`A256GCM` 이다. 키는 `JWT_SECRET` 에서 용도를 못박아
  뽑는다.
- `POST /v2/auth/signup` 은 계정·신원·동의 행을 **한 트랜잭션**에서 만든다. 결정의 확인이 먼저라 빠진 것이 있으면
  어떤 행도 생기지 않는다.
- 로그인과 가입 제출의 IP 한도는 키가 다르다.

### 6-7. 제공자와 연결 끊기 알림

> 제품 규칙의 정본: [account.login](../../docs/specs/account/login.md)(켜 둔 제공자와 400·503, 제공자 목록, 이메일 검증 근거, 네이버·애플의 토큰 교환, 연결 끊기 알림의 응답·401·503)

- **켜 둔 제공자**(`integration/oidc/ProviderRegistry`): `AUTH_ENABLED_PROVIDERS`(기본 `google,apple`)에 든 것만
  로그인된다. 카카오·네이버는 검수 승인 뒤에 이 값에 이름을 더해 켠다.
- 카카오의 이메일 검증은 사용자 정보 API(어드민 키, `target_id` = `sub`)로 묻는다. 네이버의 `@naver.com` 판정은
  `feature/auth/domain/NaverEmail` 이다.
- **네이버는 서버가 코드를 교환한다**(SOMA-528 결정 I-5): `POST https://nid.naver.com/oauth2/token` 에
  client secret 과 함께 보내 받은 `id_token` 을 JWKS(`https://nid.naver.com/oauth2/jwks`, 발급자
  `https://nid.naver.com`, `aud` = 우리 Client ID)로 검증한다. 함께 받은 refresh token 은 암호화해
  `user_identities.naver_token_encrypted` 에 두고 로그인마다 새 값으로 바꾼다.
- **애플 authorization code**: 이메일 겹침 409 를 먼저 가르므로 409 로 끝날 요청에는 코드를 쓰지 않는다. 바꿔 온
  값은 가입 토큰에 실려 가입 제출 때 `apple_token_encrypted` 로 저장된다. 교환과 폐기의 `client_id` 는 ID 토큰의
  `aud` 다. 토큰이 없는 기존 애플 회원의 채우기가 실패하면 애플의 무응답은 삼키지 않고 보고한다
  (`AuthService.keepProviderToken` — 계속 못 채우면 탈퇴 때 폐기할 토큰이 없다). 이미 쓰인 코드 같은 예상된 거절은
  보고하지 않는다.
- **연결 끊기 알림**(`POST /v2/auth/providers/{naver|kakao}/disconnect`): 응답 코드는 제공자가 정한다 — 카카오는
  사용자 정보가 없어도 200 으로 답하라고 하고 다른 응답은 발송 실패로 본다.
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

> 제품 규칙의 정본: [account.withdraw](../../docs/specs/account/withdraw.md)(응답, 파기·가명처리·남기는 것, 보관 동의, 제공자 해제, 신원 해시의 쓰임), [common.md](../../docs/specs/common.md) 「탈퇴·삭제」

- **한 트랜잭션**(`PostgresProfileRepository#withdraw`)에서: 상태 전환, 이메일 파기(I-3 예외로
  `users.nickname=NULL` 포함), 프로필의 이름·사진·소개 파기와 생년월일 → 5세 단위 `age_band`,
  알림 토글 끄기, 포트폴리오 행째 삭제, 이관 코드 삭제, 리프레시 폐기·푸시 토큰 삭제, 진행 중
  `external_operations` 와 `ai_jobs` 를 `failed`/`account_deactivated` 로 닫고 lease 떼기(분석 중이던 연습도
  `failed`, 0.1.0 작업은 결과 본문도 비운다), **0.1.0 영상에 `purged_at` 찍기**, `practice_feedback` 의 연락처
  비우고 시트 재전송 예약, `note_ratings` 의 한 줄 비우기(평가 값은 남는다), 신원의 `provider_uid`·토큰을 비우고 `uid_hash` 채우기,
  챌린지 자료 정리(`PostgresProfileRepository#eraseChallenge` — 마감이 지났는데 집계되지 않은 챌린지를 먼저
  집계하고(`ChallengeWithdrawal#settleBeforeWithdrawal`), 참여작 비공개·주최 해제·차단·저장·알림함 삭제·AI 리포트
  본문 파기, §6-16~§6-20). 성별·연령대·방향·경력·목표와 배우 기억은 남는다(§6-15 「연습 자료의 이관·삭제·탈퇴」).
- **신원 행은 지우지 않는다.** `uid_hash` = HMAC-SHA256(provider, provider_uid) 만 남긴다
  (`ck_user_identities_uid_or_hash`).
- **영상 객체**는 옛 예약 장부(`upload_intents`)와 0.1.0 보관함(`videos`)의 키를 함께 모은다 — 보관함 영상의
  **포스터**(`videos.poster_key`, V23)도 함께다. 포스터 워커는 붙일 때 같은 `users` 행을 잡으므로 탈퇴가 키를 모은 뒤에
  붙는 포스터는 없다(§6-15 보관함 「포스터」). 남길지는 `retention` 의 **현재 판에 대한 마지막 결정**으로 가른다.
- **리딩 자료는 같은 트랜잭션에서 행째 지운다**(`PostgresProfileRepository#eraseReading`, §6-14). 보관 동의가
  있으면 녹음 행을 남기고 `reading_session_id`·`line_id` 를 NULL 로 비운 채 `user_id` 를 유지해 3년 파기가 지우고,
  없으면 행(음성과 **전사**)을 지우고 객체 키를 장부(`reading_recording_delete`)에 올린다. 지우기 전에 그
  사람의 `scripts`·`reading_sessions` 행을 `FOR UPDATE` 로 잡는다 — 리딩의 쓰기가 같은 행을 잡으므로 겹쳐도
  순서가 정해진다(먼저 온 쓰기는 함께 지워지고, 늦게 온 쓰기는 없는 행을 보고 404 다).
- **탈퇴와 겹친 쓰기**: 게이트의 계정 상태 확인은 요청의 앞머리에서 끝나므로, 회원 자료를 쓰는 트랜잭션
  (프로필 저장·알림 토글·프로필 사진·포트폴리오·푸시 토큰 등록)은 **탈퇴가 잡는 것과 같은 `users` 행을
  `FOR UPDATE` 로 잡고 활성인지 다시 본다**(`PostgresProfileRepository#lockActive`,
  `PostgresPortfolioRepository#lockOrCreate`, `PostgresPushTokenRepository#register`). 탈퇴는 `users` 행을 남기므로
  FK 는 뒤늦은 쓰기를 막지 못한다 — 이 확인이 없으면 파기한 이름·생년월일이 다시 차고 지운 포트폴리오 행이
  되살아난다. 쓰기가 먼저면 탈퇴가 그 뒤에 파기하고, 탈퇴가 먼저면 쓰지 않는다(응답은 각 스펙).
- **바깥 호출은 트랜잭션 밖이다**(`feature/profile/app/AccountCleanup`). 탈퇴 트랜잭션은 해제에 쓸 값을
  **파기 전에** `account_cleanup_operations`(V11)로 옮겨 두기만 한다 — `object_delete`(객체 키 목록),
  `apple_revoke`(애플 토큰), `kakao_unlink`(회원번호), `naver_revoke`(refresh token), 그리고 `reading_recording_delete`
  (리딩 녹음 객체 키 목록, V13·§6-14 — 실행은 `object_delete` 와 같다). 커밋 뒤 바로 한 번
  시도하고, 실패하면 5분에서 두 배씩(최대 12시간) 늘려 다시 시도한다. 성공하면 행을 값과 함께 지운다 —
  **끝난 것은 장부에 남지 않는다.**
- **7일이 지난 뒤는 종류가 가른다**(`AccountCleanupRepository.OBJECT_DELETE_KINDS`). **제공자 해제**
  (`apple_revoke`·`kakao_unlink`·`naver_revoke`)는 포기하고 값과 함께 지운다 — 해제에 쓸 값을 그보다 오래 들고
  있지 않는다. **객체 삭제**(`object_delete`·`reading_recording_delete`)는 **성공할 때까지 대상 키를 지우지
  않는다**: `expires_at` 이 지나도 계속 집어 시도하고, 그때마다 `ObjectDeletionOverdue` 로 운영자에게 알린 뒤
  다음 알림을 7일 뒤로 미룬다(같은 작업을 일주일에 한 번보다 자주 알리지 않는다). 키를 먼저 버리면 그 객체를
  아는 곳이 없어 복구할 수 없다(specs/reading 「리딩 자료의 이관·삭제·탈퇴」).
- **`object_delete` 는 탈퇴만 쓰는 것이 아니다.** 객체 키를 DB 에서 덮거나 그 행을 지우는 자리는 전부 같은
  트랜잭션에서 장부에 남긴다(`PostgresObjectCleanupLedger`): 프로필 사진의 교체·삭제, **올리다 만 프로필 사진의
  주소를 다시 받을 때 덮이는 앞의 키**, 포트폴리오 사진의 삭제와 시한이 지난 올리기 찌꺼기. 키를 먼저 잃으면
  저장소가 실패했을 때 그 객체를 아는 곳이 없어 탈퇴의 파기도 찾지 못한다. 저장소 삭제가 실패하면 장부가
  보고하며 다시 시도한다. 올리기 주소가 아직 살아 있는 객체는 **그 시한 뒤에** 지운다
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
- 탈퇴 3년 뒤의 파기(해시 행, 보관하던 영상)는 매일 도는 일이다(§6-12).

### 6-9. 웹 게스트와 이관

> 제품 규칙의 정본: [account.guest](../../docs/specs/account/guest.md)(게스트 만들기, 기능별 동의 문서, `member_only`·`guest_only`, 첫 동의의 나이 확인, 이관 코드, 옮기기와 기억 선택, `guest_transferred`), [account.consent](../../docs/specs/account/consent.md)(게스트의 조회), [practice.analyze](../../docs/specs/practice/analyze.md)(게스트 분석 하루 3회)

- 게스트 여부는 `AuthenticatedUser#guest` 가 요청마다 한 질의로 본다(신원이 전부 `guest`). `users` 에 컬럼을
  늘리지 않는다.
- **게스트의 게이트**(`platform/security/GuestFeature`): 경로가 속한 기능의 문서만 본다. 연습은
  `/v2/videos/**`·`/v2/practices/**`·`/v2/practice-feedback/**`·`/v2/me/practice-feedback/**`·`/v2/coach/**`·
  `/v2/me/memory/**`, 리딩은 `/v2/reading/**` 다(서버가 대본·음성을 분석하지 않아 AI 분석 동의는 없다 —
  ADR-031, §6-14). 이 목록에 없는 경로가 `member_only` 다.
- **dev 분석 한도 예외**: `ACTTUB_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED=false`이면 새 연습·재분석 모두 일일 횟수 제한 없이 처리한다. 배포 워크플로는 dev에 false, 운영에 true를 명시한다. 기본값은 true이며 회원 정책과 요청 ID 멱등성은 유지한다.
- **분석 하루 3회**는 작업 장부의 `analyze` 행을 센다. **세는 일과 작업을 만드는 일은 한 트랜잭션이다**
  (`PostgresPracticeSessionLedger#overQuota`): 그 게스트의 `users` 행을 잡은 채 세므로 겹쳐 온 분석 둘이 같은 수를
  보고 함께 지나가지 못한다. 같은 요청 ID 의 재전송은 한도보다 **먼저** 갈라 재생한다. 재분석에서는 한도(429)가
  "실패 상태가 아님"(409)보다 먼저다. 잠금 순서는 올린 영상·연습 행 → `users` 다(이관과 같은 방향).
- **이관 코드**(`POST /v2/guest/transfer-code`): 해시는 HMAC 이고 키는 `JWT_SECRET` 에서 용도를 못박아 뽑는다.
  다른 게스트의 살아 있는 코드와 해시가 겹치면 다시 뽑는다. **유일성은 DB 가 지킨다**
  (V12 의 부분 유니크 인덱스 둘 — 쓰지 않은 코드는 게스트마다 하나, 숫자마다 하나). 겹쳐 온 발급은 뒤의 INSERT 가
  앞의 커밋을 기다렸다가 `ON CONFLICT DO NOTHING` 의 0행으로 끝나고 다시 뽑으면서 앞의 코드를 지운다 — 둘 다 201
  이지만 살아 있는 코드는 하나다. 발급은 코드 행만 잠근다(`users` 행을 잡으면 옮기기와 순서가 엇갈려 교착한다).
- **옮기기의 틀린 시도 한도**는 **자리를 먼저 잡고 평가한다**(`FixedWindowRateLimiter#reserve`): 평가 중인 시도도
  자리를 차지하므로 겹쳐 보낸 추측 스무 개가 같은 수를 보고 함께 평가되지 못한다. 맞은 코드·409·서버 쪽 실패는
  자리를 되돌려 준다.
- **한 트랜잭션**(`feature/transfer/app/GuestTransferService`): 코드 행을 `FOR UPDATE` 로 잡고(같은 코드를 든
  두 요청 가운데 하나만 받는다), 올린 영상·연습·작업 장부·배우 기억과 리딩 자료(대본·회차·녹음·암기 상태)의
  `user_id` 를 회원으로 바꾸고, 게스트를
  닫는다(`deactivated`, **신원 행 삭제**, 리프레시 폐기 — **행은 남긴다**), 코드를 쓴 것으로 적는다. 진행 중 작업은
  상태와 lease 를 건드리지 않아 돌던 워커가 그대로 끝낸다.
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
- **옮겨진 게스트의 표식**은 **쓰인 이관 코드 행**이다 — 신원 행을 지우므로 신원으로는 알 수 없다. 그래서 탈퇴의
  파기는 **쓰지 않은** 코드만 지운다.

### 6-10. 알림 토글, 푸시 토큰, 로그아웃

> 제품 규칙의 정본: [account.notification](../../docs/specs/account/notification.md)(토글 셋과 `PATCH`, 토큰 등록·삭제, 발송), [account.logout](../../docs/specs/account/logout.md)(멱등 204)

- **"둘 다 꺼짐" 확인과 저장은 한 트랜잭션이다**(`PostgresPushTokenRepository#register`): 토글 끄기·
  탈퇴와 같은 `users` 행을 잡아 줄을 선 뒤에 읽은 토글로 거른다. 따로 읽고 쓰면 끄는 도중에 끼어든 등록이
  살아남는다 — 다른 기기가 앱을 여는 것만으로 토큰이 되살아난다. 토큰 전부 삭제는 토글을 끄는 트랜잭션에서 한다.
- 발송(`PushService#onAnalysisComplete`)의 실패는 `FailureReporter` 로 간다. Expo 의 ticket 은 보낸 순서대로
  온다. 읽을 수 없는 답과 `DeviceNotRegistered` 밖의 ticket 오류는 종류만 실어 보고한다(`ExpoPushSender.tickets` —
  본문과 토큰은 싣지 않는다). receipt 는 읽지 않는다.

### 6-11. 포트폴리오

> 제품 규칙의 정본: [account.portfolio](../../docs/specs/account/portfolio.md)(입구와 응답, 값의 형태·상한·사유 코드, 사진, 공유 링크, 공개 조회)

- **사진은 프로필 사진과 같은 길**이다. 형식·크기 규칙은 `integration/storage/PhotoUploadType` 한 벌이다. 삭제는
  행을 지우면서 객체 삭제를 **같은 트랜잭션에서 정리 장부에 올리고** 커밋 뒤에 시도한다
  (`portfolio/app/PortfolioPhotoCleanup` — 구현은 장부의 주인인 `profile`, §6-8).
- 상한과 순서는 **포트폴리오 행을 `FOR UPDATE` 로 잡은 채** 센다(`PostgresPortfolioRepository#lockOrCreate`).
- **공유 slug** 는 128비트 난수(base64url, `/`·`+`·`=` 없음)다. `url` 은 `<SITE_URL>/p/<slug>` 이고
  `SITE_URL` 이 비어 있으면 `null` 이다 — 주소를 코드에 박아 두지 않는다(SOMA-528 결정 I-8).
- 공개 조회는 프로필의 것을 `portfolio/app/PortfolioOwners` 포트로 받는다(구현은 `profile`).

### 6-12. 매일 도는 일

> 제품 규칙의 정본: 보관 기간과 대상은 [account.login](../../docs/specs/account/login.md#상태)(리프레시 토큰 30일), [account.guest](../../docs/specs/account/guest.md)(게스트 30일, 이관 코드 30일), [account.withdraw](../../docs/specs/account/withdraw.md)(탈퇴 3년, 해제 재시도), [practice.feedback](../../docs/specs/practice/feedback.md)(설문 연락처 90일, 시트 전송)

`feature/profile/app/AccountHousekeeping#runDaily` — 한국 시간 새벽 4시 30분(`ACCOUNT_HOUSEKEEPING_CRON`).
설정이 없으면 켜져 있고 `ACCOUNT_HOUSEKEEPING_ENABLED=false` 로 끈다. **전부 멱등**이고 한 가지가 실패해도
나머지는 돈다(실패는 `AccountHousekeeping.<일 이름>` 으로 보고).

| 일 | 구현 규칙 |
|---|---|
| 리프레시 토큰 | 한 문장으로 지운다 — 회전된 옛 토큰이 새 토큰을 `replaced_by_id` 로 가리킨다 |
| 게스트 | 활성 게스트를 `ProfileService#withdraw` 로 파기한다. 리딩의 쓰기는 `scripts.created_at`, `reading_sessions.updated_at`, `reading_recordings.updated_at`, `line_memorization.updated_at` 로 센다(§6-14). 옮겨진 게스트는 이미 닫혀 있어 고르지 않는다 |
| 탈퇴 3년 | 해시 행 삭제와 영상 객체·리딩 녹음(행째 지우고 객체는 장부로, §6-14) 삭제의 장부 올리기는 한 트랜잭션이다 — 해시 보관 기간이 곧 영상 보관 기간이다(ADR-029). **고르는 기준은 신원이 아니라 `users.deactivated_at` 과 `users.retention_purged_at`(V10)이다** — 제공자의 연결 끊기로 마지막 신원이 먼저 지워진 회원에게는 해시 행이 없다. 파기를 마친 시각을 적으므로 다시 고르지 않는다 |
| 해제 재시도 | `AccountCleanup#runDue`(5분마다도 돈다, §6-8) |
| 이관 코드 | ⚠ 쓰인 코드는 `guest_transferred` 의 표식이라 그 게스트의 리프레시 토큰이 살 수 있는 30일 동안은 지우면 안 된다(§6-9) |

`feature/feedback/app/ExitSurveySync#runDaily` — **이탈 설문의 매일 도는 일은 따로다**(`EXIT_SURVEY_SYNC_ENABLED`,
기본 하루). 시트가 죽어 있는 동안 계정 정리까지 멈추면 안 되기 때문이다. 순서는 **연락처 파기 → 시트 전송**이다 —
먼저 비워야 그날 안에 시트의 연락처까지 사라진다.

| 일 | 구현 규칙 |
|---|---|
| 설문 연락처 | 연락처를 비우고 `sheet_seq` 를 올린 뒤 `sheet_synced_at` 을 NULL 로 되돌린다 — 같은 설문 id·새 순번으로 시트에 다시 보낸다(§6-15) |
| 설문 시트 전송 | `sheet_synced_at` 이 NULL 인 행을 오래된 순으로 보낸다. 한 묶음에서 하나도 보내지 못하면 멈춘다(시트가 죽은 동안 같은 묶음을 영원히 돌지 않는다) |

### 6-13. 방문자 IP

IP 로 거는 제한(로그인·가입 제출·갱신, 게스트 만들기, 옮기기의 틀린 시도, 푸시 토큰 삭제, 포트폴리오 공개
조회, 참여작 공유 조회)의 열쇠는 **방문자 주소**이고 `platform/security/ClientAddress` 한 자리가 구한다. feature 는
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

> 제품 규칙의 정본: [reading/](../../docs/specs/reading/README.md)(「리딩 자료의 이관·삭제·탈퇴」 표, 최종 저장 직전의 재확인, 게스트의 마지막 활동), [reading.script](../../docs/specs/reading/script.md)(등록·목록·검색·상세·수정·삭제, 사유 코드·한도·재전송, 카드 필드), [reading.cast](../../docs/specs/reading/cast.md)(내 배역, 목소리 프리셋), [reading.session](../../docs/specs/reading/session.md)(시작·재전송, 진행 저장의 판정 순서, 마지막 회차), [reading.recording](../../docs/specs/reading/recording.md)(올리기의 검사 순서·한도·총량·대체, 재생, 보관), [reading.memorization](../../docs/specs/reading/memorization.md)(갱신 판정, 조회)

- **경로**는 전부 `/v2/reading/**` 이고 게스트의 기능 표 `READING`(`platform/security/GuestFeature`, §6-9)에 든다.
  회원은 회원의 게이트(§6-5)를 지난다.
- **스키마(V13)**: `scripts`·`script_characters`·`script_lines`·`reading_sessions`·`reading_recordings`·
  `line_memorization`. 값 목록은 text + CHECK 이고 Java enum 은 `platform/schema` 에 있다(`ScriptSource`·
  `ScriptLineKind`·`ReadingMode`·`ReadingAdvance`·`ReadingSessionStatus`·`TranscriptSource`·`MemorizationStatus`).
  FK 에 `ON DELETE` 가 없다 — 삭제는 애플리케이션이 표대로 순서를 정해 지운다. `scripts.request_id`·
  `reading_sessions.request_id` 는 (user_id, request_id) 유일이고 이관 충돌 때만 NULL 이다.
  `uq_script_characters_script_name` 은 DEFERRABLE 이다 — 이름 수정이 두 배역의 이름을 맞바꿀 때 문장 사이에서
  잠시 겹치므로 수정 트랜잭션이 `SET CONSTRAINTS … DEFERRED` 로 커밋까지 미룬다.

**대본**

- `request_fingerprint` 는 정규화한 생성 본문의 SHA-256 이다(`ScriptService`). 사유 코드와 한도는
  `domain/ScriptRules` 한 곳이다.
- **등록·수정은 `users` 행을 `FOR UPDATE` 로 잡고 활성인지 본다**(`PostgresScriptRepository#lockActive`, §6-8 과 같은
  형태). 활성이 아니면 저장소가 `OwnerNotActive` 를 알리고 `ScriptService#activeOnly` 가 403 으로 바꾼다. 같은 회원의
  등록이 겹쳐도 여기서 줄을 서므로 개수 한도가 정확하다.
- 검색은 `%`·`_`·`\` 를 풀어(`escapeLike`) `ILIKE … ESCAPE '\'` 로 제목과 배역 이름만 본다(`PostgresScriptRepository`).
- **삭제**: 줄·회차·녹음·암기 행은 `PostgresScriptRepository#delete` 가 한 트랜잭션에서 지운다. 녹음 객체의 삭제는 행을
  지운 트랜잭션이 정리 장부(`reading_recording_delete`)에 올리고 커밋 뒤에 시도한다(`reading/app/
  ReadingRecordingCleanup`, 구현은 `profile` 의 `PostgresObjectCleanupLedger`).

**리딩 회차 (SOMA-546 RA2)**

- **시작**: `reading_sessions` 에는 지문 컬럼이 없어 저장된 속성 여섯과 대본을 비교해 재전송을 가른다.
  **한 트랜잭션에서 대본 행을 `FOR UPDATE` 로 잡고**(같은 대본의 시작이 여기서 줄을 선다) 열린 회차를 `stopped` 로
  바꾼 뒤 새 회차를 만든다 — `uq_reading_sessions_open_script` 가 그물이다. `started_at`·`ended_at` 은 앱 시계다.
- **진행 저장**: 시간은 `GREATEST(저장값, 보낸 값)` 로 쓴다. 회차 행을 `FOR UPDATE` 로 잡은 채 하고, 계정 상태를 따로
  보지 않는다 — 이관·삭제가 먼저 끝났으면 행의 주인이 바뀌었거나 행이 없어 404 다.
- **회차 삭제**는 녹음 행을 지우고 객체 삭제를 같은 트랜잭션에서 장부(`reading_recording_delete`)에 올린다.
- 마지막 회차는 `ORDER BY started_at DESC, id DESC` 의 첫 행이다(`PostgresScriptRepository`·`PostgresSessionRepository`).

**줄 단위 녹음 (SOMA-546 RA3)**

- **유일한 multipart 요청**이다. 칸의 모양 검사는 핸들러가 직접 422 **배열**로 만든다 — JSON 본문의 검증기가 닿지
  않는 자리다(`RecordingController`). `RequestBodyCachingFilter` 는 multipart 를 캐시하지 않는다(컨테이너의 파트
  파싱이 원 스트림을 읽는다 — `ReadingRecordingUploadServerIT` 가 실제 서버로 본다). 컨테이너 상한은
  `spring.servlet.multipart.*`(25MB)이고 넘으면 핸들러 전이라 413 은 advice(`ApiErrorAdvice`)가 낸다.
- 사전 확인은 잠그지 않는다. 변환은 `integration/media/AudioTranscoder`(ffmpeg), 객체 키는
  `reading/{user_id}/{session_id}/{line_id}/{request_id}.m4a` 다. **최종 저장은 회차 행을 `FOR UPDATE` 로 잡고**
  같은 확인을 다시 한 뒤 총량(저장된 `byte_size` 합)을 본다. 바깥 호출(변환·올림)은 트랜잭션 밖이다(§5-4).
- 최종 저장이 거절(404·422)하거나 재전송·작은 시도 번호로 끝나면 방금 올린 객체의 키를 **같은 트랜잭션에서** 장부
  (`reading_recording_delete`)에 올린다. 대체된 앞 객체도 같다.
- 재생 주소는 `reading/app/RecordingPlayback` 이 조회마다 만든다.
- 저장소 포트 `ObjectStorage` 에 `upload(objectKey, mimeType, Path)` 가 생겼다(서버가 직접 올리는 유일한 객체).

**암기 표시 (SOMA-546 RA4)**

- **저장**은 `INSERT … ON CONFLICT (user_id, line_id) DO UPDATE` 한 문장이다. 같은 상태의 재전송은 CASE 로 옛
  `updated_at` 을 유지한다. 판정과 저장은 그 줄의 **대본 행을 `FOR UPDATE` 로 잡은** 트랜잭션 안이다
  (`PostgresMemorizationRepository`).
- OpenAPI 컴포넌트: `ReadingMemorizationRequest`·`ReadingMemorizationStatusInput`·`ReadingLineMemorization`(`status` 는
  `MemorizationStatus`).

**생애 — 이관·삭제·탈퇴·파기 (SOMA-546 RA5)**

- 코드의 자리: 이관은 `reading/app/ReadingOwnership.reassign`(§6-9), 대본 삭제는 `PostgresScriptRepository#delete`,
  탈퇴·미이관 게스트 30일 파기는 `PostgresProfileRepository#eraseReading` 하나(§6-8), 3년 파기는 영상과 같은
  `purgeRetained`(`users.retention_purged_at`)다.
- **쓰기가 잠그는 행**: 대본 등록·수정은 `users` 행, 회차 시작·암기 갱신은 대본 행, 진행 저장·녹음 저장은 회차 행,
  탈퇴는 `users` 와 그 사람의 대본·회차 행을 잡는다. 이관·탈퇴·삭제가 리딩 행을 잠근 뒤 진행하므로 둘이 겹쳐도
  순서가 정해진다.
- **게스트의 마지막 활동**은 `PostgresProfileRepository#idleGuests` 가 리딩의 쓰기 다섯까지 센다(§6-12).
- 보관 행은 회차·줄 연결이 없어 회차를 조인하는 모든 읽기(`PostgresSessionRepository#recordings`·대본의
  `recording_count`·녹음 삭제의 소유 확인)에서 자연히 빠진다 — 일반 API 에 보이지 않는 것은 별도 필터가 아니라
  구조가 그렇다.
- 대본·회차·녹음 삭제, 대체된 녹음, 탈퇴 파기가 모두 같은 장부 종류 `reading_recording_delete` 를 쓴다(§6-8).

### 6-15. 연습 0.1.0 — 스키마(V14)와 영상 보관함 (SOMA-546)

정본은 [specs/practice/](../../docs/specs/practice/README.md) 와 README 「연습 자료의 이관·삭제·탈퇴」 표다. 회차·분석·
대화·노트·기억·설문의 API 는 뒤 티켓이 이 절에 이어 쓴다. **코치의 행동 규칙(§7·§8-5·§8-6, ADR-027)은 바꾸지
않는다** — 0.1.0 이 바꾸는 것은 저장이다.

- **넓히기만 한 V14**: 새 테이블 열(`videos`·`video_transcripts`·`practices`·`analyses`·`coach_conversations`·
  `coach_messages`·`coach_notes`·`actor_memories`·`practice_feedback`·`ai_jobs`)과, `upload_intents` 에 NULL 허용
  컬럼 셋(`request_id`·`request_fingerprint`·`video_id`), `users` 에 `exit_survey_asked_at`·`memory_epoch`. **옛
  테이블은 건드리지 않는다** — `practice_sessions`·`transcripts`·`summaries`·`anomalies`·`coach_sessions`·
  `coach_turns`·`coaching_handoffs`·`practice_reports`·`actor_memory_entries`·`external_operations` 가 그대로 돈다.
  데이터 전환은 Flyway 가 아니라 재실행 가능한 애플리케이션 명령이고, 옛 테이블의 삭제는 읽기·쓰기를 모두 중단한
  버전을 배포한 **다음** 릴리스부터다(specs/practice 「0.1.0 스키마 전환」).
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
    없다. **포스터 주소(`poster_url`)는 목록에도 있다** — 목록이 미리보기를 보여 주는 자리다(아래 「포스터」).
  - **상세** `GET /v2/videos/{id}`: `Video` + 10분 서명 `playback_url`·`playback_expires_at` + `poster_url` +
    `usage{practice_count, entry_count}`. 조회할 때마다 새 주소다. 없는 것과 남의 것은 같은 **404 `video_not_found`**(수정·삭제·파기도 같다).
  - **삭제** `DELETE /v2/videos/{id}`: **참조가 없을 때만** 204 다. 회차나 참여작이 참조하면 422 `video_in_use` 이고
    아무것도 지우지 않는다 — 오류 본문은 코드 하나이고 **사용처는 상세 조회에서** 본다. 지우면 받아쓰기도 함께
    지우고 객체(영상과 포스터)는 장부로 간다. 참조 확인과 삭제는 **영상 행을 잠근 채** 한다(회차 시작과 겹쳐도 하나만
    성공한다).
  - **파일만 파기** `POST /v2/videos/{id}/purge-file`: 회차·참여작의 기록은 남기고 객체(영상과 포스터)·받아쓰기만
    지운다(`purged_at`). 그 영상은 재생 불가로 표시되고 `poster_url` 도 `null` 이며 **총량에서 빠진다** — 총량이 가득한
    계정이 공간을 되찾는 길이다. 이미 파기된 영상에 다시 걸면 같은 답이고, 파기했어도 참조가 있으면 삭제는 여전히
    422 다. `poster_key` 는 `object_key` 처럼 행에 남지만 객체는 없다.
  - **포스터**(`videos.poster_key`·`poster_attempts`, V23, SOMA-562) — 목록의 미리보기인 첫 장면 JPEG 한 장이다.
    - **올리기를 막지 않는다.** 마무리는 포스터를 기다리지 않고 `poster_url: null` 로 영상을 돌려준다.
      `video/app/VideoPosterWorker` 가 뒤에서 `poster_key` 가 빈 영상을 **최신 저장순으로 하나씩** 집는다 — 새 영상과
      이 기능 이전에 올라온 영상(백필)이 같은 길이다. 스케줄러(`adapter/sched/VideoPosterScheduler`)는 10초마다
      (`VIDEO_POSTER_POLL_INTERVAL_MS`) 자기 스레드 하나에서 일감이 없을 때까지 비운다.
    - **한 번은 집기 · 받기 · 뽑기 · 올리기 · 붙이기다.** 집기는 `FOR UPDATE SKIP LOCKED` 로 한 행을 잡아
      `poster_attempts` 를 올리고 커밋한다 — 도중에 죽은 시도도 세고, **세 번 집힌 영상은 더 고르지 않는다**
      (`VideoRules.POSTER_MAX_ATTEMPTS`). 파기됐거나 활성 계정의 것이 아닌 영상은 고르지 않는다. 받기·ffmpeg·올리기는
      트랜잭션 밖이다(§5-4). ffmpeg 는 0.5초 자리(1초 미만·길이 모름이면 맨 앞)의 한 장면을 폭 480px 이하 JPEG 로 뽑고
      (`integration/media/PosterFrameExtractor`, 분석과 같은 `FfmpegLock`), 키는 영상 옆 `videos/{사용자}/{요청}.poster.jpg`
      (`VideoRules.posterKey`)라 다시 만들어도 같은 키에 덮어쓴다. 실패는 보고(`VideoPosterWorker.generate`)만 하고 목록은
      `poster_url` 없이 그대로 열린다.
    - **붙이기는 주인의 `users` 행 → 영상 행 순서로 잡는다**(탈퇴·3년 파기와 같은 순서). 그 사이에 영상이 지워졌거나
      파기됐거나 주인이 바뀌었거나 계정이 활성이 아니면 붙이지 않고 **올린 포스터의 삭제를 같은 트랜잭션에서 장부에**
      올린다 — 늦게 만든 포스터가 남지 않는다. 주인이 바뀐(이관) 영상은 다음 주기에 다시 만든다.
    - `poster_url` 은 재생 주소와 같은 **10분 서명 GET** 이고 목록·상세·즐겨찾기 응답에 실린다. 아직 없거나 파기됐거나
      스토리지가 없는 기동이면 `null` 이다. 화면은 `null` 을 "미리보기 없음" 으로 그린다.
    - **스위치가 둘이고 둘 다 켜져야 돈다**: `ANALYSIS_WORKER_ENABLED`(분석·기억·챌린지 리포트 워커와 공유 — 격리 복원
      검증이 이것 하나로 뒤에서 쓰는 일을 모두 멈춘다)와 `VIDEO_POSTER_ENABLED`(포스터만). 테스트는 후자를 전역으로
      끄고 워커를 직접 부른다.
  - **즐겨찾기** `PATCH /v2/videos/{id}` `{favorite}` → `Video`.
  - **이관**은 `video/app/VideoOwnership` 이 `videos` 와 **예약 장부**를 함께 옮긴다(§6-9의 순서에서 올린 영상 바로
    뒤다). 예약을 두고 가면 옛 게스트의 대기 업로드가 마무리될 자리를 잃는다.
- **회차**(`/v2/practices/**`, `feature/practice` 의 0.1.0 코드) — 영상 하나로 시작하는 연습의 단위다.
  - **시작** `POST /v2/practices`: 본문 `request_id`·`video_id`·`scene{situation, character, goal}`·
    `blockage{category, detail, note}`. **회차 하나와 분석 작업 하나가 한 트랜잭션**이다 — 도중에 실패하면 둘 다
    없다. 첫 회차는 `root_id = 자기`·`ordinal = 1`·`stage analyzing` 이고 `ai_jobs` 에 `analyze` 가 `pending` 으로
    선다. 응답은 **201** `Practice`.
    - **잠그는 순서가 규칙을 세운다**: 시작은 **영상 행**(보관함의 삭제·파기와 같은 행, §6-15 보관함)을 잡고,
      이어하기·재시도는 **묶음의 첫 행**을 잡으며, 게스트의 하루 한도는 **사용자 행**을 잡고 센다.
    - Scene Context 는 셋 모두 선택이고 각 300자, 막힘 서술은 500자다(넘으면 422 **배열**). 비우면 빈 문자열로
      저장하고 **시작 뒤에는 바꾸지 않는다** — 고치는 API 가 없다. 막힘을 고르지 않으면 "그 외/그 외"이고 큰 갈래와
      세부의 조합은 옛 CHECK 와 같다. **이론 선택은 0.1.0 에 없다.**
    - **경험 판**(`experience_version`)은 서버 플래그(`ACTTUB_THREE_LAYERS_ENABLED`)가 켜져 있고 계약 헤더
      `X-Acttub-Contract: three_layers_v1` 이면 장면·막힘을 적었는지와 무관하게 `three_layers_v1` 이다(SOMA-508 hotfix,
      `PracticeRules.threeLayers` — 예전에는 무입력일 때만이었다). 그 밖은 전부 `legacy` — 본문에 `client_experience` 같은 필드는 없다(헤더가 정본이다).
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
- **분석 결과**(`analyses`, `feature/analysis`): 워커는 **한 클래스**(`AnalysisWorker`)이고 원장마다 저장소·빈이
  하나다 — 옛 `AnalysisStore`(={`external_operations`} + `summaries`)와 0.1.0 `PracticeAnalysisStore`
  (={`ai_jobs`} + `analyses`·`video_transcripts`). 영상을 내려받고 검증값을 견주고 실패를 분류하고 lease 를 다루는
  규칙이 한 벌이어야 하기 때문이다. 스케줄러는 등록된 워커를 모두 돌린다.
  - **공개 요약 조회** `GET /v2/practices/{id}/analysis`: `{id, format, status, summary}`다. 기존 갈래의 summary는
    `ObservationPackResponse`, 신형은 `VideoRecordSummaryResponse`다. 전체 내부 원문·출처 목록은 내보내지 않는다.
    새 분석이 없으면 소유권을 확인하는 옛 분석 읽기로 이어진다. 없는/남의 회차는 404 `practice_not_found`,
    소유한 회차에 아직 분석이 없으면 404 `analysis_not_found`다. 영상 파일을 파기해도 저장된 요약은 읽을 수 있다.
  - **완료는 한 트랜잭션이고 그 안에서 주인과 계정 상태를 다시 본다**: 탈퇴가 먼저 끝났으면 결과를 저장하지 않고
    작업을 `failed`/`account_deactivated` 로 닫으며, 이관이 먼저 끝났으면 회차의 주인이 이미 회원이라 결과가 회원의
    것이 된다. lease 가 재선점됐으면 완료가 거절되고 트랜잭션이 통째로 되돌아간다.
  - **기록은 완료 뒤 불변이다** — 같은 회차에 두 번째 분석이 끝나도 덮지 않는다(`ON CONFLICT DO NOTHING`). 형식은
    `experience_version` 이 정한다: 신형은 `video_record_v1` 이고 **행의 id 가 `record_id`**, 기존 갈래는 `legacy` 로
    ObservationPack 원문을 그대로 둔다(구형을 신형으로 위장하지 않는다). **못 본 구간이 있으면 `partial`** 이고 그
    구간을 채우지 않는다 — 부분 완료여도 대화는 시작된다.
  - 결과가 저장되면 회차가 `conversing` 으로, 최종 실패(3회 소진·즉시 실패)면 `closed`/`analysis_failed` 로 간다.
    **코치 시작은 이 `stage` 가 답한다** — `conversing` 이 아니면 409 `analysis_not_ready` 다.
  - **받아쓰기는 영상당 묶음 하나**다(`uq_video_transcripts_video`). 같은 영상의 다음 회차는 새로 만들지 않고 먼저
    만든 묶음을 재사용한다.
  - 예약 장부에 **검증값이 없는 영상은 견주지 않는다** — 없는 것을 불일치로 보면 그 회차가 재큐만 되풀이하다 실패한다.
- **코치 대화**(`/v2/coach/**`, `feature/coach` 의 0.1.0 코드) — 회차에 대화는 하나다(`coach_conversations.practice_id`
  유일). 열린 대화는 같은 id 로 재개하고 닫힌 뒤 다시 코칭하려면 새 회차다.
  - **바꾼 것은 저장뿐이다.** 코치의 행동 규칙(응답 상한 8/10, 첫 응답 경로, 도움 버튼, 상태 json 의 출처 분리,
    프로필 조건부 입력)은 `CoachEngine`·`CoachPrompt` 가 그대로 갖고 있고(§7·§8, ADR-027), 새 저장소는 엔진이 쓰는
    `CoachSessionSnapshot` 을 `practices`·`analyses`·`videos`·`coach_*` 에서 만들어 건넨다.
  - **시작** `POST /v2/coach/start` `{practice_id, request_id}`: 회차의 `stage` 가 `conversing` 이 아니면 409
    `analysis_not_ready` 다 — 분석이 결과를 저장할 때 그 값이 된다(§6-15 분석). `start_request_id` 로 멱등하다.
  - **답장** `POST /v2/coach/reply` `{conversation_id, request_id, text, revision}`: 배우 답은 300자까지다.
    `(conversation_id, request_id)` 로 멱등하고 같은 id 에 다른 본문이면 422 `request_fingerprint_mismatch`,
    `revision` 이 다르면 409 `conversation_conflict`, 닫힌 대화면 409 `conversation_closed` 다. **바깥 호출(LLM)은
    트랜잭션 밖**이고 저장할 때 대화 행을 잠가 `state_revision` 을 다시 본다(§5-4).
  - 응답은 `{conversation, message, note}` 이고 `conversation` 에 `status`·`revision`·`coach_reply_count`·
    `reply_limit`·`messages` 가 있다 — 화면이 남은 응답 수와 마무리 예고를 그린다.
  - **대화 조회** `GET /v2/coach/conversations/{id}`: 409 뒤 최신 상태를 다시 읽는 자리이자 회차의 이전 대화를
    펼치는 자리다. 없는 것과 남의 것은 같은 404. `reply_limit`은 저장된 경험 판을 읽어 기존 갈래는 8,
    신형은 10을 반환하며 시작·후속 응답과 같다.
- **연습 노트**(`coach_notes`, `GET /v2/practices/{id}/note`) — 대화와 1:1 이고 닫힐 때 **한 번** 만든다(고정된 종료
  `source_revision`). 재생성 요청은 같은 노트를 돌려받는다.
  - **만들지 않는 조건**이 갈래마다 다르다: 기존 갈래는 종료어·도움말을 뺀 배우 답이 2개 미만이면 만들지 않고
    (화면은 "아직 정리 없음"), 신형은 조기 종료에도 남긴다 — 제안이 있으면 `action`, 초점만 남았으면
    `observation`, 초점도 없으면 `record_only` 이고 그때 **제목은 NULL** 이다.
  - 생성이 실패하면 **한 번 재시도**하고 그래도 실패하면 기존 갈래는 노트가 없고 신형은 확인된 것만 담은 폴백
    (`fallback = true`)을 남긴다. 내부 재시도가 성공하면 `fallback = false`이고, 거듭 실패해도 이미 확인된
    초점·근거는 보존한다. 배우의 방향(`direction`)과 촬영 제안(`practice.instruction.text`)을 혼동하지 않는다.
  - 생성기가 낸 **원문 전체**를 `legacy_report` 에 함께 둔다 — 컬럼 이름은 옛 것이지만 신형도 여기에 둔다. 옛 공개
    필드를 읽던 화면이 그대로 쓰는 호환 응답의 재료다.
  - 응답의 `summary_quotes`는 `{quote, kind, source_ref}` 배열이고 `kind`는 actor·observation이다.
    `actor_words`·`corrections`·`tags`는 문자열 배열이다. 응답의 `report`는 기존 공개 리포트 또는
    `acttub.public_practice_note.v1`이며 내부 출처 목록·대화 상태를 보내지 않는다. 원문은 DB에 그대로 보존한다.
  - 응답의 `my_rating` 은 이 사람이 이 노트에 남긴 평가(`NoteRating`)이고 없으면 null 이다. **노트 조회만 채운다** —
    코치 응답(`CoachTurnResult.note`)에 실린 노트는 방금 만든 것이라 언제나 null 이다(SOMA-558, 키 추가만).
- **노트 평가**(`note_ratings`, V22, `PUT /v2/practices/{id}/note/rating`, SOMA-558) — "도움 됐어요·아쉬웠어요" 를 누르는
  순간 노트 단위로 남긴다. 본문 `{request_id, rating, comment?}`, 응답 200 `{rating, comment, updated_at}`.
  - **노트 하나에 사람 하나가 한 행**이다(`uq_note_ratings_note_user`). 다시 보내면 값·한 줄·`request_id`·`updated_at` 을
    덮어쓰고, `comment` 를 빼면 한 줄도 비운다. `rating` 은 `helpful`·`not_helpful` 이고 밖의 값은 422 **배열**이다.
    한 줄은 앞뒤 공백을 걷은 1~100자(코드 포인트)이고 비었으면 NULL, 넘으면 422 `comment_too_long` 이다.
  - **멱등은 행의 `request_id` 가 한다.** 같은 id·같은 본문(다듬은 값으로 견준다)의 재전송은 200 같은 응답이고 행을
    바꾸지 않으며, 같은 id 에 다른 본문은 422 `request_fingerprint_mismatch` 다. 행이 덮어쓰이므로 지문 칸을 따로
    두지 않고 저장된 값과 견준다. 기기는 노트마다 마지막 요청 하나만 들고 있다가 다시 보낸다 — 옛 요청이 새 평가를
    덮지 않게 하는 것은 기기의 몫이다.
  - **게이트·소유권은 노트 조회와 같다**: 없는 회차·남의 회차·노트가 아직 없는 회차는 모두 404 `note_not_found`.
    평가가 가리키는 것은 0.1.0 노트(`coach_notes`)뿐이라 **아직 옮기지 않은 옛 노트(`practice_reports`)는 조회는 되지만
    평가는 404** 이고 `my_rating` 은 언제나 null 이다(전환 명령이 옮기면 받는다).
  - 쓰기는 탈퇴와 같은 `users` 행을 `FOR UPDATE` 로 잡고 활성인지 다시 본다(§6-8) — 게이트 뒤에 탈퇴가 끝났으면 403
    `account_deactivated`. 평가는 노트·대화·기억 상태를 바꾸지 않는다. 구현은 `coach/app/NoteRatingService`·
    `coach/adapter/db/PostgresNoteRatingStore`, 실 DB 검증은 `NoteRatingIT` 다.
  - **이관**은 회차를 따라 `user_id` 를 회원으로 바꾼다(`NoteRatingOwnership`, 설문 다음). **탈퇴**는 한 줄(자유 입력)을
    비우고 평가 값은 사람과 끊어 남긴다(`PostgresProfileRepository#erasePractice`).
- **배우 기억**(`/v2/me/memory`, `actor_memories`) — 칸은 **넷**(`goal`·`blockage`·`speech_self`·`speech_actual`)이고
  `(user_id, field)` 유일이다. **성별·나이 칸은 없다** — 프로필로 옮겼다(account.profile). 옛 여섯 칸 화면은
  `/v2/legacy-me/memory` 로 옮겨 옛 표(`actor_memory_entries`)를 그대로 읽는다.
  - `GET` 은 칸마다 `field`·`value`·`written_by_actor`·`source_practice_id`·`updated_at` 을 준다. **출처 회차가 숨겨진
    묶음이면 값은 그대로고 `source_practice_id` 만 비운다**(링크만 사라진다).
  - `PUT /v2/me/memory/{field}` 는 공백을 정리한 뒤 1~1,000자다. 다듬고 나서 빈 값이면 422 **배열**
    (`value must not be blank`), 1,001자도 422 배열이다. 여기서 쓴 칸은 `written_by = actor` 이고 **워커가 덮지
    않는다**. `DELETE` 는 칸 하나든 전체든 **멱등**(204)이고 누적 확인 연습 횟수를 초기화하지 않는다.
  - **기억 세대**(`users.memory_epoch`)가 늦은 갱신을 막는다. 삭제와 **이관 선택**이 세대를 올리고, 갱신 작업은
    예약 시점의 세대를 `ai_jobs.memory_epoch` 에 들고 있다가 완료 때 다르면 `memory_epoch_stale` 로 닫고 **아무것도
    쓰지 않는다** — 지운 기억이 되살아나거나 버린 쪽의 작업이 덮지 못한다.
  - **갱신 예약**은 대화가 닫히고 노트까지 남은 뒤다(`coach/app/ConversationClosedListener` → `memory`). 확인 연습은
    **노트가 남은 회차**이고 `record_only` 는 세지 않는다 — 첫 회차와 그 뒤 3의 배수(1·3·6·9…)에만 `ai_jobs` 에
    `memory_update` 가 선다. 요청 id 를 회차에서 만들어 **같은 회차는 작업 하나**다.
  - 워커는 분석과 **같은 추출기·같은 재시도 규칙**이다(근거는 배우 발화·받아쓰기·관찰뿐, 바깥 실패는 재큐이고 3회
    뒤 sweep 이 닫는다). 저장은 한 트랜잭션에서 **지금의 주인**에게 하고 계정 상태와 세대를 다시 본다. **회차 상태는
    건드리지 않는다** — 기억이 없다고 연습이 망가질 것은 아니다.
- **이탈 설문**(`/v2/practice-feedback`, `/v2/me/practice-feedback/**`, `practice_feedback`) — **DB 가 정본이고 시트는
  복제본이다**(ERD).
  - **접수** `POST /v2/practice-feedback`: `request_id`·`practice_id?`·`screen`(coach·report)·`trigger`(x·leave·back)·
    `body?`·`contact_email?`·`contact_phone?`. 본문은 공백 정리 뒤 1~100자이고 **없으면 건너뛰기**(`dismissed`)다 —
    공백만 보낸 본문은 건너뛰기가 아니라 422 `feedback_body_required`. 연락처는 각각 80자이고 없이도 보낼 수 있다.
    길이는 유니코드 코드 포인트로 세며 본문은 공백 정리 뒤 센다. 초과는 422 배열이며 이모지 100개를 UTF-16 길이로 거절하지 않는다.
    남의 회차를 가리키면 404 `practice_not_found`. 만들면 **201**, 같은 `request_id` 의 재전송이면 **200** 이고 같은
    설문 id 다(오프라인에서 들고 있다 다시 보내도 행 하나).
  - **한 계정에 한 번만 묻는다.** `GET /v2/me/practice-feedback/status` 는 `{asked, asked_now}` 로 이미 물어봤는지만
    보고 표식을 건드리지 않는다. 자동 노출 직전에는 `POST /v2/me/practice-feedback/claim` 으로 **선점**하고
    `asked_now` 가 참인 기기만 시트를 띄운다 — `UPDATE users … WHERE exit_survey_asked_at IS NULL` 한 문장이라 두
    기기가 동시에 물어도 하나만 이긴다. 오프라인에서는 선점을 부르지 않는다(새 자동 노출 없음).
  - **시트 복제는 뒤의 일이다.** 저장은 DB 커밋으로 끝나고 전송이 실패하면 `sheet_synced_at` 이 NULL 로 남아 매일
    도는 일이 다시 보낸다. 시트는 설문 id 로 **한 줄**이고 `sheet_seq` 가 작은 전송은 무시한다 — 오래된 전송이 파기한
    연락처를 되살리지 못한다. **이 전송은 AI 작업이 아니라 `ai_jobs` 에 넣지 않는다.**
  - **연락처는 접수 90일 뒤에 비운다**: DB 를 비우고 `sheet_seq` 를 올린 뒤 `sheet_synced_at` 을 NULL 로 되돌려 같은
    설문 id·새 순번으로 시트에 다시 보낸다(시트의 연락처도 지운다). 탈퇴 때도 같다. **본문은 사람과 끊어 남는다.**
  - 시트 구현이 아직 없다. 자리 지킴이(`adapter/sheet/LoggingExitSurveySheet`)는 **보낸 척하지 않고 실패로 남긴다** —
    성공을 돌려주면 그 설문이 재전송 대상에서 빠져 시트가 붙는 날 영영 복제되지 않는다.
- **운영 피드백 조회**(`GET /v2/admin/feedback`) — 같은 `ADMIN_OPS_TOKEN` 으로 이탈 설문과 노트 평가를
  최신순 한 목록으로 읽는다. 기본 50개, 최대 100개이고 응답은 `{items, limit, has_more}` 다.
  - 한 항목은 `id`·`kind`(`exit_survey`·`note_rating`)·`created_at`·`actor`·`is_team`·`body`·`rating`·
    `status`·`source`·`trigger`·`practice_id`를 항상 싣고 해당 없는 값은 null 이다. 설문은 body 유무에 따라
    `answered`·`dismissed`, source 는 `coach`·`report`다. 평가는 comment 를 `body`, 평가값을 `rating`, source 를
    `practice_note`로 낸다. 정렬은 `created_at DESC, kind ASC, id ASC`라 같은 시각에도 고정된다.
  - 배우는 `배우 ` + `md5(user_id)` 앞 8자리뿐이다. 연락처·원본 user id·이메일은 projection 과 DTO 에 없다.
    `ADMIN_OPS_EXCLUDE_EMAILS`와 `exclude_actors`(ops-core와 같은 검증)를 팀으로 보고 기본적으로 제외한다.
    `include_team=true`일 때만 팀 테스트를 포함하고 `is_team=true`로 표시한다.
  - 이 자유 입력 조회는 **별도 실시간 경로뿐**이다. `ops-core` JSON·백업 스냅샷·git 산출물에는 body나 평가
    comment를 넣지 않는다.
- **연습 자료의 이관·삭제·탈퇴** — 정본은 specs/practice 의 처리표다.
  - **이관**은 `user_id` 가 있는 행을 한 트랜잭션에서 옮긴다: 예약 장부 → `videos` → `practice_sessions`·`practices`
    → `external_operations`·`ai_jobs` → 배우 기억 → 리딩 → 설문 → 노트 평가 순이다(§6-9의 잠금 순서에 이어진다). 분석·대화·노트·
    받아쓰기는 그 행에 매달려 따라간다. 기억은 합치지 않고 양쪽에 있으면 409 `memory_choice_required` 이며, 고른
    뒤 **회원의 기억 세대가 오른다**. 설문 이력은 모두 회원 것이 되고 **어느 쪽이든 물어봤으면 회원도 물어본 것**이다.
  - **탈퇴·30일 파기**: `videos` 는 **행을 지우지 않고** `purged_at` 을 찍어 최소 메타만 남긴다(재생은 막히고 총량에서
    빠지며 회차·참여작의 기록은 깨지지 않는다). 객체(포스터 포함)는 정리 장부로 가고, 보관 동의자의 영상은 탈퇴 3년 뒤 같은 자리에서
    파기된다. 진행 중인 `ai_jobs`(분석·기억 갱신)는 `failed`/`account_deactivated` 로 닫고 lease 를 떼며 결과 본문을
    비운다. `practice_feedback` 의 연락처는 비우고 시트에 다시 보낸다. `note_ratings` 는 한 줄만 비우고 값은 남긴다.
    `practices`·`analyses`·`coach_*`·
    `video_transcripts` 는 **사람과 끊어 남긴다**.
  - **대화 중 탈퇴**: 코치 응답의 저장은 대화 행과 함께 `users.status` 를 본다 — 바깥 호출이 도는 사이에 탈퇴가
    끝났으면 아무것도 쓰지 않고 403 `account_deactivated` 다(분석의 완료가 같은 자리에서 같은 확인을 한다).
- **데이터 전환**(`POST /v2/admin/practice-migration`, `platform/migration`) — 옛 표의 자료를 0.1.0 표로 옮기는
  <b>재실행 가능한 명령</b>이다. Flyway 가 아니라 애플리케이션 명령인 것은 전환이 배포를 멈추면 안 되고 되돌릴
  수도 없기 때문이다(specs/practice 「0.1.0 스키마 전환」 ③).
  - **단계는 순서대로 끝까지 돈다**: 영상 → 회차 → 받아쓰기 → 관찰 기록 → 대화 → 메시지 → 노트 → 기억 →
    작업 장부. 뒤 단계가 앞 단계가 만든 행을 가리키므로 한 단계를 남김없이 끝낸 뒤에 다음으로 간다. 한 묶음
    (기본 200)이 한 트랜잭션이고 **고르기와 옮기기가 그 안에 함께** 있다.
  - **멱등은 대응표가 만든다**(`practice_migration_entries`, V15). 한 번 고른 원본은 다시 고르지 않고
    ({@code (source_table, source_id)} 유일), 옮기기는 언제나 다시 돌 수 있다(`NOT EXISTS`·`ON CONFLICT DO
    NOTHING`). 몇 번을 돌려도 행 수도 대응표도 그대로다.
  - **옮기지 않는 것은 사유와 함께 적힌다**: 가지 쳐 차수가 겹치는 묶음(`branching_chain`), 닫히지 않은 회차가
    둘 이상인 묶음(`multiple_open_practices`), 확정되지 않은 업로드를 가리키는 묶음(`video_missing`), 한 연습의
    옛 대화 가운데 최신이 아닌 것(`superseded_conversation`), 같은 영상의 두 번째 전사(`transcript_conflict`).
    **임의로 닫거나 지우지 않는다** — 그 자료는 호환 읽기 경로가 옛 표에서 그대로 보여 준다.
  - **옛 표에 쓰는 자리는 `upload_intents.video_id` 하나다** — V14 가 예약 장부에 더해 둔 칸이고 옛 서버는 그것을
    모른다. 그 밖의 옛 표는 읽기만 한다.
  - **진행 중인 AI 작업은 옮기지 않는다**(고르지도 않는다). 옛 워커가 끝내야 하고 두 큐에서 같은 작업이 동시에
    돌면 안 된다 — 끝나면 다음 실행이 집어 간다. 옮긴 작업의 `memory_epoch` 는 NULL 이다(옛 예약에는 세대가
    없고, NULL 은 "세대를 견주지 않는다" 는 뜻이다).
  - **이름을 바꾸지 않는다**: 기존 갈래 노트는 `legacy` 형식에 옛 종류(analysis·expression) 그대로이고, 구형
    관찰은 `legacy` 형식에 원문 그대로다. 대화의 종료 사유만 새 어휘로 옮긴다(`actor_finished`→`user_ended`,
    `turn_budget`→`limit`, `interrupted`→`exhausted`). 옛 대화에는 시작 요청 id 가 없어 **세션 id 를 그대로** 쓴다.
- **호환 읽기 경로**(specs/practice ②) — 넓히기와 새 쓰기 사이에는 같은 배우의 자료가 두 표에 나뉘어 있다. 새 조회
  API 는 **새 표를 먼저 보고 없으면 옛 표를 읽어 같은 응답 모양**을 낸다. 화면은 어느 표에서 왔는지 모른다.
  - `GET /v2/practices/{id}`·`/status`·`GET /v2/practices` 는 `practice/adapter/db/PostgresLegacyPracticeReader`
    로 간다. 차수는 `continued_from` 체인을 그때그때 펴서 만들고 **전환 명령과 같은 규칙**이라 옮기기 전후의
    응답이 같다. 옛 묶음에는 제목·태그·즐겨찾기가 없어 `favorite` 필터에는 하나도 걸리지 않는다.
  - `GET /v2/practices/{id}/note` 는 `practice_reports` 를 새 봉투에 담아 낸다. `GET /v2/coach/conversations/{id}`
    는 `coach_sessions`·`coach_turns` 를 읽는다 — **한 연습에 대화가 여럿인 옛 자료의 "이전 대화" 가 이 경로로
    열린다.**
  - **회차 상세의 `previous_conversations`** 는 새 표에서는 언제나 빈 배열이다(회차당 대화 하나). 채워지는 것은
    옛 자료뿐이고, **옮긴 뒤에도 채워진다** — 전환이 최신 하나만 옮기고 나머지를 옛 표에 남기기 때문이다.
  - **구형 관찰은 요약만이다** — 새 모양에 담기는 것은 기록의 상태(`ready`·`partial`)까지다. 구형 분리 배열을
    신형 기록으로 위장하지 않는다.
  - 호환 읽기는 **옛 표를 고치거나 지우지 않는다.**
- **되돌리기**(specs/practice 「0.1.0 스키마 전환」, BRANCHING-STRATEGY 「DB와 배포 안전성」) — 내리기 마이그레이션은
  없다. 대신 **더하기만 한다**: V14·V15 는 새 표와, 예약 장부의 NULL 허용 컬럼 셋, `users` 의 둘만 더했고 옛 표의
  모양은 한 칸도 바뀌지 않았다(`flyway/PracticeRollbackCompatibilityTest` 가 V13 과 최신의 fingerprint 를 옛 표만
  추려 견준다). Hibernate 의 `ddl-auto: validate` 는 **매핑이 없는 여분 표를 보지 않으므로** 직전 태그의 서버가
  새 표가 있는 DB 에서 그대로 뜬다. 배포 절차는 [DEPLOY-HOME.md](../../docs/deploy/DEPLOY-HOME.md) 의 롤백 절과
  같고, 사람이 밟아야 하는 확인(직전 태그 이미지로 옛 화면 읽기)은 배포 파이프라인의 일이다.
- **옛 쓰기 경로는 내렸다** — `/v2/uploads/**` 와 `/v2/practice-sessions/**` 는 사라졌다. 영상은
  `/v2/videos/**` 가, 회차는 `/v2/practices/**` 가 받고, 그 표에 없는 옛 자료는 **호환 읽기 경로**가 같은 모양으로
  보여 준다(위 「호환 읽기 경로」). 옛 표는 그대로 남아 있고 지우지 않았다 — 삭제는 읽기·쓰기를 모두 중단한
  버전을 배포한 다음 릴리스부터다(specs/practice ④). 게스트 기능표에서도 두 경로를 뺐다.
- **옛 코치·리포트 경로도 내렸다** — `/v2/legacy-coach/**`와 옛 연습의 `/v2/reports/**`는 등록하지 않는다.
  코치는 `/v2/coach/start`·`/v2/coach/reply`, 노트 읽기는 `/v2/practices/{id}/note`를 쓴다. 새 코치는 §7-2의
  프로필과 배우 기억을 매 턴 읽으며, 같은 묶음의 앞 회차 대화·노트만 참고한다. 복수 대화 전환에서 옛 표에
  남긴 노트도 소유권을 확인해 읽는다. `CoachReadsProfileIT`는 새 경로에서 이 규칙과 조회 실패의 폴백을 검증한다.
  옛 저장 형식의 회귀 검사는 테스트 전용 어댑터로 유지하며 이 어댑터는 운영 산출물에 포함하지 않는다.
- OpenAPI 컴포넌트: 보관함은 `Video`·`VideoList`·`VideoUsage`·`VideoIntent`·`VideoIntentRequest`·`VideoPatch`, 회차는
  `Practice`·`PracticeGroup`·`PracticeGroupList`·`PracticeStatus`·`PracticeJob`·`PracticeScene`·`PracticeBlockage`·
  `PracticeCreateRequest`·`PracticeContinueRequest`·`PracticeAnalyzeRequest`·`PracticeGroupPatch`·
  `PreviousConversation`, 기억은
  `ActorMemoryItem`·`ActorMemoryResponse`·`UpdateActorMemoryRequest`(옛 여섯 칸의 `MemoryItem`·`MemoryResponse`·
  `UpdateMemoryRequest` 는 `/v2/legacy-me/memory` 가 계속 쓴다), 설문은 `PracticeFeedbackRequest`·
  `PracticeFeedbackResponse`·`PracticeFeedbackStatus`, 노트 평가는 `NoteRatingRequest`·`NoteRating`(`CoachNote.my_rating`).

### 6-16. 챌린지 개설·목록 (0.1.0)

> 제품 규칙의 정본: [challenge/](../../docs/specs/challenge/README.md)(게이트, 삭제·탈퇴 표, 공개 조건·개인 노출 조건), [challenge.create](../../docs/specs/challenge/create.md)(개설·삭제·운영 개설·moderation, 정규화·한도·오류 코드, 오늘의 챌린지), [challenge.browse](../../docs/specs/challenge/browse.md)(목록 탭·정렬·커서·검색, `featured`·`more_count`)

- 게이트는 `adapter/web/ChallengeMembers` 한 곳이다. 이후 챌린지 절(6-17~6-20)의 회원 경로도 이것을 지난다.
- 개설의 검사·쓰기는 활성 사용자 행 잠금 아래 하므로 동시 개설·탈퇴 뒤 늦은 쓰기가 새 행을 만들지 않는다.
- V16은 `challenges`, V17은 공개 집계의 기반인 `challenge_entries`·`entry_likes`·`user_blocks`를 더한다.
  기존 표·컬럼은 축소하지 않는다. 값 CHECK와 Schema Entity 매핑도 함께 검증한다.

### 6-17. 챌린지 참여·랭킹·조회수 (0.1.0)

> 제품 규칙의 정본: [challenge.entry](../../docs/specs/challenge/entry.md)(참여·수정·삭제, 영상 길이, 오류 코드·한도), [challenge.browse](../../docs/specs/challenge/browse.md)(참여작 목록·순위·스냅숏 커서, 종료 랭킹 `ranking_state`, 조회수, P03), [challenge.react](../../docs/specs/challenge/react.md)(공유 링크 `/e/<id>`와 `GET /v2/public/entries/{id}`)

- 참여의 검사·쓰기는 사용자 → 챌린지 → 영상 행을 잠근 한 트랜잭션이라 챌린지 삭제·영상 파기·보관함 삭제·탈퇴와
  겹쳐도 한쪽만 성공한다.
- 종료 랭킹 집계는 챌린지 행을 잠그고 한 번 한다(매시 일은 `CHALLENGE_SETTLEMENT_ENABLED`). likes 정렬의 첫 조회는
  전체 순서와 순위를 `entry_ranking_snapshots`에 굳히고 커서는 그 위치다.
- 조회 사건은 `entry_view_events`에 조회수 증가와 한 트랜잭션으로 남긴다.
- 공유 조회(`GET /v2/public/entries/{id}`)의 IP별 한도는 웹 서버가 받은 `X-Forwarded-For`를 그대로 넘긴 값으로 센다(§6-13).
- V18은 `entry_view_events`·`entry_ranking_snapshots`를 더하고 기존 표는 바꾸지 않는다.

### 6-18. 챌린지 반응·차단·신고 (0.1.0)

> 제품 규칙의 정본: [challenge.react](../../docs/specs/challenge/react.md)(좋아요·저장·댓글, 저장 목록), [challenge.block](../../docs/specs/challenge/block.md)(차단), [challenge.report](../../docs/specs/challenge/report.md)(신고·운영 판정·`target_version`·`target_text`)

- 반응 저장은 행동하는 사람·작성자 `users` 행(id 순)과 참여작 행을 잠근 채 조건을 다시 본다. 차단은 두 사람 행을
  id 순으로 잠근다. 신고 저장과 숨김은 대상 행을 잠근 한 트랜잭션이고, 운영 판정도 대상 행을 잠그고 한다.
- 좋아요 수는 연결 행을 다시 센다(§7 머리말 1번).
- POST `/v2/reports`는 옛 연습 리포트 작업(`create_report_v2_reports_post`)이 아니라 챌린지 신고
  (`create_challenge_report_v2_reports_post`)다. V19는 `entry_saves`·`entry_comments`·`entry_reports`를 더한다.

### 6-19. 챌린지 AI 리포트 (0.1.0)

> 제품 규칙의 정본: [challenge.ai-report](../../docs/specs/challenge/ai-report.md)(요청·조회, 한도, 표본 선정, 입력은 영상과 대사, 출력 모양·금지 어휘, 3회 실행, 저장 직전 재확인, 파기)

- 요청은 참여작 행을 잠가 같은 참여작의 동시 요청과 삭제를 줄 세운다.
- 워커(`ANALYSIS_WORKER_ENABLED` 스위치를 공유)는 `AiJobLedger`로 작업을 집는다. 모델 포트(`ChallengeReportModel`)는
  영상과 챌린지 대사만 받는다 — 코치 대화·장면 입력·배우 기억을 실을 자리가 없다. Gemini 구현은 저장소에서 받은
  영상들을 라벨(내 영상·S1…)과 함께 한 번에 보인다.
- 금지 어휘 목록과 실행 상한은 `ChallengeReportRules` 한 곳이다. 문장별 표본 id는 `entry_ai_reports.result`에만 있다.
- V20은 `ck_ai_jobs_kind`에 `challenge_report`를 더하고 `entry_ai_reports`(참여작당 한 행)를 만든다.

### 6-20. 챌린지 알림함·푸시와 탈퇴 연결 (0.1.0)

> 제품 규칙의 정본: [challenge.notification](../../docs/specs/challenge/notification.md)(사건 넷, 묶음·`group_key`, 발송 시각·재확인, 알림함·읽음·`target_available`, 90일 정리), [challenge/](../../docs/specs/challenge/README.md)의 삭제·탈퇴 표와 [account.withdraw](../../docs/specs/account/withdraw.md)(탈퇴 연결)

- event_key는 `like:<좋아요 id>`·`comment:<댓글 id>`·`ai_report:<작업 id>`이고 `challenge_ended`는 챌린지당 하나다.
  사건은 원인 행동과 같은 트랜잭션에서 `notifications`에 남기고 `(user_id, event_key)`로 재전송을 한 행으로 막는다.
  참조의 부모 관계(`comment_id`의 참여작, `entry_id`의 챌린지)는 FK로 묶는다.
- 발송(`CHALLENGE_NOTIFICATION_PUSH_ENABLED`)은 커밋 뒤 따로 돈다. 때가 된 묶음을 잠그고 `notification_pushes`의
  `(group_key, stage first·summary)`를 한 번만 선점해 첫 푸시와 요약 푸시를 하나씩 보낸다.
- 탈퇴는 계정을 비활성으로 바꾸기 전에 이 사람의 참여작이 있는 챌린지의 밀린 마감 집계를 먼저 한다
  (`ChallengeWithdrawal`). 진행 중 리포트 생성은 기존 `ai_jobs` 취소가 닫는다.
- V21은 `notifications`·`notification_pushes`와 `entry_comments (id, entry_id)` 유일 제약을 더한다.

## 7. 보존 규칙 — 되돌리면 안 되는 결정

1. **좋아요 카운트는 재집계다.** 증감 방식이 "두 번 눌리면 2 증가" 하던 버그 때문에 의도적으로
   선택됐다. 성능 명목으로 증감으로 되돌리면 버그가 부활한다. (1·2는 커뮤니티의 규칙이다. 코드는
   0.1.0에서 내렸고 git 이력의 `feature/community/adapter/db/PostgresCommunityRepository`에 있다 —
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
([account.profile](../../docs/specs/account/profile.md)). §7-1 의 계약은 그대로다 — 요청·응답 DTO,
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
  라우팅 경로(`dialogue_actions_v2`)에서는 그 입력이 **생성 호출**(`CoachingPipeline:generate`)에 실리고 프로필 지시도 그
  호출에만 붙는다 — 분류 호출은 프로필을 받지 않는다. 별도의 문장 다듬기 호출은 없다.
  `ConversationService` 가 **턴마다 다시 읽는다** — 설정에서 고친 값이 다음 코치 대화부터 반영된다. 읽다 실패하면 보고하고
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

**Gemini 직접 영상 코칭(2026-09-21):** 배포가 `ACTTUB_THREE_LAYERS_ENABLED=true`와
`ACTTUB_DIRECT_VIDEO_ENABLED=true`를 명시하면 영상 전용 신규 연습은 1층 AI 분석을 생략한다.
업로드 무결성과 길이를 확인하고 빈 관찰 팩으로 분석 작업을 완료한다. `/v2/coach` API가
소유한 원본 영상과 해당 세션의 실제 대화 원문을 Gemini에 전달한다. 시스템 지시는
`DirectVideoPrompts.common()`의 공통 원칙과 서비스가 선택한 응답별 지침을 붙인다. §7-2의 프로필과 같은 묶음의
이전 맥락은 생성 호출에만 별도 블록으로 싣고, 텔레메트리에서 프로필 이름을 가린다. 분류에는 싣지 않는다.
후속 발화는 영상 없이 실제 대화 원문으로 별도 Gemini 분류를 거친다. 분류기는 의도·정정·모름·방법 요청·수긍·기타를
허용된 JSON 신호로만 반환하고, 코드는 정정 → 이해 보조 → 방법 → 의도 → 수긍 순으로 지침을 선택한다.
정정과 방법 요청 또는 정정과 이해 어려움이 함께 있으면 해당 두 지침만 순서대로 붙인다.
첫 응답과 기존 규칙의 명시적 종료·횟수 제한은 서비스가 직접 선택한다. 단순 수긍은 세션을 닫지 않는다.
예상 밖의 질문·사실·감정·화제 전환이나 확신하기 어려운 답은 기타(`other`) 지침으로 받으며 기존 흐름에 억지로 맞추지 않는다.
빈 신호 배열도 기타로 받는다. 분류 실패·잘못된 JSON은 원인을 보고하고 별도 기본 답변(`general`)으로 이어간다.
분류 결과는 배우에게 표시하거나 대화·확정된 배우 의도로 저장하지 않는다. 코칭 출력은 평문이다.
서버는 모델 응답에서 Markdown 제목·강조·목록 기호·표·코드 블록 기호를 걷어 낸 평문을 대화 턴·handoff·응답에 같은 값으로 저장한다(`PlainCoachText`). 기호를 걷은 뒤 비어 있으면 빈 응답과 같은 생성 실패로 처리한다.
첫 응답은 장면 전체 인상, 중요한 보완점 최대 두 개와 구체적인 근거, 개선 방향을 짧은 문단으로 설명한다.
모든 답을 한두 문장으로 제한하지 않으며, 부족함이나 화면 밖 상대의 반응을 지어내지 않는다.
후속 대화는 기존 진단과 최신 발화를 연결하며, 끝의 질문은 필요한 경우에만 한다.
코치 응답은 기존 turn/revision/멱등 저장 계약을 따른다. 종료와 10회 제한, handoff v2 및 3층 노트는
유지한다. 자유 형식 응답을 구조화된 관찰·확인된 배우 의도로 승격하지 않는다.
매 요청의 Gemini 파일과 로컬 임시 파일은 성공·실패 모두 정리한다.
직접 영상 코칭은 §6-15의 회차·대화 저장 계약을 쓴다. legacy 연습과 설정이 꺼진 환경은 아래 모델 경로를 유지한다.
설정을 끈 뒤에는 분석을 생략한 세션 대신 영상을 새로 올린다.

아래 첫 질문·단일 프롬프트 설명은 legacy 및 `acttub.coaching.routed-enabled=false` 롤백 경로에 해당한다.
Gemini 직접 영상 코칭이 꺼진 환경의 기본 2층은 [Luna 분류와 코드 기반 선택](../../docs/specs/practice/coach.md#2층-대화-동작-분류와-코드-기반-프롬프트-선택)을 따른다.
첫 질문 개정(SOMA-531): 기존 기본 코치와 구조화 코치는 공통 `coach/coach-opening-policy.txt`를 사용한다.
전체 흐름에서 중요한 지점을 고르고 답에 따라 살펴볼 기준이 달라지는 쉬운 질문 하나로 시작한다.
기본 코치에 있던 질문 없는 관찰·해석 시작은 폐기한다. 근거가 있는 첫 응답은 질문 누락·중복과
대표적인 모호한 해석 문구를 재생성 사유로 삼고, 새 경로는 근거 참조·focus 저장·즉시 종료도 검증한다.
대사 인용 안의 물음표는 배우에게 묻는 질문 수에서 제외한다. 의미적 관련성과 선정의 적절성은
자동 검사만으로 보장하지 않는다. 공개 JSON과 DB는 유지한다.

2026-09-14의 2·3층 개정은 대화와 촬영 노트([practice.coach](../../docs/specs/practice/coach.md#2층-대화-soma-531)·[practice.note](../../docs/specs/practice/note.md#3층-촬영-노트-soma-531))를 따른다.
2층 내부 출력은 직전 답변 인용을 포함한 `acttub.layer2_turn.v2`이며 과제/실행 변경을 허용하지 않는다.
서버는 현재 맥락·원문 대화·근거를 `acttub.coach_handoff.v2`로 전달하고 3층이 다음 촬영 제안 하나를 생성한다.
요약은 확인된 배우 말·관찰의 발췌이고, 제안은 선택·실행으로 승격하지 않는다.
공개 `PublicPracticeNote`와 저장 노트 v1의 필드는 유지한다. v1 handoff는 이전 프롬프트로 처리한다.

`X-Acttub-Contract: three_layers_v1`과 서버 생성 플래그로 선택한 신규 연습은 [3층 계약](../../docs/specs/practice/README.md#영상만-올리는-연습-three_layers_v1)을 따른다. 기존 입력 갈래의 응답과 legacy 저장 행은 유지한다. 새 공개 타입은 `VideoRecordSummaryResponse`, `PublicPracticeNote`, handoff branch `coaching`이다. 이 타입을 지원하지 않는 클라이언트에는 목록 필터와 직접 접근 409를 적용한다.

새 계약은 배우가 하지 않은 첫 발화를 만들지 않고, state/revision을 누적한다. 보고서 작성 여부나 턴 수를 배우의 실행·확인 증거로 쓰지 않는다. 새 노트는 handoff_confirmation 없이 생성된다. 모델 출력·참조 검증과 레코드 조회, 조립, 상태 전이의 단위 테스트에 더해 `CoachSessionRepositoryIT`에서 새 필드의 원자적 저장과 충돌을 확인한다.

### 8-6. 코드에서 선택하는 네 가지 코칭 프롬프트

**dev 직접 영상 실험:** `SITE_URL=https://dev.acttub.com`이고 `ACTTUB_DIRECT_VIDEO_ENABLED=true`로
명시한 환경에서만 `/v2/coach/direct-video/**` 임시 세션 API가 열린다(공개 OpenAPI에서는 제외).
운영의 영속 코칭과 같은 Gemini 분류·지침 선택을 사용하며, 임시 세션의 명시적 종료는 `finished`다.
영속 코칭은 위 §8-5를 따른다. 이 설정의 애플리케이션 기본값은 false다.

`three_layers_v1`의 기본 경로는 Luna 분류 → Java의 프롬프트 선택 → 문장 생성이다.
생성 모델에는 선택된 분류의 지침 하나만 전달한다. 이전 `dialogue_progress` 키워드 분기와 고정 답변은 적용하지 않는다.
첫 발화가 null인 시작은 코드가 `opening.txt`를 선택한다. 전체 흐름에서 함께 풀 가치가 있는 지점 하나를 골라
구체적인 영상 피드백 한 문장과 질문 한 문장으로 연다. 가능한 의도 두 가지를 근거에서 유추해 번호 없이
자연스럽게 묻되, 근거가 부족하면 필요한 사실 하나만 확인한다. 이미 제공된 의도·관계는 다시 묻지 않는다.
목소리·시선 변화 자체를 결점으로 삼지 않으며, 잘된 선택은 발전을 돕는다. 후속 답에는 해석·피드백·실행 가능한
연기 선택 중 필요한 도움 하나를 먼저 제공하고, 매번 선택형 질문으로 끝내지 않는다.
첫 focus는 함께 풀 주제와 근거를 저장하며, 확인하지 않은 인물의 의도나 문제를 결론으로 저장하지 않는다.
후속 턴은 네 분류의 지침을 사용한다. 첫 응답용 지침은 후속 요청이나 종료 지침에 섞지 않는다.
생성 모델은 message·context_update·evidence_refs만 출력하며, 서버가 기존 저장 계약의 revision·reply_link·flow를 조립한다.
영상 텍스트 기록 전체·현재 세션 원문 대화·현재 발화를 전달하고, 질문/종료/실행을 사용자 발화와 혼동하지 않는다.
분류는 `advance`(답변 반영), `scaffold`(막힘 지원), `repair`(대화 복구), `respond`(요청 답변)이다.
분류기는 현재 맥락·직전 교환도 함께 읽는다. 이전 분류보다 최신 정정과 현재 요청을 우선한다.
별도 한국어 편집 호출 없이 생성 원문을 대화·출처·3층 전달에 동일하게 저장한다.
별도 LLM 가드레일 검토는 없다. JSON 형식·근거 참조·원문 인용·길이·revision 검사는 저장 무결성 검사로 유지한다.
문장 수는 인용 대사 안의 문장 부호를 제외하고 코치가 배우에게 건네는 문장으로 센다. 인용을 포함한 전체 글자 수 제한은 유지한다.
공개 API, DB 스키마, 3층 handoff v2는 유지한다. 종료 요청과 턴 한도는 코드가 관리하고 종료 때는 분류를 생략한다.
