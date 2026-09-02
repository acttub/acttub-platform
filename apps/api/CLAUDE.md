# apps/api 지침

## 판정 순서

1. [CONTRACT.md](CONTRACT.md)를 읽습니다. 이 문서는 API·영속·스키마의 행동 판정 기준입니다.
2. 아래 표에서 변경 갈래에 맞는 정본과 검증을 확인합니다.
3. 구조 결정의 이유를 인용할 때는 [domain.md](../../docs/agents/domain.md)의 방식으로 해당 ADR의
   개정 블록까지 읽습니다.

`spec/openapi.json`은 웹 타입 생성에 쓰는 요청·응답 **스키마 산출물**입니다. 오류와 상태 전이
같은 행동 계약 전체를 표현하지 않으며, 그 부분은 `CONTRACT.md`와 Java 테스트가 지킵니다.

| 변경 갈래 | 먼저 읽을 정본 | 최소 완료 기준 |
|---|---|---|
| DTO·직렬화·검증·오류 | `CONTRACT.md` §4·§6 | 관련 MockMvc/계약 테스트, OpenAPI diff, 웹·모바일 영향 확인 |
| 예외·보고 | `CONTRACT.md` §6·[ADR-025](../../docs/ADR.md) | 5xx `ApiException`은 `external(...)`·`unexpected(...)` 팩토리로 원인과 함께 만들고, 예외를 삼키는 자리는 `FailureReporter`로 보고 여부를 드러냄 |
| 저장소·SQL·트랜잭션 | `CONTRACT.md` §5 | 실제 Postgres를 쓰는 통합 테스트로 쿼리와 커밋 경계 확인 |
| Entity·Flyway·제약 | `CONTRACT.md` §5-3·§5-5·§5-8 | migration·fingerprint·baseline·forward 경로 확인 |
| feature·layer·port·패키지 의존 | [ADR-016~020](../../docs/ADR.md)과 구조 테스트 | `PackageLayerTest`·`PackageCycleTest`의 목록·비공허성 및 조건부 빈의 부팅 검사 확인 |
| Gradle·dotenv·Testcontainers·부팅 | 실제 설정과 대응 테스트 | dotenv를 끄고 필요한 키를 명시한 격리 부팅과 CI 환경 재현 |

FastAPI와 응답 바이트를 대조하던 parity harness는 폐기됐습니다. 그 계약의 현재 테스트 위치를
찾을 때만 [M6-contract-migration.md](../../docs/archive/soma287/M6-contract-migration.md)를
읽습니다. 현재 계약 방어선은 Java 테스트이며 실행 범위와 required check는 루트 지침을
따릅니다.

## 로컬 설정

`DotenvEnvironmentPostProcessor`는 프로세스 작업 디렉터리의 `.env`를 로컬 개발 설정으로 읽고,
서버는 systemd의 `EnvironmentFile`을 사용합니다. 실제 환경변수·시스템 프로퍼티·애플리케이션
설정이 `.env`보다 우선합니다.

- Gradle `test`의 `acttub.dotenv.enabled=false`를 유지합니다. 이 가드가 로컬 실 API 키의 테스트
  유입을 막습니다.
- 격리한 jar를 띄울 때는 `-Dacttub.dotenv.enabled=false`로 로컬 파일의 영향을 제거하고,
  애플리케이션이 요구하는 설정은 명시적으로 공급합니다.
- dotenv와 `DATABASE_URL` post-processor의 순서·우선순위를 바꾸면 실제 환경변수가 이기는지와
  배포 형식 URL 부팅을 테스트합니다.

## 스키마

- 스키마는 Flyway가 소유하고 Hibernate는 `ddl-auto: validate`로 대조합니다.
- `V1__baseline.sql`은 동결합니다. 스키마 변경은 현재 최대 번호 다음 migration으로 추가하고,
  baselined DB와 빈 DB 경로를 모두 검증합니다.
- 스키마가 바뀌면 `scripts/regen-fingerprint.sh`로
  `src/test/resources/baseline-schema-fingerprint.txt`를 갱신합니다.
- `baseline-on-migrate`를 애플리케이션에서 켜지 않습니다. 기존 DB의 최초 baseline은 명시적인
  배포 작업이고 신규·재해복구 DB는 V1부터 적용합니다.
- 마이그레이션은 jar 기동의 일부입니다. 축소는 루트 지침의 호환 배포 순서를 따릅니다.

## 영속

- 운영 DB 접근은 Spring Data JPA와 `EntityManager`로 일원화합니다. 직접 JDBC는 테스트 fixture와
  독립 검증에만 사용합니다.
- Schema Entity 26개는 자기 feature의 Adapter와 영속 내부 repository만 사용합니다. app·domain과
  다른 feature는 Schema Entity나 Spring Data interface에 의존하지 않습니다.
- native DML `RETURNING`은 `CONTRACT.md` §5-2·§5-8의 data-modifying CTE와 alias 기반 `Tuple`
  규칙을 따릅니다.

**완료 기준:** 표에서 변경한 모든 갈래의 정본·테스트·생성물 diff를 확인했고, Java 테스트
밖에 남는 계약 사각지대를 명시했습니다.
