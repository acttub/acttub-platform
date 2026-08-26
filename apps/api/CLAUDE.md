# apps/api 지침

## 적용 범위

Java 21 + Spring Boot 3.4. **dev·운영 모두 여기가 트래픽을 받습니다** — 백엔드는 이 하나뿐입니다.

응답 계약의 정본은 `apps/api/spec/openapi.json`이고, springdoc이 만듭니다. `apps/web`이 그것으로 타입을 생성하므로(`pnpm --filter web generate:v2-schema`) **필드 하나·nullable 하나가 어긋나면 프론트가 조용히 깨집니다.**

## 판정 기준 (읽는 순서)

1. [CONTRACT.md](CONTRACT.md) — 이 백엔드가 지키는 계약. §2 기술 스택은 확정이고 변경 금지.
2. [ADR-016~020](../../docs/ADR.md) — 패키지 구조를 왜 이렇게 정했는지.

소스 참조는 **`파일:심볼` 형식**입니다. 라인 번호를 쓰지 않습니다.

계약 동등성 하네스는 `SOMA-403` 4단계에서 폐기했습니다. **그것이 보던 계약이 지금 어느 테스트에 있는지는 [docs/archive/soma287/M6-contract-migration.md](../../docs/archive/soma287/M6-contract-migration.md)가 정본입니다** — 오류 계약 인벤토리는 `ErrorContractInventoryTest`가 지점 수까지 셉니다.

## 명령어 (이 디렉토리 기준)

- `./gradlew test` — JUnit 5 + Testcontainers. **Docker 필요.** CI가 돌리는 것과 같습니다.
- `./gradlew bootJar` — `acting-api.jar` 생성. **배포 아티팩트는 이것 하나뿐입니다.**
- `./gradlew bootRun` — 로컬 기동(:8080). 설정은 아래 `.env`가 공급합니다. 실제 OIDC 없이 로그인하려면 `DEVELOPMENT_AUTH_PROVIDER=1`을 함께 줍니다 — `integration/oidc/DevelopmentProviderVerifier`가 `1`·`true`만 인식하므로 `yes`로는 켜지지 않습니다.
- `scripts/regen-fingerprint.sh` — 스키마 fixture 재생성(아래 참조). **Docker만** 필요합니다.

**`contract` 스프링 프로파일은 하네스와 함께 사라졌습니다.** 스텁 프로바이더·스텁 스토리지·스텁 LLM·제어 표면(`/__harness/*`)과 `@Profile("!contract")` 열두 자리가 전부 그때 걷혔습니다. 프로파일로 외부 연동을 끄던 자리가 없으므로, **지금 앱은 어떤 모드로 뜨든 진짜 연동을 세우고 그 키를 요구합니다.**

## 로컬 설정은 `.env`, 서버는 systemd입니다

`DotenvEnvironmentPostProcessor`가 **작업 디렉토리의 `.env`를 읽어 환경변수처럼 씁니다.** 로컬 개발 편의용이고, 서버에서는 아무 일도 하지 않습니다 — 배포 아티팩트는 jar 하나뿐이라 `.env`가 없고, 설정은 systemd가 `EnvironmentFile=/etc/acttub/api.env`로 주입합니다.

```bash
./gradlew bootRun     # 이 디렉토리의 .env 를 읽습니다
```

`.env`는 이 디렉토리의 **실제 파일**입니다. `.gitignore`에 있어 커밋되지 않습니다.

- **이미 있는 값을 덮지 않습니다.** `addLast`로 넣으므로 실제 환경변수·시스템 프로퍼티·`application.yml`이 항상 이깁니다.
- **테스트에서는 꺼집니다.** `build.gradle.kts`의 test 태스크가 `acttub.dotenv.enabled=false`를 박습니다. **이 가드를 지우면 로컬 실 API 키가 테스트로 새어들어**, 스텁을 쓰는 줄 알았던 테스트가 진짜 호출을 하게 됩니다.
- ⚠ **격리해서 띄울 때는 손으로 꺼야 합니다** — `java -Dacttub.dotenv.enabled=false -jar …`. 안 끄면 주지 않은 키(`S3_BUCKET`·`AWS_*` 등)가 `.env`에서 새어들어, 그 환경이 무엇을 요구하는지가 로컬 사정에 좌우됩니다.
  - 🔎 **이 원칙이 코드보다 앞서 있던 적이 있습니다.** `.env`가 `GEMINI_API_KEY`를 채워주는 동안 아무도 격리 기동을 해보지 않아, dotenv를 끄면 컨텍스트가 죽는 상태가 오래 남아 있었습니다(`SOMA-397` 1단계). **`src/test/resources/application.properties`가 같은 키를 주므로 테스트도 이걸 못 잡습니다** — 키를 비운 채 전체 컨텍스트를 띄우던 `HarnessContractProfileIT`가 그 방어였는데, 하네스와 함께 사라졌습니다(`SOMA-403` 4단계). **키 없이 뜨는 모드가 이제 없어 요구 자체가 사라진 것**이지, 다른 테스트가 대신 보고 있는 것이 아닙니다.
- `DatabaseUrlEnvironmentPostProcessor`보다 **먼저** 돌아야 합니다(`.env`가 `DATABASE_URL`을 공급할 수 있으므로). 순서는 `getOrder()`로 고정했고 테스트가 지킵니다.

## Testcontainers는 Postgres 18입니다

운영 RDS가 18.4라 컨테이너도 **18**로 맞춥니다. PG18은 NOT NULL을 `pg_constraint`로 물질화하는 등 카탈로그가 달라, **16에서 통과한 스키마 검증이 운영을 보증하지 않습니다.** 이미지 태그는 `PostgresContainerSupport`가 들고, Testcontainers 라이브러리 버전은 BOM에 맡기지 않고 `build.gradle.kts`에 고정해 둡니다.

## 스키마는 Flyway가 소유합니다

**정본입니다**(`SOMA-403` 3단계). 배포는 jar만 보내고 마이그레이션은 **기동 중에** Flyway가 돌립니다. 규칙 전문은 [CONTRACT.md](CONTRACT.md) §5-5에 있고, 아래는 코드를 고칠 때 걸리는 것들입니다.

- `ddl-auto: validate` 고정. `create`/`update`는 절대 금지(CONTRACT §2).
- `baseline-on-migrate: false` — 기존 dev·운영 DB의 baseline 기록은 애플리케이션이 아니라 별도 명령으로 합니다. 여기서 켜면 "빈 DB가 아닌데 V1을 건너뛰는" 판정을 애플리케이션이 조용히 내립니다.
- 🔥 **`V1__baseline.sql`은 동결입니다. 스키마 변경은 거기 있는 가장 큰 번호 다음으로 새 파일을 만듭니다.** V1을 고치면 dev·운영은 **멀쩡한데 신규 환경만** `checksum mismatch`로 기동하지 못합니다 — 두 경로의 이력이 다르기 때문입니다(dev·운영은 type=BASELINE이라 checksum이 아예 없습니다). 재해복구가 필요한 순간에야 드러나므로 `FlywayBaselineTest.baselineIsFrozen`이 checksum을 못박아 막습니다.
- ⚠ **마이그레이션이 기동의 일부라 폭발 반경이 큽니다.** 나쁜 마이그레이션은 배포 실패가 아니라 **서비스 중단**이고, Postgres는 실패한 마이그레이션의 이력조차 남기지 않습니다. 되돌리는 길은 새 마이그레이션뿐입니다.
- **스키마를 바꿨으면 `scripts/regen-fingerprint.sh`를 돌리고 `baseline-schema-fingerprint.txt`를 함께 커밋합니다.** 그 fixture가 "마이그레이션이 만드는 스키마"의 기대값이고 `FlywayBaselineTest`가 대조합니다.
- ⚠ **`V1`은 dev·운영에서 실행된 적이 없습니다** — `<< Flyway Baseline >>` 한 줄(type=BASELINE, checksum 없음)로 기록만 됐습니다. **그 뒤 마이그레이션들은 기동 중에 실제로 돌았습니다.** 앞으로도 그 경로가 뚫려 있는지는 `FlywayForwardMigrationTest`가 지킵니다 — 커밋하지 않는 프로브를 **다음 빈 번호로**(`FlywaySupport.nextFreeVersion()`) 얹어 baseline 기록 경로와 빈 DB 경로 양쪽에 통과시킵니다. **baseline이 마이그레이션보다 높으면 예외 없이 조용히 건너뛰므로**(같은 테스트의 반증), 새 마이그레이션이 안 도는 것 같으면 거기부터 의심합니다.
- `baseline 관련 값을 테스트에서 명시하지 않습니다`(`FlywaySupport.flywayFor`) — `application.yml`이 주지 않으므로 실물은 Flyway 기본값입니다. 명시하면 실물과 다른 DB를 세워 놓고 "dev·운영 재현"이라 부르게 됩니다.

## 패키지 구조

최상위가 **세 묶음**입니다 — `feature`(비즈니스 도메인 13) · `platform`(배관: web·security·config·health·observability·ledger·operation·schema) · `integration`(외부 연동: oidc·llm·storage·media·observation). 루트에 남는 것은 스캔 기점 `ActingApiApplication` 하나입니다.

각 도메인은 `domain`(규칙을 담은 Domain Model, 프레임워크 import 금지) · `app`(서비스와 포트 선언) · `adapter`(`web`·`db`·`storage`·`media`·`sched`·`resource`·`expo`, 어느 하위에도 안 속하고 여럿을 조립하는 배선 `@Configuration`은 그 층의 루트) · `schema`(Schema Entity)로 서되 **가진 층만큼만**입니다.

📌 **왜 이 형태인지, 재편 중 무엇을 실측했는지는 [ADR-017~020](../../docs/ADR.md)이 정본입니다** — 층을 왜 다 세우지 않는지(ADR-020), 포트가 실패를 어떻게 알리는지(ADR-018), 서로를 소비하는 두 도메인을 어떻게 정렬하는지(ADR-019). 아래는 **그 결정을 지키며 코드를 고칠 때 필요한 것**만 담습니다.

### 구조를 지키는 것은 검사 둘뿐입니다

서브패키지로 갈리면서 저장소 클래스를 막아주던 package-private 보호가 옅어졌습니다. `PackageLayerTest`(층 방향)와 `PackageCycleTest`(순환)가 **구조를 지키는 유일한 장치입니다.**

⚠ **둘 다 손으로 관리하는 목록을 돌므로, 목록에서 빠진 것은 영원히 못 봅니다.** 새로 만들 때 함께 고칠 곳:

- **도메인을 추가하면** `PackageLayerTest.FEATURE_LAYERS` — 이름 목록이 아니라 「도메인 → 그 도메인이 가진 층」 표입니다. 없는 층을 적으면 그 규칙이 대상 0으로 조용히 통과하고, 층이 새로 생겼는데 안 적으면 그 층만 검사 밖에 남습니다(`everyRuleActuallyHasSomethingToCheck`가 양쪽을 봅니다). 층별 규칙은 표에서 대상을 끌어옵니다(`featuresWithDomain`·`featuresWithSchema`) — 목록 전체를 넘기면 층이 없는 도메인에서 깨집니다.
  - `FEATURE_LAYERS`는 열 쌍을 넘어 `Map.ofEntries`입니다. `Map.of`는 열 쌍까지만 받습니다.
- **묶음을 추가하면** `PackageCycleTest.BUNDLES` — 여기 이름을 더해야 그 안이 조각으로 갈립니다. 안 더하면 조각들이 한 덩어리가 되어 그 사이의 순환이 검사에서 사라지는데, **순환 검사는 이 누락을 못 잡습니다**(뭉친 묶음이 양방향 간선을 가질 때만 사이클이 됩니다). `everyBundleIsInTheList`가 대신 잡습니다.
- 같은 부류의 구멍을 막는 검사 셋이 더 있습니다 — `everyFeatureIsInTheTable`(실물과 표 대조) · `everyFeatureSubpackageIsALayer`(`feature/practice/util` 같은 층 아닌 하위 패키지) · `nothingLivesOutsideTheBundles`(루트에 만든 도메인 — 자식이 층 이름이면 `everyBundleIsInTheList`를 통과해 버립니다).
- 📌 **`featuresSeeOnlyEachOthersAppLayer`의 대상 패턴만 절대 경로입니다**(`com.acttub.actingapi.feature.<이름>..`). 상대형으로 두면 배관에 같은 이름의 조각이 생기는 순간(`platform/admin`) 규칙이 거기까지 번져 "배관은 대상 밖"이라는 전제가 깨집니다.

### 도메인끼리는 상대의 `app` 층만 봅니다

`featuresSeeOnlyEachOthersAppLayer`가 겁니다. 배관·외부 연동을 보는 것은 금지 대상이 아니고(`auth/app/AuthService`가 `integration/oidc`를 직접 부릅니다), 배관이 도메인 포트를 구현하는 것도 대상 밖입니다(`platform/security`·`platform/operation`이 그 형태입니다).

- 📌 지금 걸린 도메인 간 간선은 넷뿐이고, 각각 포트 하나가 실체입니다 — `coach`→`report` 12(`ReportSourceProvider`를 코치 어댑터가 구현) · `consent`→`auth` 2(`auth/app/PendingConsentDocuments`) · `memory`→`coach` 2(`coach/app/CoachMemory`를 `memory/adapter/db/PostgresMemoryRepository`가 직접 구현, 교환 타입 `PriorContext`는 소비자인 `coach`의 것) · `push`→`analysis` 1(`analysis/app/AnalysisCompletionListener`를 `push/app/PushService`가 구현 — 분석은 듣는 쪽이 누구인지 모릅니다). **참조 폭이 늘면 그것이 두 도메인을 합쳐야 한다는 신호입니다**(ADR-019). 검사는 폭을 세지 않습니다 — 세면 숫자가 곧 유지보수 대상이 되고, 판단은 사람이 해야 합니다.
- 📌 그래서 **다른 도메인이 알아야 하는 타입은 `app`에 둡니다.** `report/app/PublicReport`가 web이 아니라 app에 사는 이유가 그것입니다 — 코치 응답에도 같은 본문이 실립니다. 엔드포인트 입출력 봉투(`ReportDtos`)는 web에 남습니다.
- 📌 **집계하거나 읽어 온 것이 곧 응답인 도메인은 그 형태를 `app`에 둡니다** — `admissions/app/Admissions`·`admin/app/AdminMetrics`. 중간 표현을 따로 만들면 필드 수십 개가 두 벌이 되고 그 어긋남을 웹은 컴파일 타임에 잡지 못합니다.
- 📌 **포트를 새로 만들 때 시그니처에 제공자 패키지 이름이 보이면 아직 안 끊긴 것입니다.** 교환 타입은 어느 쪽의 것도 아닌 자리에 둡니다(ADR-017).

### 포트를 새로 만들 때

- 📌 **자원을 준 포트가 그것을 거둡니다.** `AudioExtractor.discard`가 그 형태입니다 — 부르는 쪽이 "추출물이 임시 디렉토리 안에 홀로 산다"는 구현 사정을 알고 있으면, 디렉토리를 쓰지 않는 추출기로 갈아끼울 때 엉뚱한 곳을 지웁니다.
- 📌 **응답 본문은 부르는 쪽이 만들어 넘깁니다** — `complete`의 `JsonNode` 인자가 그것입니다 — `coach/app/CoachOperationLedger`·`report/app/ReportOperationLedger`는 리스를 `platform/ledger/SyncOperationClaim` 하나로 묶어 받고(`complete(claim, JsonNode)`), 워커가 쓰는 `memory/app/MemoryUpdateQueue`만 그것을 펼쳐 듭니다(`complete(operationId, leaseToken, JsonNode, now)`). 그 바이트가 곧 계약이라 조립을 원장으로 넘기면 계약이 도메인 밖으로 나갑니다.
- ⚠ **응답 JSON 표기도 포트 뒤에 있습니다**(`coach/app/CoachResponseRenderer`). 코치 응답의 바이트는 응답이면서 동시에 원장에 남는 값이라, 조립을 컨트롤러에 두면 규칙과 표기가 한 요청 안에서 두 번 오갑니다. **무엇을** 담을지는 서비스가, **어떤 키로** 담을지는 web 어댑터가 정합니다.
- 위임만 하는 포트는 끼우지 않습니다 — `oidc`가 그래서 포트 없이 `auth/app/AuthService`가 직접 부릅니다. 외부 연동을 보는 것은 금지 대상이 아니고 간선도 한 방향이라, 인터페이스만 늘고 얻는 것이 없습니다.

### 검사가 보지 못하는 자리

⚠ 아래는 **계약 하네스가 살아 있을 때도** 사각지대였던 자리입니다. 하네스가 사라진 지금(`SOMA-403` 4단계) 응답 바이트를 통째로 대조하는 그물마저 없으니, 여기를 건드릴 때는 테스트를 함께 세우는 수밖에 없습니다.

🔥 **워커 응답 본문** — 백그라운드 워커가 만드는 바이트는 어떤 응답 대조에도 걸리지 않았습니다. 그 바이트는 잡이 재생될 때 그대로 응답으로 나갑니다. `MemoryUpdateWorkerPayloadTest`가 그 모양을 못박아 둔 이유입니다.

🔥 **요청 지문(fingerprint)** — 멱등 재생 판정에 쓰는 그 바이트도 응답 대조 바깥이었습니다.

🔥 **저장소 트랜잭션의 커밋 순서** — 응답만 보는 대조는 "무엇이 어떤 순서로 커밋됐는가"를 보지 못하고, 가짜 저장소를 쓰는 단위 테스트는 SQL이 틀려도 초록입니다. 실 DB를 쓰는 통합 테스트만 잡습니다 — `ExternalOperationIT`(claim·fail·release)와 `PostgresAnalysisStoreIT`(분석 완료)가 그 자리입니다.

🔥 **조건부 빈이 있는 도메인에 서비스를 끼워 넣을 때는 조건을 함께 옮깁니다.** `admissions`(`@ConditionalOnResource`)·`admin`(`@ConditionalOnExpression`)이 그렇습니다 — 컨트롤러와 저장소만 조건부이던 자리에 서비스가 끼면 **그 서비스가 없는 빈을 요구해 컨텍스트가 기동하지 못합니다.** 리소스나 토큰이 없는 기동을 띄워 보는 테스트가 없어 이 자리는 아무도 보지 못합니다.

🔥 **불변식이 깨진 자리는 "없음"이 아닙니다.** 대상이 없다는 예외를 한 연산이 두 경로로 던지면 뜻이 뭉개집니다 — 넣은 직후 다시 못 읽은 것을 `CommunityContentNotFound`로 내면 500이던 것이 404가 되어 멀쩡한 분류를 탓합니다. 그런 자리는 `IllegalStateException`으로 냅니다. 도달하려면 파손된 데이터가 필요해 어떤 검사도 밟지 못합니다.

### 알아 둘 예외 넷

- **`platform/schema`는 사라지지 않습니다.** 공유 enum 열아홉은 도메인으로 못 갑니다 — `PgEnumCatalogVerifier`가 맵 전체 equals로 대조하느라 전부 정적 참조하는데 그 검증기가 배관이라, 흩으면 순환입니다. 거기 사는 것은 "배관이 소유한 스키마 + 어느 도메인의 것도 아닌 어휘"입니다.
- **`platform/ledger`와 `platform/operation`이 갈려 있는 것은 실수가 아닙니다.** 교환 타입은 `ledger`, 구현은 `operation` — 합치면 순환입니다(실제로 합쳐 확인했습니다). **같은 묶음 안이라고 한 조각이 되는 것은 아닙니다.**
- **`domain`이 배관을 보는 자리가 하나 있습니다** — `memory/domain/MemoryValue`가 `platform/web/PythonText`를 봅니다. `domainKnowsNoFramework`가 막는 목록(스프링·JPA·Jackson·swagger)에 없어 통과하며, **의도한 것입니다**: 그 유틸이 재현하는 공백 처리 규칙이 곧 응답 바이트라 정규화 규칙과 같은 층에 속합니다. **계약이 그대로인 한 남습니다** — 이름은 출처에서 왔지만 지금은 이 백엔드의 규칙입니다.
- **SQL이 남의 테이블을 치는 것은 패키지 의존이 아니라** 구조 검사에 걸리지 않습니다. 탈퇴는 `profile`이 `user_identities`·`refresh_tokens`·`push_tokens`를 함께 칩니다 — 주인은 앞의 둘이 `auth`, 마지막이 `push`지만 파기의 원자성이 트랜잭션 하나를 요구합니다. `admin`도 같은 형태로 도메인을 가로질러 셉니다.

### 자주 헷갈리는 자리 둘

- ⚠ **동의 목록을 내는 곳이 둘이고, 합치면 안 됩니다.** `/v2/consents/pending`은 최신 문서를 자바에서 걸러 **종류 순**으로, 로그인 응답은 SQL 한 문장으로 **발행 시각 순**으로 냅니다. 각각 다른 엔드포인트의 응답이고, 양쪽 주석이 서로를 가리킵니다.
- ⚠ **워커 큐 둘은 실패 정책이 다릅니다** — `ExternalOperationAnalysisQueue`(kind=`analyze`, 실패 시 **연습 세션도 실패**) vs `ExternalOperationMemoryQueue`(kind=`memory_update`, 연습은 건드리지 않음).

📌 `memory`에 Schema Entity가 없는 것은 이사 누락이 아닙니다 — `actor_memory_entries`에 대응하는 `@Entity`가 애초에 만들어진 적이 없고, **그 테이블만 `ddl-auto: validate` 밖에 있습니다**(→ SOMA-398).

## 계약에서 자주 깨지는 지점

전문은 [CONTRACT.md](CONTRACT.md) §6에 있고, 아래는 특히 자주 걸리는 것들입니다.

- Jackson `default-property-inclusion: always` — null 필드를 키째 실어보냅니다. 전역 `NON_NULL`을 켜지 않습니다.
- unknown key는 **전역 거부** + 허용이 필요한 DTO만 `@JsonIgnoreProperties(ignoreUnknown = true)`. 반대 방향(전역 허용 + DTO별 거부)은 Jackson이 표현하지 못합니다.
- `org.postgresql:postgresql`이 `runtimeOnly`가 아니라 `implementation`인 이유 — 유니크 위반을 제약명 문자열로 가르는 코드가 `PSQLException.getServerErrorMessage().getConstraint()`를 컴파일 타임에 참조합니다.
- `DATABASE_URL`(`postgresql://…`)은 `DatabaseUrlEnvironmentPostProcessor`가 JDBC URL + username/password로 변환합니다. **변수 이름은 배포가 주는 그대로 유지합니다.**
- Spring Web MVC + virtual threads. **WebFlux 금지**(CONTRACT §2).
- springdoc은 `openapi_3_1`로 맞춥니다 — 커밋된 스펙이 3.1.0이고 `const`/`anyOf` 표현이 3.0과 다릅니다.

## CI

`.github/workflows/ci.yml`의 잡 **`api (gradle test · Testcontainers)` 하나**가 이 디렉토리를 지킵니다 — `./gradlew test`. 이 잡이 없던 동안 Java 통합 테스트 17개가 깨진 채로 dev가 초록이었습니다.

⚠ **응답 바이트를 FastAPI와 대조하던 관문은 이제 없습니다.** 하네스 잡 둘이 `SOMA-403` 4단계에서 사라졌고, **계약을 지키는 것은 이 잡 안의 Java 테스트뿐입니다.** 무엇이 어디로 옮겨졌는지는 [docs/archive/soma287/M6-contract-migration.md](../../docs/archive/soma287/M6-contract-migration.md)에 있습니다.

⚠ **`OpenApiSnapshotIT`는 자기 스냅샷과 비교합니다.** `UPDATE_OPENAPI_SNAPSHOT=1`로 다시 뜨면 무엇을 바꿨든 초록입니다. 바깥 정본이 사라졌으므로 이 한계는 **구조적**이고, **스냅샷 diff를 눈으로 보는 것이 유일한 방어**입니다.

**잡 이름이 곧 required status check의 context입니다.** 이름을 바꾸거나 잡을 지우면 ruleset의 required check에서도 함께 고칩니다 — 어긋나면 **영원히 오지 않는 관문**이 생겨 이후 PR이 전부 막힙니다.
