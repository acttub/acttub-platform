# apps/api-java 지침

## 적용 범위 — 아직 정본이 아닙니다

Java 21 + Spring Boot 3.4. FastAPI(`apps/api`) 전면 이관 작업(`SOMA-287`)의 대상입니다.

**이관이 끝날 때까지 동작의 정본은 `apps/api`입니다.** 여기 코드는 계약을 정하는 쪽이 아니라, FastAPI가 이미 내고 있는 계약을 재현하는 쪽입니다. 성공 기준은 "엔드포인트가 동작한다"가 아니라 **"기존 응답 계약이 재현된다"**입니다 — `apps/web`이 `apps/api/spec/openapi.json`으로 타입을 생성하므로 필드 하나·nullable 하나가 어긋나면 프론트가 조용히 깨집니다.

## 판정 기준 (읽는 순서)

1. 루트 [SPEC.md](../../SPEC.md) — 모든 사이클 공통 규칙. §2 기술 스택은 확정이고 변경 금지.
2. `spec/M<n>-*.md` — 해당 마일스톤 문서.
3. [tools/contract-harness/README.md](../../tools/contract-harness/README.md) — 계약 동등성 판정 도구.

소스 참조는 **`파일:심볼` 형식**입니다. 라인 번호를 쓰지 않습니다(SPEC §12).

## 명령어 (이 디렉토리 기준)

- `./gradlew test` — JUnit 5 + Testcontainers. **Docker 필요.**
- `REQUIRE_ALEMBIC_CHECK=1 ./gradlew test` — CI와 같은 조건. 이 변수가 없으면 `FlywayBaselineTest`가 alembic을 못 돌릴 때 **조용히 건너뛰고 초록**이 됩니다.
- `./gradlew bootJar` — `acting-api.jar` 생성.
- `./gradlew bootRun` — 로컬 기동(:8080). 설정은 아래 `.env`가 공급합니다.
- `scripts/regen-baseline.sh` — baseline 스냅샷 재생성(아래 참조). Docker + uv 필요.
- 루트에서 `python3 spec/check-refs.py` — SPEC이 가리키는 심볼이 소스에 실재하는지.

계약 동등성 검사는 `apps/api`의 uv 가상환경을 그대로 씁니다(새 의존성을 들이지 않습니다):

```bash
cd apps/api && uv sync --frozen --all-packages    # 최초 1회
cd tools/contract-harness
PY=../../apps/api/.venv/bin/python
$PY -m contract_harness --baseline fastapi --target java --java-base-url http://127.0.0.1:8099
```

전체 시나리오는 기본(`contract`, ADMIN_OPS_TOKEN 없음), admin(`contract`, 토큰 있음),
nostorage(`contract,nostorage`) 인스턴스를 각각 띄우고 하네스의
`--java-admin-base-url`·`--java-nostorage-base-url`로 전달합니다. **기동 명령과 필요한
환경변수 전량은 [하네스 README](../../tools/contract-harness/README.md)의 `java 타겟` 절이
정본입니다** — 값은 하네스 `config.py`에서 나오므로 여기에 복사해 두지 않습니다.

**contract 프로파일에는 진짜 LLM·분석 체인이 서지 않습니다.** `integration/observation/GeminiConfiguration`과
`analysis/adapter/AnalysisConfiguration`이 `@Profile("!contract")`이라, 하네스 인스턴스는 외부 API 키
없이 뜹니다. 🔎 **`@Primary`로는 이걸 못 합니다** — `ContractAnalysisProcessor`가 주입 경합에서
이겨도 진짜 체인의 빈은 그대로 만들어지고, 그러다 `GEMINI_API_KEY`가 없어 컨텍스트가 죽었습니다.
새 외부 연동을 붙일 때는 스텁으로 대체할지, contract에서 아예 세우지 않을지를 먼저 정합니다.

## 로컬 설정은 `.env`, 서버는 systemd입니다

`DotenvEnvironmentPostProcessor`가 **작업 디렉토리의 `.env`를 읽어 환경변수처럼 씁니다.** 로컬 개발 편의용이고, 서버에서는 아무 일도 하지 않습니다 — 배포 아티팩트는 jar 하나뿐이라 `.env`가 없고, 설정은 systemd가 `EnvironmentFile=/etc/acttub/api.env`로 주입합니다.

```bash
ln -sfn ../api/acting-api/.env .env    # 최초 1회. 파이썬과 같은 파일을 공유합니다
./gradlew bootRun
```

**심링크로 두는 이유** — 파이썬 `config.py`가 `apps/api/acting-api/.env`를 경로 계산으로 읽습니다(옮기면 FastAPI 로컬 개발이 깨집니다). 파일을 복사하면 두 벌이 갈라지므로 한 곳만 둡니다. `.gitignore`에 있어 커밋되지 않습니다.

- **이미 있는 값을 덮지 않습니다.** `addLast`로 넣으므로 실제 환경변수·시스템 프로퍼티·`application.yml`이 항상 이깁니다.
- **테스트에서는 꺼집니다.** `build.gradle.kts`의 test 태스크가 `acttub.dotenv.enabled=false`를 박습니다. **이 가드를 지우면 로컬 실 API 키가 테스트로 새어들어**, 스텁을 쓰는 줄 알았던 테스트가 진짜 호출을 하게 됩니다.
- ⚠ **하네스용 인스턴스를 띄울 때도 꺼야 합니다** — `java -Dacttub.dotenv.enabled=false -jar …`. 하네스가 주지 않는 키(`S3_BUCKET`·`AWS_*` 등)가 `.env`에서 새어들면 판정이 로컬 환경에 좌우됩니다. 하네스는 격리된 환경이어야 재현됩니다.
  - 🔎 **이 원칙이 코드보다 앞서 있던 적이 있습니다.** `.env`가 `GEMINI_API_KEY`를 채워주는 동안 아무도 격리 기동을 해보지 않아, dotenv를 끄면 컨텍스트가 죽는 상태가 오래 남아 있었습니다(`SOMA-397` 1단계). **`src/test/resources/application.properties`가 같은 키를 주므로 테스트도 이걸 못 잡습니다** — `HarnessContractProfileIT`가 그래서 `GEMINI_API_KEY=`를 일부러 비웁니다.
- `DatabaseUrlEnvironmentPostProcessor`보다 **먼저** 돌아야 합니다(`.env`가 `DATABASE_URL`을 공급할 수 있으므로). 순서는 `getOrder()`로 고정했고 테스트가 지킵니다.

## Testcontainers는 Postgres 18입니다

운영 RDS가 18.4라 컨테이너도 **18**로 맞춥니다. PG18은 NOT NULL을 `pg_constraint`로 물질화하는 등 카탈로그가 달라, **16에서 통과한 스키마 검증이 운영을 보증하지 않습니다.** 버전을 BOM에 맡기지 않고 `build.gradle.kts`에 고정해 둡니다.

## 스키마는 Flyway가 소유합니다

- `ddl-auto: validate` 고정. `create`/`update`는 절대 금지(SPEC §2).
- `baseline-on-migrate: false` — 기존 dev·운영 DB의 baseline 기록은 애플리케이션이 아니라 별도 명령으로 합니다. 여기서 켜면 "빈 DB가 아닌데 V1을 건너뛰는" 판정을 애플리케이션이 조용히 내립니다.
- **`V1__baseline.sql`과 `alembic-schema-fingerprint.txt`는 alembic 결과의 스냅샷입니다.** `apps/api`에 마이그레이션이 추가되면 둘 다 낡는데, `FlywayBaselineTest`는 **이 둘을 서로 비교하므로 둘 다 낡아도 초록입니다.** 스키마가 바뀌는 PR마다 `scripts/regen-baseline.sh`를 돌리고 결과를 커밋합니다.

## 패키지 구조는 재편 중입니다 (SOMA-397)

최상위가 **세 묶음**으로 갈립니다(ADR-017) — `platform`(배관: web·security·config·harness·health·observability·ledger) · `integration`(외부 연동: oidc·llm·storage·media·observation) · 비즈니스 도메인. **앞의 둘은 8단계에서 섰고**, 도메인 열넷을 `feature` 아래로 넣는 것은 도메인 배치가 끝난 뒤의 **마지막 이사**입니다. 공용 `schema`는 도메인별로 흩어지는 중이라 아직 최상위에 있습니다.

도메인별 헥사고날로 옮기는 중이고 **열둘이 끝났습니다** — `practice`(4단계) · `community`(10단계) · `report`·`coach`(9단계) · `analysis`·`memory`(11단계) · `upload`·`profile`·`admissions`·`admin`·`auth`·`consent`(12단계). 옮긴 도메인은 `domain`(규칙을 담은 Domain Model, 프레임워크 import 금지) · `app`(서비스와 포트 선언) · `adapter`(`web`·`db`·`storage`·`media`·`sched`·`resource`) · `schema`(Schema Entity)로 섭니다. 남은 것은 13단계(`feature` 이사 + ArchUnit 한정 해제)뿐입니다.

- ⚠ **네 층을 다 갖는 도메인이 오히려 흔하지 않습니다**(ADR-020). 층은 넣을 것이 실재하는 만큼만 세웁니다 — `admissions`·`admin`은 `domain`과 `schema` 둘 다 없고(요강은 바깥에서 통째로 들어오는 문서라 행위 규칙이 없고, 운영 지표는 도메인을 가로질러 세는 일이라 자기 테이블이 없습니다), `memory`·`profile`은 `schema`가 없습니다. 🔎 **판별 기준은 11단계 `observation`과 같은 것이고 결론만 다릅니다** — 엔드포인트가 있으면 도메인이고, 그때는 묶음으로 보내지 않고 **가진 층만으로** 세웁니다.
- 📌 **집계하거나 읽어 온 것이 곧 응답인 도메인은 그 형태를 `app`에 둡니다** — `admissions/app/Admissions`·`admin/app/AdminMetrics`가 `report/app/PublicReport`와 같은 자리입니다. 중간 표현을 따로 만들면 필드 수십 개가 두 벌이 되고 그 어긋남을 웹은 컴파일 타임에 잡지 못합니다.
- 🔥 **조건부 빈이 있는 도메인에 서비스를 끼워 넣을 때는 조건을 함께 옮깁니다.** `admissions`(`@ConditionalOnResource`)·`admin`(`@ConditionalOnExpression`)이 그렇습니다 — 컨트롤러와 저장소만 조건부이던 자리에 서비스가 끼면 **그 서비스가 없는 빈을 요구해 컨텍스트가 기동하지 못합니다.** 🔎 하네스도 테스트도 이 자리를 보지 못합니다(리소스나 토큰이 없는 기동으로 인스턴스를 띄우는 시나리오가 없습니다. `admissions-missing`은 "없는 대학"이지 "없는 카탈로그"가 아닙니다). 12단계에서 조건을 뺀 채 요강 파일을 감춰 `NoSuchBeanDefinitionException`을 실제로 확인했습니다.

- 📌 **배선(`@Configuration`)은 그 도메인 `adapter` 층의 루트에 둡니다** — `analysis/adapter/AnalysisConfiguration`·`AnalysisWorkerConfiguration`. 어느 하위 어댑터에도 속하지 않고 여럿을 조립하기 때문입니다(먼저 옮긴 다섯 도메인에 이런 파일이 없는 것은 그들이 스프링 스테레오타입만 쓰기 때문이지, 루트를 비워야 해서가 아닙니다).
- 📌 **`domain`이 봐도 되는 것은 프레임워크가 아닌 것뿐입니다.** `memory/domain/MemoryValue`가 `platform/web/PythonText`를 봅니다 — `domain`이 배관을 보는 첫 사례이고, `domainKnowsNoFramework`가 막는 목록(스프링·JPA·Jackson·swagger)에는 없어 통과합니다. **의도한 것입니다** — 그 유틸은 파이썬 `str.strip`의 공백 집합을 재현하는 문자열 규칙이라 정규화 규칙과 같은 층에 속하고, 여기서 손으로 다시 구현하면 두 벌이 갈립니다. 이관이 끝나면 함께 사라질 것입니다.
- ⚠ **그래서 `PackageLayerTest`의 한정 목록이 이름 목록이 아니라 「도메인 → 그 도메인이 가진 층」 표입니다.** 없는 층을 적으면 그 규칙이 대상 0으로 조용히 통과하고, 반대로 **층이 새로 생겼는데 표에 안 적으면 그 층만 검사 밖에 남습니다** — `everyRuleActuallyHasSomethingToCheck`가 양쪽을 다 봅니다. `memory`에 Schema Entity가 없는 것은 이사 누락이 아니라 `actor_memory_entries`에 대응하는 `@Entity`가 애초에 만들어진 적이 없어서이고, **그 테이블만 `ddl-auto: validate` 밖에 있습니다**(→ SOMA-398).
  - 🔥 **층별 규칙은 그 표에서 대상을 끌어와야 합니다**(`featuresWithDomain`·`featuresWithSchema`). 목록 전체를 넘기면 층이 없는 도메인에서 **두 방향으로** 깨집니다 — `that()`으로 대상을 좁힌 규칙(`domainKnowsNoFramework`)은 ArchUnit이 대상 0을 실패로 쳐서 빨간불이 나고, 그렇지 않은 규칙(`schemaEntitiesAreNeverCalled`)은 반대로 대상 0으로 통과합니다.
  - `MIGRATED_FEATURES`가 열 쌍을 넘어 `Map.ofEntries`입니다. `Map.of`는 열 쌍까지만 받습니다.

- 🔥 **포트가 없음을 알리는 방법은 하나가 아닙니다**(ADR-018). `practice`는 `null`·`boolean`으로 알리지만 `community`는 **예외를 `app`에 선언하고 어댑터가 던집니다.** **정하는 단위는 연산이 아니라 포트 전체입니다** — 한 포트 안에서 방식이 둘이면 부르는 쪽이 연산마다 어느 쪽인지 기억해야 하므로, 갈래가 가장 많은 연산이 그 포트의 방식을 정합니다. `community`에서는 `updatePost`("없다"와 "내 것이 아니다"가 같은 트랜잭션·같은 잠금 안에서 갈립니다)가 그 연산이고, 그래서 `getPost`처럼 갈래가 하나인 것도 예외를 씁니다. 예외가 `app`에 살면 방향이 `adapter → app`이라 층 규칙에 맞고, 제공자와 소비자가 같은 도메인이라 시그니처에 남의 패키지 이름이 보이지도 않습니다.
- 📌 **예외 이름은 던지는 자리에서 정직해야 합니다.** 종전 `community`는 저장소의 `PostNotFound` 하나를 컨트롤러가 `post_not_found`·`target_not_found`·`user_not_found` 셋으로 갈랐습니다 — 뜻을 정하는 곳이 던지는 곳과 멀어 예외 이름만으로는 무엇이 없다는 것인지 알 수 없었습니다. 지금은 대상이 없으면 `CommunityContentNotFound` 하나이고, **부르는 자리에서 뜻이 하나로 정해집니다**(글을 쓸 때 없을 수 있는 것은 분류뿐입니다). 상태코드로 옮기는 일은 서비스가 합니다.
  - ⚠ **합치면 한 연산이 그 예외를 몇 군데서 던지는지 세어야 합니다.** 두 경로가 같은 예외면 뜻이 하나로 뭉개집니다 — `createPost`는 "분류가 없다" 와 "넣은 직후 다시 못 읽었다" 가 같은 예외였고, 뒤쪽은 종전에 안 잡혀 500이던 것이 404 `category_not_found`가 될 뻔했습니다(멀쩡한 분류를 탓하는 형태). `updateComment`의 부모 글 조회도 같았습니다. **불변식이 깨진 자리는 "없음"이 아니므로** `IllegalStateException`으로 냅니다 — `AnonymousAliasAllocator.lockPost`가 원래 그렇게 하고 있었습니다. 🔎 **하네스는 이 부류를 못 잡습니다**(도달하려면 파손된 데이터가 필요합니다). 리뷰 두 축이 독립적으로 짚어 잡혔습니다.

- 📌 **자원을 준 포트가 그것을 거둡니다.** `SummaryAnalyzer`(app)가 `FfmpegAudioExtractor.deleteTree(audioPath.getParent())`를 부르던 자리가 그랬습니다 — "추출물이 임시 디렉토리 안에 홀로 산다"는 구현 사정을 부르는 쪽이 알고 있어서, 디렉토리를 쓰지 않는 추출기로 갈아끼우면 엉뚱한 곳을 지웁니다. `AudioExtractor.discard`로 올렸고, **층으로 가르지 않았으면 드러나지 않았을 간선입니다**(11단계).
- 층 방향은 `PackageLayerTest`가 강제합니다(순환은 `PackageCycleTest`가 따로 봅니다). 서브패키지로 갈리면서 저장소 클래스를 막아주던 package-private 보호가 옅어졌으므로 **이 검사가 구조를 지키는 유일한 장치입니다.**
- ⚠ **검사 대상이 `MIGRATED_FEATURES` 목록으로 한정돼 있습니다.** 도메인을 옮기면 그 목록에 이름을 추가해야 규칙이 걸립니다 — 빠뜨리면 새로 옮긴 도메인이 아무 검사 없이 통과합니다. 안 옮긴 도메인이 빨간불을 내지 않게 하려는 한정이라, 이 대가는 의도된 것입니다.
- 아직 못 거는 규칙이 하나 있습니다 — **feature끼리 직접 import 금지**. `practice`가 참조하던 `storage`·`web`은 8단계에서 묶음 뒤로 갔으므로(배관·외부 연동을 보는 것은 정상입니다) 이제 걸 수 있고, 한정이 풀리는 **13단계**에 함께 들어옵니다.
  - ⚠ **그 규칙은 "상대의 `app` 층만 허용"으로 씁니다**(ADR-019). 두 도메인이 서로를 소비하면 양쪽 다 포트를 선언할 수 없어서입니다 — 구현하는 쪽이 인터페이스를 import하므로 간선이 양방향이 되어 순환입니다. `coach`↔`report`가 그 자리였고(9단계), `coach → report/app` 한 방향 **아홉 심볼**로 정렬돼 있습니다. 반대 방향은 0입니다(`ReportSourceProvider`를 코치 어댑터가 구현합니다). **참조 폭이 늘면 그것이 두 도메인을 합쳐야 한다는 신호입니다.**
  - 📌 그래서 **다른 도메인이 알아야 하는 타입은 `app`에 둡니다.** 성적표 본문의 공개 스키마(`report/app/PublicReport`)가 web이 아니라 app에 사는 이유가 그것입니다 — 코치 응답에도 같은 본문이 실립니다. 엔드포인트 입출력 봉투(`ReportDtos`)는 web에 남습니다.
- ⚠ **`PackageCycleTest`의 슬라이스 할당에 묶음 이름 목록(`BUNDLES`)이 있습니다.** 묶음을 새로 만들면 여기에 이름을 더해야 그 안이 조각으로 갈립니다 — 종전 `slices().matching(…(*)..)`은 첫 하위 패키지 하나로만 가르므로, 접두어가 붙으면 조각들이 한 덩어리가 되어 그 사이의 순환이 검사에서 사라집니다. 🔥 **순환 검사는 이 누락을 못 잡습니다** — 뭉친 묶음이 도메인과 **양방향** 간선을 가질 때만 사이클이 되어서, `integration`처럼 앱 안으로 나가는 간선이 없는 묶음은 뭉쳐도 **조용히 초록**입니다(실측). 그래서 `everyBundleIsInTheList`가 따로 잡습니다 — **층(`domain`·`app`·`adapter`·`schema`)이 아닌 하위 패키지를 거느린 최상위가 목록에 없으면 실패**합니다.
- **`operation`은 6단계에서 포트 뒤로 갔습니다.** 다섯 도메인(`practice`·`coach`·`report`·`memory`·`analysis`) 전부 `com.acttub.actingapi.operation`을 **한 줄도 import하지 않습니다.** 의존은 `operation` → 소비자 포트 한 방향뿐입니다.
  - 🔥 **교환 타입을 어디 두느냐가 이 단계의 전부였습니다.** 포트를 쓰는 쪽에 선언해도 시그니처에 `operation`의 record·예외가 들어가면 소비자 → 제공자 간선이 남고, 그러면 제공자가 그 포트를 구현하는 순간 `PackageCycleTest`가 빨간불이라 **구현을 소비자 쪽에 두는 수밖에 없어집니다**(ADR-017의 "구현은 제공하는 쪽에"가 깨지는 형태). → `SyncOperationBegin`·`SyncOperationClaim`·`LeaseOwnershipException`을 **`ledger`**(배관, 8단계에 `platform/ledger`로 갔습니다)로 올려 풀었습니다. **포트를 새로 만들 때 시그니처에 제공자 패키지 이름이 보이면 아직 안 끊긴 것입니다.**
  - 그 결과 위임만 하던 어댑터가 사라지고 `SyncOperationService`가 `CoachOperationLedger`·`ReportOperationLedger`를 **직접 구현**합니다. 두 포트의 요구가 글자까지 같아 한 클래스가 둘 다 받습니다 — 갈리는 날 거기서 갈리면 됩니다.
  - 워커 큐는 종류와 실패 정책이 다릅니다 — `ExternalOperationAnalysisQueue`(kind=`analyze`, 실패 시 **연습 세션도 실패**) vs `ExternalOperationMemoryQueue`(kind=`memory_update`, 연습은 건드리지 않음).
  - 🔥 **6단계가 memory 쪽에서 두 연산을 흘렸습니다**(11단계에서 회수). 포트가 있는데도 워커가 `JdbcTemplate`으로 `external_operations`를 직접 쳤습니다 — 잡이 어느 연습의 것인지 읽는 것과, 성공으로 닫는 것. 지금은 `MemoryUpdateQueue.practiceSessionOf`·`complete`입니다.
    - 📌 **응답 본문은 부르는 쪽이 만들어 넘깁니다.** `complete(operationId, leaseToken, JsonNode, now)` — `coach/app/CoachOperationLedger`·`report/app/ReportOperationLedger`와 같은 형태입니다. 그 바이트가 곧 계약이라 조립을 원장으로 넘기면 계약이 도메인 밖으로 나갑니다(재편 중 한 번 그렇게 갔다가 되돌렸습니다).
    - ⚠ **그 본문은 계약 하네스가 못 봅니다.** DB 투영이 external_operations를 `has_response_payload`(참·거짓)로만 비교하고, 백그라운드 워커는 contract 프로파일에서 아예 뜨지 않습니다 — **전 시나리오 diff 0을 통과해도 조용히 달라질 수 있는 자리**인데 그 바이트는 잡이 재생될 때 그대로 응답으로 나갑니다. `MemoryUpdateWorkerPayloadTest`가 파이썬 `memory_worker.py:run_once`의 모양에 못박아 둔 이유이고, **티켓의 "새 테스트를 쓰지 않는다"에 대한 예외는 이 근거 하나입니다**(seam 넷 중 어느 것도 이 바이트를 보지 못합니다).
- **`auth`는 7단계에서 세 갈래로 갈렸습니다.** 요청 필터·동의 게이트·레이트리미터가 **`platform/security`**로, OIDC 검증과 프로바이더 레지스트리가 **`integration/oidc`**로 나갔고(묶음 접두어는 8단계에서 붙었습니다), `auth`에는 로그인·토큰 발급·가입 출처만 남았습니다. 여덟 도메인은 이제 `auth`가 아니라 `security`를 봅니다 — 배관을 보는 것은 정상이고, 금지되는 것은 feature끼리의 직접 import입니다.
  - 🔥 **방향이 뒤집힌 경우입니다.** 6단계는 feature가 feature에 포트를 요구했지만, 여기서는 **배관이 feature에 요구합니다** — `security`가 `AccessTokenVerifier`·`AuthenticatedUsers`를 선언하고 `auth`의 `JwtService`·`AuthStore`가 그것을 **직접 구현**합니다(위임 어댑터를 끼우지 않습니다). 간선은 `auth` → `security` 한 방향뿐입니다.
  - 교환 타입 `AuthenticatedUser`가 `security`에 사는 이유도 같습니다. 이것이 `auth`에 있으면 받는 여덟이 전부 `auth`를 import하게 되어, 포트를 어디에 선언하든 간선이 남습니다.
  - `oidc`는 12단계에서도 포트로 감싸지 않았습니다 — `auth/app/AuthService`가 직접 부릅니다. 외부 연동을 보는 것은 금지 대상이 아니고(금지되는 것은 feature끼리의 직접 import입니다) 간선도 한 방향이라, 위임만 하는 포트를 끼우면 인터페이스만 늘고 얻는 것이 없습니다.
  - 🔥 **동의 조회 두 자리가 12단계에서 `consent`로 갔습니다.** 종전에는 `AuthStore`가 `consent_documents`·`user_consents`를 직접 읽었습니다. **한 포트는 한 쪽만 구현하므로 소유가 갈리면 포트도 갈립니다** — 게이트("막을 것인가")는 `AuthenticatedUsers`에서 떼어 `platform/security/PendingConsentGate`로 세웠고, 로그인 응답에 실리는 목록은 `auth/app/PendingConsentDocuments`로 선언해 `consent`가 구현합니다. 교환 타입 `PendingConsent`도 소비자인 `auth`에 삽니다(제공자 타입을 시그니처에 두면 구현하는 순간 순환입니다).
    - ⚠ **그 둘은 같은 것을 세지만 질의가 둘이고, 합치면 안 됩니다.** `/v2/consents/pending`은 최신 문서를 자바에서 걸러 **종류 순**으로, 로그인 응답은 SQL 한 문장으로 **발행 시각 순**으로 냅니다. 파이썬 정본이 두 자리를 그렇게 갈라 두었고 각각 다른 엔드포인트의 응답입니다. 양쪽 주석이 서로를 가리킵니다.
  - ⚠ **탈퇴는 `profile`이 `user_identities`·`refresh_tokens`를 함께 칩니다.** 그 두 테이블의 주인은 `auth`지만 파기의 원자성이 트랜잭션 하나를 요구합니다 — 포트로 갈라 두 도메인이 나눠 부르면 그 경계가 깨집니다. **SQL이 남의 테이블을 치는 것은 패키지 의존이 아니라** 구조 검사에 걸리지 않습니다(`admin`도 같은 형태로 도메인을 가로질러 셉니다).
  - 🔎 갈래를 가른 7단계와 묶음으로 옮긴 8단계 사이에는 `security`·`oidc`·`ledger`가 **최상위에 임시로 살았습니다.** 접두어를 먼저 붙이면 순환 검사가 조용히 0이 되므로, 접두어와 슬라이스 할당 수정을 같은 커밋에 뒀습니다(위 ⚠, ADR-017).
- **`memory`는 9단계에서 포트 뒤로 갔습니다.** `CoachController`가 저장소를 직접 주입받던 자리가 `coach/app/CoachMemory` 선언으로 바뀌고 `memory/adapter/db/PostgresMemoryRepository`가 그것을 **직접 구현**합니다(위임 어댑터 0). 교환 타입 `PriorContext`는 소비자인 `coach`의 것이라 간선이 `memory → coach` 한 방향입니다.
- ⚠ **응답 JSON 표기도 포트 뒤에 있습니다**(`coach/app/CoachResponseRenderer`). 코치 응답의 바이트는 **응답이면서 동시에 원장에 남는 값**이라 서비스가 그것을 만들어 원장에 넘겨야 하는데, 조립을 컨트롤러에 두면 규칙과 표기가 한 요청 안에서 두 번 오갑니다. 무엇을 담을지는 서비스가, 어떤 키로 담을지는 web 어댑터가 정합니다.

## 계약 재현에서 자주 깨지는 지점

- Jackson `default-property-inclusion: always` — null 필드를 키째 실어보냅니다. 전역 `NON_NULL`을 켜지 않습니다.
- unknown key는 **전역 거부** + 허용이 필요한 DTO만 `@JsonIgnoreProperties(ignoreUnknown = true)`. 반대 방향(전역 허용 + DTO별 거부)은 Jackson이 표현하지 못합니다.
- `org.postgresql:postgresql`이 `runtimeOnly`가 아니라 `implementation`인 이유 — 유니크 위반을 제약명 문자열로 가르는 코드가 `PSQLException.getServerErrorMessage().getConstraint()`를 컴파일 타임에 참조합니다.
- `DATABASE_URL`(`postgresql://…`)은 `DatabaseUrlEnvironmentPostProcessor`가 JDBC URL + username/password로 변환합니다. **변수 이름은 FastAPI와 같게 유지합니다.**
- Spring Web MVC + virtual threads. **WebFlux 금지**(SPEC §2).
- springdoc은 `openapi_3_1`로 맞춥니다 — 기존 스펙이 3.1.0이고 `const`/`anyOf` 표현이 3.0과 다릅니다.

## CI

`.github/workflows/ci.yml`의 잡 **둘**이 이 디렉토리를 지킵니다.

- **`api-java`** — `./gradlew test`. 이 잡이 없던 동안 Java 통합 테스트 17개가 깨진 채로 dev가 초록이었습니다. Java 잡인데도 파이썬 워크스페이스를 함께 설치하는데, `FlywayBaselineTest`가 `apps/api`의 alembic을 실제로 돌려 스키마를 대조하기 때문입니다.
- **`contract-harness-java`** — 세 인스턴스를 띄우고 `--target java`로 전 시나리오를 돌려 **FastAPI와의 계약 동등성**을 봅니다(`SOMA-397` 3단계). 테스트가 초록이어도 응답 바이트가 어긋날 수 있고, 웹은 FastAPI 스펙으로 타입을 생성하므로 그것을 컴파일 타임에 못 잡습니다. 절차의 정본은 [하네스 README](../../tools/contract-harness/README.md)의 `java 타겟` 절이고, 잡은 그것을 그대로 옮긴 것입니다.

## 사이클 진입 전 점검 (검사기로 대체 불가)

`check-refs.py`는 **참조가 실재하는지**만 봅니다. 심볼이 남은 채 동작만 바뀌면 통과합니다 — `SOMA-304`가 `POST /v2/coach/start`의 멱등 계약을 무효화했을 때 참조 102건이 전부 통과했고, SPEC은 성립하지 않는 계약을 가리킨 채 초록불이었습니다. 매 사이클 시작 시 `apps/api`의 dev 전진분을 SPEC 인용 서술에 대고 손으로 읽습니다. 절차는 SPEC §12.
