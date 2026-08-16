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

**contract 프로파일에는 진짜 LLM·분석 체인이 서지 않습니다.** `observation/GeminiConfiguration`과
`analysis/AnalysisConfiguration`이 `@Profile("!contract")`이라, 하네스 인스턴스는 외부 API 키
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

도메인별 헥사고날로 옮기는 중이고 **`practice`만 끝났습니다**(ADR-017). 옮긴 도메인은 네 층으로 섭니다 — `domain`(규칙을 담은 Domain Model, 프레임워크 import 금지) · `app`(서비스와 포트 선언) · `adapter`(`web`·`db`·`storage`·`sched`) · `schema`(Schema Entity). 나머지 열세 도메인은 아직 평평하고, 그게 정상입니다.

- 층 방향은 `PackageLayerTest`가 강제합니다(순환은 `PackageCycleTest`가 따로 봅니다). 서브패키지로 갈리면서 저장소 클래스를 막아주던 package-private 보호가 옅어졌으므로 **이 검사가 구조를 지키는 유일한 장치입니다.**
- ⚠ **검사 대상이 `MIGRATED_FEATURES` 목록으로 한정돼 있습니다.** 도메인을 옮기면 그 목록에 이름을 추가해야 규칙이 걸립니다 — 빠뜨리면 새로 옮긴 도메인이 아무 검사 없이 통과합니다. 안 옮긴 도메인이 빨간불을 내지 않게 하려는 한정이라, 이 대가는 의도된 것입니다.
- 아직 못 거는 규칙이 하나 있습니다 — **feature끼리 직접 import 금지**. `practice`가 여전히 `storage`·`web`을 직접 참조합니다. 그 둘을 묶음 뒤로 보낸 뒤(SOMA-397 8단계) 붙습니다.
- **`operation`은 6단계에서 포트 뒤로 갔습니다.** 다섯 도메인(`practice`·`coach`·`report`·`memory`·`analysis`) 전부 `com.acttub.actingapi.operation`을 **한 줄도 import하지 않습니다.** 의존은 `operation` → 소비자 포트 한 방향뿐입니다.
  - 🔥 **교환 타입을 어디 두느냐가 이 단계의 전부였습니다.** 포트를 쓰는 쪽에 선언해도 시그니처에 `operation`의 record·예외가 들어가면 소비자 → 제공자 간선이 남고, 그러면 제공자가 그 포트를 구현하는 순간 `PackageCycleTest`가 빨간불이라 **구현을 소비자 쪽에 두는 수밖에 없어집니다**(ADR-017의 "구현은 제공하는 쪽에"가 깨지는 형태). → `SyncOperationBegin`·`SyncOperationClaim`·`LeaseOwnershipException`을 **`ledger`**(배관, 8단계에 `platform/ledger`로 갑니다)로 올려 풀었습니다. **포트를 새로 만들 때 시그니처에 제공자 패키지 이름이 보이면 아직 안 끊긴 것입니다.**
  - 그 결과 위임만 하던 어댑터가 사라지고 `SyncOperationService`가 `CoachOperationLedger`·`ReportOperationLedger`를 **직접 구현**합니다. 두 포트의 요구가 글자까지 같아 한 클래스가 둘 다 받습니다 — 갈리는 날 거기서 갈리면 됩니다.
  - 워커 큐는 종류와 실패 정책만 다릅니다 — `ExternalOperationAnalysisQueue`(kind=`analyze`, 실패 시 **연습 세션도 실패**) vs `ExternalOperationMemoryQueue`(kind=`memory_update`, 연습은 건드리지 않음). 그 둘이 갈리는 유일한 자리입니다.
- **`auth`는 7단계에서 갈리는 중입니다.** 요청 필터·동의 게이트·레이트리미터가 **`security`**(배관)로 나갔고, 여덟 도메인은 이제 `auth`가 아니라 `security`를 봅니다. 배관을 보는 것은 정상입니다 — 금지되는 것은 feature끼리의 직접 import입니다.
  - 🔥 **방향이 뒤집힌 경우입니다.** 6단계는 feature가 feature에 포트를 요구했지만, 여기서는 **배관이 feature에 요구합니다** — `security`가 `AccessTokenVerifier`·`AuthenticatedUsers`를 선언하고 `auth`의 `JwtService`·`AuthStore`가 그것을 **직접 구현**합니다(위임 어댑터를 끼우지 않습니다). 간선은 `auth` → `security` 한 방향뿐입니다.
  - 교환 타입 `AuthenticatedUser`가 `security`에 사는 이유도 같습니다. 이것이 `auth`에 있으면 받는 여덟이 전부 `auth`를 import하게 되어, 포트를 어디에 선언하든 간선이 남습니다.
  - ⚠ **`security`가 최상위에 임시로 있는 것은 의도된 것입니다.** 지금 `platform.` 접두어를 붙이면 `PackageCycleTest`의 슬라이스 매처가 조각들을 한 덩어리로 묶어 **순환 검사가 조용히 0이 됩니다**(ADR-017). 묶음 이사와 매처 수정은 8단계가 함께 합니다.

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
