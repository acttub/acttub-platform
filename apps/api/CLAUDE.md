# apps/api 지침

## 판정 순서

1. 바꾸는 기능의 [스펙](../../docs/specs/README.md)과 [CONTRACT.md](CONTRACT.md)를 읽습니다. 둘이 무엇을
   판정하는지는 루트 [CLAUDE.md 「조건부 정본」](../../CLAUDE.md#조건부-정본)을 따릅니다.
2. 아래 표에서 변경 갈래에 맞는 정본과 검증을 확인합니다.
3. 구조 결정의 이유로 ADR을 인용할 때는 [domain.md 「읽는 순서」](../../docs/agents/domain.md#읽는-순서)를 따릅니다.

| 변경 갈래 | 먼저 읽을 정본 | 최소 완료 기준 |
|---|---|---|
| DTO·직렬화·검증·오류 | 해당 기능 스펙, `CONTRACT.md` §4·§6 및 [계약 변경 절차](CONTRACT.md#계약-변경-절차) | 관련 MockMvc/계약 테스트와 계약 변경 절차의 완료 기준 통과 |
| 예외·보고 | `CONTRACT.md` §6-2(5xx 팩토리와 실패 보고), 실패 분류의 뜻은 [ARCHITECTURE 「용어」](../../docs/ARCHITECTURE.md#용어)(이유는 [ADR-025](../../docs/ADR.md)) | 변경한 모든 예외 처리 지점에서 원인·분류·보고 여부와 기존 응답·폴백 보존을 테스트로 확인 |
| 저장소·SQL·트랜잭션 | `CONTRACT.md` §5 | 실제 Postgres를 쓰는 통합 테스트로 쿼리와 커밋 경계 확인 |
| Entity·Flyway·제약 | `CONTRACT.md` §5-3·§5-5·§5-8 | `./gradlew test --tests '*Flyway*'`로 migration·fingerprint·baseline·forward 경로 확인 |
| feature·layer·port·패키지 의존 | [ARCHITECTURE 「api 층 규칙」](../../docs/ARCHITECTURE.md#api-층-규칙)과 구조 테스트(이유는 ADR-016~020) | `PackageLayerTest`·`PackageCycleTest`의 목록·비공허성 및 조건부 빈의 부팅 검사 확인 |
| Gradle·dotenv·Testcontainers·부팅 | 실제 설정과 대응 테스트 | dotenv를 끄고 필요한 키를 명시한 격리 부팅과 CI 환경 재현 |

현재 계약 방어선은 Java 테스트입니다.

## 로컬 설정

`DotenvEnvironmentPostProcessor`는 프로세스 작업 디렉터리의 `.env`를 로컬 개발 설정으로 읽고,
서버는 Compose가 `.env`·`release.env`에서 주입한 환경변수를 사용합니다. 실제 환경변수·시스템 프로퍼티·애플리케이션
설정이 `.env`보다 우선합니다.

- Gradle `test`의 `acttub.dotenv.enabled=false`를 유지합니다. 이 가드가 로컬 실 API 키의 테스트
  유입을 막습니다.
- 격리한 jar를 띄울 때는 `-Dacttub.dotenv.enabled=false`로 로컬 파일의 영향을 제거하고,
  애플리케이션이 요구하는 설정은 명시적으로 공급합니다.
- dotenv와 `DATABASE_URL` post-processor의 순서·우선순위를 바꾸면 실제 환경변수가 이기는지와
  배포 형식 URL 부팅을 테스트합니다.

## 완료 기준

표에서 변경한 모든 갈래의 정본·테스트·생성물 diff를 확인했고, Java 테스트
밖에 남는 계약 사각지대를 명시했습니다.
