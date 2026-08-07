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
- `./gradlew bootRun` — 로컬 기동(:8080). `DATABASE_URL` 필요.
- `scripts/regen-baseline.sh` — baseline 스냅샷 재생성(아래 참조). Docker + uv 필요.
- 루트에서 `python3 spec/check-refs.py` — SPEC이 가리키는 심볼이 소스에 실재하는지.

계약 동등성 검사는 `apps/api`의 uv 가상환경을 그대로 씁니다(새 의존성을 들이지 않습니다):

```bash
cd apps/api && uv sync --frozen --all-packages    # 최초 1회
cd tools/contract-harness
PY=../../apps/api/.venv/bin/python
$PY -m contract_harness --baseline fastapi --target java --java-base-url http://127.0.0.1:8099
```

## Testcontainers는 Postgres 18입니다

운영 RDS가 18.4라 컨테이너도 **18**로 맞춥니다. PG18은 NOT NULL을 `pg_constraint`로 물질화하는 등 카탈로그가 달라, **16에서 통과한 스키마 검증이 운영을 보증하지 않습니다.** 버전을 BOM에 맡기지 않고 `build.gradle.kts`에 고정해 둡니다.

## 스키마는 Flyway가 소유합니다

- `ddl-auto: validate` 고정. `create`/`update`는 절대 금지(SPEC §2).
- `baseline-on-migrate: false` — 기존 dev·운영 DB의 baseline 기록은 애플리케이션이 아니라 별도 명령으로 합니다. 여기서 켜면 "빈 DB가 아닌데 V1을 건너뛰는" 판정을 애플리케이션이 조용히 내립니다.
- **`V1__baseline.sql`과 `alembic-schema-fingerprint.txt`는 alembic 결과의 스냅샷입니다.** `apps/api`에 마이그레이션이 추가되면 둘 다 낡는데, `FlywayBaselineTest`는 **이 둘을 서로 비교하므로 둘 다 낡아도 초록입니다.** 스키마가 바뀌는 PR마다 `scripts/regen-baseline.sh`를 돌리고 결과를 커밋합니다.

## 계약 재현에서 자주 깨지는 지점

- Jackson `default-property-inclusion: always` — null 필드를 키째 실어보냅니다. 전역 `NON_NULL`을 켜지 않습니다.
- unknown key는 **전역 거부** + 허용이 필요한 DTO만 `@JsonIgnoreProperties(ignoreUnknown = true)`. 반대 방향(전역 허용 + DTO별 거부)은 Jackson이 표현하지 못합니다.
- `org.postgresql:postgresql`이 `runtimeOnly`가 아니라 `implementation`인 이유 — 유니크 위반을 제약명 문자열로 가르는 코드가 `PSQLException.getServerErrorMessage().getConstraint()`를 컴파일 타임에 참조합니다.
- `DATABASE_URL`(`postgresql://…`)은 `DatabaseUrlEnvironmentPostProcessor`가 JDBC URL + username/password로 변환합니다. **변수 이름은 FastAPI와 같게 유지합니다.**
- Spring Web MVC + virtual threads. **WebFlux 금지**(SPEC §2).
- springdoc은 `openapi_3_1`로 맞춥니다 — 기존 스펙이 3.1.0이고 `const`/`anyOf` 표현이 3.0과 다릅니다.

## CI

`.github/workflows/ci.yml`의 `api-java` 잡이 이 디렉토리의 유일한 관문입니다 — 이 잡이 없던 동안 Java 통합 테스트 17개가 깨진 채로 dev가 초록이었습니다. Java 잡인데도 파이썬 워크스페이스를 함께 설치하는데, `FlywayBaselineTest`가 `apps/api`의 alembic을 실제로 돌려 스키마를 대조하기 때문입니다.

## 사이클 진입 전 점검 (검사기로 대체 불가)

`check-refs.py`는 **참조가 실재하는지**만 봅니다. 심볼이 남은 채 동작만 바뀌면 통과합니다 — `SOMA-304`가 `POST /v2/coach/start`의 멱등 계약을 무효화했을 때 참조 102건이 전부 통과했고, SPEC은 성립하지 않는 계약을 가리킨 채 초록불이었습니다. 매 사이클 시작 시 `apps/api`의 dev 전진분을 SPEC 인용 서술에 대고 손으로 읽습니다. 절차는 SPEC §12.
