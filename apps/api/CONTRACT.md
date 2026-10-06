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

**기능의 행동(누가 무엇을 할 수 있는지, 오류 코드, 한도, 응답의 뜻, 상태 전이)은 [docs/specs/](../../docs/specs/README.md)가
정본이다.** 이 문서는 백엔드 공통 규칙(스택, 영속·트랜잭션·락, 스키마, 오류 계약의 모양, 검증)과 기능 절마다의
구현 규칙만 둔다. 기능 절(§6-5 이후)은 첫 줄에 정본 스펙을 가리킨다. 둘 다 대응하는 Java 테스트가 판정한다.
`spec/openapi.json`은 springdoc이
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

**호환 배포:** DB·API 축소는 여러 배포에 나누며, 소비 중인 컬럼·필드를 한 배포에서 제거하지 않는다.
단계(expand → contract)와 릴리스 순서는 [DB와 배포 안전성](../../docs/BRANCHING-STRATEGY.md#db와-배포-안전성)을 따른다.

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

Schema Entity는 Java 코드가 JPA로 읽고 쓰는 테이블만 매핑한다. 아무 코드도 쓰지 않는 매핑을
`ddl-auto: validate` 스키마 검증만을 위해 두지 않는다(2026-10-01 결정). `actor_memory_entries`·`push_tokens`도
`ddl-auto: validate` 대상이다. 명시적으로 은퇴한 매핑은 아래 목록으로 한정하며,
`EntityMappingIT`가 나머지 테이블·컬럼의 매핑과 검증 대상의 비공허성을 확인한다.

- 구형 `reports`: 옛 연습 노트는 `practice_reports`, 0.1.0 노트는 `coach_notes`가 갖는다.
- 옛 연습 흐름의 여섯 테이블(`practice_sessions`·`coach_sessions`·`coach_turns`·`coaching_handoffs`·
  `handoff_confirmations`·`practice_reports`): Java 쓰기 경로를 내렸다. 연습 데이터 이관
  (`platform/migration`)과 호환 읽기(`PostgresLegacyPracticeReader`, 이어하기 맥락)가 native SQL로만 읽으므로
  테이블과 값 CHECK는 그대로 둔다.
- `upload_intents`(예약 장부): 옛 올리기 저장소(`feature/upload`)를 내렸다. 보관함 저장소(`PostgresVideoRepository`)와
  이관(`PostgresVideoOwnership`)이 native SQL로만 읽고 쓰므로 테이블과 값 CHECK는 그대로 둔다.
- `summaries.observation`·`summary`·`intent_alignment`·`key_moment`·`key_dimension`:
  현재 분석 저장자와 관찰 소비자는 사용하지 않는다.
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

1. **값 목록은 text 컬럼 + CHECK 다** (SOMA-462). 네이티브 Postgres enum 열아홉을 걷어낸 이유는
   [ADR-023](../../docs/ADR.md)이다.

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
   활성 매핑의 `summaries.observations_json`/`.uncertainties_json`은 DB 기본값이 있고
   null 로 두면 NOT NULL 위반이다. 매핑을 내린 `coach_sessions.conversation_summary`(`''`)와
   구형 `reports.comparison`의 DB 기본값도 그대로 보존한다.
4. **활성 JSONB 매핑** — `summaries.raw`/`.observations_json`/`.uncertainties_json`,
   `external_operations.response_payload`(NULL 허용). 구형 `summaries.observation`과
   `reports.biggest_problem`은 DB에 보존하며 활성 매핑에서 제외한다.
   **JSON null(`'null'::jsonb`)과 SQL NULL 을 구분한다.** External Operation 신규 행의 아직 없는
   응답은 SQL NULL이고, claim·release·fail·resume·sweep가 이전 응답을 비우는 값은 Python
   SQLAlchemy JSONB `None`과 같은 JSON null이다. 완료 응답은 JSON 객체다.
5. **BIGSERIAL PK** — 활성 매핑에서는 `Anomaly.id` 하나다. `IDENTITY` 전략은 JDBC 배치 INSERT 를
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
| 6 | refresh 회전 | 소진 토큰 재사용의 전 세션 무효화는 의도된 동작이다 — [account.login 「상태」](../../docs/specs/account/login.md#상태) |
| 7 | 404 | [common.md 「오류 응답」](../../docs/specs/common.md#오류-응답) |
| 8 | S3 presign | **리전 엔드포인트 고정.** 글로벌 엔드포인트는 신규 버킷에 307 |
| 9 | ffmpeg | 동시 실행 1개 락, 600초 타임아웃, 실패·부재 시 원본 폴백 |
| 10 | 제약명 문자열 의존 | **`consent_documents` 유니크 위반** 판정을 `PSQLException.getServerErrorMessage().getConstraint()` 로 한다. 그래서 `org.postgresql:postgresql` 이 `runtimeOnly` 가 아니라 `implementation` 이다 |
| 11 | (은퇴) 테이블 락 획득 순서 | 옛 연습 원장·리포트 원장의 순서였고 두 원장과 함께 지웠다. 번호는 테스트 주석의 `§6 #N` 인용 때문에 당기지 않는다 |
| 12 | canonical JSON | 멱등 replay 는 키 정렬 + 공백 없음 + 한글 raw UTF-8 |
| 13 | `X-Request-Id` 응답 헤더 | 바디만 맞추면 놓친다 |
| 14 | v1 경로 404 | `/summarize`, `/coach/start`, `/coach/reply`, `/report`, `/report/history/{id}` 5개 |
| 15 | 숫자 파싱 | `size_bytes: 12.0`(정수형 float) → **201**, `12.5` → **422** |
| 16 | 커뮤니티 API 은퇴 | `/v2/community/**` 는 **404** 다(0.1.0, 테이블은 보존 §5-1). 인증이 선택이던 경로는 이것뿐이었다. `Authorization` 헤더가 오면 없는 경로에서도 먼저 검증한다 — 탈퇴한 계정의 토큰은 403 |
| 17 | 미처리 예외 500 | `{"detail":"internal_server_error"}` |
| 18 | 5xx `ApiException` | `ApiException.external(...)`·`ApiException.unexpected(...)` 팩토리로만 원인과 함께 만든다 |
| 19 | 클라이언트 판 426 | `ClientVersionFilter` 가 토큰 검증보다 먼저 낸다(§6-5). 행동은 [common.md 「클라이언트 판과 강제 업데이트」](../../docs/specs/common.md#클라이언트-판과-강제-업데이트) |
| 20 | 회원 게이트 | 경로 목록은 `ConsentGateInterceptor` 한 곳이다(§6-5). 규칙은 [common.md 「게이트와 보호 기능」](../../docs/specs/common.md#게이트와-보호-기능) |
| 21 | 로그인은 계정을 만들지 않는다 | 계정·신원·동의 행은 가입 제출의 **한 트랜잭션**에서 생긴다(§6-6). 행동은 [account.login](../../docs/specs/account/login.md#규칙제약) |
| 22 | 제공자 장애는 처음 온 사람에게만 | 행동은 [account.login 「예외」](../../docs/specs/account/login.md#예외)(§6-7) |
| 23 | 탈퇴는 200 과 최초 탈퇴 시각 | 탈퇴한 계정의 토큰을 받는 예외 자리는 `CurrentUserService` 다(§6-5). 바깥 호출이 실패해도 200 이고 정리 장부가 다시 시도한다(§6-8). 행동은 [account.withdraw](../../docs/specs/account/withdraw.md#상태) |
| 24 | 저장하는 비밀에는 키 판 접두사 | `uid_hash`·토큰 암호문·정리 장부의 payload 는 `k1:`(전용 키)·`d1:`(`JWT_SECRET` 파생) 로 시작한다. 읽을 때 접두사로 키를 고른다. **접두사 없는 값은 없다**(§6-8) |
| 25 | 게스트의 게이트는 다른 규칙 | 회원의 규칙과 합치지 않는다(`GuestFeature`, §6-9). 규칙은 [account.guest](../../docs/specs/account/guest.md#규칙제약) |
| 26 | 옮겨진 게스트의 사유가 먼저 | 규칙은 [account.guest 「상태」](../../docs/specs/account/guest.md#상태)(§6-9) |
| 27 | 이관은 한 트랜잭션 | 도메인마다의 "주인 바꾸기" 포트는 **자기 트랜잭션을 열지 않는다.** 도중에 실패하면 어느 행의 주인도 바뀌지 않는다(§6-9) |
| 28 | 로그아웃은 멱등 | 행동은 [account.logout](../../docs/specs/account/logout.md#규칙제약)과 [account.notification](../../docs/specs/account/notification.md#규칙제약)(§6-10) |
| 29 | 포트폴리오 공개 조회는 같은 404 | 행동(같은 404, IP 한도, `X-Robots-Tag`)은 [account.portfolio](../../docs/specs/account/portfolio.md#입력출력)(§6-11). IP 의 열쇠는 §6-13 |
| 30 | slug 는 꺼도 남는다 | 글자 규칙은 §6-11. 껐다 켜도 같은 주소라는 행동은 [account.portfolio](../../docs/specs/account/portfolio.md#규칙제약) |
| 31 | 매일 도는 일은 멱등이고 서로를 막지 않는다 | 한 가지가 실패해도 나머지는 돈다(§6-12). 쓰인 이관 코드를 지우는 때는 [account.guest 「상태」](../../docs/specs/account/guest.md#상태) |
| 32 | 회원 자료는 활성 계정에만 쓴다 | 프로필·알림 토글·사진·포트폴리오·푸시 토큰을 쓰는 트랜잭션은 **탈퇴와 같은 `users` 행을 잡고** 상태를 다시 본다. 게이트를 지난 뒤 탈퇴가 끝났으면 쓰지 않는다(응답은 [common.md 「탈퇴와 겹친 쓰기」](../../docs/specs/common.md#탈퇴와-겹친-쓰기))(§6-8) |
| 33 | 객체 키를 DB 에서 먼저 잃지 않는다 | 사진 키를 덮거나 행을 지우는 트랜잭션이 `object_delete` 를 **같은 트랜잭션에서** 정리 장부에 남긴다. 저장소 삭제가 실패해도 요청은 끝나고 장부가 다시 시도한다(§6-8·§6-11) |
| 34 | IP 제한의 열쇠는 방문자 주소다 | `platform/security/ClientAddress` 한 자리가 구한다. **신뢰하는 프록시가 붙인** `X-Forwarded-For` 만 믿고 오른쪽부터 읽는다(§6-13) |

### 6-1. nullable — "null 로 보낼 것" 과 "키를 생략할 것" 이 다르다

| 동작 | 대상 |
|---|---|
| **required + `null` 값을 실어 보냄** | `AuthUser.email`, `MeResponse.email`/`.profile`, `Profile` 의 `directions` 를 뺀 전 항목(0.1.0 이전 회원은 `name` 만 차 있다), `SourceHandoffIds.analysis`, `MemoryItem.source_practice_session_id`, `ConsentEntryDocument.current_decision`/`.decided_at`, `Portfolio.intro`, `PortfolioPhoto.url`, `PortfolioShare.slug`/`.url`, `PublicPortfolio.photo_url`/`.gender`/`.intro`, `PublicPortfolioPhoto.url`, `PublicChallengeEntry.character`/`.poster_url`, 연습 노트의 `PracticeNote*`·`PublicPracticeNote` 항목들, `AppPoster` 의 `badge`·`body`·`image_url`·`image_asset`·`audio_asset`·`cta_label`·`cta_target` |
| **optional 인데 항상 포함** | `Video.purged_at`/`.playback_url`/`.playback_expires_at`/`.poster_url` |

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
**배열**이고, 규칙에 걸린 것은 다른 오류와 같이 **코드 문자열 하나**다. 선례는 `request_fingerprint_mismatch` 다. 어떤 규칙
코드가 있는지는 각 스펙의 「입력·출력」 표가 정하고, 코드 전체의 집합은 `ErrorContractInventoryTest` 가 판정한다(아래 "숫자를
완료 조건으로 쓰지 않는다"). (네이버 로그인에 `authorization_code`·`code_verifier` 가 빠진 것은 본문의 모양이 틀린 것이라
**배열**이다 — 애플의 `authorization_code_required` 와 다르다.) 클라이언트는 `detail` 이 문자열이면 사유로 가르고 배열이면
자기 버그로 다룬다.

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

**실패 보고.** 실패는 HTTP 상태 코드와 따로 Expected Rejection·External Failure·Unexpected Failure로 가른다(뜻은
[ARCHITECTURE 「용어」](../../docs/ARCHITECTURE.md#용어), 이유는 ADR-025). Expected Rejection 은 보고하지 않고, 나머지
둘은 `platform/observability` 의 Port `FailureReporter.report(...)` 로 보고한다. HTTP 실패는 `ApiErrorAdvice` 가,
예외를 삼키는 워커·어댑터는 그 자리에서 이 Port 를 직접 부른다. Sentry 를 아는 구현은 `SentryFailureReporter`
하나다. 우리가 만든 바깥 의존 예외는 표시 인터페이스 `ExternalFailure` 를 구현하고, `FailureClassifier` 가 원인
예외를 따라가며 그 표시와 남이 만든 네트워크·DB 예외(목록은 그 클래스)를 External Failure 로, 나머지를
Unexpected Failure 로 가른다. `SentryFailureReporter` 는 보고 자리와 예외 클래스가 같은 반복을 프로세스
메모리에서 `SUPPRESSION_WINDOW`(10분) 동안 억제한다 — 재시작하면 초기화되고 인스턴스끼리 공유하지 않는다.
검증은 `FailureClassifierTest`·`SentryFailureReporterTest`·`ApiErrorAdviceTest` 다.

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
- **고지**(동의 문서와 가르는 규칙은 account.consent): 개인정보 처리방침은 `consent_documents` 의 행이 아니라 배포에 든 고정 파일
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

- **켜 둔 제공자**(`integration/oidc/ProviderRegistry`): `AUTH_ENABLED_PROVIDERS`(기본 `google,apple`). 언제 켜는지는
  [account.login](../../docs/specs/account/login.md#규칙제약).
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

- **한 트랜잭션**(`PostgresProfileRepository#withdraw`)에서 파기와 상태 전환을 한다. 무엇을 지우고 남기는지는
  [account.withdraw](../../docs/specs/account/withdraw.md#규칙제약)와 영역 표(연습·리딩·챌린지)가 정본이다. 구현만의 것:
  `users.nickname=NULL`(I-3 예외), 진행 중 `external_operations`·`ai_jobs` 의 lease 떼기(분석 중이던 연습도 `failed`,
  0.1.0 작업은 결과 본문도 비운다), 0.1.0 영상의 `purged_at`, `practice_feedback` 의 시트 재전송 예약(`sheet_seq`),
  챌린지 자료 정리(`PostgresProfileRepository#eraseChallenge` — 밀린 마감 집계를 먼저 한다(`ChallengeWithdrawal#settleBeforeWithdrawal`), §6-20).
- **신원 행은 지우지 않는다.** `uid_hash` 만 남긴다(`ck_user_identities_uid_or_hash`). 값은 `platform/security/AccountSecrets#identityHash`
  가 만들고(조회 후보는 `#identityHashCandidates`), 운영 셸로 같은 값을 내는 계산은
  [RETENTION-REVOCATION 2단계](../../docs/deploy/RETENTION-REVOCATION.md#2-옛-계정을-해시로-찾는다--본인-확인)에 있다. 둘이 같음을
  `AccountSecretsTest` 가 고정한다.
- **영상 객체**는 옛 예약 장부(`upload_intents`)와 0.1.0 보관함(`videos`)의 키를 함께 모은다 — 보관함 영상의
  **포스터**(`videos.poster_key`, V23)도 함께다. 포스터 워커는 붙일 때 같은 `users` 행을 잡으므로 탈퇴가 키를 모은 뒤에
  붙는 포스터는 없다([practice.library](../../docs/specs/practice/library.md)). 남길지는 [account.withdraw](../../docs/specs/account/withdraw.md#규칙제약)가 정하고 `PostgresProfileRepository#retentionGranted` 가 판정한다.
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
  되살아난다. 쓰기가 먼저면 탈퇴가 그 뒤에 파기하고, 탈퇴가 먼저면 쓰지 않는다(응답은 [common.md 「탈퇴와 겹친 쓰기」](../../docs/specs/common.md#탈퇴와-겹친-쓰기)).
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
  아는 곳이 없어 복구할 수 없다([account.withdraw 「상태」](../../docs/specs/account/withdraw.md#상태)).
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
  `/v2/me/memory/**`, 리딩은 `/v2/reading/**` 다(기능마다의 문서는 [account.guest](../../docs/specs/account/guest.md#규칙제약)).
  이 목록에 없는 경로가 `member_only` 다.
- **dev 분석 한도 예외**: `ACTTUB_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED=false`이면 새 연습·재분석 모두 일일 횟수 제한 없이 처리한다. 환경별 값은 [DEPLOY-HOME §3](../../docs/deploy/DEPLOY-HOME.md#3-actions와-일상-배포)이 정한다. 기본값은 true이며 회원 정책과 요청 ID 멱등성은 유지한다.
- **분석 하루 3회**는 작업 장부의 `analyze` 행을 센다. **세는 일과 작업을 만드는 일은 한 트랜잭션이다**
  (`PostgresPracticeRepository#overQuota`, §6-15): 그 게스트의 `users` 행을 잡은 채 세므로 겹쳐 온 분석 둘이 같은 수를
  보고 함께 지나가지 못한다. 같은 요청 ID 의 재전송은 한도보다 **먼저** 갈라 재생한다. 판정 순서는
  [practice.start](../../docs/specs/practice/start.md#규칙제약)다. 잠금 순서는 올린 영상·연습 행 → `users` 다(이관과 같은 방향).
- **이관 코드**(`POST /v2/guest/transfer-code`): 해시는 HMAC 이고 키는 `JWT_SECRET` 에서 용도를 못박아 뽑는다.
  다른 게스트의 살아 있는 코드와 해시가 겹치면 다시 뽑는다. **유일성은 DB 가 지킨다**
  (V12 의 부분 유니크 인덱스 둘 — 쓰지 않은 코드는 게스트마다 하나, 숫자마다 하나). 겹쳐 온 발급은 뒤의 INSERT 가
  앞의 커밋을 기다렸다가 `ON CONFLICT DO NOTHING` 의 0행으로 끝나고 다시 뽑으면서 앞의 코드를 지운다 — 둘 다 201
  이지만 살아 있는 코드는 하나다. 발급은 코드 행만 잠근다(`users` 행을 잡으면 옮기기와 순서가 엇갈려 교착한다).
- **옮기기의 틀린 시도 한도**는 **자리를 먼저 잡고 평가한다**(`FixedWindowRateLimiter#reserve`): 평가 중인 시도도
  자리를 차지하므로 겹쳐 보낸 추측 스무 개가 같은 수를 보고 함께 평가되지 못한다. 세지 않는 시도는 자리를 되돌려
  준다(무엇을 세는지는 [account.guest 「예외」](../../docs/specs/account/guest.md#예외)).
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
  - 🔥 각 도메인의 주인 바꾸기 포트(`video/app/VideoOwnership`·`PracticeOwnership`·`MemoryOwnership`·
    `platform/ledger/OperationOwnership`·`auth/app/GuestAccounts`·`reading/app/ReadingOwnership`)는 **자기 `TransactionTemplate` 을 쓰지
    않는다.** 몇몇 저장소의 템플릿은 `REQUIRES_NEW` 라(§5-4) 거기에 얹으면 이관과 따로 커밋돼, 도중에 실패해도
    그 행만 회원에게 넘어간 채로 남는다 — 실제로 그렇게 새는 것을 `GuestTransferIT` 가 잡았다.
- **옮겨진 게스트의 표식**은 **쓰인 이관 코드 행**이다([account.guest 「상태」](../../docs/specs/account/guest.md#상태)). 그래서 탈퇴의
  파기는 **쓰지 않은** 코드만 지운다.

### 6-10. 알림 토글, 푸시 토큰, 로그아웃

> 제품 규칙의 정본: [account.notification](../../docs/specs/account/notification.md)(토글 셋과 `PATCH`, 토큰 등록·삭제, 발송, 저녁 리마인드), [account.logout](../../docs/specs/account/logout.md)(멱등 204)

- **"셋 다 꺼짐" 확인과 저장은 한 트랜잭션이다**(`PostgresPushTokenRepository#register`): 토글 끄기·
  탈퇴와 같은 `users` 행을 잡아 줄을 선 뒤에 읽은 토글로 거른다. 따로 읽고 쓰면 끄는 도중에 끼어든 등록이
  살아남는다 — 다른 기기가 앱을 여는 것만으로 토큰이 되살아난다. 토큰 전부 삭제는 토글을 끄는 트랜잭션에서 한다.
- 발송(`PushService#onAnalysisComplete`)의 실패는 `FailureReporter` 로 간다. Expo 의 ticket 은 보낸 순서대로
  온다. 읽을 수 없는 답과 `DeviceNotRegistered` 밖의 ticket 오류는 종류만 실어 보고한다(`ExpoPushSender.tickets` —
  본문과 토큰은 싣지 않는다). receipt 는 읽지 않는다.
- **저녁 리마인드**(`EveningReminderScheduler` → `EveningReminderService#sendDaily`, V25): 토큰 등록 때
  `X-Acttub-Client` 의 앱 판을 `push_tokens.app_version` 에 남기고(`ClientAppVersion`), 판을 모르거나
  `EVENING_REMINDER_MIN_APP_VERSION`(기본 0.1.2)보다 낮은 토큰에는 보내지 않는다. 활동은 영상·연습·코치 메시지와
  대본·리딩 회차·리딩 녹음·암기 상태의 생성·갱신 시각으로 판정한다(`PostgresEveningReminderRepository#claimTargets`).
  `evening_reminder_sends(user_id, day)` 를 먼저 선점해 같은 날 두 번 보내지 않는다. 실패는 보고하고
  `DeviceNotRegistered` 토큰은 지운다.

### 6-11. 포트폴리오

> 제품 규칙의 정본: [account.portfolio](../../docs/specs/account/portfolio.md)(입구와 응답, 값의 형태·상한·사유 코드, 사진, 공유 링크, 공개 조회)

- **사진은 프로필 사진과 같은 길**이다. 형식·크기 규칙은 `integration/storage/PhotoUploadType` 한 벌이다. 삭제는
  행을 지우면서 객체 삭제를 **같은 트랜잭션에서 정리 장부에 올리고** 커밋 뒤에 시도한다
  (`portfolio/app/PortfolioPhotoCleanup` — 구현은 장부의 주인인 `profile`, §6-8).
- 상한과 순서는 **포트폴리오 행을 `FOR UPDATE` 로 잡은 채** 센다(`PostgresPortfolioRepository#lockOrCreate`).
- **공유 slug** 는 128비트 난수(base64url, `/`·`+`·`=` 없음)다. `url` 은 `SITE_URL` 로 만든다 — 주소를 코드에 박아 두지
  않는다(SOMA-528 결정 I-8). 응답의 뜻은 [account.portfolio](../../docs/specs/account/portfolio.md#규칙제약).
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
| 설문 연락처 | 연락처를 비우고 `sheet_seq` 를 올린 뒤 `sheet_synced_at` 을 NULL 로 되돌린다(시트에서 연락처를 지우는 동작은 [practice.feedback](../../docs/specs/practice/feedback.md)) |
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

> 제품 규칙의 정본: [reading/](../../docs/specs/reading/README.md)(「리딩 자료의 이관·삭제·탈퇴」 표), [common.md](../../docs/specs/common.md)(「요청 재전송」, 「저장 직전 재확인」), [account.guest](../../docs/specs/account/guest.md#규칙제약)(게스트의 마지막 활동), [reading.script](../../docs/specs/reading/script.md)(등록·목록·검색·상세·수정·삭제, 사유 코드·한도·재전송, 카드 필드), [reading.cast](../../docs/specs/reading/cast.md)(내 배역, 목소리 프리셋), [reading.session](../../docs/specs/reading/session.md)(시작·재전송, 진행 저장의 판정 순서, 마지막 회차), [reading.recording](../../docs/specs/reading/recording.md)(올리기의 검사 순서·한도·총량·대체, 재생, 보관), [reading.memorization](../../docs/specs/reading/memorization.md)(갱신 판정, 조회), [reading.cloud-voice](../../docs/specs/reading/cloud-voice.md)(고품질 목소리)

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
- 검색은 `%`·`_`·`\` 를 풀어(`escapeLike`) `ILIKE … ESCAPE '\'` 로 찾는다(`PostgresScriptRepository`). 찾는 칸은 reading.script.
- **삭제**: 줄·회차·녹음·암기 행은 `PostgresScriptRepository#delete` 가 한 트랜잭션에서 지운다. 녹음 객체의 삭제는 행을
  지운 트랜잭션이 정리 장부(`reading_recording_delete`)에 올리고 커밋 뒤에 시도한다(`reading/app/
  ReadingRecordingCleanup`, 구현은 `profile` 의 `PostgresObjectCleanupLedger`).

**리딩 회차 (SOMA-546 RA2)**

- **시작**: `reading_sessions` 에는 지문 컬럼이 없어 저장된 속성 여섯과 대본을 비교해 재전송을 가른다.
  **한 트랜잭션에서 대본 행을 `FOR UPDATE` 로 잡고**(같은 대본의 시작이 여기서 줄을 선다) 새 회차를 만든다. 같은
  대본의 진행 중 회차는 건드리지 않아 여럿일 수 있고, 대본 상세의 `open_session_id` 는 그중 `started_at DESC, id DESC`
  첫 회차다. 회차 상태는 `in_progress`·`completed` 둘이다. `started_at`·`ended_at` 은 앱 시계다.
- **진행 저장**: 시간은 `GREATEST(저장값, 보낸 값)` 로 쓴다. 회차 행을 `FOR UPDATE` 로 잡은 채 하고, 계정 상태를 따로
  보지 않는다 — 이관·삭제가 먼저 끝났으면 행의 주인이 바뀌었거나 행이 없어 회차를 찾지 못하는 것으로 충분하다(응답은
  reading.session 「예외」, 규칙은 common.md 「저장 직전 재확인」).
- **대조(SOMA-593 B1)**: 진행 저장의 `said` 는 `domain/LineResult#merge` 가 `domain/LineMatch`(기기에 있던 규칙을
  옮긴 것)로 판정하고, 말한 것은 `reading_sessions.line_said`(V32, `{line_id: said}`)에 둔다. `line_results` 원소에 넣지
  않는 것은 전역 `fail-on-unknown-properties`(§6-3) 때문이다 — 옛 이미지로 되돌리면 모르는 키가 든 회차를 읽지 못해 500 이다.
  원문과 다르게 말한 대사(`domain/DifferentLine`, 어절은 `domain/WordDiff`)는 저장하지 않고 상세 조회·진행 저장마다
  구간의 대사 줄 원문으로 계산한다. 대사 번호는 표시값과 같은 `ReadingLayout#dialogueNo` 가 센다. 녹음의 `matched` 는 최종 저장 트랜잭션이 그 줄 원문으로 정한다(`RecordingRules#matched`).
- **회차 삭제**는 녹음 행을 지우고 객체 삭제를 같은 트랜잭션에서 장부(`reading_recording_delete`)에 올린다.
- 마지막 회차는 `ORDER BY started_at DESC, id DESC` 의 첫 행이다(`PostgresScriptRepository`·`PostgresSessionRepository`).

**표시값 — 장면·자동 목소리·구간 이름·진행 K/N (SOMA-593)**

- 규칙은 `domain/ReadingLayout`(대사 번호·장면·구간 이름·K/N)과 `domain/VoiceAssignment`(자동 목소리) 두 곳이고, 서버는
  그 값을 대본·회차 응답에 싣는다. 뜻은 reading.session(장면·구간 이름·K/N)과 reading.cast(`voice`)다.
- 저장하지 않고 조회할 때 센다. 대본 상세는 이미 읽은 줄·배역으로 세서 질의가 늘지 않는다. 회차 목록·상세·시작 응답은
  그 대본의 줄(`id, kind`, 장면 머리 줄만 `text`)을 한 번 더 읽는다 — 목록은 카드 수와 상관없이 한 번이다
  (`PostgresSessionRepository#lines`). 상세·시작과 진행 저장은 같은 한 번에 구간 안 대사 줄의 `text` 도 읽는다(다르게
  말한 대사의 원문).
- K 는 `current_line_id` 의 대사 번호에서 센다. 시작(`start_line_id`)과 진행 저장이 구간 안 대사 줄만 받으므로 API 로는 늘
  대사 줄이다. FK 는 줄의 종류를 보지 않아, 대사가 아닌 줄이 들어 있으면 `ReadingLayout` 은 그 앞 대사로 센다.
- `voice` 는 저장값이 프리셋 목록(M1~M5·F1~F5)에 있을 때만 그 값을 쓰고 아니면 자동 순환 값이다. 저장 검증은 여전히 길이만
  본다(`ScriptRules.VOICE_PRESET_MAX`).
- OpenAPI 컴포넌트: `ReadingScriptScene`(`ReadingScript.scenes`), `ReadingScriptCharacter.voice`, `ReadingSessionRangeName`·
  `ReadingSessionProgressCount`(`ReadingSessionCard`·`ReadingSession` 의 `range_name`·`progress`, `progress` 는 completed 면 null).

**줄 단위 녹음 (SOMA-546 RA3)**

- **유일한 multipart 요청**이다. 칸의 모양 검사는 핸들러가 직접 422 **배열**로 만든다 — JSON 본문의 검증기가 닿지
  않는 자리다(`RecordingController`). `RequestBodyCachingFilter` 는 multipart 를 캐시하지 않는다(컨테이너의 파트
  파싱이 원 스트림을 읽는다 — `ReadingRecordingUploadServerIT` 가 실제 서버로 본다). 컨테이너 상한은
  `spring.servlet.multipart.*`(값과 응답은 reading.recording)이고 넘으면 핸들러 전이라 413 은 advice(`ApiErrorAdvice`)가 낸다.
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

**고품질 목소리 (SOMA-500)** — 제품 규칙의 정본: [reading.cloud-voice](../../docs/specs/reading/cloud-voice.md)(두 경로의 입력·출력·오류, 한도, 동의)

- `available` 은 `GEMINI_API_KEY`·`GEMINI_TTS_MODEL`·오브젝트 스토리지가 모두 설정되고, 현재 시각이 무료 종료 시각
  (`READING_VOICE_FREE_UNTIL`) 이하이며, 그 달의 새 합성이 월 한도 미만일 때만 참이다. 사용량 날짜는 Asia/Seoul 기준이다.
- 캐시 키는 `sha256(model + "\n" + geminiVoice + "\n" + text)` 이고 객체 키는 `reading-voice/{hash}.wav` 다. 캐시 적중은
  합성과 사용량 증가 없이 성공하고, 새 합성 성공만 일 사용량을 1 올린다(`PostgresCloudVoiceRepository`).
- 모델 호출에는 대사 원문 하나와 고른 prebuilt voice만 싣는다(`CloudVoiceService`).
- V24 의 `reading_voice_cache(hash PK, model, voice, byte_size, created_at)` 는 사용자와 연결하지 않는다.
  `reading_voice_usage(user_id, day, lines, PK(user_id, day))` 는 탈퇴 때 바로 지운다(`PostgresProfileRepository`).

### 6-15. 연습 0.1.0 — 스키마(V14)와 영상 보관함 (SOMA-546)

> 제품 규칙의 정본: [practice/](../../docs/specs/practice/README.md)(「0.1.0 스키마 전환」, 「연습 자료의 이관·삭제·탈퇴」 표, 옛 경로를 내린 것), [practice.record](../../docs/specs/practice/record.md)(올리기 세 구간·한도·시한), [practice.library](../../docs/specs/practice/library.md)(보관함·상세·삭제·파일만 파기·포스터, 묶음 목록·속성), [practice.start](../../docs/specs/practice/start.md)(시작·재시도, 경험 판, 판정 순서), [practice.resume](../../docs/specs/practice/resume.md)(이어하기), [practice.analyze](../../docs/specs/practice/analyze.md)(상태·취소, 분석 조회, 하루 3회), [practice.coach](../../docs/specs/practice/coach.md)(대화 시작·답장·조회, `reply_limit`), [practice.note](../../docs/specs/practice/note.md)(노트·평가, `my_rating`), [practice.memory](../../docs/specs/practice/memory.md)(배우 기억), [practice.feedback](../../docs/specs/practice/feedback.md)(이탈 설문, 운영 피드백 조회)

- **넓히기만 한 V14**: 새 테이블 열(`videos`·`video_transcripts`·`practices`·`analyses`·`coach_conversations`·
  `coach_messages`·`coach_notes`·`actor_memories`·`practice_feedback`·`ai_jobs`)과, `upload_intents` 에 NULL 허용
  컬럼 셋(`request_id`·`request_fingerprint`·`video_id`), `users` 에 `exit_survey_asked_at`·`memory_epoch`. **옛
  테이블은 건드리지 않는다** — `practice_sessions`·`transcripts`·`summaries`·`anomalies`·`coach_sessions`·
  `coach_turns`·`coaching_handoffs`·`practice_reports`·`actor_memory_entries`·`external_operations` 는 V14 뒤에도
  구조가 그대로다(옛 연습 흐름의 Java 쓰기 경로는 뒤에 지웠다, §5-1).
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
- **보관함**(`/v2/videos/**`, `feature/video`)
  - 예약 장부(`upload_intents`)가 요청 id·지문·객체 키·시한·확정 `video_id` 를 들고 있어 마무리 재전송이 같은 영상을
    돌려준다.
  - **총량 검사와 확정은 `users` 행을 `FOR UPDATE` 로 잡은 한 트랜잭션**이다 — 한도 직전에 겹쳐 온 확정 둘 가운데
    하나만 통과한다. **바깥 호출(저장소)은 그 트랜잭션 밖이다**(§5-4): 주소를 받고 올라온 객체를 확인하는 일은
    서비스가 한다.
  - 시한이 지난 마무리는 예약을 `expired` 로 닫으며 **미확정 객체의 삭제를 같은 트랜잭션에서 장부**(`object_delete`)에
    올린다.
  - 목록의 커서는 저장 시각과 id 다.
  - 삭제는 참조 확인과 삭제를 **영상 행을 잠근 채** 한다(회차 시작과 겹쳐도 하나만 성공한다). 지운 영상과 포스터
    객체는 장부로 간다. 파일만 파기해도 `poster_key` 는 `object_key` 처럼 행에 남지만 객체는 없다.
  - **포스터**(`videos.poster_key`·`poster_attempts`, V23, SOMA-562): `video/app/VideoPosterWorker` 가 뒤에서
    `poster_key` 가 빈 영상을 하나씩 집는다. 스케줄러(`adapter/sched/VideoPosterScheduler`)는 10초마다
    (`VIDEO_POSTER_POLL_INTERVAL_MS`) 자기 스레드 하나에서 일감이 없을 때까지 비운다.
    - **한 번은 집기 · 받기 · 뽑기 · 올리기 · 붙이기다.** 집기는 `FOR UPDATE SKIP LOCKED` 로 한 행을 잡아
      `poster_attempts` 를 올리고 커밋한다 — 도중에 죽은 시도도 센다(`VideoRules.POSTER_MAX_ATTEMPTS`). 받기·ffmpeg·올리기는
      트랜잭션 밖이다(§5-4). 추출은 `integration/media/PosterFrameExtractor`(분석과 같은 `FfmpegLock`)이고, 키는 영상 옆
      `videos/{사용자}/{요청}.poster.jpg`(`VideoRules.posterKey`)라 다시 만들어도 같은 키에 덮어쓴다. 실패는
      `VideoPosterWorker.generate` 가 보고한다.
    - **붙이기는 주인의 `users` 행 → 영상 행 순서로 잡는다**(탈퇴·3년 파기와 같은 순서). 붙이지 못하면 올린 포스터의
      삭제를 같은 트랜잭션에서 장부에 올린다.
    - **스위치가 둘이고 둘 다 켜져야 돈다**: `ANALYSIS_WORKER_ENABLED`(분석·기억·챌린지 리포트 워커와 공유 — 격리 복원 때 함께 끄는 스위치는
      [DEPLOY-HOME §7](../../docs/deploy/DEPLOY-HOME.md#7-db와-호스트-복구))와 `VIDEO_POSTER_ENABLED`(포스터만). 테스트는 후자를 전역으로
      끄고 워커를 직접 부른다.
  - **이관**은 `video/app/VideoOwnership` 이 `videos` 와 **예약 장부**를 함께 옮긴다(§6-9의 순서에서 올린 영상 바로
    뒤다). 예약을 두고 가면 옛 게스트의 대기 업로드가 마무리될 자리를 잃는다.
- **회차**(`/v2/practices/**`, `feature/practice` 의 0.1.0 코드)
  - 시작은 **회차 하나와 분석 작업 하나를 한 트랜잭션**에서 만든다.
  - **잠그는 순서가 규칙을 세운다**: 시작은 **영상 행**(보관함의 삭제·파기와 같은 행)을 잡고, 이어하기·재시도는
    **묶음의 첫 행**을 잡으며, 게스트의 하루 한도는 **사용자 행**을 잡고 센다(`PostgresPracticeRepository#overQuota`,
    `ai_jobs` 와 옛 `external_operations` 의 `analyze` 를 함께 센다).
  - 경험 판은 `PracticeRules.threeLayers` 가 정한다.
  - 차수는 묶음 잠금과 `uq_practices_root_ordinal` 로 발급한다.
  - 취소는 작업의 **lease 를 지워** 늦은 완료와 재큐를 막는다.
- **`ai_jobs` 장부**(`platform/ledger/AiJobLedger`, `platform/operation/PostgresAiJobLedger`): 상태와 lease 의 뜻은
  [공통 규칙 「공통 상태」](../../docs/specs/common.md#공통-상태)가 정본이다. 종류는 `platform/schema/AiJobKind`.
  선점(`claimNext`)은 `pending` 만 `FOR UPDATE SKIP LOCKED` 로 집는다 — 만료된 `running` 을 다시 집지 않는 점이 §5-7 과
  다르다. `release` 는 `attempt_count` 를 되돌리지 않고, 3회 뒤 `sweepMaxAttempts` 가 닫는다. `failure_reason` 에는
  CHECK 가 없다(분류가 열린 목록이다).
- **분석 결과**(`analyses`, `feature/analysis`): 워커는 **한 클래스**(`AnalysisWorker`)이고 원장마다 저장소·빈이
  하나다 — 옛 `AnalysisStore`(={`external_operations`} + `summaries`)와 0.1.0 `PracticeAnalysisStore`
  (={`ai_jobs`} + `analyses`·`video_transcripts`). 영상을 내려받고 검증값을 견주고 실패를 분류하고 lease 를 다루는
  규칙이 한 벌이어야 하기 때문이다. 스케줄러는 등록된 워커를 모두 돌린다.
  - **완료는 한 트랜잭션이고 그 안에서 주인과 계정 상태를 다시 본다.** lease 가 재선점됐으면 완료가 거절되고
    트랜잭션이 통째로 되돌아간다.
  - 기록의 불변은 `ON CONFLICT DO NOTHING` 이 지킨다. 받아쓰기의 영상당 하나는 `uq_video_transcripts_video` 다.
  - 예약 장부에 **검증값이 없는 영상은 견주지 않는다** — 없는 것을 불일치로 보면 그 회차가 재큐만 되풀이하다 실패한다.
- **코치 대화**(`/v2/coach/**`, `feature/coach` 의 0.1.0 코드)
  - 코치의 행동 규칙은 `CoachEngine`·`CoachPrompt` 가 그대로 갖고 있고(제품 규칙은 [practice.coach](../../docs/specs/practice/coach.md), 구현은 §7·§8), 새 저장소는 엔진이 쓰는
    `CoachSessionSnapshot` 을 `practices`·`analyses`·`videos`·`coach_*` 에서 만들어 건넨다.
  - 답장의 **바깥 호출(LLM)은 트랜잭션 밖**이고 저장할 때 대화 행을 잠가 `state_revision` 을 다시 본다(§5-4).
- **연습 노트**(`coach_notes`) — 생성기가 낸 **원문 전체**를 `legacy_report` 에 함께 둔다. 컬럼 이름은 옛 것이지만
  신형도 여기에 둔다. 옛 공개 필드를 읽던 화면이 그대로 쓰는 호환 응답의 재료다.
- **노트 평가**(`note_ratings`, V22, SOMA-558)
  - 한 행은 `uq_note_ratings_note_user` 가 지킨다(행동은 [practice.note](../../docs/specs/practice/note.md)). **멱등은 행의 `request_id` 가 한다** — 행이
    덮어쓰이므로 지문 칸을 따로 두지 않고 저장된 값과 견준다.
  - 쓰기는 탈퇴와 같은 `users` 행을 `FOR UPDATE` 로 잡고 활성인지 다시 본다(§6-8). 구현은 `coach/app/NoteRatingService`·
    `coach/adapter/db/PostgresNoteRatingStore`, 실 DB 검증은 `NoteRatingIT` 다.
  - **이관**은 `NoteRatingOwnership`(설문 다음), **탈퇴**는 `PostgresProfileRepository#erasePractice` 다.
- **배우 기억**(`actor_memories`) — 갱신 예약은 `coach/app/ConversationClosedListener` → `memory` 이고 요청 id 를
  회차에서 만든다. 워커는 분석과 같은 추출기·같은 재시도 규칙이며 저장은 한 트랜잭션에서 지금의 주인에게 하고 계정
  상태와 세대(`ai_jobs.memory_epoch`)를 다시 본다.
- **이탈 설문**(`practice_feedback`) — 선점은 `UPDATE users … WHERE exit_survey_asked_at IS NULL` 한 문장이다. 시트
  구현이 아직 없다. 자리 지킴이(`adapter/sheet/LoggingExitSurveySheet`)는 **보낸 척하지 않고 실패로 남긴다** — 성공을
  돌려주면 그 설문이 재전송 대상에서 빠져 시트가 붙는 날 영영 복제되지 않는다.
- **운영 통합 이용 기록**(`GET /v2/admin/ops-core`의 `activity_rows`) — 코칭 세션·대본 리딩 세션·삭제되지 않은
  챌린지 참여작의 전체 기록을 한 목록으로 추가 제공한다. 기존 `sessions`·`features`의 의미와 인증은 바꾸지 않는다.
  - 각 행은 `activity_id`(`coaching:`·`reading:`·`challenge:` + 원천 행 id), `feature`, `created_at`, `actor`,
    `signup_at`, `signup_d7`, `platform`, `device`, `status`, `is_team`만 가진다. `actor`는 기존과 같은 `배우 ` +
    `md5(user_id)` 앞 8자리여서 기능을 넘나드는 사람도 중복 제거할 수 있다. 이메일·원본 user id·대본·평가·댓글 등
    자유 입력은 넣지 않는다. 활동 시각은 분, 가입 시각은 시간 단위로 뭉개 기존 스냅샷의 정밀도를 유지한다.
    `signup_d7`은 뭉개기 전 시각으로 최근 7일 가입 여부를 계산해 SQL 퍼널과 정확히 같은 가입 코호트를 유지한다.
  - 세 기능 모두 공통 `team` 제외 기준을 적용하고 미래 시각은 제외한다. 코칭은 0.1.0 이관 전후 같은 id를 한 번만
    읽는 `ps_all`을 재사용한다. 단순 참여작 조회·좋아요·댓글은 연습 이용으로 합치지 않는다.
  - 행 제한 없이 전체 이력을 제공하며 실제 기록이 없으면 `[]`다. 필드가 없는 구버전·결측 응답을 0으로 해석하거나
    코칭 전용 숫자를 통합 수치로 대체하면 안 된다. 운영 개요 소비자는 동일 actor 기준 인원·반복·재방문을 계산한다.
- **가입 코호트 원장**(`GET /v2/admin/ops-core`의 `signup_rows`, SOMA-591) — 팀을 뺀 가입자 한 명당 한 행이다.
  `actor`(기존 가명)·`signup_at`(시간 단위)·`platform`(`앱`·`웹`)·`device`(가입 기기 분류)·`first_upload_at`
  (가장 이른 `finalized` 업로드, 분 단위, 없으면 null)만 가진다. 미래 행은 뺀다. 운영 화면은 이를 `activity_rows`·
  `signup_attributions`와 가명으로 이어 플랫폼×유입 소스 퍼널을 같은 기간 가입 코호트로 계산한다.
  `signup_attributions`는 기존 키를 유지하면서 `source`와 nullable `medium`을 더 제공한다. 필드가 없는
  구버전 응답을 0명으로 해석하면 안 된다.
- **챌린지 참여작 목록**(`GET /v2/admin/ops-core`의 `features.challenges`) — `entries.private` 수와 `recent_entries`
  (삭제되지 않은 최신 50건)를 더한다. 비공개 참여작도 운영이 봐야 하므로 `visibility`를 그대로 싣는다.
  - 한 항목은 `entry_id`·`challenge_id`(둘 다 앞 8자리)·`challenge_origin`·`actor`(기존 가명)·`visibility`·`status`·
    `has_video`·`created_at`·`published_at`(분 단위)·`views`·`likes`·`comments`(팀 제외)·`ai_report`(없으면 null)다.
    캡션·챌린지 대사·이메일·원본 id 는 넣지 않는다(git 에 남는 JSON 이다). 팀·미래 시각 행은 제외한다.
- **업로드 완료 · 연습 미시작 기록**(`GET /v2/admin/ops-core`의 `upload_only_rows`)는
  조회 시점에 연습·챌린지와 연결되지 않은 확정 업로드를 별도 배열로 제공한다. 기존 `sessions`·
  `activity_rows`·퍼널·코칭 지표의 계산과 의미는 바꾸지 않는다.
  - 필드는 `upload_intent_id`·`created_at`·`actor`·`is_team`·`platform`·`device`·`duration_ms`다.
    시각은 `finalized_at` 우선, 없으면 업로드 `created_at`을 쓰며 UTC 분 단위로 낮춘다.
    가명과 가입 기기 분류는 기존 기준을 재사용한다. 원본 user id·이메일·파일경로·URL·자유 글은 싣지 않는다.
    팀 행은 공통 `team` 기준으로 `is_team=true`를 표시하며 화면에서 기본 제외한다.
  - `status='finalized'`인 업로드만 읽고 미래 완료 시각은 제외한다. 신형은 `video_id`, 구형 이관은
    같은 소유자의 `object_key`로 영상 후보를 찾는다. 후보 중 하나라도 연습·챌린지에 연결되거나
    `purged_at`이 있으면 제외한다. 옛 `practice_sessions.upload_intent_id` 연결도 별도로 제외한다.
    영상 키는 유일하지 않으므로 첫 후보만 보고 판정하지 않는다. 같은 영상으로 연습을 시작하면 해당
    업로드 전용 행은 사라지며, 동일 배우의 다른 미연결 업로드는 그대로 남는다.
  - 업로드 목적은 저장되지 않으므로 보관용인지 이탈인지 단정하지 않는다. 삭제된 챌린지의 `video_id`나
    삭제된 영상과의 연결은 사라질 수 있어 과거 연결 이력도 복원할 수 없다. 이는 현재 연결 상태의 조회이지
    이탈 확정·코칭 실패·영상 재생 가능 여부의 판정이 아니다. 화면에도 이 한계를 알린다.
  - 전체 이력을 완료 시각 내림차순, 같은 시각이면 업로드 id 내림차순으로 제공한다. 실제 기록이 없으면
    `[]`이며 필드 누락·형식 오류는 0이 아닌 확인 불가로 처리한다. `AdminEndpointIT`에서 실 DB로 검증한다.
- **운영 피드백 조회**(`GET /v2/admin/feedback`) — 연락처·원본 user id·이메일은 projection 과 DTO 에 없다. 팀 판정은
  `ADMIN_OPS_EXCLUDE_EMAILS` 와 `exclude_actors`(ops-core 와 같은 검증)다.
- **연습 자료의 이관·삭제·탈퇴** — 제품 규칙은 specs/practice 의 처리표다.
  - **이관**은 `user_id` 가 있는 행을 한 트랜잭션에서 옮긴다: 예약 장부 → `videos` → `practice_sessions`·`practices`
    → `external_operations`·`ai_jobs` → 배우 기억 → 리딩 → 설문 → 노트 평가 순이다(§6-9의 잠금 순서에 이어진다). 분석·대화·노트·
    받아쓰기는 그 행에 매달려 따라간다.
  - **대화 중 탈퇴**: 코치 응답의 저장은 대화 행과 함께 `users.status` 를 본다(분석의 완료가 같은 자리에서 같은 확인을 한다).
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
  API 는 **새 표를 먼저 보고 없으면 옛 표를 읽어 같은 응답 모양**을 낸다.
  - `GET /v2/practices/{id}`·`/status`·`GET /v2/practices` 는 `practice/adapter/db/PostgresLegacyPracticeReader`
    로 간다. 차수는 `continued_from` 체인을 그때그때 펴서 만들고 **전환 명령과 같은 규칙**이라 옮기기 전후의
    응답이 같다.
  - `GET /v2/practices/{id}/note` 는 `practice_reports` 를 새 봉투에 담아 낸다. `GET /v2/coach/conversations/{id}`
    는 `coach_sessions`·`coach_turns` 를 읽는다. `GET /v2/practices/{id}/analysis` 도 새 분석이 없으면 소유권을
    확인하는 옛 분석 읽기로 이어진다.
  - 회차 상세의 `previous_conversations` 가 **옮긴 뒤에도 채워지는** 것은 전환이 최신 대화 하나만 옮기고 나머지를 옛
    표에 남기기 때문이다.
  - 호환 읽기는 **옛 표를 고치거나 지우지 않는다.**
- **되돌리기**(specs/practice 「0.1.0 스키마 전환」, BRANCHING-STRATEGY 「DB와 배포 안전성」) — 내리기 마이그레이션은
  없다. 대신 **더하기만 한다**: V14·V15 는 새 표와, 예약 장부의 NULL 허용 컬럼 셋, `users` 의 둘만 더했고 옛 표의
  모양은 한 칸도 바뀌지 않았다(`flyway/PracticeRollbackCompatibilityTest` 가 V13 과 최신의 fingerprint 를 옛 표만
  추려 견준다). Hibernate 의 `ddl-auto: validate` 는 **매핑이 없는 여분 표를 보지 않으므로** 직전 태그의 서버가
  새 표가 있는 DB 에서 그대로 뜬다. 배포 절차는 [DEPLOY-HOME.md](../../docs/deploy/DEPLOY-HOME.md) 의 롤백 절과
  같고, 사람이 밟아야 하는 확인(직전 태그 이미지로 옛 화면 읽기)은 배포 파이프라인의 일이다.
- **옛 경로를 내린 뒤**: 게스트 기능표에서도 `/v2/uploads/**`·`/v2/practice-sessions/**` 를 뺐다.
  `CoachReadsProfileIT` 는 새 코치 경로에서 프로필·기억을 읽는 규칙과 조회 실패의 폴백을 검증한다. 옛 저장 형식의
  회귀 검사는 테스트 전용 어댑터로 유지하며 이 어댑터는 운영 산출물에 포함하지 않는다.
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
- 개설의 검사·쓰기는 활성 사용자 행 잠금 아래 하므로 동시 개설·탈퇴 뒤 늦은 쓰기가 새 행을 만들지 않는다. 삭제된 챌린지의
  moderation 변경은 `PostgresChallengeRepository.moderate` 가 404 로 막는다.
- V16은 `challenges`, V17은 공개 집계의 기반인 `challenge_entries`·`entry_likes`·`user_blocks`를 더한다.
  기존 표·컬럼은 축소하지 않는다. 값 CHECK와 Schema Entity 매핑도 함께 검증한다.

### 6-17. 챌린지 참여·랭킹·조회수 (0.1.0)

> 제품 규칙의 정본: [challenge.entry](../../docs/specs/challenge/entry.md)(참여·수정·삭제, 영상 길이, 오류 코드·한도), [challenge.browse](../../docs/specs/challenge/browse.md)(참여작 목록·순위·스냅숏 커서, 종료 랭킹 `ranking_state`, 조회수, P03), [challenge.react](../../docs/specs/challenge/react.md)(공유 링크 `/e/<id>`와 `GET /v2/public/entries/{id}`)

- 참여와 공개 전환의 검사·쓰기는 사용자 → 챌린지 → 영상 행을 잠근 한 트랜잭션이라 챌린지 삭제·영상 파기·보관함 삭제·탈퇴와
  겹쳐도 한쪽만 성공한다(`PostgresEntryRepository`).
- 종료 랭킹 집계는 챌린지 행을 잠그고 한 번 한다(`ChallengeSettlement.settle` 은 집계와 확정 시도, `aggregateIfDue` 는 집계만 —
  반응(`EntryLocks`)과 목록 조회가 부른다. 매시 일은 `CHALLENGE_SETTLEMENT_ENABLED`). likes 정렬의 첫 조회는
  전체 순서와 순위를 `entry_ranking_snapshots`에 굳히고 커서는 그 위치다.
- 조회 사건은 `entry_view_events`에 조회수 증가와 한 트랜잭션으로 남긴다.
- 공유 조회(`GET /v2/public/entries/{id}`)의 IP별 한도는 웹 서버가 받은 `X-Forwarded-For`를 그대로 넘긴 값으로 센다(§6-13).
- V18은 `entry_view_events`·`entry_ranking_snapshots`를 더하고 기존 표는 바꾸지 않는다.

### 6-18. 챌린지 반응·차단·신고 (0.1.0)

> 제품 규칙의 정본: [challenge.react](../../docs/specs/challenge/react.md)(좋아요·저장·댓글, 저장 목록), [challenge.block](../../docs/specs/challenge/block.md)(차단), [challenge.report](../../docs/specs/challenge/report.md)(신고·운영 판정·`target_version`·`target_text`)

- 반응·신고의 잠금 순서는 사람(`users`, id 순 — 행동하는 사람은 쓰기, 작성자는 읽기) → 챌린지(마감 뒤 첫 변경이면 마감 집계)
  → 참여작이다(`EntryLocks`). 참여작 수정·삭제도 사용자 → 챌린지 → 참여작 순서라 서로 기다려도 원을 만들지 않는다. 행동하는
  사람이 활성이 아니면 여기서 403 이다. **차단 행은 잠그지 않는다** — 차단 켜기가 두 사람의 `users` 행을 같은 순서로 잠그므로
  반응과 차단이 겹치면 먼저 잡은 쪽이 끝난 뒤 다른 쪽이 조건을 다시 본다. 신고 저장과 숨김은 대상 행을 잠근 한 트랜잭션이고,
  운영 판정도 대상 행을 잠그고 한다. 챌린지 신고는 챌린지 행을 잠근 채 처리 전 신고의 서로 다른 신고자 수를 세어 임계값
  (`ChallengeRules.CHALLENGE_REPORT_THRESHOLD`)에 닿으면 `review` 로 올린다(`PostgresEntryReportRepository`).
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

- event_key는 `like:<좋아요 id>`·`comment:<댓글 id>`·`ai_report:<작업 id>`·`ended:<챌린지 id>`다(`ChallengeSettlement`).
  사건은 원인 행동과 같은 트랜잭션에서 `NotificationEvents` 가 `notifications`에 남기고 `(user_id, event_key)`로 재전송을 한 행으로 막는다.
  참조의 부모 관계(`comment_id`의 참여작, `entry_id`의 챌린지)는 FK로 묶는다.
- 발송(`CHALLENGE_NOTIFICATION_PUSH_ENABLED`)은 커밋 뒤 따로 돈다. 때가 된 묶음을 잠그고 `notification_pushes`의
  `(group_key, stage first·summary)`를 한 번만 선점해 첫 푸시와 요약 푸시를 하나씩 보낸다.
- 탈퇴는 계정을 비활성으로 바꾸기 전에 이 사람의 참여작이 있는 챌린지의 밀린 마감 집계를 먼저 한다
  (`ChallengeWithdrawal`). 진행 중 리포트 생성은 탈퇴의 `ai_jobs` 정리(`failed`/`account_deactivated`, §6-8)가 닫는다.
- V21은 `notifications`·`notification_pushes`와 `entry_comments (id, entry_id)` 유일 제약을 더한다.

### 6-21. 운영용 챌린지 영상 목록·재생

- `GET /v2/admin/challenge-videos?limit=50&exclude_actors=…&visibility=all|public|private`는
  `limit` 1~100, 기본 50이다. 응답은 `entries`와 그 응답 묶음의 크기인 `count`다. 각 행은
  `id`(참여작 UUID)·`actor`(`md5(user_id)` 앞 8자리)·`created_at`·`visibility`·`status`·
  `challenge_kind`(`challenges.origin`)·`challenge_ref`(`md5(challenge_id)` 앞 8자리)·`has_video`만
  포함한다. raw 참여작 id는 이 live 운영 응답에서만 허용하며, user UUID·이메일·대사·작품·캡션 같은
  자유 텍스트·원본 object key·재생 URL은 목록에 넣지 않는다.
- `GET /v2/admin/challenge-videos/{id}/playback?exclude_actors=…`는
  `{"playback_url":…,"expires_in":600}`을 반환한다. 스토리지 서명 TTL은 반드시 600초다.
- 두 경로 모두 기존 `ADMIN_OPS_TOKEN`을 먼저 검사하고, `ADMIN_OPS_EXCLUDE_EMAILS`와
  `exclude_actors`에 걸린 배우를 제외한다. 삭제된 참여작·삭제된 챌린지는 목록과 재생에서 제외한다.
  재생에서는 없음·팀·삭제·영상 없음 또는 파기를 모두 404 `challenge_video_not_found`로 합친다.
  스토리지 부재나 서명 실패는 503 `playback_unavailable`이다. 성공 응답은
  `Cache-Control: private, no-store`다.
- 관리자 빈은 토큰이 있을 때만 서므로 커밋된 기본 `spec/openapi.json`에는 이 경로가 없다.
  `AdminEndpointIT`의 조건부 관리자 경로 명시 목록과 응답 스키마 검사가 이 계약을 지킨다.

### 6-22. 운영용 리딩 회차·대본·녹음 조회와 재생

- 세 경로는 기존 조건부 관리자 빈과 `ADMIN_OPS_TOKEN`을 쓴다. 토큰을 질의값 검증보다 먼저 확인하고,
  `ADMIN_OPS_EXCLUDE_EMAILS`와 요청의 `exclude_actors`(쉼표로 나눈 `md5(user_id)` 앞 8자리, 최대 100개)를
  목록·상세·재생에 똑같이 적용한다. 성공 응답은 모두 `Cache-Control: private, no-store`다. 관리자 빈은
  토큰이 있을 때만 서므로 기본 `spec/openapi.json`에는 실리지 않으며 `AdminEndpointIT`의 조건부 경로 명시
  목록과 직렬화 검사가 이 계약을 지킨다.
- `GET /v2/admin/reading-sessions?limit=50&status=all&exclude_actors=…`는 `limit` 1~100, 기본 50이고
  `status`는 `all`·`in_progress`·`completed`다. 응답은 `{sessions, count}`이며 `count`는 지금
  반환한 묶음의 크기다. 각 행은 `id`(회차 UUID)·`actor`(접두사 없는 8자리 가명)·`script_title`·
  `started_at`·`ended_at`(항상 포함, 없으면 null)·`status`·`mode`(`read`·`quiz`)·`elapsed_seconds`·
  `recording_count`만 가진다. `started_at DESC, id DESC`로 고정 정렬한다. 대본 본문·전사·원본 user id·이메일·
  object key·재생 URL은 목록에 넣지 않는다.
- `GET /v2/admin/reading-sessions/{id}?exclude_actors=…`는 `{session, lines, recordings}`다. `session`은 목록과
  같은 메타데이터다. `lines`는 대본 전체를 원래 `ordinal ASC`로 내며 각 줄은 `id`·`ordinal`·`kind`·
  `character_name`·`text`·`in_range`·`is_mine`이다. 실제 저장 enum은 `dialogue`·`direction`·`scene`이다
  (`stage_direction`·`scene_header`로 다시 이름 붙이지 않는다). `in_range`는 회차의 시작·끝 줄 ordinal을
  포함한 범위이고, `is_mine`은 줄의 배역이 회차 `my_character_ids`에 들었는지다. `recordings`는 그 회차의
  내 배역 대사 녹음만 가지며 `id`·`line_id`·`attempt_no`·`duration_ms`·`created_at`·`transcript_source`
  (`stt`·`none`)·`transcript`·`matched`를 싣는다. transcript·matched는 항상 포함하고 없으면 null이다.
  대본과 전사는 git 스냅샷에 남기지 않는 이 live 상세 응답에서만 허용한다.
- `GET /v2/admin/reading-recordings/{id}/playback?exclude_actors=…`는 저장된 m4a 녹음에
  `AdminPlayback#requiredUrl`을 사용해 `{"playback_url":…, "expires_in":600}`을 반환한다. TTL은 고정 600초다.
  없음·팀·비활성 계정·탈퇴 보관으로 회차/줄 연결이 끊긴 녹음·유효한 회차/대본/줄 부모와 맞지 않는 녹음·
  내 배역 대사가 아닌 녹음·m4a가 아닌 녹음은 모두 404 `reading_recording_not_found`다. 스토리지 부재나
  서명 실패는 원인을 보존한 503 `playback_unavailable`이다.
- 세 조회는 `users.deactivated_at IS NULL`과 `users.retention_purged_at IS NULL`인 계정만 읽고,
  `reading_sessions.user_id = scripts.user_id`, 시작·끝 줄이 그 대본 소속, 녹음의 user/session/line이 같은
  회차·대본 소속이라는 부모 연결을 SQL에서 확인한다. 상세 회차가 없거나 제외되거나 부모가 어긋나면
  404 `reading_session_not_found`다. 삭제된 리딩 자료는 행째 없어 자연히 보이지 않는다. 상대역 음성은 기기
  TTS라 저장 대상이 아니므로 녹음 수·상세·재생 모두 `my_character_ids`에 속한 대사 줄만 센다.

### 6-23. 가입 유입 출처 (SOMA-588·SOMA-591 후속)

- 앱의 `PUT /v2/me/signup-attribution` 은 **204** 다. 기존 보호 기능 게이트를 유지해 동의와 프로필을 끝낸 회원만
  부른다(게스트 403 `member_only`). 본문은 `source`(`airbridge`)·`platform`(`ios`·`android`)·`channel`(비어 있지
  않음)이 필수이고 `campaign`·`ad_group`·`ad_creative`·`content`·`term`·`sub_publisher` 는 선택이다. 값마다 앞뒤
  공백을 걷고 비면 NULL, 200자를 넘으면 422 다. 모르는 키(광고 식별자 등)는 전역 정책대로 422 다(§6-3).
- 웹의 `PUT /v2/me/web-attribution` 도 **204** 다. 인증된 회원·게스트 모두 부를 수 있지만 서버가 현재 판
  개인정보 수집·이용 동의(`privacy`)를 실제 DB에서 확인한다. 프로필과 다른 동의는 요구하지 않는다. 본문은
  `channel`(`utm_source`, 필수)·`medium`·`campaign`·`content`·`term`이고 source=`web_utm`, platform=`web`은
  서버가 고정한다. 값은 앞뒤 공백을 걷고 선택 값이 비면 NULL이다. 각 값은 1~64자의 ASCII 영문·숫자로 시작하고
  이후 영문·숫자·점·밑줄·하이픈만 허용한다(`^[A-Za-z0-9][A-Za-z0-9._-]*$`). URL·이메일·자유 입력과 모르는 키는
  422다. 웹 UTM은 클라이언트 자기 보고 유입이며 광고 플랫폼 귀속과 같은 뜻이 아니다.
- **처음 온 값만 남는다**(`ON CONFLICT DO NOTHING`). 어느 경로든 다시 보내면 바꾸지 않은 채 204 다 — 재시도에
  안전하다. DB는 `airbridge`×`ios|android`, `web_utm`×`web` 조합만 허용한다.
- 앱은 Airbridge SDK 의 설치 귀속 결과를 그 기기에서 **새로 가입한** 계정에만 한 번 보낸다. 기존 회원이 앱을
  업데이트해 SDK 가 처음 돌 때의 귀속은 보내지 않는다.
- 게스트 이관 때 웹 유입 행을 회원에게 옮기지 않고 닫힐 게스트의 행을 지운다. 서버는 그 회원이 게스트 뒤에 새로
  가입한 계정인지 확실히 증명할 신호가 없으므로, 기존 회원의 과거 가입 출처를 웹 재방문 UTM으로 추정 연결하지
  않는다. 회원에게 이미 있던 Airbridge 등 기존 출처는 그대로다.
- 쓰기는 회원 자료 쓰기와 같이 `users` 행을 잡고 활성인지 본다(`PostgresProfileRepository#lockActive`) — 탈퇴가
  먼저면 쓰지 않고 403 `account_deactivated` 다. 탈퇴는 이 행을 지운다(§6-8). 만 14세 미만 종료로 계정 행을
  지우면 CASCADE 가 함께 지운다.
- 탈퇴와 게스트 이관은 해당 행을 즉시 지운다. 매일 도는 `AccountHousekeeping`은 기록 시각이 한국 시간 달력 기준
  14개월보다 오래된 `web_utm` 행만 지운다. Airbridge 행의 보존 규칙은 바꾸지 않는다. 만료 뒤 기존 계정에 새 UTM을
  다시 붙이지 않는 경계는 웹의 신규 guest userId와 세션 결합이며, 서버가 생성 시각으로 신규 여부를 추정하지 않는다.
- 읽는 곳은 ops 사용자 화면이다. 광고 관리자는 가입을 수로만 센다.

### 6-24. 앱 공지 포스터 (SOMA-599)

> 제품 규칙의 정본: [app.poster](../../docs/specs/app/poster.md)(고르는 규칙, 빈도·다시 보지 않기·대상, 운영자 사용법)

- 표는 `app_posters`(V29)다. Schema Entity 없이 `feature/poster/adapter/db/PostgresPosterRepository` 의 native SQL
  로만 읽고 쓴다(행이 적고 `platforms` 가 `text[]` 라서다, §5-1·`EntityMappingIT` 의 대기 목록). 값 목록(`frequency`·
  `audience`·`cta_action`)은 Java enum 없이 `PosterRules` 상수와 CHECK 가 같은 선을 긋는다(`ValueCheckCatalogIT` 의
  `WITHOUT_JAVA_ENUM`).
- 유일은 `uq_app_posters_slug_locale (slug, COALESCE(locale,''))` 다 — 언어 없음(NULL)도 한 자리를 차지한다.
  만들기는 `ON CONFLICT DO NOTHING` 의 0행, 고치기는 겹치는 다른 행이 있으면 갱신하지 않는 조건의 0행으로 알고
  둘 다 422 `duplicate_poster` 다.
- V29 가 지금 홍보(고품질 목소리 출시)를 `slug=cloud-voice-launch` ko·en 두 줄로 싣는다. 문구는 0.1.2 앱 번역
  `cloudVoice.promo*` 의 값이다.
- 앱 경로 `GET /v2/app/posters` 는 게이트(`ConsentGateInterceptor` 의 FULL)를 지난 회원·게스트 모두 받는다. 질의
  검사는 받는 자리(`PosterController`)에서 하고 틀리면 배열 422 다 — `platform` 빠짐은 `missing`, 값이 틀리면
  `value_error`. 기간·플랫폼·언어는 SQL 이, 판(`min_app_version`)과 5장 자르기는 `PosterRules.forApp` 이 고른다.
  판 비교는 점으로 나눈 정수 비교다(`0.1.10 > 0.1.9`).
- 이미지가 객체 키(`posters/<uuid>.<png|jpg|webp>`)면 기존 스토리지로 1시간 재생 주소를 서명한다. 스토리지가 없거나
  서명이 실패하면 `image_url` 만 null 이고 목록은 그대로 나간다(서명 실패는 External Failure 로 보고,
  `ObjectStoragePosterImages`). 소리는 번들 자산(`asset:`)만 내고 객체 키면 null 이다.
- 운영 경로 `GET·POST /v2/admin/posters`, `PATCH /v2/admin/posters/{id}`, `POST /v2/admin/poster-images` 는 다른
  `/v2/admin` 과 같이 `ADMIN_OPS_TOKEN` Bearer 를 상수 시간 비교로 보고(401 `Unauthorized`), 토큰이 없는 기동에는
  경로째 없다(`AdminService.ENABLED_WHEN`) — 그래서 `spec/openapi.json` 에 실리지 않고 `AdminEndpointIT` 의 조건부
  목록이 센다. 응답은 `Cache-Control: private, no-store` 다. 지우기 경로는 없다(끄기 = `active=false`).
- 만들기 본문은 닫혀 있다(§6-3). PATCH 는 보낸 칸만 바꾸므로 본문을 JSON 객체로 받아 지금 값 위에 얹고, 모르는
  칸은 `extra_forbidden`, 형태가 틀린 칸은 그 칸을 가리키는 `value_error` 422 다. `bump_revision: true` 면
  revision 을 하나 올린다. 둘 다 `updated_at` 을 그 시각으로 둔다.
- 이미지 올릴 자리는 `{content_type, size_bytes}` 를 받는다. 기존 `ObjectStorage#presignUpload` 가 크기를 서명에
  넣기 때문이다(스펙 초안의 `{content_type}` 에서 `size_bytes` 를 더했다). PNG·JPEG·WebP 만 받고(415
  `unsupported_media_type`), 10MB 를 넘으면 413 `upload_too_large`, 주소는 10분이다. 스토리지 설정은 기존 `S3_*` 를
  그대로 쓰고 없으면 503 `storage_not_configured`(§6-2 의 advice) 다.

## 7. 보존 규칙 — 되돌리면 안 되는 결정

1. **좋아요 카운트는 재집계다.** 증감 방식이 "두 번 눌리면 2 증가" 하던 버그 때문에 의도적으로
   선택됐다. 성능 명목으로 증감으로 되돌리면 버그가 부활한다. (1·2는 커뮤니티의 규칙이다. 코드는
   0.1.0에서 내렸고 git 이력의 `feature/community/adapter/db/PostgresCommunityRepository`에 있다 —
   되살릴 때와 챌린지의 좋아요·댓글 집계를 만들 때 같은 규칙을 지킨다.)
2. **댓글 수 증감은 원자적이어야 한다.** `post.setCommentCount(get()+1)` 형태로 옮기면 lost
   update 가 새로 생긴다. 벌크 UPDATE 로 분리한다.
3. **상관 서브쿼리에서 앵커 테이블을 명시한다.** 명시하지 않으면 같은 테이블이 FROM 에 두 번
   들어가 Postgres 가 거부한다. 실제로 한 번 사고가 났던 자리다.
4. **옛 `external_operations` 선점(`ExternalOperationClaimer`)에는 `SKIP LOCKED` 가 없다.** 경합 시 블로킹 대기 →
   조건 재평가 실패 → 폴링 재시도 구조다. 정확하지만 처리량이 낮다. 바꾸려면 두 방식을 **구분하는 테스트**를 먼저
   세운다 — 기존 테스트는 구분하지 못한다. 뒤에 생긴 큐는 `FOR UPDATE SKIP LOCKED` 로 집는다
   (`PostgresAiJobLedger`, `PostgresAccountCleanupRepository`, `PostgresVideoRepository` 의 만료 예약 정리·포스터,
   `PostgresNotificationRepository`).

### 7-1. 코칭 응답과 종료 (2026-09-10)

> 제품 규칙의 정본: [practice.coach](../../docs/specs/practice/coach.md)(「규칙·제약」의 도움 버튼과 기존 갈래·이전 경로의 응답 규칙: `그 외`의 기본 코치, 재생성 사유, 숨은 심리를 만들지 않음), [practice.note](../../docs/specs/practice/note.md)(「규칙·제약」의 기존 갈래: `completion_level=unavailable`, 내용이 확보된 답변)

- 요청·응답 DTO와 저장 스키마는 유지한다.
- `CoachPrompt:buildChat`은 1층 관찰 팩 전체(장면 요약·전체 흐름·소리 측정값·대사 인용·불확실성)와 현재 세션의 대화 원문 전체를 전달한다. `CoachPrompt:select`의 공통 정책이 갈래별 질문 순서보다 우선한다.
- 막힘을 건너뛴 `그 외`의 프롬프트는 `coach-video-first-prompt.txt`다. 명시적인 분석·표현 선택의 프롬프트와 대화가 끝날 때 만드는 handoff·분석/표현 리포트 계약은 유지한다. 이전 분석 세션의 handoff를 표현 세션 입력으로 넘기는 경로는 없다(`NoteWriter`가 `ReportEngine:generateReport`의 `analysisHandoff`에 `null`을 넘긴다).
- 재생성 사유는 `CoachResponsePolicy:failures`, 생성 실패 handoff의 차단은 `ReportEngine:buildReportInput`(두 갈래 모두) 한 곳이다.
- 코칭은 `TextValidator:validateCoachTurn`으로 근거 설명용 어휘를 허용한다. 기억 추출은 기존 `validateTurn`을 유지한다. 두 검증 모두 글자 수는 보지 않는다.

### 7-2. 코치 대화와 노트가 읽는 배우 프로필 (2026-09-19)

> 제품 규칙의 정본: [account.profile](../../docs/specs/account/profile.md)(「규칙·제약」의 코치에 넘기는 프로필: 싣는 조건, 부재 시 동일성, 만 나이, 턴마다 다시 읽기, 기억 사본에서 성별·나이 빼기, 저장하지 않음, 노트 재생성 없음)

§7-1 의 계약은 그대로다 — 요청·응답 DTO, 저장 스키마, handoff·report 계약을 바꾸지 않는다.

- **부재 시 동일성은 고정값이 지킨다**(규칙은 account.profile). 시스템 프롬프트 본문을 조건 없이 바꾸지 않는다. 기존
  고정값(`frozen/coach-chat-prompt*.txt`·`coach-regeneration-prompt.txt`·`report-input-*.txt`)이 이것을 지킨다.
- **이음매**는 읽는 쪽의 포트 둘이다: `coach/app/CoachProfile`, `report/app/ReportProfile`. 구현은
  `profile/adapter/reader` 에 있고 간선은 `profile → coach.app`·`profile → report.app` 한 방향이다. 교환 타입은
  소비자의 것이고 값은 표시말이다. 프로필이 없거나 여섯 항목 가운데 하나라도 비어 있으면 포트가 `null` 을 준다.
- **코치**: 문자열 경로는 `CoachPrompt:actorProfileBlock` 이 맨 앞의 독립 블록(`## 배우 프로필`)으로, 구조화 경로는
  `StructuredCoachEngine:input` 이 독립 키 `actor_profile` 로 싣는다. 기억 블록의 1,200자 상한과 분리돼 있다.
  라우팅 경로(`dialogue_actions_v2`)에서는 그 입력이 **생성 호출**(`CoachingPipeline:generate`)에 실린다.
  `ConversationService` 가 턴마다 다시 읽는다.
- **기억과 겹침**: 모델에 넘기는 기억 사본에서 `gender`·`age` 를 빼는 자리는 `CoachSessionSnapshot:priorForModel` 이다.
- **텔레메트리에는 이름을 가려 보낸다.** 모델에 보내는 입력은 그대로 두고, 같은 입력을 바깥 수탁사(Langfuse)에
  기록할 때만 이름 자리에 `[redacted]` 를 싣는다 — 문자열 경로는 프로필 블록의 이름 줄
  (`CoachPrompt:withoutActorName`), 구조화 경로(라우팅 경로의 생성 호출 포함)와 노트는 최상위 `actor_profile.name`
  (`platform/observability/ActorNameRedaction`). 무엇을 가리고 왜 가리는지는 account.profile 이 정한다. 프로필이 없는 호출의
  기록은 글자 하나 바뀌지 않는다.
- **노트**: `ReportEngine:generateReport` 가 받는 사람의 ID 로 프로필을 읽어 `buildReportInput` 의 **최상위**
  `actor_profile` 로(handoff 밖), 구조화 노트의 생성 입력에도 나란히 싣는다.
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

> 제품 규칙의 정본: [practice.start](../../docs/specs/practice/start.md)(경험 판·신형 생성 플래그), [practice.analyze](../../docs/specs/practice/analyze.md)(1층 기록·공개 요약, 직접 영상 코칭의 분석), [practice.coach](../../docs/specs/practice/coach.md)(「Gemini 직접 영상 코칭」, 「2층 대화 (SOMA-531)」의 첫 질문 개정), [practice.note](../../docs/specs/practice/note.md)(「3층 촬영 노트 (SOMA-531)」·공개 응답)

- **Gemini 직접 영상 코칭**: 공통 원칙은 `DirectVideoPrompts.common()`, Markdown 기호를 걷어 내는 자리는 `PlainCoachText` 다.
- 층마다의 실행 파일(`apps/api/src/main/resources/`)과 모델에 함께 주는 JSON Schema(`coaching/three-layer-contracts.schema.json`의
  정의)는 아래 표다. 스펙은 이 표를 가리킨다. 공개 JSON과 DB는 유지한다.

  | 쓰임 | 프롬프트 | 스키마 |
  |---|---|---|
  | 1층 영상 기록(`GeminiVideoRecordAnalyzer`) | `coaching/video-record-prompt.txt` | `layer1_chunk` |
  | 2층 구조화 코치(`StructuredCoachEngine`) | 라우팅 끔: `coaching/coach-prompt.txt` + 첫 질문 정책 `coach/coach-opening-policy.txt`, 라우팅 켬(`CoachingPipeline`): `coaching/routes/*.txt` | 응답 `layer2_dialogue_turn`, 2→3 전달 `coach_handoff_v2` |
  | 3층 노트(`DialogueNote`) | `coaching/note-prompt.txt` | `layer3_note` |
  | 기존 갈래 코치(`CoachPrompt`) | `coach/coach-v2-prompt.txt`·`coach-v3-prompt.txt`·`coach-response-policy.txt`, 막힘 `그 외`는 `coach-video-first-prompt.txt` + `coach-opening-policy.txt` | — |
  | Gemini 직접 영상 코칭(`DirectVideoPrompts`) | `coaching/direct-video/*.txt`(`common`, 분류 `classifier`, 신호별 지침, 연습 루프 `practice-loop`) | — |
- 2·3층 개정(2026-09-14): 2층 내부 출력은 `acttub.layer2_turn.v2`, 2→3 전달은 `acttub.coach_handoff.v2` 다. 공개
  `PublicPracticeNote`와 저장 노트 v1의 필드는 유지한다. v1 handoff를 만드는 경로가 없어 노트는 v2 handoff에서만 조립한다.
- 새 계약의 검증은 모델 출력·참조 검증과 레코드 조회, 조립, 상태 전이의 단위 테스트에 더해 `CoachConversationIT`에서
  대화 상태의 원자적 저장과 낡은 revision 충돌을 확인한다.

### 8-6. 코드에서 선택하는 네 가지 코칭 프롬프트

> 제품 규칙의 정본: [practice.coach](../../docs/specs/practice/coach.md)(「2층 대화 동작 분류와 코드 기반 프롬프트 선택」: 네 분류, 첫 응답, 입력·출력, 문장 수 세기, 실패 처리 / 「Gemini 직접 영상 코칭」: dev 임시 세션 API와 연습 루프)

- 2층 분류는 Luna, 선택은 Java 의 enum/switch 다(`CoachingPipeline`).
- 직접 영상: dev 임시 세션 API는 `DirectVideoController`(조건부 등록, 공개 OpenAPI에서 `@Hidden`), 임시 세션은
  `DirectVideoSessions` → `DirectVideoRouting`, 영속 코칭은 `DirectVideoCoach` → 연습 루프 `DirectVideoPracticeLoop`다. 열리는 조건과
  경로 선택은 practice.coach 「규칙·제약」의 경로 표와 「Gemini 직접 영상 코칭」에 있다.
