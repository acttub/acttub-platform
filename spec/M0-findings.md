# M0 findings — 스파이크 결과

`spec/M0-spike.md` 의 산출물 A~F 를 실제로 돌린 결과다. 추정이 아니라 실행 결과만 적었다.

- 구현 위치: `apps/api-java/`
- 검증: `./gradlew clean build` → **43 tests / 0 failed / 0 skipped** (Gemini 실호출 포함)
- 환경: Java 21.0.11 (Homebrew openjdk@21), Gradle 8.14.3 (wrapper), Docker Desktop, Testcontainers 1.21.3

---

## 0. 한 줄 결론

| 미결 사항 | 결론 |
|---|---|
| Gemini Java SDK 가 세 기능을 지원하는가 | **셋 다 된다. SDK 채택.** REST 직접 호출 경로는 필요 없다 |
| 위험 함수 #1 의 트랜잭션 관리 스타일 | **`TransactionTemplate`.** 선언적 2층도 동작하지만 채택하지 않았다 |
| Flyway 두 경로 | **둘 다 성립.** 빈 DB 재구축이 alembic 과 diff 0 |
| 운영 be 인스턴스 | **t2.micro (1 vCPU / 1 GB).** M5 에서 **업그레이드가 필수**다 |

---

## C. Gemini Java SDK — **채택**

### 무엇을 어떻게 확인했나

`com.google.genai:google-genai:1.57.0` 으로 **실제 API 를 호출했다**(`GeminiSdkSpikeTest`).
샘플 영상은 Docker ffmpeg 으로 만든 6초 320x240 mp4(80,364 B)이고 저장소에 커밋하지 않는다
(`./gradlew prepareSpikeVideo` → `build/spike/sample.mp4`).

실행 로그:

```
[M0-spike] uploaded=files/gyj8leuipoyx state=PROCESSING sizeBytes=80364
[M0-spike] ACTIVE uri=https://generativelanguage.googleapis.com/v1beta/files/gyj8leuipoyx
[M0-spike] anomalies=2 intent_impact=[반전, 약화]
```

| 검증 항목 | 결과 | Java API |
|---|---|---|
| 1. Files API 업로드 | ✅ | `client.files.upload(String path, UploadFileConfig)` — `mimeType`/`displayName` 지정 가능 |
| 2. `PROCESSING` → `ACTIVE` 폴링 | ✅ | `client.files.get(name, GetFileConfig)` → `File.state()` 가 `Optional<FileState>`. 업로드 직후 실제로 `PROCESSING` 이 관측됐다 |
| 2-1. 타임아웃 경로 | ✅ | SDK 가 주지 않는다. `summarizer.py:19-32` 를 그대로 옮긴 폴러를 만들었다(`FileActivationPoller`). 시계를 주입해 네트워크 없이 타임아웃 분기를 테스트한다 |
| 3. `responseSchema` 구조화 출력 | ✅ | `GenerateContentConfig.builder().responseMimeType("application/json").responseSchema(Schema.fromJson(json))` |
| 3-1. **한글 enum** (`반전/약화/국소`) | ✅ | `enum` 키로 강제되고 실제로 `반전`,`약화` 가 왔다. **여기가 최대 관문이었는데 통과했다** |
| 3-2. 스키마 준수 | ✅ | `FAIL_ON_UNKNOWN_PROPERTIES=true` ObjectMapper 로 파싱해도 깨지지 않는다 = 스키마 밖 필드가 없다 |

### Python 대비 빠지는 것 (M4 가 메워야 함)

| Python | Java | M4 대응 |
|---|---|---|
| `client.files.upload(file=path)` 가 확장자로 mime 추론 | 추론이 불안정 | `UploadFileConfig.mimeType` 을 **항상 명시**한다 |
| `response.parsed` → Pydantic 인스턴스 | **없다.** `GenerateContentResponse.text()` 뿐 | `_parse` 의 1차 경로가 사라진다. Jackson 으로 `text()` 를 파싱하고, `summarizer.py` 의 **2회 재시도 루프**는 그대로 옮긴다 |
| `response_schema=SceneSummary` (Pydantic 클래스 직접) | `Schema` 객체만 받는다 | 스키마 JSON 을 리소스로 두거나 DTO→Schema 생성기를 만든다. M0 은 리소스(`scene-summary.schema.json`) 방식으로 했고 이게 단순하다 |
| `types.MediaResolution.MEDIA_RESOLUTION_LOW` | `MediaResolution.Known.MEDIA_RESOLUTION_LOW` ✅ | 그대로. **비용 절감(프레임당 258→64토큰)이 유지된다** |
| `top_k=1` (int) | `topK(Float)` | 타입만 다르다 |
| `client.files.delete(name=...)` | `client.files.delete(name, null)` ✅ | 원본처럼 실패를 무시한다 |
| `seed=42`, `temperature`, `topP` | 전부 있다 ✅ | 결정성 설정 유지 |

### 부수 사실 — 배포 크기

`google-genai` 는 M0 에서 `testImplementation` 이다. M4 에서 `implementation` 으로 올리면
전이 의존성 포함 **약 12 MB** 가 늘어난다(genai 9.5 + protobuf 1.8 + auth/http-client/grpc 0.9).
현재 `bootJar` 는 70.2 MB → M4 후 약 82 MB 예상. 1 GB 인스턴스에서 디스크는 문제가 아니지만
클래스로딩·메타스페이스가 늘어나므로 F 의 인스턴스 판단과 함께 본다.

### 결론

> **Google GenAI Java SDK 를 채택한다. `RestClient` 직접 호출 프로토타입은 만들지 않는다.**
> 세 기능이 전부 되고, 특히 M4 의 최대 위험이던 한글 enum 구조화 출력이 통과했다.
> SDK 가 안 주는 것은 폴링 타임아웃 하나뿐인데 그건 원래 Python 도 직접 짠 부분이다.

---

## D. Flyway — 두 경로 다 성립

### V1__baseline.sql 을 어떻게 만들었나

1. 빈 DB 에 `alembic upgrade head` (0001~0006)
2. `pg_dump --schema-only --no-owner --no-privileges --exclude-table=alembic_version`
3. 손으로 고친 것은 **셋뿐**이고 파일 헤더에 적어 뒀다
   - psql 메타커맨드(`\restrict`/`\unrestrict`)와 `SET`/`set_config` 프리앰블 제거 (Flyway 는 JDBC 로 실행한다)
   - `0005` 의 `op.bulk_insert` 로 들어가던 `community_categories` 시드 3건을 파일 끝에 추가
   - 주석 블록

결과: 20 테이블 + 17 enum 타입 + 인덱스 + 제약 + 시드. 1,137 줄.

### 검증 결과

| 경로 | 결과 | 근거 |
|---|---|---|
| (a) 빈 DB → V1 실행 | ✅ **alembic 결과와 diff 0** | `FlywayBaselineTest.freshDatabaseRebuildMatchesAlembic` |
| (a-2) 객체 실물 확인 | ✅ 20 테이블 / 17 enum / 부분 인덱스 3 / CHECK 1 / `reports_session_id_key` / `intent_impact_t = 반전,약화,국소` / 시드 3건 | 같은 파일 |
| (b) 기존 스키마 → baseline 기록만 | ✅ **DDL 미실행, 스키마 변경 0, 시드 재실행 없음** | `existingDatabaseGetsBaselineOnly`. baseline 후 `migrate()` 를 다시 불러도 실행 0건 |
| (b-2) 안전장치 | ✅ `baseline-on-migrate: false` 라서 애플리케이션이 스스로 baseline 을 찍지 못하고 거부한다 | `applicationDoesNotBaselineSilently` |
| `ddl-auto: validate` | ✅ 매핑 2종(`users`, `practice_sessions`)에 대해 통과 | `EntityMappingIT` + 컨텍스트 기동 자체 |
| 부분 인덱스·CHECK 가 validate 를 깨는가 | ✅ **안 깬다** | Hibernate 스키마 검증기는 인덱스와 CHECK 를 검증 대상으로 보지 않는다. "검증도 못 한다"는 §5-3-6 의 서술이 맞고, 그래서 방해도 하지 않는다 |

"diff 0" 은 `pg_dump` 텍스트 비교(수동)와 카탈로그 fingerprint 비교(테스트 자동) **양쪽으로** 확인했다.
fingerprint 는 enum 라벨·컬럼 타입/기본값/nullable·제약 정의·인덱스 정의·시퀀스를 정렬해 476줄로 만든다
(`src/test/resources/schema-fingerprint.sql`). `flyway_schema_history` 와 `alembic_version` 은 제외한다.

### ⚠️ 발견 1 — 운영 Postgres 는 **18.4** 다 (16 이 아니다)

F 에서 조회한 실제 값: `acttub-db / db.t4g.micro / PostgreSQL 18.4`.
그래서 Testcontainers 이미지를 `postgres:18-alpine` 으로 맞췄다.

PG18 에서도 **alembic 과 V1 은 diff 0** 이다(별도 컨테이너로 재확인). V1 은 16↔18 사이에서 이식 가능하다.

다만 **fingerprint fixture 는 Postgres 메이저 버전에 종속**된다.
PG18 은 NOT NULL 을 `pg_constraint` 에 별도 제약(`contype='n'`)으로 물질화해서
16 에서 뜬 fixture 와 텍스트가 달라진다(328줄 → 476줄). 스키마 자체는 같다.

**fixture 재생성 방법** (컨테이너 버전을 바꿀 때):

```bash
docker run -d --name pgref -e POSTGRES_PASSWORD=p -e POSTGRES_USER=u -p 55433:5432 postgres:18
docker exec pgref psql -U u -d postgres -c 'CREATE DATABASE ref'
cd apps/api && DATABASE_URL="postgresql://u:p@127.0.0.1:55433/ref" \
  uv run --package acting-api alembic -c acting-api/alembic.ini upgrade head
grep -v '^--' apps/api-java/src/test/resources/schema-fingerprint.sql \
  | docker exec -i pgref psql -U u -d ref -tA -f /dev/stdin \
  > apps/api-java/src/test/resources/alembic-schema-fingerprint.txt
```

### ⚠️ 발견 2 — `@JdbcTypeCode(SqlTypes.NAMED_ENUM)` 과 `AttributeConverter` 는 **같이 못 쓴다**

`/SPEC.md` §5-3-1 이 요구하는 `AttributeConverter` 를 네이티브 Postgres enum 컬럼에 붙이려면
바인딩 방식을 따로 정해야 한다. M0 에서 실제로 셋을 시도했다.

| 시도 | 결과 |
|---|---|
| `@Convert` 만 | 드라이버가 `varchar` 로 보내서 Postgres 가 `operator does not exist: user_status_t = character varying` 로 거절 |
| `@Convert` + `@JdbcTypeCode(SqlTypes.NAMED_ENUM)` | **`entityManagerFactory` 생성 실패**: `Cannot read the array length because "values" is null`. Hibernate 의 `PostgreSQLEnumJdbcType` 이 Java 타입을 enum 으로 가정하고 `getEnumConstants()` 를 부르는데, 컨버터를 거치면 관계 타입이 `String` 이라 null 이 나온다 |
| `@Convert` + **커스텀 `PgEnumJdbcType`** | ✅ 동작. `setObject(idx, value, Types.OTHER)` 로 타입 없는 값을 보내 서버가 컬럼 타입으로 추론하게 한다 |

JDBC URL 의 `stringtype=unspecified` 도 후보였지만 **커넥션 전체의 바인딩 의미를 바꾸므로 쓰지 않았다.**
문제 컬럼만 겨냥하는 `PgEnumJdbcType` 이 부작용이 없다.

> **M2 영향: enum 17종 전부가 `@Convert` + `@JdbcType(PgEnumJdbcType.class)` 조합이어야 한다.**
> `PgEnum` 인터페이스 + `PgEnumConverter<E>` 뼈대를 만들어 뒀으니 M2 는 상수 정의만 채우면 된다.

### 발견 3 — `Persistable` 이 의도대로 동작한다

`EntityMappingIT.newEntityDoesNotSelectBeforeInsert` 가 Hibernate `StatementInspector` 로
실행 SQL 을 모아 **INSERT 앞에 SELECT 가 하나도 없음**을 확인한다.
`/SPEC.md` §5-3-2 가 요구한 "17개 전부에 대해 검증"의 검증 수단이 이 방식이다 — M2 에서 그대로 확장한다.

또 `created_at`/`updated_at` 을 `insertable = false, updatable = false` 로 두면
`server_default`(`now()`)가 실제로 발동한다(§5-3-3). 필드 초기화값을 주면 안 되는 이유가 이것이다.

---

## E. 위험 함수 #1 트랜잭션 — **`TransactionTemplate` 채택**

### 구조

세 조각으로 나눴다.

| 클래스 | 역할 |
|---|---|
| `ReportOperationWork` | 트랜잭션 <b>안쪽 본문</b>. 어노테이션 없음. 경계는 호출자가 정한다 |
| `ReportOperationService` | **채택** — `TransactionTemplate` + 바깥에서 `DataIntegrityViolationException` catch |
| `DeclarativeReportOperationService` | 비교용 — 별도 빈의 `@Transactional` 메서드 호출 + 바깥에서 catch |

두 스타일에 **같은 테스트를 전부 돌렸고 결과가 동일**하다. 그래서 "둘 다 맞다"고 말할 수 있고,
선택 근거를 동작이 아니라 유지보수 관점에서 댈 수 있다.

### 시나리오 검증 (Testcontainers 통합 테스트)

| 시나리오 | 기대 | 결과 |
|---|---|---|
| 정상 | payload 반환 + 커밋, operation 이 `succeeded` + lease 해제 + `response_payload` 저장 | ✅ 두 스타일 |
| **경로 (2)** 사전 존재 확인 (`store.py:1605-1615`) | `null`, 예외 없음, operation 은 `running` 유지 | ✅ 두 스타일 |
| **경로 (3)** INSERT 시 `reports_session_id_key` 위반 | `null`(예외 아님), 전체 롤백 | ✅ 두 스타일 |
| **경로 (3) 진짜 경쟁** 2 스레드 동시 실행 | 정확히 한쪽만 성공, reports 는 1건 | ✅ |
| 리스 소유권 상실 | `LeaseOwnershipException` + 롤백(리포트 안 남음) | ✅ 두 스타일 |
| operation 없음 / kind≠report | 각각 전용 예외 | ✅ 두 스타일 |
| 제약명 판정 | `summaries_session_id_key` 위반은 **삼키지 않는다** | ✅ |
| `report_count` | practice session 단위 + `hidden_at IS NULL` 제외 | ✅ |

경로 (2)와 (3)을 갈라 놓기 위해, (3)은 **사전 SELECT 가 미스하도록 데이터를 구성**했다.
사전 확인은 `reports → coach_sessions → summaries → summaries.session_id = operation.session_id` 로
거슬러 올라가므로, operation 이 가리키는 practice session 과 coach session 이 매달린 practice session 이
다르면 통과한다. 그 뒤 INSERT 가 `reports.session_id` 유니크에 걸린다.
동시성 테스트는 여기에 스레드 둘을 더해 실제 경쟁을 만든다.

### 왜 순진한 이식이 안 되는가 — 실측

"메서드 하나에 `@Transactional` 붙이고 그 안에서 try/catch" 를 실제로 만들어 돌렸다
(`NaiveTransactionTrapIT`). Postgres 는 statement 하나가 실패하면 트랜잭션 전체를 abort 시키므로:

1. **삼킨 뒤 DB 를 더 건드리면** → `25P02 current transaction is aborted` 로 터진다
2. **삼키고 그냥 리턴하면** → 커밋이 조용히 롤백으로 바뀐다. **예외 하나 없이 선행 쓰기가 사라진다**

2번이 위험하다. 겉으로는 성공한 것처럼 보인다. 테스트가 이 두 가지를 그대로 재현한다.
즉 "예외를 트랜잭션 경계 <b>바깥</b>에서 잡는다"는 것은 취향이 아니라 **필수 조건**이다.

### `TransactionTemplate` 을 고른 이유

| 기준 | `TransactionTemplate` | 선언적 2층 |
|---|---|---|
| 원본과의 대응 | `with db.begin(): … except:` 구조가 한 메서드 안에 그대로 보인다 | 경계가 다른 빈에 있어 두 파일을 봐야 한다 |
| 빈 개수 | 그대로 | 하나 늘어난다 |
| 자기호출 함정 | 없다 | "이 메서드에는 왜 `@Transactional` 이 없는가"가 영구히 남는다. 나중에 누가 바깥 메서드에 `@Transactional` 을 붙이면 조용히 깨진다 |
| 전파 속성 | `PROPAGATION_REQUIRES_NEW` 를 생성자에서 못 박는다 | 어노테이션 속성 |
| 워커에서 호출 | 바깥 트랜잭션에 얹히지 않음을 코드로 확인 가능 | 같음 |

> **결론: M2~M3 에서 "커밋/무결성 예외를 정상 응답으로 바꾸는" 경로는 `TransactionTemplate` 로 쓴다.**
> 그 밖의 평범한 읽기·쓰기는 선언적 `@Transactional` 로 둔다 — 전면 `TransactionTemplate` 화는 과하다.
> 판단 기준: **"예외를 잡아 정상 흐름으로 바꿔야 하는가"** 가 있으면 `TransactionTemplate`.

### 부수 발견

- **제약명 판정은 `PSQLException.getServerErrorMessage().getConstraint()` 로 된다.**
  Spring 이 `DataIntegrityViolationException` 으로 감싸므로 예외 사슬을 끝까지 훑는다.
  메시지 문자열 매칭은 쓰지 않는다 — 메시지는 `lc_messages` 로 번역되지만 `constraint` 필드는 안 된다.
- **`org.postgresql:postgresql` 은 `runtimeOnly` 가 아니라 `implementation`** 이어야 한다.
  위 판정이 드라이버 예외 API 를 컴파일 타임에 참조한다.
- **Java 에서는 위반이 COMMIT 이 아니라 INSERT 실행 시점에 뜬다.** JDBC 가 즉시 실행하기 때문이다.
  원본도 `_add_report` 직후 `db.flush()` 를 부르므로 실질적으로 같은 지점이다. 어느 쪽이든
  "트랜잭션 안에서 터지고 바깥에서 잡는다"는 구조는 동일하다.
- **jsonb 는 키 순서와 공백을 보존하지 않는다.** `response_payload` 를 문자열로 비교하면 안 되고
  파싱해서 봐야 한다. 멱등 replay 의 canonical JSON(§6 #12)과는 별개 문제다 — 그쪽은 fingerprint 계산용이다.

---

## F. 인스턴스 스펙 (AWS 조회 결과)

`aws --profile acttub` (계정 673698306055, ap-northeast-2) 로 실제 조회했다.

| 역할 | 인스턴스 ID | 타입 | vCPU/RAM | 디스크 | AZ |
|---|---|---|---|---|---|
| 운영 back (`acttub-be`) | `i-08a90c20095d4ecf1` | **t2.micro** | 1 / **1 GB** | 8 GB gp3 (3000 IOPS) | ap-northeast-2a |
| 운영 front (`acttub-fe`) | `i-06eda45984a6f354e` | t2.micro | 1 / 1 GB | — | ap-northeast-2a |
| 개발 (`acttub-dev`) | `i-0f101fb852e26d081` | t2.micro | 1 / 1 GB | — | ap-northeast-2a |

| DB | 클래스 | 엔진 | 스토리지 | Multi-AZ |
|---|---|---|---|---|
| `acttub-db` | db.t4g.micro | **PostgreSQL 18.4** | 20 GB | 아니오 |

아키텍처는 x86_64(ami-0e4ab31f1847c850c).

### M5 판단

**운영 be 도 t2.micro 다 — 문서에 없던 사실이고, dev 와 같다.**

- JVM(Tomcat + Hikari + Hibernate + Flyway)의 현실적 RSS 는 **450~600 MB** 다.
  1 GB 에서 OS·ffmpeg 과 나눠 쓰면 여유가 없다. 현행 uvicorn 은 이보다 훨씬 적게 쓴다.
- **t2 는 credit 모델이다.** JVM 기동·JIT 워밍업이 CPU credit 을 태우고, credit 이 마르면
  baseline 10% 로 떨어져 응답이 급격히 느려진다. 분석 워커가 ffmpeg 을 돌리면 더 빨리 마른다.
- be 는 분석 파이프라인(ffmpeg 동시 실행 1개, 600초 타임아웃 — §6 #9)도 같이 돈다.

> **권고: M5 에서 be 를 최소 `t3.small`(2 GB / 버스트 무제한 옵션 가능)로 올린다.
> 가능하면 `t3.medium`(4 GB).** front 는 Next 프로세스뿐이라 당장은 유지 가능하다.
> dev 도 같은 이유로 올리는 것이 SPEC §10 의 기존 판단과 일치한다.
> JVM 옵션은 `-XX:MaxRAMPercentage` 로 주고 고정 `-Xmx` 는 피한다 — 인스턴스를 바꿔도 따라온다.

---

## 부수 발견 — 빌드·테스트 환경

M1 이후 다른 사람이 같은 벽에 부딪히지 않게 적어 둔다. 전부 `apps/api-java/` 안에 조치돼 있다.

1. **Testcontainers 가 Docker 를 못 찾는다** (`Could not find a valid Docker environment`).
   실제 원인은 소켓이 아니라 **API 버전**이다. docker-java 기본값 `1.32` 를 현행 Docker Engine 이
   400 으로 거부한다(`v1.41` 은 200). `systemProperty("api.version", "1.41")` 로 해결했다.
   `DOCKER_API_VERSION` 환경변수만으로는 안 된다 — docker-java 가 읽는 키는 시스템 프로퍼티 `api.version` 이다.

2. **`EnvironmentPostProcessor` 는 `META-INF/spring.factories` 로 등록한다.**
   `META-INF/spring/….imports` 는 자동설정 전용이라 조용히 무시된다(예외도 안 난다).

3. **`@DynamicPropertySource` 로는 `DATABASE_URL` 변환을 테스트할 수 없다.**
   그 프로퍼티 소스는 `EnvironmentPostProcessor` 가 이미 돈 뒤에 붙는다.
   `SpringApplicationBuilder.properties(...)`(= `setDefaultProperties`)는 환경 준비 **전에** 들어가므로 보인다.
   `HealthAndBootIT` 가 이 방식으로 실제 배포 형식 URL 부팅을 검증한다.

4. **`@JsonTest` 는 임의의 `@Configuration` 을 스캔하지 않는다.** `@Import(JacksonConfig.class)` 가 없으면
   테스트가 Spring Boot 기본 ObjectMapper 를 보게 되어 **초록인데 계약을 검증하지 않는** 상태가 된다.
   (실제로 처음에 이 상태였고, 6자리 고정·unknown key 거부가 전부 통과처럼 보였다.)

5. **springdoc 은 `const` 를 어노테이션으로 못 낸다.** `allowableValues` 는 `enum: ["ok"]` 이 된다.
   `OpenApiCustomizer` 에서 `Schema.setConst(...)` 를 직접 호출해야 3.1 의 `const` 가 나온다.

6. **springdoc 은 컨트롤러 이름으로 태그를 자동 생성한다**(`health-controller`).
   Python 의 `/health` 에는 태그가 없다(`/v2/*` 만 `v2-auth` 등을 단다). 커스터마이저에서 지웠다.

7. **`required` 배열 순서가 다르다.** springdoc 은 알파벳순, pydantic 은 선언순.
   의미는 같으므로 M1 하네스는 **집합으로 비교**해야 한다.

---

## 완료 기준 체크리스트 대조

### 빌드·기동
- [x] `./gradlew build` 성공 (wrapper 포함, 로컬 Gradle CLI 불필요 — wrapper 8.14.3 생성)
- [x] `./gradlew bootRun` 기동, `GET /health` 가 지정 JSON 형상 반환
- [x] `./gradlew bootJar` → `java -jar build/libs/acting-api.jar` 로 동일 동작
      (**FastAPI(:8000)와 나란히 띄워 `/health` 응답이 바이트 단위로 동일함을 확인**)
- [x] `/v3/api-docs` 의 `HealthResponse` 가 `additionalProperties: false` + `status` const
      (**커밋된 `apps/api/spec/openapi.json` 의 `/health` 슬라이스와 동일** — `required` 순서 제외)
- [x] Jackson 이 `Instant` 를 `...Z` + 마이크로초 6자리로 낸다 (단위 테스트 7건)

### Gemini (C)
- [x] Files API 업로드 성공
- [x] `PROCESSING` → `ACTIVE` 폴링 성공, 타임아웃 경로 존재
- [x] `responseSchema` 구조화 출력으로 스키마 준수 JSON 파싱 성공
- [x] **결론 기록: SDK 채택.** REST 직접 호출 프로토타입 불필요

### Flyway (D)
- [x] `V1__baseline.sql` 생성. 빈 DB 실행 → alembic 결과와 diff 0 (PG16·PG18 양쪽)
- [x] 기존 스키마에 baseline 기록 → DDL 미실행, 스키마 변경 0
- [x] `ddl-auto: validate` 가 매핑 2종에 대해 통과
- [x] 부분 인덱스 3개·CHECK 제약이 validate 를 깨지 않음

### 트랜잭션 프로토타입 (E)
- [x] 정상 시나리오: payload 반환 + 커밋
- [x] 사전 존재 확인 경로: `null` 반환
- [x] INSERT 시 `reports_session_id_key` 위반 경로: `null` 반환, 예외 전파 없음 (+ 진짜 동시성 테스트)
- [x] 리스 소유권 상실: 전용 예외 + 롤백
- [x] 제약명 문자열로 중복 판정 (`getConstraint()`), 다른 제약은 삼키지 않음
- [x] **결론 기록: `TransactionTemplate`**

### DB 연결
- [x] 실제 배포 형식 `postgresql://user:pass@host:5432/db` 로 부팅 성공 (+ 포트 생략·퍼센트 인코딩·쿼리 파라미터)

### 기록
- [x] `spec/M0-findings.md`
- [x] M1~M6 조정 항목 (아래)

---

## M1~M6 SPEC 조정 제안

| 대상 | 조정 내용 | 근거 |
|---|---|---|
| **§5-3-1 / M2** | "`AttributeConverter` 17개" 에 **"+ `@JdbcType(PgEnumJdbcType.class)`"** 를 명시한다. 컨버터만으로는 Postgres 가 거절하고, `@JdbcTypeCode(NAMED_ENUM)` 은 컨버터와 공존 불가다 | D 발견 2 (실측) |
| **§2 / M2** | Postgres 버전을 **18.4** 로 명시한다. Testcontainers 이미지와 fingerprint fixture가 여기에 묶인다 | F 조회 결과 |
| **§10 / M5** | "dev 인스턴스 업그레이드" → **"dev·운영 be 둘 다 업그레이드"** 로 확장. 운영 be 도 t2.micro 다 | F 조회 결과 |
| **§10 / M0** | Gemini 미결 사항 해소. **"SDK 채택"** 으로 확정하고 §10 에서 뺀다 | C |
| **§10 / M0** | 트랜잭션 스타일 미결 사항 해소. **"예외를 정상 흐름으로 바꾸는 경로만 `TransactionTemplate`"** 으로 확정 | E |
| **§6 #2 / §6-3 / M1** | M0-spike.md A 의 "`FAIL_ON_UNKNOWN_PROPERTIES=true`" 와 §6-3 의 "전역 true 금지" 가 충돌한다. **채택한 해석: 전역 true + 허용 7개 DTO 에 `@JsonIgnoreProperties(ignoreUnknown = true)`.** Jackson 에는 "전역 false + DTO 별 true 강제" 를 표현할 수단이 없고, 이 방향이라야 실수 시 조용히 통과하지 않고 시끄럽게 실패한다. **M1 이 요청 바디 16개 전부에 unknown-field 회귀 테스트를 만든다** | §6-3 의 취지 + Jackson 제약 |
| **§8-1 / M1** | "`openapi.json` diff 0" 판정에서 **`required` 배열은 집합으로 비교**한다고 명시 | 부수 발견 7 |
| **M1** | 태그 정책을 하네스에 넣는다. springdoc 이 컨트롤러 이름으로 태그를 자동 생성하므로, `/v2/*` 는 `v2-auth` 등 9종으로 맞추고 `/health` 는 태그 없음 | 부수 발견 6 |
| **M1** | `const`(Pydantic `Literal`)를 내는 `OpenApiCustomizer` 를 일반화한다. M0 은 `HealthResponse.status` 하나만 하드코딩했다 | 부수 발견 5 |
| **M4** | `response.parsed` 가 없다는 전제로 `_parse` 를 다시 설계한다 (`text()` + Jackson + 2회 재시도) | C |
| **M4** | `responseSchema` 를 **JSON 리소스**로 관리한다(`scene-summary.schema.json`). DTO 에서 생성하는 방식은 만들지 않는다 | C |
| **M4/M5** | `google-genai` 를 `implementation` 으로 올리면 bootJar 이 약 12 MB 늘어난다(70 → 82 MB). 인스턴스 판단과 함께 본다 | C 부수 |
| **M2** | `Persistable` 검증 수단으로 Hibernate `StatementInspector` 를 쓴다. M0 의 `EntityMappingIT` 패턴을 17개로 확장 | D 발견 3 |
| **M6** | fingerprint fixture 재생성 절차(위 D)를 alembic 삭제 <b>전에</b> 마지막으로 한 번 돌린다. 지운 뒤에는 기대값을 다시 뜰 수 없다 | D |

---

## 남은 것 / 하지 않은 것

- **엔티티는 2개만 만들었다** (`users`, `practice_sessions`). M0-spike.md "하지 말 것" 1 대로다.
- **엔드포인트는 `/health` 하나뿐이다.** 오류 포맷(`{"detail": …}`) 오버라이드, 인증 필터, S3 presigner 는
  전부 M1~M3 몫이라 손대지 않았다.
- **`apps/api/` 는 수정하지 않았다.** 읽기만 했다.
- **Gemini 프롬프트를 옮기지 않았다.** 스파이크 프롬프트는 능력 확인용으로 새로 썼다.
- **샘플 영상은 커밋하지 않는다.** `./gradlew prepareSpikeVideo` 가 Docker ffmpeg 으로 만든다.
- `GEMINI_API_KEY` 가 없으면 실호출 테스트는 건너뛴다(`@EnabledIfEnvironmentVariable`).
  나머지 42건은 Docker 만 있으면 돈다.

---

## 이중 구현 대조 (Phase 3)

같은 SPEC으로 Codex(`m0-codex`)와 Claude 서브에이전트(`m0-claude`)가 독립 병렬 구현했고, 오케스트레이터가 대조·실증했다.

### 채택

**베이스 = Claude 산출물.** Java 37파일 / 43 tests. Codex 산출물에서 이식할 것은 없었다.

근거는 코드 품질이 아니라 검증 깊이다. Codex 샌드박스는 Docker·외부 HTTPS·Gradle 소켓이 모두 차단돼 **아무것도 실행하지 못했고**, 그 결과 실행하면 즉시 드러나는 오류가 남았다.

### 두 구현이 독립적으로 합의한 것

**트랜잭션 = `TransactionTemplate` + 바깥 catch.** 서로를 보지 않고 같은 결론에 도달했다. Claude는 선언적 2층 방식까지 구현해 같은 테스트를 돌려 비교한 뒤 유지보수성을 근거로 골랐다.

한쪽만 봤다면 "이게 최선인가"가 남았을 지점이다. 대조가 준 확신이다.

### 오케스트레이터가 Codex 산출물에서 잡은 결함

실행 환경이 없어 남았던 것들이다. 전부 실증 과정에서 드러났다.

| 결함 | 파급 |
|---|---|
| `nimbus-jose-jwt` 버전 누락 (BOM 미관리 좌표) | 빌드 실패 |
| `responseSchema(Map)` — 실제 API는 `Schema` 타입 | M4 전체 |
| enum 컬럼에 문자열 리터럴 비교 | M2~M4의 모든 네이티브 SQL → `/SPEC.md` §5-8 |
| `Instant`를 JDBC 파라미터로 바인딩 | 동일 → `/SPEC.md` §5-8 |

2번을 파다가 **`Schema.fromJson(String)`**을 찾았다. Python Pydantic이 만드는 JSON Schema를 문자열로 그대로 넘길 수 있어 M4의 계약 동등성 리스크가 크게 낮아졌다.

### 오케스트레이터가 틀린 것 (기록)

1. **PG 16으로 검증했다.** 운영은 18.4다(AWS 조회로 확인). Claude가 먼저 찾아 Testcontainers를 18-alpine으로 맞췄다. 16에서 통과한 스키마 검증은 운영을 보증하지 않는다.
2. **"Testcontainers는 이 환경에서 동작하지 않는다"고 결론냈다.** 틀렸다. `DOCKER_API_VERSION` 환경변수만 주고 docker-java가 우선하는 **시스템 프로퍼티 `api.version`**을 빠뜨린 탓이었다. Claude가 셋(환경변수 + 시스템 프로퍼티 + 소켓 오버라이드)을 조합해 해결했다 → `/SPEC.md` §8-4.
3. **unknown key 정책을 B안(전역 허용 + DTO별 거부)으로 바꾸려 했다.** Jackson이 표현하지 못하는 방식이다. `@JsonIgnoreProperties(ignoreUnknown = false)`는 "거부하라"가 아니라 "전역을 따르라"는 뜻이라 예외가 나지 않는다. 실제로 시도해 실패한 뒤 A안으로 되돌렸다 → `/SPEC.md` §6-3에 근거를 남겼다.

### 환경 격차에 대한 교훈

이중 구현의 대조가 성립하려면 **양쪽이 실행 결과를 가져와야 한다.** Codex는 코드만 냈고 실증은 오케스트레이터가 대신했다. M1 이후에는 실행이 덜 필요한 작업(설계 비판, 계약 표 추출)과 실증이 필요한 작업을 나누어 배분하는 편이 효율적이다.

---

## 리뷰 결과 (Phase 5~6)

Codex 코드 리뷰와 적대적 리뷰를 병렬로 돌렸다. 지적 5건 중 **기각한 것은 없다.**

### 코드 리뷰 — 즉시 수정

| 지적 | 조치 |
|---|---|
| `DatabaseUrl:78` — `URLDecoder`가 user-info의 `+`를 공백으로 바꾼다. **비밀번호에 `+`가 있으면 인증 실패** | `%2B`로 escape 후 디코드해 리터럴 보존 |
| `build.gradle.kts:58` — `DOCKER_API_VERSION`이 이미 있으면 `api.version` 시스템 프로퍼티를 건너뛴다 | 환경변수 값을 존중하되 시스템 프로퍼티에 **항상** 같은 값 전달 |

두 번째는 오케스트레이터가 실제로 겪었던 실패 경로다(§이중 구현 대조 참조). 해결 코드에 그 경로가 그대로 남아 있었다.

### 적대적 리뷰 — 후속 마일스톤 관문으로 배치

M0의 완료 기준(미지수 해소)은 충족됐으므로 M0을 다시 파지 않고, 드러난 갭을 해당 마일스톤 SPEC에 관문으로 박았다.

| 지적 | 배치 |
|---|---|
| **[high]** Flyway 검증이 owner·ACL·extension·sequence `last_value`·시드 실제값을 보지 않는다. V1은 `--no-owner --no-privileges`로 생성됐고 시드는 개수만 센다 | **M6 선행 관문** — 실제 alembic DB와 독립 비교, production-like role로 기동, 데이터 복원 후 sequence 충돌 확인 |
| **[medium]** 23505 이후 부분 커밋·커넥션 오염이 없다는 것을 증명하지 못한다. 중복 테스트는 23505 전에 SELECT만 한다 | **M3** — 성공하는 marker write 후 23505 발생시켜 롤백 확인, 풀 크기 1로 같은 커넥션 재사용 확인 |
| **[medium]** Gemini PASS(6초·80KB 1건)는 대용량·재시도·delete 실패를 대표하지 못한다 | **M4 관문 ③** — production-envelope 스파이크. **SDK 채택을 잠정 결정으로 낮춘다** |

### 판정에 대한 이견 하나

적대적 리뷰는 "출하 보류"로 판정했다. **동의하지 않는다** — M0는 출하물이 아니라 스파이크이고, 지적된 셋은 전부 후속 마일스톤에서 처리할 성질이다. 다만 지적 내용 자체는 전부 타당해 위와 같이 반영했다.

특히 [high]는 **M6에서 alembic을 지우기 전에 반드시 통과해야 하는 관문**이다. 그 시점 이후로는 되돌릴 방법이 없다.
